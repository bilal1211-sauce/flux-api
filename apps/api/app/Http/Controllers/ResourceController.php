<?php

namespace App\Http\Controllers;

use App\Domain\Requests\RequestRules;
use App\Models\AlertRule;
use App\Models\ApiRequest;
use App\Models\Collection;
use App\Models\CollectionFolder;
use App\Models\Environment;
use App\Models\EnvironmentVariable;
use App\Models\Monitor;
use App\Models\RequestAssertion;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ResourceController extends Controller
{
    private const MODELS = ['collections' => Collection::class, 'folders' => CollectionFolder::class, 'requests' => ApiRequest::class, 'environments' => Environment::class, 'monitors' => Monitor::class];

    public function index(Request $r, string $workspace, string $resource)
    {
        $exists = fn ($table) => Rule::exists($table, 'id')->where('workspace_id', $workspace);
        $r->validate([
            'page' => 'sometimes|integer|min:1',
            'per_page' => 'sometimes|integer|min:1|max:100',
            'search' => 'sometimes|nullable|string|max:200',
            'collection_id' => ['sometimes', 'nullable', 'integer', $exists('collections')],
            'folder_id' => ['sometimes', 'nullable', 'integer', $exists('collection_folders')],
            'sort' => 'sometimes|in:default,name,method,updated_at',
        ]);
        $page = $r->integer('page', 1);
        $perPage = $r->integer('per_page', 100);
        $model = self::MODELS[$resource] ?? abort(404);
        $query = $model::where('workspace_id', $workspace);
        if ($resource === 'folders') {
            $query->orderBy('collection_id')->orderBy('parent_id')->orderBy('sort_order')->orderBy('id');
        } elseif ($resource === 'requests') {
            if ($r->filled('search')) {
                $search = trim((string) $r->input('search'));
                $query->where(function ($match) use ($search) {
                    $match->where('name', 'like', '%'.$search.'%')
                        ->orWhere('url', 'like', '%'.$search.'%')
                        ->orWhere('method', 'like', '%'.$search.'%');
                });
            }
            if ($r->filled('collection_id')) {
                $query->where('collection_id', $r->integer('collection_id'));
            }
            if ($r->filled('folder_id')) {
                $query->where('folder_id', $r->integer('folder_id'));
            }
            match ($r->input('sort', 'default')) {
                'name' => $query->orderBy('name')->orderBy('id'),
                'method' => $query->orderBy('method')->orderBy('name')->orderBy('id'),
                'updated_at' => $query->orderByDesc('updated_at')->orderByDesc('id'),
                default => $query->orderByDesc('pinned')->orderBy('sort_order')->orderBy('id'),
            };
        } else {
            $query->orderBy('id');
        }
        if ($resource === 'requests') {
            $query->with('assertions');
        }
        $total = (clone $query)->count();
        $lastPage = max(1, (int) ceil($total / $perPage));
        $items = $query->forPage($page, $perPage)->get();
        if ($resource === 'environments') {
            $variables = EnvironmentVariable::where('workspace_id', $workspace)->whereIn('environment_id', $items->pluck('id'))->orderBy('id')->get()->groupBy('environment_id');
            $items->each(function ($item) use ($variables) {
                $item->setAttribute('variables', ($variables->get($item->id) ?? collect())->map(fn ($v) => ['id' => $v->id, 'key' => $v->key, 'is_secret' => $v->is_secret, 'value' => $v->is_secret ? null : $v->value]));
            });
        }
        if ($resource === 'monitors') {
            $monitorIds = $items->pluck('id');
            $rules = AlertRule::where('workspace_id', $workspace)->whereIn('monitor_id', $monitorIds)->get()->keyBy('monitor_id');
            $latestIds = DB::table('monitor_runs')->where('workspace_id', $workspace)->whereIn('monitor_id', $monitorIds)->selectRaw('monitor_id, MAX(id) as latest_id')->groupBy('monitor_id');
            $latestRuns = DB::table('monitor_runs')
                ->joinSub($latestIds, 'latest_monitor_runs', fn ($join) => $join->on('monitor_runs.id', '=', 'latest_monitor_runs.latest_id'))
                ->join('request_runs', function ($join) use ($workspace) {
                    $join->on('request_runs.id', '=', 'monitor_runs.request_run_id')->where('request_runs.workspace_id', '=', $workspace);
                })
                ->select(['monitor_runs.monitor_id', 'request_runs.id as last_run_id', 'request_runs.status as last_status', 'request_runs.duration_ms as last_duration_ms', 'request_runs.error_code as last_error_code'])
                ->get()->keyBy('monitor_id');
            $recentChecks = DB::table('monitor_runs')
                ->join('request_runs', function ($join) use ($workspace) {
                    $join->on('request_runs.id', '=', 'monitor_runs.request_run_id')->where('request_runs.workspace_id', '=', $workspace);
                })
                ->where('monitor_runs.workspace_id', $workspace)
                ->whereIn('monitor_runs.monitor_id', $monitorIds)
                ->where('request_runs.created_at', '>=', now()->subDays(7))
                ->selectRaw('monitor_runs.monitor_id, COUNT(*) as checks_7d, SUM(CASE WHEN request_runs.outcome = ? THEN 1 ELSE 0 END) as passed_7d', ['passed'])
                ->groupBy('monitor_runs.monitor_id')->get()->keyBy('monitor_id');
            $openIncidents = DB::table('alert_events')->where('workspace_id', $workspace)->whereIn('monitor_id', $monitorIds)->whereNull('resolved_at')->selectRaw('monitor_id, COUNT(*) as open_incidents')->groupBy('monitor_id')->pluck('open_incidents', 'monitor_id');
            $items->each(function ($monitor) use ($rules, $latestRuns, $recentChecks, $openIncidents) {
                $checks = $recentChecks->get($monitor->id);
                $lastRun = $latestRuns->get($monitor->id);
                $monitor->setAttribute('alert_rule', $rules->get($monitor->id));
                $monitor->setAttribute('last_run_id', $lastRun?->last_run_id);
                $monitor->setAttribute('last_status', $lastRun?->last_status);
                $monitor->setAttribute('last_duration_ms', $lastRun?->last_duration_ms);
                $monitor->setAttribute('last_error_code', $lastRun?->last_error_code);
                $monitor->setAttribute('checks_7d', (int) ($checks?->checks_7d ?? 0));
                $monitor->setAttribute('passed_7d', (int) ($checks?->passed_7d ?? 0));
                $monitor->setAttribute('success_rate_7d', $checks && (int) $checks->checks_7d > 0 ? round((int) $checks->passed_7d / (int) $checks->checks_7d * 100, 2) : null);
                $monitor->setAttribute('open_incidents', (int) ($openIncidents->get($monitor->id) ?? 0));
            });
        }

        $meta = ['current_page' => $page, 'last_page' => $lastPage, 'per_page' => $perPage, 'total' => $total];
        if ($resource === 'requests') {
            $meta['collection_counts'] = ApiRequest::where('workspace_id', $workspace)
                ->selectRaw('collection_id, COUNT(*) as total')
                ->groupBy('collection_id')
                ->get()
                ->mapWithKeys(fn ($row) => [(string) ($row->collection_id ?? 'unassigned') => (int) $row->total]);
        }

        return ['data' => $items, 'meta' => $meta];
    }

    public function showRequest(Request $r, string $workspace, string $id): array
    {
        return ['data' => ApiRequest::where('workspace_id', $workspace)->with('assertions')->findOrFail($id)];
    }

    public function save(Request $r, string $workspace, string $resource, ?string $id = null)
    {
        $model = self::MODELS[$resource] ?? abort(404);
        $item = $id ? $model::where('workspace_id', $workspace)->findOrFail($id) : new $model;
        $exists = fn ($table) => Rule::exists($table, 'id')->where('workspace_id', $workspace);
        $data = match ($resource) {
            'requests' => RequestRules::validate($r, (int) $workspace),
            'collections' => $r->validate(['name' => 'required|string|max:150', 'description' => 'nullable|string|max:2000']),
            'folders' => $r->validate(['name' => 'required|string|max:100', 'collection_id' => ['required', 'integer', $exists('collections')], 'parent_id' => ['nullable', 'integer', Rule::exists('collection_folders', 'id')->where('workspace_id', $workspace)->where('collection_id', $r->input('collection_id'))], 'sort_order' => 'sometimes|integer|min:0|max:1000000']),
            'environments' => $r->validate(['name' => 'required|string|max:100', 'variables' => 'present|array|max:100', 'variables.*.key' => 'required|regex:/^[A-Za-z_][A-Za-z0-9_]*$/|max:100|distinct', 'variables.*.value' => 'present|nullable|string|max:8192', 'variables.*.is_secret' => 'required|boolean']),
            'monitors' => $r->validate(['name' => 'required|string|max:150', 'api_request_id' => ['required', 'integer', $exists('api_requests')], 'environment_id' => ['nullable', 'integer', $exists('environments')], 'interval_minutes' => 'required|integer|min:1|max:1440', 'enabled' => 'required|boolean', 'failure_threshold' => 'required|integer|min:1|max:20']),
        };
        $item = DB::transaction(function () use ($r, $workspace, $resource, $item, $data) {
            $fields = $data;
            unset($fields['assertions'], $fields['variables'], $fields['environment_id'], $fields['failure_threshold']);
            $descendants = [];
            if ($resource === 'folders' && $item->exists) {
                $descendants = [(int) $item->id];
                $frontier = $descendants;
                while ($frontier) {
                    $frontier = CollectionFolder::where('workspace_id', $workspace)->whereIn('parent_id', $frontier)->whereNotIn('id', $descendants)->pluck('id')->map(fn ($id) => (int) $id)->all();
                    $descendants = [...$descendants, ...$frontier];
                }
                if (! empty($data['parent_id'])) {
                    abort_if(in_array((int) $data['parent_id'], $descendants, true), 422, 'A folder cannot be moved inside itself or one of its child folders.');
                }
            }
            if ($resource === 'requests') {
                $fields += ['body_mode' => 'raw', 'auth_type' => 'none', 'auth_config' => [], 'timeout_ms' => 15000, 'pinned' => false, 'sort_order' => 0];
            }
            if ($resource === 'monitors') {
                $fields['environment_id'] = $data['environment_id'] ?? null;
                $fields['next_run_at'] = now();
            }
            $item->fill(['workspace_id' => (int) $workspace, ...$fields])->save();
            if ($resource === 'folders') {
                $descendants = array_values(array_unique([...$descendants, (int) $item->id]));
                CollectionFolder::where('workspace_id', $workspace)->whereIn('id', $descendants)->update(['collection_id' => $item->collection_id]);
                ApiRequest::where('workspace_id', $workspace)->whereIn('folder_id', $descendants)->update(['collection_id' => $item->collection_id]);
            }
            if ($resource === 'requests') {
                RequestAssertion::where('workspace_id', $workspace)->where('api_request_id', $item->id)->delete();
                foreach ($data['assertions'] as $a) {
                    RequestAssertion::create(['workspace_id' => $workspace, 'api_request_id' => $item->id, 'type' => $a['type'], 'path' => $a['path'] ?? null, 'expected' => $a['expected'] ?? null]);
                }
                $item->load('assertions');
            }
            if ($resource === 'environments') {
                $keys = array_column($data['variables'], 'key');
                EnvironmentVariable::where('workspace_id', $workspace)->where('environment_id', $item->id)->whereNotIn('key', $keys)->delete();
                foreach ($data['variables'] as $v) {
                    $old = EnvironmentVariable::where('workspace_id', $workspace)->where('environment_id', $item->id)->where('key', $v['key'])->first();
                    // A null value preserves a saved secret; changing it to public must explicitly supply a value.
                    if ($old && $old->is_secret && $v['value'] === null) {
                        abort_unless($v['is_secret'], 422, 'Supply a new value when making a secret public.');

                        continue;
                    }
                    EnvironmentVariable::updateOrCreate(['workspace_id' => $workspace, 'environment_id' => $item->id, 'key' => $v['key']], ['value' => $v['value'] ?? '', 'is_secret' => $v['is_secret']]);
                }
            }
            if ($resource === 'monitors') {
                AlertRule::updateOrCreate(['workspace_id' => $workspace, 'monitor_id' => $item->id], ['failure_threshold' => $data['failure_threshold'], 'enabled' => true]);
            }
            $this->audit($r, $resource.'.saved', $item);

            return $item;
        });

        return response()->json(['data' => $item], $id ? 200 : 201);
    }

    public function destroy(Request $r, string $workspace, string $resource, string $id)
    {
        $model = self::MODELS[$resource] ?? abort(404);
        $item = $model::where('workspace_id', $workspace)->findOrFail($id);
        if ($resource === 'environments') {
            abort_if(Monitor::where('workspace_id', $workspace)->where('environment_id', $item->id)->exists(), 409, 'Reassign monitors before deleting this environment.');
        }
        DB::transaction(function () use ($r, $resource, $item, $workspace) {
            $this->audit($r, $resource.'.deleted', $item);
            // Explicitly detach folder when removing a collection to retain valid saved requests.
            if ($resource === 'collections') {
                ApiRequest::where('workspace_id', $workspace)->where('collection_id', $item->id)->update(['folder_id' => null]);
            }
            $item->delete();
        });

        return ['data' => null];
    }

    public function duplicate(Request $r, string $workspace, string $id)
    {
        $source = ApiRequest::where('workspace_id', $workspace)->with('assertions')->findOrFail($id);
        $copy = DB::transaction(function () use ($r, $workspace, $source) {
            $copy = ApiRequest::create([
                'workspace_id' => (int) $workspace, 'collection_id' => $source->collection_id, 'folder_id' => $source->folder_id,
                'name' => mb_substr('Copy of '.$source->name, 0, 150), 'method' => $source->method, 'url' => $source->url,
                'headers' => $source->headers, 'query_params' => $source->query_params, 'body' => $source->body,
                'body_mode' => $source->body_mode, 'auth_type' => $source->auth_type, 'auth_config' => $source->auth_config,
                'timeout_ms' => $source->timeout_ms, 'pinned' => false, 'sort_order' => $source->sort_order + 1,
            ]);
            foreach ($source->assertions as $assertion) {
                RequestAssertion::create(['workspace_id' => (int) $workspace, 'api_request_id' => $copy->id, 'type' => $assertion->type, 'path' => $assertion->path, 'expected' => $assertion->expected]);
            }
            $this->audit($r, 'requests.duplicated', $copy);

            return $copy->load('assertions');
        });

        return response()->json(['data' => $copy], 201);
    }

    public function reorderFolders(Request $r, string $workspace): array
    {
        return $this->reorder($r, $workspace, 'folders');
    }

    public function reorderRequests(Request $r, string $workspace): array
    {
        return $this->reorder($r, $workspace, 'requests');
    }

    private function reorder(Request $r, string $workspace, string $resource): array
    {
        $parentField = $resource === 'folders' ? 'parent_id' : 'folder_id';
        $rules = [
            'collection_id' => 'present|nullable|integer', $parentField => 'present|nullable|integer',
            'ids' => 'required|array|min:1|max:1000', 'ids.*' => 'required|integer|distinct',
        ];
        if ($resource === 'requests') {
            $rules['pinned'] = 'required|boolean';
        }
        $data = $r->validate($rules);
        $model = $resource === 'folders' ? CollectionFolder::class : ApiRequest::class;
        $query = $model::where('workspace_id', $workspace)->where('collection_id', $data['collection_id']);
        $query = $data[$parentField] === null ? $query->whereNull($parentField) : $query->where($parentField, $data[$parentField]);
        if ($resource === 'requests') {
            $query->where('pinned', $data['pinned']);
        }
        $siblings = $query->orderBy('sort_order')->orderBy('id')->pluck('id')->map(fn ($id) => (int) $id)->all();
        $requestedIds = array_map('intval', $data['ids']);
        abort_unless(count($siblings) === count($requestedIds) && count(array_diff($siblings, $requestedIds)) === 0 && count(array_diff($requestedIds, $siblings)) === 0, 422, 'Reorder every item in the same folder group.');

        DB::transaction(function () use ($r, $workspace, $resource, $model, $data, $parentField) {
            foreach ($data['ids'] as $position => $id) {
                $itemQuery = $model::where('workspace_id', $workspace)->where('collection_id', $data['collection_id']);
                $itemQuery = $data[$parentField] === null ? $itemQuery->whereNull($parentField) : $itemQuery->where($parentField, $data[$parentField]);
                if ($resource === 'requests') {
                    $itemQuery->where('pinned', $data['pinned']);
                }
                $item = $itemQuery->findOrFail($id);
                $item->update(['sort_order' => $position * 10]);
            }
            $first = $model::where('workspace_id', $workspace)->findOrFail($data['ids'][0]);
            $this->audit($r, $resource.'.reordered', $first);
        });

        return ['data' => null];
    }
}
