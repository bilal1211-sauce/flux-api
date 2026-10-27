<?php

namespace App\Http\Controllers;

use App\Domain\Executions\Executor;
use App\Domain\Requests\RequestRules;
use App\Models\ApiRequest;
use App\Models\EnvironmentVariable;
use App\Models\RequestRun;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

class RunController extends Controller
{
    public function recordLocal(Request $r, string $workspace, Executor $executor)
    {
        $r->validate([
            'execution_id' => 'required|uuid', 'request' => 'required|array', 'response' => 'required|array',
            'assertion_results' => 'sometimes|array|max:30', 'assertion_results.*.type' => 'required_with:assertion_results|in:status,duration_lt,header_contains,json_equals,json_exists,body_contains',
            'assertion_results.*.path' => 'nullable|string|max:255', 'assertion_results.*.expected' => 'nullable', 'assertion_results.*.actual' => 'nullable', 'assertion_results.*.passed' => 'required_with:assertion_results|boolean',
            'response.status' => 'nullable|integer|min:100|max:599', 'response.headers' => 'present|array|max:100',
            'response.headers.*' => 'string|max:2048', 'response.body' => 'present|nullable|string|max:1048576',
            'response.duration_ms' => 'required|integer|min:0|max:60000', 'response.size_bytes' => 'required|integer|min:0|max:1048576',
            'response.truncated' => 'required|boolean', 'response.error_code' => 'nullable|in:TIMEOUT,CANCELLED,NETWORK_ERROR,RESPONSE_TOO_LARGE',
            'response.timings' => 'nullable|array', 'response.timings.*' => 'integer|min:0|max:60000',
        ]);
        abort_if(RequestRun::where('execution_id', $r->input('execution_id'))->exists(), 409, 'This execution was already recorded.');
        $workspaceModel = $r->attributes->get('workspace');
        $requestData = $r->input('request');
        $requestData['environment_id'] = $r->input('environment_id');
        $validated = Validator::make($requestData, [
            'name' => 'required|string|max:150', 'method' => 'required|in:GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
            'url' => 'required|string|max:4096', 'id' => 'nullable|integer',
            'collection_id' => 'nullable|integer', 'folder_id' => 'nullable|integer',
            'headers' => 'present|array|max:40', 'headers.*' => 'string|max:4096',
            'query_params' => 'present|array|max:50', 'query_params.*' => 'string|max:4096',
            'body' => 'nullable|string|max:65536', 'assertions' => 'present|array|max:30',
            'assertions.*.type' => 'required|in:status,duration_lt,header_contains,json_equals,json_exists,body_contains',
            'assertions.*.path' => 'nullable|string|max:255', 'assertions.*.expected' => 'nullable',
            'environment_id' => 'nullable|integer',
        ])->validate();
        $validated['id'] = null;
        if (! empty($requestData['id'])) {
            $saved = ApiRequest::where('workspace_id', $workspace)->findOrFail($requestData['id']);
            $validated['id'] = $saved->id;
            $validated['collection_id'] = $saved->collection_id;
            $validated['folder_id'] = $saved->folder_id;
        }
        $response = $r->input('response');
        $response['body'] = (string) ($response['body'] ?? '');
        foreach ($response['headers'] as $name => $value) {
            abort_if(! preg_match('/^[A-Za-z0-9-]{1,256}$/D', (string) $name) || preg_match('/[\r\n\x00]/', $value), 422, 'The local response contains an invalid header.');
        }

        $run = $executor->recordLocal($workspaceModel, $validated, $response, $r->user()->id, $r->input('execution_id'), $r->input('assertion_results'));
        $this->audit($r, 'request.executed', $run);

        return ['data' => $run];
    }

    public function execute(Request $r, string $workspace, Executor $executor)
    {
        $r->validate(['execution_id' => 'nullable|uuid']);
        if ($r->filled('execution_id')) {
            abort_if(RequestRun::where('execution_id', $r->input('execution_id'))->exists(), 409, 'This execution was already recorded.');
        }
        $data = RequestRules::validate($r, (int) $workspace);
        if ($r->filled('saved_request_id')) {
            $r->validate(['saved_request_id' => ['integer', Rule::exists('api_requests', 'id')->where('workspace_id', $workspace)]]);
            $data['id'] = (int) $r->input('saved_request_id');
        }
        $run = $executor->run($r->attributes->get('workspace'), $data, $r->user()->id, $data['environment_id'] ?? null, 'manual', $r->input('execution_id'));
        $this->audit($r, 'request.executed', $run);

        return ['data' => $run];
    }

    public function index(Request $r, string $workspace)
    {
        $r->validate($this->filterRules($workspace));
        $perPage = min(100, max(1, $r->integer('per_page', 25)));
        $runs = $this->filteredRuns($r, $workspace)
            ->paginate($perPage)
            ->withQueryString();
        $secrets = $this->workspaceSecrets($workspace);
        $runs->getCollection()->transform(fn (RequestRun $run) => $this->presentRun($run, $secrets));

        return ['data' => $runs];
    }

    public function export(Request $r, string $workspace)
    {
        $r->validate($this->filterRules($workspace));
        $query = $this->filteredRuns($r, $workspace);
        $total = (clone $query)->count('request_runs.id');
        $rows = $query->limit(5001)->get();
        $truncated = $rows->count() > 5000;
        $secrets = $this->workspaceSecrets($workspace);
        $data = $rows->take(5000)->map(fn (RequestRun $run) => $this->presentRun($run, $secrets));

        return ['data' => ['records' => $data, 'meta' => ['total' => $total, 'exported' => $data->count(), 'truncated' => $truncated, 'limit' => 5000]]];
    }

    public function show(Request $r, string $workspace, string $id)
    {
        $run = RequestRun::where('workspace_id', $workspace)
            ->with('response', 'assertions')
            ->findOrFail($id);

        return ['data' => $this->presentRun($run, $this->workspaceSecrets($workspace), true)];
    }

    public function compare(Request $r, string $workspace)
    {
        $r->validate(['first' => 'required|integer', 'second' => 'required|integer|different:first']);
        $runs = RequestRun::where('workspace_id', $workspace)
            ->with('response', 'assertions')
            ->whereIn('id', [$r->integer('first'), $r->integer('second')])
            ->get()
            ->keyBy('id');
        abort_unless($runs->has($r->integer('first')) && $runs->has($r->integer('second')), 404);
        $secrets = $this->workspaceSecrets($workspace);
        $a = $runs->get($r->integer('first'));
        $b = $runs->get($r->integer('second'));
        $first = $this->presentRun($a, $secrets, true);
        $second = $this->presentRun($b, $secrets, true);
        $bodyComparable = $a->response?->body !== null
            && $b->response?->body !== null
            && ! $a->response->truncated
            && ! $b->response->truncated;

        return ['data' => [
            'first' => $first,
            'second' => $second,
            'duration_delta_ms' => (int) $b->duration_ms - (int) $a->duration_ms,
            'size_delta_bytes' => (int) $b->size_bytes - (int) $a->size_bytes,
            'status_changed' => $a->status !== $b->status,
            'outcome_changed' => $a->outcome !== $b->outcome,
            'assertion_outcome_changed' => $first['assertion_outcome'] !== $second['assertion_outcome'],
            'failure_classification_changed' => $first['failure_classification'] !== $second['failure_classification'],
            'headers_changed' => ($first['response']['headers'] ?? null) !== ($second['response']['headers'] ?? null),
            'body_comparable' => $bodyComparable,
            'body_changed' => $bodyComparable ? $a->response->body !== $b->response->body : null,
        ]];
    }

    /** @return array<string, mixed> */
    private function filterRules(string $workspace): array
    {
        return [
            'outcome' => 'nullable|in:passed,failed',
            'method' => 'nullable|in:GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
            'search' => 'nullable|string|max:150',
            'source' => 'nullable|in:manual,monitor',
            'mode' => 'nullable|in:cloud,local',
            'classification' => 'nullable|in:success,execution_failure,http_failure,assertion_failure',
            'assertion_outcome' => 'nullable|in:passed,failed,none',
            'status' => ['nullable', 'regex:/^(?:[1-5][0-9]{2}|[1-5]xx|no_response)$/'],
            'date_from' => 'nullable|date_format:Y-m-d',
            'date_to' => 'nullable|date_format:Y-m-d|after_or_equal:date_from',
            'monitor_id' => ['nullable', 'integer', Rule::exists('monitors', 'id')->where('workspace_id', $workspace)],
            'sort' => 'nullable|in:newest,oldest,duration_desc,duration_asc,name_asc,name_desc',
            'page' => 'nullable|integer|min:1',
            'per_page' => 'nullable|integer|min:1|max:100',
        ];
    }

    private function filteredRuns(Request $r, string $workspace): Builder
    {
        $assertionStats = DB::table('assertion_results')
            ->where('workspace_id', $workspace)
            ->select('request_run_id')
            ->selectRaw('COUNT(*) as assertion_count, SUM(CASE WHEN passed = ? THEN 1 ELSE 0 END) as failed_count', [true])
            ->groupBy('request_run_id');
        $q = RequestRun::query()
            ->leftJoinSub($assertionStats, 'run_assertion_stats', fn ($join) => $join->on('run_assertion_stats.request_run_id', '=', 'request_runs.id'))
            ->where('request_runs.workspace_id', $workspace)
            ->select('request_runs.*', 'run_assertion_stats.assertion_count', 'run_assertion_stats.failed_count');

        foreach (['outcome', 'method', 'source'] as $field) {
            if ($r->filled($field)) {
                $q->where('request_runs.'.$field, $r->input($field));
            }
        }
        if ($r->filled('mode')) {
            $q->where('request_runs.execution_mode', $r->input('mode'));
        }
        if ($r->filled('search')) {
            $q->where('request_runs.name', 'like', '%'.$r->input('search').'%');
        }
        if ($r->filled('date_from')) {
            $q->where('request_runs.created_at', '>=', Carbon::createFromFormat('Y-m-d', $r->input('date_from'))->startOfDay());
        }
        if ($r->filled('date_to')) {
            $q->where('request_runs.created_at', '<=', Carbon::createFromFormat('Y-m-d', $r->input('date_to'))->endOfDay());
        }
        if ($r->filled('status')) {
            $status = (string) $r->input('status');
            if ($status === 'no_response') {
                $q->whereNull('request_runs.status');
            } elseif (preg_match('/^([1-5])xx$/', $status, $matches)) {
                $q->whereBetween('request_runs.status', [(int) $matches[1] * 100, (int) $matches[1] * 100 + 99]);
            } else {
                $q->where('request_runs.status', (int) $status);
            }
        }
        if ($r->filled('monitor_id')) {
            $q->whereIn('request_runs.id', DB::table('monitor_runs')->where('workspace_id', $workspace)->where('monitor_id', $r->integer('monitor_id'))->select('request_run_id'));
        }
        if ($r->input('assertion_outcome') === 'none') {
            $q->whereDoesntHave('assertions');
        } elseif ($r->input('assertion_outcome') === 'failed') {
            $q->whereHas('assertions', fn ($assertions) => $assertions->where('passed', false));
        } elseif ($r->input('assertion_outcome') === 'passed') {
            $q->whereHas('assertions')->whereDoesntHave('assertions', fn ($assertions) => $assertions->where('passed', false));
        }
        if ($r->filled('classification')) {
            $classification = $r->input('classification');
            if ($classification === 'execution_failure') {
                $q->where(fn ($query) => $query->whereNotNull('request_runs.error_code')->orWhereNull('request_runs.status'));
            } elseif ($classification === 'http_failure') {
                $q->whereNull('request_runs.error_code')->whereNotNull('request_runs.status')->where(fn ($query) => $query->where('request_runs.status', '<', 200)->orWhere('request_runs.status', '>=', 300));
            } elseif ($classification === 'assertion_failure') {
                $q->whereNull('request_runs.error_code')->whereBetween('request_runs.status', [200, 299])->whereHas('assertions', fn ($assertions) => $assertions->where('passed', false));
            } else {
                $q->whereNull('request_runs.error_code')->whereBetween('request_runs.status', [200, 299])->whereDoesntHave('assertions', fn ($assertions) => $assertions->where('passed', false));
            }
        }

        return match ($r->input('sort', 'newest')) {
            'oldest' => $q->orderBy('request_runs.created_at')->orderBy('request_runs.id'),
            'duration_desc' => $q->orderByDesc('request_runs.duration_ms')->orderByDesc('request_runs.id'),
            'duration_asc' => $q->orderBy('request_runs.duration_ms')->orderByDesc('request_runs.id'),
            'name_asc' => $q->orderBy('request_runs.name')->orderByDesc('request_runs.id'),
            'name_desc' => $q->orderByDesc('request_runs.name')->orderByDesc('request_runs.id'),
            default => $q->orderByDesc('request_runs.created_at')->orderByDesc('request_runs.id'),
        };
    }

    /** @return array<string, mixed> */
    private function presentRun(RequestRun $run, array $secrets, bool $includeDetails = false): array
    {
        $assertions = $includeDetails && $run->relationLoaded('assertions') ? $run->assertions : null;
        $assertionCount = $assertions?->count() ?? (int) ($run->assertion_count ?? 0);
        $failedCount = $assertions?->where('passed', false)->count() ?? (int) ($run->failed_count ?? 0);
        $assertionOutcome = $assertionCount === 0 ? 'none' : ($failedCount > 0 ? 'failed' : 'passed');
        $classification = $this->classify($run, $failedCount > 0);
        $record = [
            'id' => (int) $run->id,
            'execution_id' => $run->execution_id,
            'api_request_id' => $run->api_request_id ? (int) $run->api_request_id : null,
            'name' => $this->redactValue((string) $run->name, $secrets),
            'method' => $run->method,
            'url' => $this->safeEndpoint((string) $run->url),
            'source' => $run->source,
            'execution_mode' => $run->execution_mode,
            'outcome' => $run->outcome,
            'failure_classification' => $classification,
            'assertion_outcome' => $assertionOutcome,
            'status' => $run->status,
            'duration_ms' => (int) $run->duration_ms,
            'size_bytes' => (int) $run->size_bytes,
            'error_code' => $run->error_code,
            'timings' => $run->timings,
            'created_at' => $run->created_at?->toISOString(),
        ];
        if ($includeDetails) {
            $response = $run->relationLoaded('response') ? $run->response : null;
            $headers = [];
            foreach (($response?->headers ?? []) as $name => $value) {
                if (preg_match('/authorization|cookie|set-cookie|token|secret|password|api[-_]?key|credential/i', (string) $name)) {
                    continue;
                }
                $headers[$name] = $this->redactValue((string) $value, $secrets);
            }
            $record['response_available'] = $response !== null;
            $record['response'] = $response ? [
                'headers' => $headers,
                'body' => $response->body === null ? null : $this->redactStoredBody((string) $response->body, $secrets),
                'truncated' => (bool) $response->truncated,
            ] : null;
            $record['assertions'] = $assertions?->map(fn ($assertion) => [
                'type' => $assertion->type,
                'path' => $this->redactValue($assertion->path, $secrets),
                'expected' => $this->redactValue($assertion->expected, $secrets, 'expected'),
                'actual' => $this->redactValue($assertion->actual, $secrets, 'actual'),
                'passed' => (bool) $assertion->passed,
            ])->values()->all() ?? [];
        }

        return $record;
    }

    private function classify(RequestRun $run, bool $assertionsFailed): string
    {
        if ($run->error_code !== null || $run->status === null) {
            return 'execution_failure';
        }
        if ($run->status < 200 || $run->status >= 300) {
            return 'http_failure';
        }
        if ($assertionsFailed) {
            return 'assertion_failure';
        }

        return 'success';
    }

    private function safeEndpoint(string $url): string
    {
        $parts = parse_url($url);
        if (! is_array($parts) || empty($parts['host'])) {
            return 'Endpoint unavailable';
        }
        $segments = explode('/', trim((string) ($parts['path'] ?? '/'), '/'));
        $safe = array_map(function (string $segment, int $index) use ($segments): string {
            $previous = strtolower($segments[$index - 1] ?? '');
            $keyedSecret = preg_match('/^(token|secret|password|api[_-]?key|authorization|bearer|signature|access[_-]?token)$/i', $previous) === 1;
            $opaque = strlen($segment) >= 40 && preg_match('/^[A-Za-z0-9._~-]+$/', $segment) === 1;

            return $keyedSecret || $opaque ? '[redacted]' : $segment;
        }, $segments, array_keys($segments));

        return $parts['host'].(isset($parts['port']) ? ':'.$parts['port'] : '').'/'.implode('/', $safe);
    }

    private function workspaceSecrets(string $workspace): array
    {
        return EnvironmentVariable::where('workspace_id', $workspace)
            ->where('is_secret', true)
            ->get()
            ->map(function (EnvironmentVariable $variable) {
                try {
                    return (string) $variable->value;
                } catch (\Throwable) {
                    return '';
                }
            })
            ->filter(fn (string $secret) => $secret !== '')
            ->unique()
            ->values()
            ->all();
    }

    private function redactValue(mixed $value, array $secrets, string $key = ''): mixed
    {
        if ($key !== '' && preg_match('/authorization|cookie|password|token|secret|api[-_]?key|credential/i', $key)) {
            return '[REDACTED]';
        }
        if (is_array($value)) {
            $safe = [];
            foreach ($value as $name => $entry) {
                $safe[$name] = $this->redactValue($entry, $secrets, (string) $name);
            }

            return $safe;
        }
        if (is_object($value)) {
            return $this->redactValue((array) $value, $secrets, $key);
        }
        if (! is_string($value)) {
            return $value;
        }

        return $this->redactText($value, $secrets);
    }

    private function redactText(string $value, array $secrets): string
    {
        usort($secrets, fn (string $a, string $b) => strlen($b) <=> strlen($a));
        foreach ($secrets as $secret) {
            foreach (array_unique([$secret, rawurlencode($secret), urlencode($secret)]) as $variant) {
                if ($variant !== '') {
                    $value = str_replace($variant, '[REDACTED]', $value);
                }
            }
        }
        $value = preg_replace('/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}={0,2}/i', 'Bearer [REDACTED]', $value) ?? $value;
        $value = preg_replace('/\bBasic\s+[A-Za-z0-9+\/=]{12,}/i', 'Basic [REDACTED]', $value) ?? $value;
        $value = preg_replace("~([?&](?:access[_-]?token|api[_-]?key|token|secret|password|signature)=)[^&#\\s\"']*~i", '$1[REDACTED]', $value) ?? $value;

        return $value;
    }

    private function redactStoredBody(string $body, array $secrets): string
    {
        $decoded = json_decode($body, true);
        if (json_last_error() === JSON_ERROR_NONE) {
            return json_encode(
                $this->redactValue($decoded, $secrets),
                JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE,
            ) ?: '[Response snapshot unavailable]';
        }

        return $this->redactText($body, $secrets);
    }
}
