<?php

namespace App\Http\Controllers;

use App\Domain\Monitoring\MonitorRunner;
use App\Models\AlertDelivery;
use App\Models\AlertEvent;
use App\Models\ApiRequest;
use App\Models\AuditLog;
use App\Models\Collection;
use App\Models\EnvironmentVariable;
use App\Models\Monitor;
use App\Models\RequestRun;
use App\Models\UsageRecord;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class InsightsController extends Controller
{
    public function deliveries(Request $request, string $workspace): array
    {
        $deliveries = AlertDelivery::where('workspace_id', $workspace)
            ->latest('id')
            ->limit(100)
            ->get(['id', 'alert_event_id', 'channel', 'recovery', 'status', 'error_code', 'delivered_at', 'created_at']);

        return ['data' => $deliveries];
    }

    public function summary(Request $r, string $workspace)
    {
        $r->validate([
            'days' => 'nullable|in:1,7,30',
            'endpoint' => 'nullable|string|max:200',
            'request_id' => ['nullable', 'integer', Rule::exists('api_requests', 'id')->where('workspace_id', $workspace)],
            'source' => 'nullable|in:manual,monitor',
            'mode' => 'nullable|in:cloud,local',
        ]);
        $days = (int) ($r->input('days', 7));
        $since = now()->subDays($days);
        $q = RequestRun::where('workspace_id', $workspace)->where('created_at', '>=', $since);
        if ($r->filled('request_id')) {
            $q->where('api_request_id', $r->integer('request_id'));
        }
        if ($r->filled('endpoint')) {
            $endpoint = trim((string) $r->input('endpoint'));
            $q->where(function ($query) use ($endpoint) {
                $query->where('name', 'like', '%'.$endpoint.'%')
                    ->orWhere('method', 'like', '%'.$endpoint.'%')
                    ->orWhere('url', 'like', '%'.$endpoint.'%');
            });
        }
        if ($r->filled('source')) {
            $q->where('source', $r->input('source'));
        }
        if ($r->filled('mode')) {
            $q->where('execution_mode', $r->input('mode'));
        }
        $stats = (clone $q)->selectRaw('COUNT(*) as total, SUM(CASE WHEN outcome = ? THEN 1 ELSE 0 END) as passed, AVG(duration_ms) as avg_ms', ['passed'])->first();
        $count = (int) ($stats->total ?? 0);
        $passed = (int) ($stats->passed ?? 0);
        $p95 = $count ? (clone $q)->orderBy('duration_ms')->offset(max(0, (int) ceil($count * 0.95) - 1))->value('duration_ms') : null;
        $daily = (clone $q)->selectRaw('DATE(created_at) as day, COUNT(*) as runs, SUM(CASE WHEN outcome = ? THEN 1 ELSE 0 END) as passed, AVG(duration_ms) as avg_ms', ['passed'])->groupByRaw('DATE(created_at)')->orderBy('day')->get();
        $dailyLatency = (clone $q)->selectRaw('DATE(created_at) as day, duration_ms, ROW_NUMBER() OVER (PARTITION BY DATE(created_at) ORDER BY duration_ms) as latency_rank, COUNT(*) OVER (PARTITION BY DATE(created_at)) as day_count');
        $dailyP95 = DB::query()->fromSub($dailyLatency, 'daily_latency')->whereRaw('latency_rank * 20 >= day_count * 19')->selectRaw('day, MIN(duration_ms) as p95_ms')->groupBy('day')->get()->keyBy('day');
        $daily = $daily->map(function ($point) use ($dailyP95) {
            $p95Value = $dailyP95->get($point->day)?->p95_ms;
            $point->p95_ms = $p95Value === null ? null : (int) $p95Value;

            return $point;
        });
        $dailyByDate = $daily->keyBy('day');
        $analyticsDaily = collect();
        for ($day = $since->copy()->startOfDay(); $day->lte(now()->startOfDay()); $day->addDay()) {
            $key = $day->toDateString();
            $point = $dailyByDate->get($key);
            $analyticsDaily->push([
                'day' => $key,
                'runs' => (int) ($point->runs ?? 0),
                'passed' => (int) ($point->passed ?? 0),
                'avg_ms' => $point ? (float) $point->avg_ms : null,
                'p95_ms' => $point && (int) $point->runs >= 20 ? $point->p95_ms : null,
            ]);
        }
        $assertionQuery = function () use ($workspace, $since, $r) {
            $query = DB::table('assertion_results')->join('request_runs', 'request_runs.id', '=', 'assertion_results.request_run_id')->where('request_runs.workspace_id', $workspace)->where('request_runs.created_at', '>=', $since);
            if ($r->filled('request_id')) {
                $query->where('request_runs.api_request_id', $r->integer('request_id'));
            }
            if ($r->filled('endpoint')) {
                $endpoint = trim((string) $r->input('endpoint'));
                $query->where(function ($nested) use ($endpoint) {
                    $nested->where('request_runs.name', 'like', '%'.$endpoint.'%')->orWhere('request_runs.method', 'like', '%'.$endpoint.'%')->orWhere('request_runs.url', 'like', '%'.$endpoint.'%');
                });
            }
            if ($r->filled('source')) {
                $query->where('request_runs.source', $r->input('source'));
            }
            if ($r->filled('mode')) {
                $query->where('request_runs.execution_mode', $r->input('mode'));
            }

            return $query;
        };
        $dailyAssertions = $assertionQuery()->selectRaw('DATE(request_runs.created_at) as day, SUM(CASE WHEN assertion_results.passed = ? THEN 1 ELSE 0 END) as passed, SUM(CASE WHEN assertion_results.passed = ? THEN 1 ELSE 0 END) as failed', [true, false])->groupByRaw('DATE(request_runs.created_at)')->orderBy('day')->get();
        $modes = (clone $q)->selectRaw('SUM(CASE WHEN execution_mode = ? THEN 1 ELSE 0 END) as cloud_runs, SUM(CASE WHEN execution_mode = ? THEN 1 ELSE 0 END) as local_runs', ['cloud', 'local'])->first();
        $assertions = $assertionQuery()->selectRaw('SUM(CASE WHEN assertion_results.passed = ? THEN 1 ELSE 0 END) as passed, SUM(CASE WHEN assertion_results.passed = ? THEN 1 ELSE 0 END) as failed', [true, false])->first();
        $statuses = (clone $q)->selectRaw("CASE WHEN status BETWEEN 200 AND 299 THEN '2xx' WHEN status BETWEEN 300 AND 399 THEN '3xx' WHEN status BETWEEN 400 AND 499 THEN '4xx' WHEN status BETWEEN 500 AND 599 THEN '5xx' ELSE 'No response' END as category, COUNT(*) as total")->groupBy('category')->orderBy('category')->get();
        $failureTypes = (clone $q)->where('outcome', 'failed')->selectRaw("CASE WHEN status IS NULL THEN COALESCE(error_code, 'TRANSPORT_FAILURE') WHEN status BETWEEN 400 AND 599 THEN 'HTTP_ERROR' ELSE 'ASSERTION_FAILURE' END as category, COUNT(*) as total")->groupBy('category')->orderBy('category')->get();
        $sourceCounts = (clone $q)->selectRaw("CASE WHEN source = 'monitor' THEN 'monitor' ELSE 'manual' END as category, COUNT(*) as total")->groupBy('category')->orderBy('category')->get();
        $modeCounts = (clone $q)->selectRaw("CASE WHEN execution_mode IN ('cloud', 'local') THEN execution_mode ELSE 'unknown' END as category, COUNT(*) as total")->groupBy('category')->orderBy('category')->get();
        $endpointGroups = function () use ($q) {
            return (clone $q)->selectRaw('api_request_id, name, method, COUNT(*) as runs, AVG(duration_ms) as avg_ms, SUM(CASE WHEN outcome = ? THEN 1 ELSE 0 END) as passed, SUM(CASE WHEN outcome = ? THEN 1 ELSE 0 END) as failed', ['passed', 'failed'])->groupBy('api_request_id', 'name', 'method');
        };
        $slowestEndpoints = (clone $endpointGroups())->orderByDesc('avg_ms')->limit(8)->get();
        $failingEndpoints = (clone $endpointGroups())->havingRaw('SUM(CASE WHEN outcome = ? THEN 1 ELSE 0 END) > 0', ['failed'])->orderByDesc('failed')->orderByDesc('runs')->limit(8)->get();
        $highestVolumeEndpoints = (clone $endpointGroups())->orderByDesc('runs')->limit(8)->get();
        $endpointP95 = function ($endpoint) use ($q) {
            $query = (clone $q)->where('name', $endpoint->name)->where('method', $endpoint->method);
            $endpoint->api_request_id === null ? $query->whereNull('api_request_id') : $query->where('api_request_id', $endpoint->api_request_id);
            $sampleCount = (clone $query)->whereNotNull('duration_ms')->count();
            if ($sampleCount < 20) {
                return null;
            }

            return (clone $query)->whereNotNull('duration_ms')->orderBy('duration_ms')->offset(max(0, (int) ceil($sampleCount * 0.95) - 1))->value('duration_ms');
        };
        $slowestEndpoints = $slowestEndpoints->map(function ($endpoint) use ($endpointP95) {
            $endpoint->p95_ms = $endpointP95($endpoint);

            return $endpoint;
        });
        $endpoints = $slowestEndpoints;
        $monitorQuery = RequestRun::where('request_runs.workspace_id', $workspace)->join('monitor_runs', 'request_runs.id', '=', 'monitor_runs.request_run_id')->where('request_runs.created_at', '>=', $since);
        if ($r->filled('request_id')) {
            $monitorQuery->where('request_runs.api_request_id', $r->integer('request_id'));
        }
        if ($r->filled('endpoint')) {
            $endpoint = trim((string) $r->input('endpoint'));
            $monitorQuery->where(function ($query) use ($endpoint) {
                $query->where('request_runs.name', 'like', '%'.$endpoint.'%')->orWhere('request_runs.method', 'like', '%'.$endpoint.'%')->orWhere('request_runs.url', 'like', '%'.$endpoint.'%');
            });
        }
        if ($r->input('source') === 'manual') {
            $monitorQuery->whereRaw('1 = 0');
        }
        if ($r->filled('mode')) {
            $monitorQuery->where('request_runs.execution_mode', $r->input('mode'));
        }
        $checks = (clone $monitorQuery)->count();
        $goodChecks = (clone $monitorQuery)->where('outcome', 'passed')->count();
        $dailyMonitorChecks = (clone $monitorQuery)->selectRaw('DATE(request_runs.created_at) as day, COUNT(*) as checks, SUM(CASE WHEN request_runs.outcome = ? THEN 1 ELSE 0 END) as passed', ['passed'])->groupByRaw('DATE(request_runs.created_at)')->orderBy('day')->get();
        $incidentOpened = AlertEvent::where('workspace_id', $workspace)->where('created_at', '>=', $since)->selectRaw('DATE(created_at) as day, COUNT(*) as total')->groupByRaw('DATE(created_at)')->orderBy('day')->get();
        $incidentRecoveries = AlertEvent::where('workspace_id', $workspace)->whereNotNull('resolved_at')->where('resolved_at', '>=', $since)->selectRaw('DATE(resolved_at) as day, COUNT(*) as total')->groupByRaw('DATE(resolved_at)')->orderBy('day')->get();
        $workspaceOpenIncidents = AlertEvent::where('workspace_id', $workspace)->whereNull('resolved_at')->count();
        $activeMonitors = Monitor::where('workspace_id', $workspace)->where('enabled', true)->orderByRaw("CASE WHEN last_outcome = 'failed' THEN 0 ELSE 1 END")->orderByDesc('last_run_at')->orderBy('id')->limit(8)->get(['id', 'name', 'last_outcome', 'last_run_at', 'consecutive_failures']);
        $monitorIds = $activeMonitors->pluck('id');
        $latestMonitorIds = DB::table('monitor_runs')->where('workspace_id', $workspace)->whereIn('monitor_id', $monitorIds)->selectRaw('monitor_id, MAX(id) as latest_id')->groupBy('monitor_id');
        $latestMonitorRuns = $monitorIds->isEmpty() ? collect() : DB::table('monitor_runs')
            ->joinSub($latestMonitorIds, 'latest_monitor_runs', fn ($join) => $join->on('monitor_runs.id', '=', 'latest_monitor_runs.latest_id'))
            ->join('request_runs', function ($join) use ($workspace) {
                $join->on('request_runs.id', '=', 'monitor_runs.request_run_id')->where('request_runs.workspace_id', '=', $workspace);
            })
            ->select(['monitor_runs.monitor_id', 'request_runs.status', 'request_runs.duration_ms', 'request_runs.error_code'])
            ->get()->keyBy('monitor_id');
        $openIncidents = $monitorIds->isEmpty() ? collect() : AlertEvent::where('workspace_id', $workspace)->whereNull('resolved_at')->whereIn('monitor_id', $monitorIds)->select('monitor_id', DB::raw('COUNT(*) as total'))->groupBy('monitor_id')->pluck('total', 'monitor_id');
        $monitorSnapshots = $activeMonitors->map(function (Monitor $monitor) use ($latestMonitorRuns, $openIncidents): array {
            $latestRun = $latestMonitorRuns->get($monitor->id);

            return [
                'id' => $monitor->id,
                'name' => $monitor->name,
                'last_outcome' => $monitor->last_outcome,
                'last_run_at' => $monitor->last_run_at,
                'consecutive_failures' => $monitor->consecutive_failures,
                'last_status' => $latestRun?->status,
                'last_duration_ms' => $latestRun?->duration_ms,
                'error_code' => $latestRun?->error_code,
                'open_incidents' => (int) ($openIncidents->get($monitor->id) ?? 0),
            ];
        })->values();
        $monitorOverviewRow = DB::table('monitors')
            ->where('monitors.workspace_id', $workspace)
            ->selectRaw("COUNT(*) as total, SUM(CASE WHEN monitors.enabled = ? THEN 1 ELSE 0 END) as paused, SUM(CASE WHEN monitors.enabled = ? AND monitors.last_outcome = 'passed' THEN 1 ELSE 0 END) as healthy, SUM(CASE WHEN monitors.enabled = ? AND monitors.last_outcome = 'failed' THEN 1 ELSE 0 END) as unhealthy, SUM(CASE WHEN monitors.enabled = ? AND monitors.last_outcome IS NULL THEN 1 ELSE 0 END) as awaiting", [false, true, true, true])->first();

        return ['data' => [
            'period' => 'Last '.$days.' '.($days === 1 ? 'day' : 'days'), 'period_days' => $days,
            'total_runs' => $count, 'passed_runs' => $passed, 'failed_runs' => $count - $passed,
            'success_rate' => $count ? round($passed / $count * 100, 2) : null,
            'avg_latency_ms' => $count ? (int) round((float) $stats->avg_ms) : null,
            'p95_latency_ms' => $p95,
            'cloud_runs' => (int) ($modes->cloud_runs ?? 0), 'local_runs' => (int) ($modes->local_runs ?? 0),
            'assertions_passed' => (int) ($assertions->passed ?? 0), 'assertions_failed' => (int) ($assertions->failed ?? 0),
            'monitor_availability' => $checks ? round($goodChecks / $checks * 100, 2) : null,
            'monitor_checks' => $checks, 'monitor_snapshots' => $monitorSnapshots, 'daily' => $daily, 'analytics_daily' => $analyticsDaily, 'daily_assertions' => $dailyAssertions,
            'daily_monitor_checks' => $dailyMonitorChecks, 'incident_opened' => $incidentOpened, 'incident_recoveries' => $incidentRecoveries,
            'endpoint_performance' => $endpoints, 'status_classes' => $statuses,
            'analytics' => [
                'failure_types' => $failureTypes,
                'sources' => $sourceCounts,
                'execution_modes' => $modeCounts,
                'slowest_endpoints' => $slowestEndpoints,
                'failing_endpoints' => $failingEndpoints,
                'highest_volume_endpoints' => $highestVolumeEndpoints,
            ],
            'monitor_overview' => [
                'total' => (int) ($monitorOverviewRow->total ?? 0),
                'healthy' => (int) ($monitorOverviewRow->healthy ?? 0),
                'unhealthy' => (int) ($monitorOverviewRow->unhealthy ?? 0),
                'awaiting' => (int) ($monitorOverviewRow->awaiting ?? 0),
                'paused' => (int) ($monitorOverviewRow->paused ?? 0),
                'open_incidents' => $workspaceOpenIncidents,
                'checks_in_period' => (int) $checks,
                'passed_in_period' => (int) $goodChecks,
                'check_success_rate' => $checks ? round($goodChecks / $checks * 100, 2) : null,
            ],
            'collections' => Collection::where('workspace_id', $workspace)->count(), 'requests' => ApiRequest::where('workspace_id', $workspace)->count(),
            'active_monitors' => Monitor::where('workspace_id', $workspace)->where('enabled', true)->count(),
            'open_alerts' => $workspaceOpenIncidents,
            'recent_runs' => RequestRun::where('workspace_id', $workspace)->latest('id')->limit(6)->get(),
            'failure_classes' => (clone $q)->where('outcome', 'failed')->selectRaw('COALESCE(error_code, ?) as category, COUNT(*) as total', ['HTTP_OR_ASSERTION'])->groupBy('category')->get(),
            'usage_today' => UsageRecord::where('workspace_id', $workspace)->where('day', today()->toDateString())->value('runs') ?? 0,
            'daily_limit' => $r->attributes->get('workspace')->daily_run_limit,
        ]];
    }

    public function alerts(Request $r, string $workspace)
    {
        $r->validate([
            'search' => 'nullable|string|max:150',
            'monitor_id' => ['nullable', 'integer', Rule::exists('monitors', 'id')->where('workspace_id', $workspace)],
            'status' => 'nullable|in:all,open,resolved,acknowledged,unacknowledged',
            'date_from' => 'nullable|date_format:Y-m-d',
            'date_to' => 'nullable|date_format:Y-m-d|after_or_equal:date_from',
            'sort' => 'nullable|in:newest,oldest',
            'page' => 'nullable|integer|min:1',
            'per_page' => 'nullable|integer|min:1|max:100',
        ]);
        $query = AlertEvent::where('workspace_id', $workspace);
        if ($r->filled('monitor_id')) {
            $query->where('monitor_id', $r->integer('monitor_id'));
        }
        if ($r->filled('search')) {
            $search = trim((string) $r->input('search'));
            $matchingMonitorIds = Monitor::where('workspace_id', $workspace)->where('name', 'like', '%'.$search.'%')->select('id');
            $query->where(fn ($filtered) => $filtered->where('message', 'like', '%'.$search.'%')->orWhereIn('monitor_id', $matchingMonitorIds));
        }
        match ($r->input('status', 'all')) {
            'open' => $query->whereNull('resolved_at'),
            'resolved' => $query->whereNotNull('resolved_at'),
            'acknowledged' => $query->whereNotNull('acknowledged_at'),
            'unacknowledged' => $query->whereNull('acknowledged_at'),
            default => null,
        };
        if ($r->filled('date_from')) {
            $query->where('created_at', '>=', now()->parse($r->input('date_from'))->startOfDay());
        }
        if ($r->filled('date_to')) {
            $query->where('created_at', '<=', now()->parse($r->input('date_to'))->endOfDay());
        }
        $query->orderBy('created_at', $r->input('sort') === 'oldest' ? 'asc' : 'desc')->orderBy('id', 'desc');
        $incidents = $query->paginate(min(100, max(1, $r->integer('per_page', 25))))->withQueryString();
        $monitorIds = $incidents->getCollection()->pluck('monitor_id')->unique()->values();
        $monitorNames = Monitor::where('workspace_id', $workspace)->whereIn('id', $monitorIds)->pluck('name', 'id');
        $secrets = $this->workspaceSecrets($workspace);
        $incidents->getCollection()->transform(fn (AlertEvent $event) => [
            'id' => (int) $event->id,
            'monitor_id' => (int) $event->monitor_id,
            'monitor_name' => $this->redactIncidentText((string) ($monitorNames->get($event->monitor_id) ?? 'Monitor'), $secrets),
            'message' => $this->redactIncidentText((string) $event->message, $secrets),
            'created_at' => $event->created_at?->toISOString(),
            'resolved_at' => $event->resolved_at?->toISOString(),
            'acknowledged_at' => $event->acknowledged_at?->toISOString(),
        ]);

        return ['data' => [
            'incidents' => $incidents,
            'summary' => [
                'open' => AlertEvent::where('workspace_id', $workspace)->whereNull('resolved_at')->count(),
                'resolved' => AlertEvent::where('workspace_id', $workspace)->whereNotNull('resolved_at')->count(),
                'acknowledged' => AlertEvent::where('workspace_id', $workspace)->whereNotNull('acknowledged_at')->count(),
            ],
        ]];
    }

    public function incidentDetail(Request $r, string $workspace, string $id): array
    {
        $event = AlertEvent::where('workspace_id', $workspace)->findOrFail($id);
        $monitor = Monitor::where('workspace_id', $workspace)->findOrFail($event->monitor_id);
        $end = $event->resolved_at ?? now();
        $previousSuccess = DB::table('monitor_runs')
            ->join('request_runs', function ($join) use ($workspace) {
                $join->on('request_runs.id', '=', 'monitor_runs.request_run_id')
                    ->where('request_runs.workspace_id', '=', $workspace);
            })
            ->where('monitor_runs.workspace_id', $workspace)
            ->where('monitor_runs.monitor_id', $monitor->id)
            ->where('request_runs.outcome', 'passed')
            ->where('request_runs.created_at', '<', $event->created_at)
            ->max('request_runs.created_at');
        $checksQuery = DB::table('monitor_runs as mr')
            ->join('request_runs as rr', function ($join) use ($workspace) {
                $join->on('rr.id', '=', 'mr.request_run_id')->where('rr.workspace_id', '=', $workspace);
            })
            ->where('mr.workspace_id', $workspace)
            ->where('mr.monitor_id', $monitor->id)
            ->where('rr.created_at', '<=', $end);
        if ($previousSuccess) {
            $checksQuery->where('rr.created_at', '>', $previousSuccess);
        }
        $checkCount = (clone $checksQuery)->count();
        $checks = $checksQuery
            ->orderBy('rr.created_at')
            ->orderBy('mr.id')
            ->limit(100)
            ->get(['mr.id as monitor_run_id', 'rr.id as run_id', 'rr.outcome', 'rr.status', 'rr.error_code', 'rr.duration_ms', 'rr.created_at']);
        $deliveries = AlertDelivery::where('workspace_id', $workspace)
            ->where('alert_event_id', $event->id)
            ->orderBy('created_at')
            ->limit(100)
            ->get(['id', 'channel', 'recovery', 'status', 'error_code', 'delivered_at', 'created_at']);
        $secrets = $this->workspaceSecrets($workspace);
        $timeline = collect();
        $firstFailureSeen = false;
        foreach ($checks as $check) {
            $failed = $check->outcome === 'failed';
            $title = $failed
                ? ($firstFailureSeen ? 'Subsequent failed check' : 'First recorded failed check')
                : 'Recovery check';
            if ($failed) {
                $firstFailureSeen = true;
            }
            $classification = $check->error_code !== null || $check->status === null
                ? 'Execution failure'.($check->error_code ? ' · '.$check->error_code : '')
                : (($check->status < 200 || $check->status >= 300)
                    ? 'HTTP response · '.$check->status
                    : ($failed ? 'Assertion failure' : 'HTTP response · '.$check->status));
            $timeline->push([
                'id' => 'check-'.$check->monitor_run_id,
                'kind' => $failed ? 'failure' : 'recovery_check',
                'title' => $title,
                'detail' => $classification,
                'run_id' => (int) $check->run_id,
                'occurred_at' => $check->created_at,
            ]);
        }
        $timeline->push([
            'id' => 'incident-'.$event->id,
            'kind' => 'incident',
            'title' => 'Alert threshold reached',
            'detail' => $this->redactIncidentText((string) $event->message, $secrets),
            'run_id' => null,
            'occurred_at' => $event->created_at,
        ]);
        foreach ($deliveries as $delivery) {
            $timeline->push([
                'id' => 'delivery-'.$delivery->id,
                'kind' => 'notification',
                'title' => $delivery->recovery ? 'Recovery notification attempt' : 'Failure notification attempt',
                'detail' => trim($delivery->channel.' · '.$delivery->status.($delivery->error_code ? ' · '.$delivery->error_code : '')),
                'run_id' => null,
                'occurred_at' => $delivery->created_at,
            ]);
        }
        if ($event->acknowledged_at) {
            $timeline->push(['id' => 'ack-'.$event->id, 'kind' => 'acknowledgment', 'title' => 'Incident acknowledged', 'detail' => 'A workspace member reviewed this incident.', 'run_id' => null, 'occurred_at' => $event->acknowledged_at]);
        }
        if ($event->resolved_at) {
            $timeline->push(['id' => 'resolved-'.$event->id, 'kind' => 'resolution', 'title' => 'Monitor recovery resolved the incident', 'detail' => 'A successful monitor check was recorded.', 'run_id' => null, 'occurred_at' => $event->resolved_at]);
        }
        $timeline = $timeline->sortBy(fn (array $item) => (string) $item['occurred_at'])->values();

        return ['data' => [
            'incident' => [
                'id' => (int) $event->id,
                'monitor_id' => (int) $event->monitor_id,
                'message' => $this->redactIncidentText((string) $event->message, $secrets),
                'created_at' => $event->created_at?->toISOString(),
                'resolved_at' => $event->resolved_at?->toISOString(),
                'acknowledged_at' => $event->acknowledged_at?->toISOString(),
            ],
            'monitor' => [
                'id' => (int) $monitor->id,
                'name' => $this->redactIncidentText((string) $monitor->name, $secrets),
                'api_request_id' => (int) $monitor->api_request_id,
                'environment_id' => $monitor->environment_id ? (int) $monitor->environment_id : null,
                'interval_minutes' => (int) $monitor->interval_minutes,
                'enabled' => (bool) $monitor->enabled,
                'failure_threshold' => DB::table('alert_rules')->where('workspace_id', $workspace)->where('monitor_id', $monitor->id)->value('failure_threshold'),
            ],
            'timeline' => $timeline,
            'deliveries' => $deliveries->map(fn (AlertDelivery $delivery) => [
                'id' => (int) $delivery->id,
                'channel' => $delivery->channel,
                'recovery' => (bool) $delivery->recovery,
                'status' => $delivery->status,
                'error_code' => $delivery->error_code,
                'delivered_at' => $delivery->delivered_at?->toISOString(),
                'created_at' => $delivery->created_at?->toISOString(),
            ])->values(),
            'checks_included' => $checks->count(),
            'checks_total' => $checkCount,
            'checks_truncated' => $checkCount > $checks->count(),
        ]];
    }

    public function acknowledge(Request $r, string $workspace, string $id)
    {
        $event = AlertEvent::where('workspace_id', $workspace)->findOrFail($id);
        $event->update(['acknowledged_at' => now()]);
        $this->audit($r, 'alert.acknowledged', $event);
        $data = $event->toArray();
        $data['message'] = $this->redactIncidentText((string) $event->message, $this->workspaceSecrets($workspace));

        return ['data' => $data];
    }

    public function auditLog(Request $r, string $workspace)
    {
        $filters = $r->validate([
            'search' => 'nullable|string|max:100',
            'action' => 'nullable|in:workspace,collections,requests,environments,monitoring,access,reports,platform,integrations,other',
            'actor' => 'nullable|string|max:100',
            'resource_type' => 'nullable|string|max:50',
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date|after_or_equal:date_from',
            'sort' => 'nullable|in:newest,oldest,action_asc,action_desc',
            'page' => 'sometimes|integer|min:1',
            'per_page' => 'sometimes|integer|min:1|max:100',
        ]);

        return ['data' => $this->auditQuery($workspace, $filters)
            ->orderBy(match ($filters['sort'] ?? 'newest') {
                'oldest' => 'audit_logs.created_at',
                'action_asc', 'action_desc' => 'audit_logs.action',
                default => 'audit_logs.id',
            }, in_array($filters['sort'] ?? 'newest', ['oldest', 'action_asc'], true) ? 'asc' : 'desc')
            ->orderByDesc('audit_logs.id')
            ->paginate((int) ($filters['per_page'] ?? 25))
            ->withQueryString()];
    }

    public function auditDetail(Request $r, string $workspace, string $id): array
    {
        $event = $this->auditQuery($workspace)->where('audit_logs.id', $id)->firstOrFail();
        $resourceUrl = $this->authorizedAuditResourceUrl($workspace, $event->resource_type, $event->resource_id);
        $workspaceName = DB::table('workspaces')->where('id', $workspace)->value('name');

        return ['data' => [
            'id' => (int) $event->id,
            'action' => $event->action,
            'user_id' => $event->user_id === null ? null : (int) $event->user_id,
            'actor_name' => $event->actor_name,
            'actor_email' => $event->actor_email,
            'resource_type' => $event->resource_type,
            'resource_id' => $event->resource_id === null ? null : (int) $event->resource_id,
            'workspace_id' => (int) $workspace,
            'workspace_name' => $workspaceName,
            'created_at' => $event->created_at,
            'resource_url' => $resourceUrl,
        ]];
    }

    public function exportAudit(Request $r, string $workspace): array
    {
        $filters = $r->validate([
            'search' => 'nullable|string|max:100',
            'action' => 'nullable|in:workspace,collections,requests,environments,monitoring,access,reports,platform,integrations,other',
            'actor' => 'nullable|string|max:100',
            'resource_type' => 'nullable|string|max:50',
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date|after_or_equal:date_from',
            'sort' => 'nullable|in:newest,oldest,action_asc,action_desc',
        ]);
        $query = $this->auditQuery($workspace, $filters);
        $total = (clone $query)->count('audit_logs.id');
        $sort = $filters['sort'] ?? 'newest';
        $records = $query->orderBy(match ($sort) {
            'oldest' => 'audit_logs.created_at',
            'action_asc', 'action_desc' => 'audit_logs.action',
            default => 'audit_logs.id',
        }, in_array($sort, ['oldest', 'action_asc'], true) ? 'asc' : 'desc')
            ->orderByDesc('audit_logs.id')
            ->limit(500)
            ->get()
            ->map(fn ($event) => [
                'id' => (int) $event->id,
                'action' => $event->action,
                'user_id' => $event->user_id === null ? null : (int) $event->user_id,
                'actor_name' => $event->actor_name,
                'actor_email' => $event->actor_email,
                'resource_type' => $event->resource_type,
                'resource_id' => $event->resource_id === null ? null : (int) $event->resource_id,
                'created_at' => $event->created_at,
            ])->values();

        return ['data' => [
            'records' => $records,
            'total_matching' => $total,
            'exported' => $records->count(),
            'limited' => $total > $records->count(),
        ]];
    }

    private function auditQuery(string $workspace, array $filters = [])
    {
        $query = AuditLog::query()
            ->where('audit_logs.workspace_id', $workspace)
            ->leftJoin('users as audit_actor', 'audit_actor.id', '=', 'audit_logs.user_id')
            ->select([
                'audit_logs.id', 'audit_logs.workspace_id', 'audit_logs.user_id', 'audit_logs.action',
                'audit_logs.resource_type', 'audit_logs.resource_id', 'audit_logs.created_at',
                'audit_actor.name as actor_name', 'audit_actor.email as actor_email',
            ]);

        if (! empty($filters['search'])) {
            $search = trim($filters['search']);
            $query->where(function ($builder) use ($search) {
                $builder->where('audit_logs.action', 'like', '%'.$search.'%')
                    ->orWhere('audit_logs.resource_type', 'like', '%'.$search.'%')
                    ->orWhere('audit_actor.name', 'like', '%'.$search.'%')
                    ->orWhere('audit_actor.email', 'like', '%'.$search.'%');
                if (ctype_digit($search)) {
                    $builder->orWhere('audit_logs.id', (int) $search)
                        ->orWhere('audit_logs.resource_id', (int) $search);
                }
            });
        }
        if (! empty($filters['actor'])) {
            $actor = trim($filters['actor']);
            $query->where(function ($builder) use ($actor) {
                $builder->where('audit_actor.name', 'like', '%'.$actor.'%')
                    ->orWhere('audit_actor.email', 'like', '%'.$actor.'%');
            });
        }
        if (! empty($filters['resource_type'])) {
            $query->where('audit_logs.resource_type', $filters['resource_type']);
        }
        if (! empty($filters['date_from'])) {
            $query->whereDate('audit_logs.created_at', '>=', $filters['date_from']);
        }
        if (! empty($filters['date_to'])) {
            $query->whereDate('audit_logs.created_at', '<=', $filters['date_to']);
        }
        if (! empty($filters['action'])) {
            $prefixes = match ($filters['action']) {
                'workspace' => ['workspace'],
                'collections' => ['collection', 'collections'],
                'requests' => ['request', 'requests'],
                'environments' => ['environment', 'environments'],
                'monitoring' => ['monitor', 'alert'],
                'access' => ['member', 'invitation'],
                'reports' => ['report'],
                'platform' => ['admin'],
                'integrations' => ['openapi'],
                default => [],
            };
            if ($filters['action'] === 'other') {
                $known = ['workspace', 'collection', 'collections', 'request', 'requests', 'environment', 'environments', 'monitor', 'alert', 'member', 'invitation', 'report', 'admin', 'openapi'];
                $query->where(function ($builder) use ($known) {
                    foreach ($known as $prefix) {
                        $builder->where('audit_logs.action', 'not like', $prefix.'.%');
                    }
                });
            } else {
                $query->where(function ($builder) use ($prefixes) {
                    foreach ($prefixes as $prefix) {
                        $builder->orWhere('audit_logs.action', 'like', $prefix.'.%');
                    }
                });
            }
        }

        return $query;
    }

    private function authorizedAuditResourceUrl(string $workspace, ?string $type, $id): ?string
    {
        if (! $id || ! $type) {
            return null;
        }

        $resource = match ($type) {
            'ApiRequest' => ['api_requests', '/studio?request='.$id],
            'Collection' => ['collections', '/collections'],
            'Monitor' => ['monitors', '/monitoring?monitor='.$id],
            'AlertEvent' => ['alert_events', '/alerts?incident='.$id],
            'Environment' => ['environments', '/environments'],
            'ShareLink' => ['share_links', '/reports'],
            default => null,
        };
        if (! $resource) {
            return null;
        }

        return DB::table($resource[0])->where('workspace_id', $workspace)->where('id', $id)->exists()
            ? $resource[1]
            : null;
    }

    public function monitorRun(Request $r, string $workspace, string $id, MonitorRunner $runner)
    {
        $monitor = Monitor::where('workspace_id', $workspace)->findOrFail($id);
        $run = $runner->run($monitor);
        $this->audit($r, 'monitor.checked', $monitor);

        return ['data' => $run];
    }

    public function monitorHistory(Request $r, string $workspace, string $id)
    {
        $r->validate(['per_page' => 'sometimes|integer|min:1|max:50', 'page' => 'sometimes|integer|min:1']);
        $monitor = Monitor::where('workspace_id', $workspace)->findOrFail($id);
        $runQuery = DB::table('monitor_runs as monitor_runs')
            ->join('request_runs', function ($join) use ($workspace) {
                $join->on('request_runs.id', '=', 'monitor_runs.request_run_id')->where('request_runs.workspace_id', '=', $workspace);
            })
            ->where('monitor_runs.workspace_id', $workspace)
            ->where('monitor_runs.monitor_id', $monitor->id)
            ->orderByDesc('monitor_runs.id')
            ->select([
                'request_runs.id', 'request_runs.outcome', 'request_runs.status', 'request_runs.duration_ms',
                'request_runs.error_code', 'request_runs.execution_mode', 'request_runs.created_at',
            ]);
        $history = $runQuery->paginate($r->integer('per_page', 20))->withQueryString();
        $request = ApiRequest::where('workspace_id', $workspace)->find($monitor->api_request_id, ['id', 'name', 'method', 'url']);
        $endpoint = null;
        if ($request) {
            $url = parse_url((string) $request->url);
            $host = $url['host'] ?? '';
            $segments = explode('/', trim((string) ($url['path'] ?? '/'), '/'));
            $safeSegments = array_map(function ($segment, $index) use ($segments) {
                $previous = $segments[$index - 1] ?? '';
                $keyedSecret = preg_match('/^(token|secret|password|api[_-]?key|authorization|bearer|signature|access[_-]?token)$/i', $previous) === 1;
                $tokenLike = strlen($segment) >= 40 && preg_match('/^[A-Za-z0-9._~-]+$/', $segment) === 1;

                return $keyedSecret || $tokenLike ? '[redacted]' : $segment;
            }, $segments, array_keys($segments));
            $path = '/'.implode('/', $safeSegments);
            $endpoint = ($host ? $host : 'Endpoint').$path;
        }
        $assertions = $request ? DB::table('request_assertions')->where('workspace_id', $workspace)->where('api_request_id', $request->id)->orderBy('id')->get(['type', 'path', 'expected'])->map(fn ($assertion) => [
            'type' => $assertion->type,
            'path' => $assertion->path,
            'expected_status' => $assertion->type === 'status' && is_numeric($assertion->expected) ? (int) $assertion->expected : null,
        ]) : collect();
        $lastSuccessAt = DB::table('monitor_runs')
            ->join('request_runs', function ($join) use ($workspace) {
                $join->on('request_runs.id', '=', 'monitor_runs.request_run_id')->where('request_runs.workspace_id', '=', $workspace);
            })
            ->where('monitor_runs.workspace_id', $workspace)
            ->where('monitor_runs.monitor_id', $monitor->id)
            ->where('request_runs.outcome', 'passed')
            ->max('request_runs.created_at');

        return [
            'data' => [
                'monitor' => [
                    'id' => $monitor->id,
                    'name' => $monitor->name,
                    'api_request_id' => $monitor->api_request_id,
                    'environment_id' => $monitor->environment_id,
                    'environment_name' => $monitor->environment_id ? DB::table('environments')->where('workspace_id', $workspace)->where('id', $monitor->environment_id)->value('name') : null,
                    'interval_minutes' => $monitor->interval_minutes,
                    'enabled' => $monitor->enabled,
                    'last_outcome' => $monitor->last_outcome,
                    'last_run_at' => $monitor->last_run_at,
                    'consecutive_failures' => $monitor->consecutive_failures,
                    'failure_threshold' => DB::table('alert_rules')->where('workspace_id', $workspace)->where('monitor_id', $monitor->id)->value('failure_threshold'),
                    'last_success_at' => $lastSuccessAt,
                    'request' => $request ? ['id' => $request->id, 'name' => $request->name, 'method' => $request->method, 'endpoint' => $endpoint, 'assertions' => $assertions] : null,
                ],
                'history' => $history,
                'incidents' => AlertEvent::where('workspace_id', $workspace)->where('monitor_id', $monitor->id)->latest('id')->limit(20)->get(['id', 'message', 'created_at', 'resolved_at', 'acknowledged_at']),
            ],
        ];
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

    private function redactIncidentText(string $text, array $secrets): string
    {
        usort($secrets, fn (string $a, string $b) => strlen($b) <=> strlen($a));
        foreach ($secrets as $secret) {
            foreach (array_unique([$secret, rawurlencode($secret), urlencode($secret)]) as $variant) {
                if ($variant !== '') {
                    $text = str_replace($variant, '[REDACTED]', $text);
                }
            }
        }
        $text = preg_replace('/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}={0,2}/i', 'Bearer [REDACTED]', $text) ?? $text;
        $text = preg_replace('/\bBasic\s+[A-Za-z0-9+\/=]{12,}/i', 'Basic [REDACTED]', $text) ?? $text;

        return preg_replace("~([?&](?:access[_-]?token|api[_-]?key|token|secret|password|signature)=)[^&#\\s\"']*~i", '$1[REDACTED]', $text) ?? $text;
    }
}
