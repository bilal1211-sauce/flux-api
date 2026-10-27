<?php

namespace App\Domain\Executions;

use Illuminate\Validation\ValidationException;

class CurlTransport
{
    public function send(string $method, string $url, array $headers, ?string $body, ?int $timeoutMs = null, ?string $operatorApprovedHost = null): array
    {
        $target = app(SafeTarget::class);
        $host = $target->host($url, $operatorApprovedHost);
        $ip = $target->resolve($host);
        $wireHeaders = ['User-Agent: APIForge/1.0', 'Accept: application/json'];
        foreach ($headers as $key => $value) {
            if (! preg_match('/^[A-Za-z0-9-]+$/D', $key) || strlen((string) $value) > 8192 || preg_match('/[\r\n\x00]/', (string) $value)
                || in_array(strtolower($key), ['host', 'connection', 'content-length', 'transfer-encoding', 'expect', 'te', 'upgrade', 'proxy-authorization', 'proxy-connection'], true)) {
                throw ValidationException::withMessages(['headers' => 'Invalid or reserved HTTP header.']);
            }
            $wireHeaders[] = $key.': '.$value;
        }
        $content = '';
        $receivedHeaders = [];
        $truncated = false;
        $limit = config('apiforge.max_response_bytes');
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $wireHeaders,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXREDIRS => 0,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_PROXY => '',
            CURLOPT_RESOLVE => [$host.':443:'.(str_contains($ip, ':') ? '['.$ip.']' : $ip)],
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT_MS => min(15000, max(100, $timeoutMs ?? config('apiforge.timeout_seconds') * 1000)),
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_ENCODING => '',
            CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$receivedHeaders) {
                if (str_contains($line, ':')) {
                    [$k, $v] = explode(':', $line, 2);
                    if (count($receivedHeaders) < 100) {
                        $receivedHeaders[strtolower(trim($k))] = substr(trim($v), 0, 2048);
                    }
                }

                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$content, &$truncated, $limit) {
                $room = $limit - strlen($content);
                $content .= substr($chunk, 0, max(0, $room));
                if (strlen($chunk) > $room) {
                    $truncated = true;

                    return 0;
                }

                return strlen($chunk);
            },
        ]);
        if ($method === 'HEAD') {
            curl_setopt($curl, CURLOPT_NOBODY, true);
        }
        if ($body !== null && $body !== '' && ! in_array($method, ['GET', 'HEAD'], true)) {
            curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
        }
        curl_exec($curl);
        $errno = curl_errno($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $duration = (int) round(curl_getinfo($curl, CURLINFO_TOTAL_TIME) * 1000);
        $error = $errno && ! $truncated ? ($errno === CURLE_OPERATION_TIMEDOUT ? 'TIMEOUT' : 'NETWORK_ERROR') : null;
        curl_close($curl);

        return ['status' => $status ?: null, 'duration_ms' => $duration, 'headers' => $receivedHeaders, 'body' => $content, 'truncated' => $truncated, 'error_code' => $error];
    }
}
