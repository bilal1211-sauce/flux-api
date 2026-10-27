<?php

namespace App\Domain\Executions;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;

class RemoteTransport
{
    public function send(string $method, string $url, array $headers, ?string $body, ?int $timeoutMs = null, ?string $operatorApprovedHost = null): array
    {
        try {
            $timeout = $timeoutMs ?? config('apiforge.timeout_seconds') * 1000;
            $approvedHost = $operatorApprovedHost ?? strtolower((string) parse_url($url, PHP_URL_HOST));
            $approvedAt = time();
            $approvalSignature = hash_hmac('sha256', $approvedHost."\n".$approvedAt, config('apiforge.executor_token'));
            $response = Http::withoutRedirecting()->connectTimeout(3)->timeout((int) ceil($timeout / 1000) + 5)
                ->withToken(config('apiforge.executor_token'))->post(rtrim(config('apiforge.executor_url'), '/').'/run', compact('method', 'url', 'headers') + ['body_base64' => base64_encode($body ?? ''), 'timeout_ms' => $timeout, 'approved_host' => $approvedHost, 'approved_at' => $approvedAt, 'approval_signature' => $approvalSignature]);
            if ($response->status() === 422) {
                throw ValidationException::withMessages(['url' => 'The isolated executor rejected this destination or request.']);
            }
            if ($response->successful() && is_array($response->json('data')) && array_key_exists('error_code', $response->json('data'))) {
                return $response->json('data');
            }
        } catch (ConnectionException $e) {
            // Do not log request payloads, credentials, or exception URLs.
        }

        return ['status' => null, 'duration_ms' => 0, 'headers' => [], 'body' => '', 'truncated' => false, 'error_code' => 'EXECUTOR_UNAVAILABLE'];
    }
}
