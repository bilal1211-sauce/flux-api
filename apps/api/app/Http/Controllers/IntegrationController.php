<?php

namespace App\Http\Controllers;

use App\Domain\Executions\SafeTarget;
use App\Domain\Requests\OpenApiDocument;
use App\Models\ApiRequest;
use App\Models\Collection;
use App\Models\CollectionFolder;
use App\Models\RequestAssertion;
use App\Models\RequestRun;
use App\Models\ShareLink;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class IntegrationController extends Controller
{
    public function import(Request $r, string $workspace)
    {
        $document = app(OpenApiDocument::class);
        $spec = $document->parse($r);
        if (! isset($spec['servers'][0]['url'])) {
            throw ValidationException::withMessages(['spec' => 'Add an explicit HTTPS server URL before importing.']);
        }
        $base = rtrim($spec['servers'][0]['url'], '/');
        app(SafeTarget::class)->host($base);
        if (parse_url($base, PHP_URL_QUERY) !== null) {
            throw ValidationException::withMessages(['spec' => 'Server URLs cannot contain query parameters.']);
        }
        $requests = [];
        foreach (($spec['paths'] ?? []) as $path => $ops) {
            if (! is_string($path) || ! str_starts_with($path, '/') || ! is_array($ops)) {
                throw ValidationException::withMessages(['spec.paths' => 'Invalid OpenAPI path item.']);
            }
            $ops = $document->resolve($ops, $spec);
            if (isset($ops['parameters']) && ! is_array($ops['parameters'])) {
                throw ValidationException::withMessages(['spec' => 'Path parameters must be an array.']);
            }
            foreach ($ops as $method => $op) {
                if (! in_array(strtoupper($method), ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'], true)) {
                    continue;
                }
                if (! is_array($op)) {
                    throw ValidationException::withMessages(['spec' => 'Invalid operation.']);
                }
                $op = $document->resolve($op, $spec);
                if (isset($op['requestBody'])) {
                    $op['requestBody'] = $document->resolve($op['requestBody'], $spec);
                }
                foreach (['parameters', 'responses', 'tags', 'requestBody'] as $field) {
                    if (isset($op[$field]) && ! is_array($op[$field])) {
                        throw ValidationException::withMessages(['spec' => 'Invalid operation '.$field.'.']);
                    }
                }
                if (isset($op['tags'][0]) && ! is_string($op['tags'][0])) {
                    throw ValidationException::withMessages(['spec' => 'Operation tags must be strings.']);
                }
                $url = $base.$path;
                $query = [];
                $headers = [];
                $parameters = [...($ops['parameters'] ?? []), ...($op['parameters'] ?? [])];
                foreach ($parameters as $p) {
                    $p = $document->resolve($p, $spec);
                    if (isset($p['schema']) && is_array($p['schema'])) {
                        $p['schema'] = $document->resolve($p['schema'], $spec);
                    }
                    if (! is_array($p) || ! is_string($p['name'] ?? null)) {
                        throw ValidationException::withMessages(['spec' => 'Invalid operation parameter.']);
                    }
                    if (isset($p['schema']) && ! is_array($p['schema'])) {
                        throw ValidationException::withMessages(['spec' => 'Invalid parameter schema.']);
                    }
                    if (! is_scalar($p['example'] ?? $p['schema']['default'] ?? 'example')) {
                        throw ValidationException::withMessages(['spec' => 'Only scalar parameter examples are supported.']);
                    }
                    $value = (string) ($p['example'] ?? $p['schema']['default'] ?? 'example');
                    if (($p['in'] ?? '') === 'path') {
                        $url = str_replace('{'.$p['name'].'}', rawurlencode($value), $url);
                    }
                    if (($p['in'] ?? '') === 'query') {
                        $query[$p['name']] = $value;
                    }
                    if (($p['in'] ?? '') === 'header' && ! preg_match('/authorization|cookie|token|key|secret/i', $p['name'])) {
                        $headers[$p['name']] = $value;
                    }
                }
                $status = 200;
                foreach (array_keys($op['responses'] ?? []) as $code) {
                    if (preg_match('/^2\d\d$/', (string) $code)) {
                        $status = (int) $code;
                        break;
                    }
                }
                $example = $op['requestBody']['content']['application/json']['example'] ?? null;
                if ($example !== null && strlen(json_encode($example)) > 65536) {
                    throw ValidationException::withMessages(['spec' => 'Request body example exceeds 64 KiB.']);
                }
                if ($example !== null) {
                    $headers['Content-Type'] = 'application/json';
                }
                $name = $op['summary'] ?? $op['operationId'] ?? strtoupper($method).' '.$path;
                if (! is_string($name) || strlen($name) > 150 || strlen($url) > 4096 || preg_match('/[{}]/', $url)) {
                    throw ValidationException::withMessages(['spec' => 'Operation name, URL or unresolved path parameter is invalid.']);
                }
                $requests[] = ['name' => $name, 'method' => strtoupper($method), 'url' => $url, 'headers' => $headers, 'query_params' => $query, 'body' => $example === null ? null : json_encode($example), 'status' => $status, 'tag' => substr((string) ($op['tags'][0] ?? 'Endpoints'), 0, 100)];
                if (count($requests) > 200) {
                    throw ValidationException::withMessages(['spec' => 'At most 200 operations may be imported.']);
                }
            }
        }
        if (! $requests) {
            throw ValidationException::withMessages(['spec' => 'No supported operations found.']);
        }
        $collection = DB::transaction(function () use ($workspace, $spec, $requests, $r) {
            $c = Collection::create(['workspace_id' => $workspace, 'name' => $spec['info']['title'], 'description' => 'Imported from OpenAPI '.$spec['openapi']]);
            $folders = [];
            foreach ($requests as $request) {
                $tag = $request['tag'];
                $status = $request['status'];
                unset($request['tag'], $request['status']);
                $folders[$tag] ??= CollectionFolder::create(['workspace_id' => $workspace, 'collection_id' => $c->id, 'name' => $tag])->id;
                $api = ApiRequest::create(['workspace_id' => $workspace, 'collection_id' => $c->id, 'folder_id' => $folders[$tag], ...$request]);
                RequestAssertion::create(['workspace_id' => $workspace, 'api_request_id' => $api->id, 'type' => 'status', 'expected' => $status]);
            }
            $this->audit($r, 'openapi.imported', $c);

            return $c;
        });

        return response()->json(['data' => ['collection' => $collection, 'imported_requests' => count($requests)]], 201);
    }

    public function shares(Request $r, string $workspace)
    {
        $filters = $r->validate([
            'search' => 'nullable|string|max:100',
            'status' => 'nullable|in:active,expired,revoked',
            'sort' => 'nullable|in:name,created_at,expires_at',
            'direction' => 'nullable|in:asc,desc',
            'per_page' => 'nullable|integer|min:1|max:50',
        ]);
        $query = ShareLink::where('workspace_id', $workspace)->select(['id', 'workspace_id', 'name', 'expires_at', 'revoked_at', 'created_at', 'updated_at']);
        if (! empty($filters['search'])) {
            $query->where('name', 'like', '%'.$filters['search'].'%');
        }
        if (($filters['status'] ?? null) === 'active') {
            $query->whereNull('revoked_at')->where('expires_at', '>', now());
        } elseif (($filters['status'] ?? null) === 'expired') {
            $query->whereNull('revoked_at')->where('expires_at', '<=', now());
        } elseif (($filters['status'] ?? null) === 'revoked') {
            $query->whereNotNull('revoked_at');
        }
        $page = $query->orderBy($filters['sort'] ?? 'created_at', $filters['direction'] ?? 'desc')->paginate((int) ($filters['per_page'] ?? 20))->appends($r->query());

        return ['data' => $page->items(), 'meta' => [
            'current_page' => $page->currentPage(),
            'last_page' => $page->lastPage(),
            'per_page' => $page->perPage(),
            'total' => $page->total(),
        ]];
    }

    public function shareOverview(Request $r, string $workspace)
    {
        $query = ShareLink::where('workspace_id', $workspace);

        return ['data' => [
            'total' => (clone $query)->count(),
            'active' => (clone $query)->whereNull('revoked_at')->where('expires_at', '>', now())->count(),
            'expired' => (clone $query)->whereNull('revoked_at')->where('expires_at', '<=', now())->count(),
            'recently_created' => (clone $query)->where('created_at', '>=', now()->subDays(7))->count(),
        ]];
    }

    public function previewShare(Request $r, string $workspace)
    {
        $data = $r->validate(['period_days' => 'required|integer|in:1,7,30']);

        return ['data' => $this->reportSnapshot($workspace, (int) $data['period_days'])];
    }

    public function showShare(Request $r, string $workspace, string $id)
    {
        $share = ShareLink::where('workspace_id', $workspace)->findOrFail($id);

        return ['data' => [
            'share' => $share->only(['id', 'name', 'expires_at', 'revoked_at', 'created_at']),
            'snapshot' => $share->snapshot,
        ]];
    }

    public function createShare(Request $r, string $workspace)
    {
        $data = $r->validate(['name' => 'required|string|max:100', 'expires_in_hours' => 'required|integer|min:1|max:168', 'period_days' => 'sometimes|integer|in:1,7,30']);
        abort_unless(in_array($r->attributes->get('workspace_role'), ['owner', 'editor'], true), 403);
        $snapshot = $this->reportSnapshot($workspace, (int) ($data['period_days'] ?? 7));
        $snapshot['name'] = $data['name'];
        $token = Str::random(48);
        $share = ShareLink::create(['workspace_id' => $workspace, 'name' => $data['name'], 'token_hash' => hash('sha256', $token), 'snapshot' => $snapshot, 'expires_at' => now()->addHours($data['expires_in_hours'])]);
        $this->audit($r, 'report.shared', $share);

        return response()->json(['data' => ['share' => $share, 'token' => $token]], 201);
    }

    public function revokeShare(Request $r, string $workspace, string $id)
    {
        $share = ShareLink::where('workspace_id', $workspace)->findOrFail($id);
        $share->update(['revoked_at' => now()]);
        $this->audit($r, 'report.revoked', $share);

        return ['data' => $share];
    }

    public function publicReport(string $token)
    {
        $share = ShareLink::where('token_hash', hash('sha256', $token))->whereNull('revoked_at')->where('expires_at', '>', now())->firstOrFail();

        return response()->json(['data' => $share->snapshot])->header('Cache-Control', 'no-store')->header('Referrer-Policy', 'no-referrer');
    }

    private function reportSnapshot(string $workspace, int $periodDays): array
    {
        $since = now()->subDays($periodDays);
        $runs = RequestRun::where('workspace_id', $workspace)->where('created_at', '>=', $since);
        $count = (clone $runs)->count();
        $passed = (clone $runs)->where('outcome', 'passed')->count();
        $average = (clone $runs)->avg('duration_ms');
        $results = (clone $runs)->latest('id')->limit(50)->get(['outcome', 'status', 'duration_ms', 'created_at'])->values()->toArray();

        return [
            'generated_at' => now()->toIso8601String(),
            'period' => $periodDays === 1 ? 'Last 24 hours' : "Last {$periodDays} days",
            'period_days' => $periodDays,
            'total_runs' => $count,
            'passed' => $passed,
            'failed' => max(0, $count - $passed),
            'average_latency_ms' => $count && $average !== null ? (int) round((float) $average) : null,
            'results' => $results,
        ];
    }
}
