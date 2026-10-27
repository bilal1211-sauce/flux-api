<?php

namespace App\Domain\Monitoring;

use App\Domain\Executions\Executor;
use App\Jobs\DeliverAlert;
use App\Models\AlertEvent;
use App\Models\AlertRule;
use App\Models\ApiRequest;
use App\Models\Monitor;
use App\Models\MonitorRun;
use App\Models\RequestRun;
use App\Models\Workspace;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class MonitorRunner
{
    public function run(Monitor $monitor): ?RequestRun
    {
        return Cache::lock('monitor:'.$monitor->id, 60)->get(function () use ($monitor) {
            $monitor->refresh();
            $workspace = Workspace::findOrFail($monitor->workspace_id);
            $request = ApiRequest::where('workspace_id', $workspace->id)->findOrFail($monitor->api_request_id);
            try {
                $run = app(Executor::class)->saved($workspace, $request, null, $monitor->environment_id, 'monitor');
            } catch (ValidationException $e) {
                $run = RequestRun::create(['workspace_id' => $workspace->id, 'api_request_id' => $request->id, 'user_id' => null, 'name' => $request->name, 'method' => $request->method, 'url' => '[blocked by executor]', 'source' => 'monitor', 'outcome' => 'failed', 'status' => null, 'duration_ms' => 0, 'size_bytes' => 0, 'error_code' => 'DESTINATION_OR_ENVIRONMENT_REJECTED']);
            } catch (HttpException $e) {
                if ($e->getStatusCode() !== 429) {
                    throw $e;
                }
                $monitor->update(['next_run_at' => now()->addMinutes($monitor->interval_minutes)]);

                return null;
            }
            DB::transaction(function () use ($monitor, $run, $workspace) {
                MonitorRun::create(['workspace_id' => $workspace->id, 'monitor_id' => $monitor->id, 'request_run_id' => $run->id]);
                $failures = $run->outcome === 'failed' ? $monitor->consecutive_failures + 1 : 0;
                $monitor->update(['last_run_at' => now(), 'next_run_at' => now()->addMinutes($monitor->interval_minutes), 'last_outcome' => $run->outcome, 'consecutive_failures' => $failures]);
                $rule = AlertRule::where('workspace_id', $workspace->id)->where('monitor_id', $monitor->id)->where('enabled', true)->first();
                $open = AlertEvent::where('workspace_id', $workspace->id)->where('monitor_id', $monitor->id)->whereNull('resolved_at');
                if ($run->outcome === 'passed') {
                    foreach ($open->get() as $incident) {
                        $incident->update(['resolved_at' => now()]);
                        DeliverAlert::dispatch($incident->id, true)->afterCommit();
                    }
                } elseif ($rule && $failures >= $rule->failure_threshold && ! $open->exists()) {
                    $incident = AlertEvent::create(['workspace_id' => $workspace->id, 'monitor_id' => $monitor->id, 'message' => $monitor->name.' reached '.$failures.' consecutive failures.']);
                    DeliverAlert::dispatch($incident->id)->afterCommit();
                }
            });

            return $run;
        });
    }
}
