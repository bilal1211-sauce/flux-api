<?php

namespace App\Domain\Executions;

use App\Models\ApiRequest;
use App\Models\AssertionResult;
use App\Models\Environment;
use App\Models\EnvironmentVariable;
use App\Models\RequestRun;
use App\Models\ResponseRecord;
use App\Models\UsageRecord;
use App\Models\Workspace;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class Executor
{
    public function recordLocal(Workspace $workspace, array $request, array $response, ?int $userId, ?string $executionId, ?array $localAssertions = null): RequestRun
    {
        DB::transaction(function () use ($workspace) {
            $locked = Workspace::whereKey($workspace->id)->lockForUpdate()->firstOrFail();
            $usage = UsageRecord::firstOrCreate(['workspace_id' => $workspace->id, 'day' => today()->toDateString()], ['runs' => 0]);
            if ($usage->runs >= $locked->daily_run_limit) {
                abort(429, 'Workspace daily execution limit reached.');
            }
            $usage->increment('runs');
        });

        $response['headers'] = array_filter($response['headers'], fn ($value, $key) => ! preg_match('/authorization|cookie|set-cookie|token|secret|api[-_]?key/i', $key), ARRAY_FILTER_USE_BOTH);
        $assertions = $localAssertions ?? app(AssertionEngine::class)->evaluate($request['assertions'] ?? [], $response);
        $body = $response['body'];
        $json = json_decode($body, true);
        $redact = function ($value) use (&$redact) {
            if (! is_array($value)) {
                return $value;
            }
            $safe = [];
            foreach ($value as $key => $entry) {
                $safe[$key] = is_string($key) && preg_match('/authorization|cookie|password|token|secret|api[-_]?key/i', $key) ? '[REDACTED]' : $redact($entry);
            }

            return $safe;
        };
        $safeBody = $json !== null ? json_encode($redact($json), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE) : mb_convert_encoding($body, 'UTF-8', 'UTF-8');
        $url = parse_url($request['url']);
        $safeUrl = ($url['scheme'] ?? 'https').'://'.($url['host'] ?? 'localhost').(isset($url['port']) ? ':'.$url['port'] : '').($url['path'] ?? '/');
        $errorCode = $response['error_code'] ?? ($response['truncated'] ? 'RESPONSE_TOO_LARGE' : null);
        $outcome = ! $errorCode && ($response['status'] ?? 0) >= 200 && $response['status'] < 300 && ! in_array(false, array_column($assertions, 'passed'), true) ? 'passed' : 'failed';

        return DB::transaction(function () use ($workspace, $request, $response, $userId, $executionId, $assertions, $safeBody, $safeUrl, $errorCode, $outcome) {
            $run = RequestRun::create([
                'workspace_id' => $workspace->id, 'api_request_id' => $request['id'] ?? null, 'user_id' => $userId,
                'name' => $request['name'], 'method' => $request['method'], 'url' => $safeUrl, 'source' => 'manual', 'execution_mode' => 'local', 'execution_id' => $executionId,
                'outcome' => $outcome, 'status' => $response['status'], 'duration_ms' => $response['duration_ms'], 'timings' => $response['timings'] ?? null,
                'size_bytes' => strlen($safeBody), 'error_code' => $errorCode,
            ]);
            ResponseRecord::create(['workspace_id' => $workspace->id, 'request_run_id' => $run->id, 'headers' => $response['headers'], 'body' => $safeBody, 'truncated' => $response['truncated']]);
            foreach ($assertions as $assertion) {
                AssertionResult::create(['workspace_id' => $workspace->id, 'request_run_id' => $run->id, ...$assertion]);
            }

            return $run->load('response', 'assertions');
        });
    }

    public function run(Workspace $workspace, array $request, ?int $userId, ?int $environmentId = null, string $source = 'manual', ?string $executionId = null): RequestRun
    {
        $result = Cache::lock('workspace-execution:'.$workspace->id, 30)->get(fn () => $this->runOnce($workspace, $request, $userId, $environmentId, $source, $executionId));
        if (! $result) {
            abort(429, 'Another request is running in this workspace. Try again shortly.');
        }

        return $result;
    }

    private function runOnce(Workspace $workspace, array $request, ?int $userId, ?int $environmentId, string $source, ?string $executionId): RequestRun
    {
        $variables = [];
        $secrets = [];
        if ($environmentId) {
            Environment::where('workspace_id', $workspace->id)->findOrFail($environmentId);
            foreach (EnvironmentVariable::where('environment_id', $environmentId)->where('workspace_id', $workspace->id)->get() as $v) {
                $variables[$v->key] = $v->value;
                if ($v->is_secret && $v->value !== '') {
                    $secrets[] = $v->value;
                }
            }
        }
        $expand = function (?string $s) use ($variables): string {
            return preg_replace_callback('/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/', function ($m) use ($variables) {
                if (! array_key_exists($m[1], $variables)) {
                    throw ValidationException::withMessages(['environment_id' => 'An environment variable is missing.']);
                }

                return $variables[$m[1]];
            }, $s ?? '');
        };
        $url = $expand($request['url']);
        $params = array_map($expand, $request['query_params'] ?? []);
        $headers = array_map($expand, $request['headers'] ?? []);
        foreach ($headers as $k => $v) {
            if (preg_match('/authorization|cookie|token|api[-_]?key|secret/i', $k) && $v !== '') {
                $secrets[] = $v;
            }
        }
        $auth = $request['auth_config'] ?? [];
        $authType = $request['auth_type'] ?? 'none';
        if ($authType === 'bearer') {
            $token = $expand($auth['token'] ?? '');
            $headers['Authorization'] = 'Bearer '.$token;
            $secrets[] = $token;
        } elseif ($authType === 'basic') {
            $username = $expand($auth['username'] ?? '');
            $password = $expand($auth['password'] ?? '');
            $headers['Authorization'] = 'Basic '.base64_encode($username.':'.$password);
            $secrets[] = $username;
            $secrets[] = $password;
        } elseif ($authType === 'api_key') {
            $key = $auth['key'] ?? '';
            $value = $expand($auth['value'] ?? '');
            if (($auth['in'] ?? 'header') === 'query') {
                $params[$key] = $value;
            } else {
                $headers[$key] = $value;
            }
            $secrets[] = $value;
        }
        if ($params) {
            $url .= (str_contains($url, '?') ? '&' : '?').http_build_query($params);
        }
        $approvedHost = app(SafeTarget::class)->host($url);
        $bodyTemplate = isset($request['body_base64']) ? base64_decode($request['body_base64'], true) : ($request['body'] ?? '');
        if ($bodyTemplate === false) {
            throw ValidationException::withMessages(['body_base64' => 'Invalid multipart body encoding.']);
        }
        $body = $expand($bodyTemplate);
        if (strlen($body) > 131072) {
            throw ValidationException::withMessages(['body' => 'Expanded body exceeds 128 KiB.']);
        }
        DB::transaction(function () use ($workspace) {
            $locked = Workspace::whereKey($workspace->id)->lockForUpdate()->firstOrFail();
            $usage = UsageRecord::firstOrCreate(['workspace_id' => $workspace->id, 'day' => today()->toDateString()], ['runs' => 0]);
            if ($usage->runs >= $locked->daily_run_limit) {
                abort(429, 'Workspace daily execution limit reached.');
            }
            $usage->increment('runs');
        });
        if (($request['body_mode'] ?? 'raw') === 'json' && ! array_key_exists('Content-Type', array_change_key_case($headers, CASE_LOWER))) {
            $headers['Content-Type'] = 'application/json';
        } elseif (($request['body_mode'] ?? 'raw') === 'urlencoded' && ! array_key_exists('Content-Type', array_change_key_case($headers, CASE_LOWER))) {
            $headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        $response = app(SafeTransport::class)->send($request['method'], $url, $headers, $body, min(15000, $request['timeout_ms'] ?? 15000), $approvedHost);
        $assertions = app(AssertionEngine::class)->evaluate($request['assertions'] ?? [], $response);
        usort($secrets, fn ($a, $b) => strlen($b) <=> strlen($a));
        $redact = function ($value) use (&$redact, $secrets) {
            if (is_array($value)) {
                $out = [];
                foreach ($value as $k => $v) {
                    $out[$k] = is_string($k) && preg_match('/authorization|cookie|password|token|secret|api[-_]?key/i', $k) ? '[REDACTED]' : $redact($v);
                }

                return $out;
            }
            if (! is_string($value)) {
                return $value;
            }
            foreach ($secrets as $secret) {
                $value = str_replace([$secret, rawurlencode($secret), urlencode($secret)], '[REDACTED]', $value);
            }

            return $value;
        };
        $jsonBody = json_decode($response['body'], true);
        $safeBody = $jsonBody !== null ? json_encode($redact($jsonBody), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE) : mb_convert_encoding($redact($response['body']), 'UTF-8', 'UTF-8');
        $safeUrl = preg_replace('/\?.*$/', '?[REDACTED]', $url);
        $outcome = ! $response['error_code'] && ! $response['truncated'] && $response['status'] >= 200 && $response['status'] < 300 && ! in_array(false, array_column($assertions, 'passed'), true) ? 'passed' : 'failed';

        return DB::transaction(function () use ($workspace, $request, $userId, $source, $response, $outcome, $safeBody, $safeUrl, $redact, $assertions, $executionId) {
            $run = RequestRun::create([
                'workspace_id' => $workspace->id, 'api_request_id' => $request['id'] ?? null, 'user_id' => $userId,
                'name' => $request['name'] ?? 'Untitled request', 'method' => $request['method'], 'url' => $redact($safeUrl), 'source' => $source, 'execution_mode' => 'cloud', 'execution_id' => $executionId,
                'outcome' => $outcome, 'status' => $response['status'], 'duration_ms' => $response['duration_ms'],
                'size_bytes' => strlen($response['body']), 'error_code' => $response['error_code'] ?? ($response['truncated'] ? 'RESPONSE_TOO_LARGE' : null),
            ]);
            ResponseRecord::create(['workspace_id' => $workspace->id, 'request_run_id' => $run->id, 'headers' => $redact($response['headers']), 'body' => $safeBody, 'truncated' => $response['truncated']]);
            foreach ($assertions as $assertion) {
                AssertionResult::create(['workspace_id' => $workspace->id, 'request_run_id' => $run->id, ...$redact($assertion)]);
            }

            return $run->load('response', 'assertions');
        });
    }

    public function saved(Workspace $workspace, ApiRequest $request, ?int $userId, ?int $environmentId = null, string $source = 'manual'): RequestRun
    {
        abort_unless($request->workspace_id === $workspace->id, 404);

        return $this->run($workspace, [...$request->toArray(), 'assertions' => $request->assertions->toArray()], $userId, $environmentId, $source);
    }
}
