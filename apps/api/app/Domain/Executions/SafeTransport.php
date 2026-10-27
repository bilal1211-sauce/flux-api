<?php

namespace App\Domain\Executions;

class SafeTransport
{
    public function send(string $method, string $url, array $headers, ?string $body, ?int $timeoutMs = null, ?string $operatorApprovedHost = null): array
    {
        if (config('apiforge.executor_url')) {
            return app(RemoteTransport::class)->send($method, $url, $headers, $body, $timeoutMs, $operatorApprovedHost);
        }
        if (app()->environment('production')) {
            abort(503, 'The isolated executor is not configured.');
        }

        return app(CurlTransport::class)->send($method, $url, $headers, $body, $timeoutMs, $operatorApprovedHost);
    }
}
