<?php

namespace App\Jobs;

use App\Domain\Monitoring\MonitorRunner;
use App\Models\Monitor;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class RunMonitor implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    public int $uniqueFor = 120;

    public int $timeout = 45;

    public int $tries = 1;

    public function __construct(public int $monitorId) {}

    public function uniqueId(): string
    {
        return (string) $this->monitorId;
    }

    public function handle(MonitorRunner $runner): void
    {
        $m = Monitor::find($this->monitorId);
        if ($m && $m->enabled && (! $m->next_run_at || $m->next_run_at->lte(now()))) {
            $runner->run($m);
        }
    }
}
