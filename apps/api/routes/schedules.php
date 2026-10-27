<?php

use App\Jobs\RunMonitor;
use App\Models\Monitor;
use App\Models\RequestRun;
use App\Models\ShareLink;
use App\Models\User;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

Artisan::command('monitors:dispatch', function () {
    $count = 0;
    Monitor::where('enabled', true)->where(fn ($q) => $q->whereNull('next_run_at')->orWhere('next_run_at', '<=', now()))->orderBy('id')->chunkById(100, function ($monitors) use (&$count) {
        foreach ($monitors as $monitor) {
            RunMonitor::dispatch($monitor->id);
            $count++;
        }
    });
    $this->info('Dispatched '.$count.' due monitor jobs.');
})->purpose('Queue due, uniquely locked monitor checks');

Artisan::command('runs:prune', function () {
    $count = RequestRun::where('created_at', '<', now()->subDays(config('apiforge.retention_days')))->delete();
    ShareLink::where('expires_at', '<', now()->subDays(7))->delete();
    $this->info('Pruned '.$count.' expired request runs.');
})->purpose('Remove runs and response bodies after the retention period');

Artisan::command('apiforge:admin {email}', function () {
    $user = User::where('email', $this->argument('email'))->firstOrFail();
    $user->forceFill(['is_admin' => true])->save();
    $this->info('Platform access granted to '.$user->email);
})->purpose('Grant platform administration from the trusted server console');

Schedule::command('monitors:dispatch')->everyMinute()->withoutOverlapping(2);
Schedule::command('runs:prune')->daily()->withoutOverlapping();
Schedule::command('auth:clear-resets')->daily();
Schedule::command('sanctum:prune-expired --hours=24')->daily();
Schedule::command('queue:prune-failed --hours=168')->daily();

Artisan::command('apiforge:doctor', function () {
    $issues = [];
    try {
        $driver = config('database.default');
        $version = $driver === 'mysql' ? DB::selectOne('SELECT VERSION() AS version')->version : 'SQLite';
        $this->info('Database: '.$driver.' '.$version.' connected.');
    } catch (Throwable $e) {
        $issues[] = 'Database connection failed.';
    }
    try {
        Cache::put('apiforge-doctor', 'ok', 10);
        if (Cache::get('apiforge-doctor') !== 'ok') {
            $issues[] = 'Cache round trip failed.';
        } else {
            $this->info('Cache: '.config('cache.default').' round trip passed.');
        }
        Cache::forget('apiforge-doctor');
    } catch (Throwable $e) {
        $issues[] = 'Cache connection failed.';
    }
    if (! config('app.key')) {
        $issues[] = 'Application encryption key missing.';
    }
    if (! config('apiforge.executor_url') || strlen(config('apiforge.executor_token')) < 32) {
        $issues[] = 'Isolated executor URL or strong service token missing.';
    }
    if (! config('apiforge.approved_hosts')) {
        $issues[] = 'No approved executor hosts configured.';
    }
    $this->info('Queue: '.config('queue.default').'. Run worker and scheduler as separate services.');
    foreach ($issues as $issue) {
        $this->error($issue);
    }
    if ($issues) {
        return 1;
    }
    $this->info('Configuration checks passed; credentials were not printed.');

    return 0;
})->purpose('Check configuration, database and cache without exposing secrets');
