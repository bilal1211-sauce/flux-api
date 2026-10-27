<?php

namespace App\Providers;

use App\Mail\OutboxTransport;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use LogicException;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->assertIsolatedE2eDatabase();
        Mail::extend('outbox', fn () => new OutboxTransport);
        RateLimiter::for('api', fn (Request $r) => Limit::perMinute(120)->by('api:'.($r->user()?->id ?? $r->ip())));
        RateLimiter::for('executions', fn (Request $r) => Limit::perMinute(20)->by('execute:'.($r->user()?->id ?? $r->ip())));
        RateLimiter::for('login', fn (Request $r) => Limit::perMinute(10)->by('login:'.$r->ip().':'.hash('sha256', strtolower(is_string($r->input('email')) ? $r->input('email') : ''))));
        RateLimiter::for('registration', fn (Request $r) => Limit::perMinute(5)->by('register:'.$r->ip()));
        RateLimiter::for('recovery', fn (Request $r) => Limit::perMinute(5)->by('recovery:'.$r->ip().':'.hash('sha256', is_string($r->input('email')) ? strtolower($r->input('email')) : '')));
        RateLimiter::for('verification', fn (Request $r) => Limit::perMinute(3)->by('verify:'.($r->user()?->id ?? $r->ip())));
    }

    private function assertIsolatedE2eDatabase(): void
    {
        if (! app()->environment('e2e')) {
            return;
        }

        $database = (string) getenv('E2E_DATABASE_NAME');
        $username = (string) getenv('E2E_DATABASE_USER');
        $connection = config('database.connections.'.config('database.default'));

        if (! preg_match('/^fluxapi_e2e_phase7_[a-f0-9]{12}$/', $database)
            || ! preg_match('/^fluxapi_e2e_[a-f0-9]{12}$/', $username)
            || config('database.default') !== 'mysql'
            || ($connection['database'] ?? null) !== $database
            || ($connection['username'] ?? null) !== $username
            || ($connection['host'] ?? null) !== '127.0.0.1'
            || (string) ($connection['port'] ?? '') !== '3307') {
            throw new LogicException('E2E database guard rejected an unverified database configuration.');
        }

        try {
            $identity = DB::selectOne("SELECT DATABASE() AS database_name, SUBSTRING_INDEX(CURRENT_USER(), '@', 1) AS database_user, @@port AS database_port");
        } catch (\Throwable $exception) {
            throw new LogicException('E2E database guard could not verify the database connection.', previous: $exception);
        }

        if (($identity->database_name ?? null) !== $database
            || ($identity->database_user ?? null) !== $username
            || (int) ($identity->database_port ?? 0) !== 3307) {
            throw new LogicException('E2E database guard rejected a database connection with an unexpected identity.');
        }
    }
}
