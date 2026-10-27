<?php

namespace App\Domain\Executions;

class AssertionEngine
{
    public function evaluate(array $assertions, array $response): array
    {
        $json = json_decode($response['body'] ?? '', true);

        return array_map(function ($a) use ($response, $json) {
            $path = $a['path'] ?? null;
            $expected = $a['expected'] ?? null;
            $jsonPath = preg_replace('/^\$\.?/', '', $path ?? '');
            $missing = new \stdClass;
            $actual = match ($a['type']) {
                'status' => $response['status'],
                'duration_lt' => $response['duration_ms'],
                'header_contains' => $response['headers'][strtolower($path ?? '')] ?? null,
                'json_equals', 'json_exists' => data_get($json, $jsonPath, $missing),
                'body_contains' => $response['body'],
                default => $missing,
            };
            $passed = match ($a['type']) {
                'status' => $actual === (int) $expected,
                'duration_lt' => $actual < (float) $expected,
                'json_equals' => $actual !== $missing && $actual === $expected,
                'json_exists' => $actual !== $missing,
                'header_contains', 'body_contains' => is_string($actual) && str_contains($actual, (string) $expected),
                default => false,
            };

            return ['type' => $a['type'], 'path' => $path, 'expected' => $expected, 'actual' => $actual === $missing ? null : (is_string($actual) ? substr($actual, 0, 1000) : $actual), 'passed' => $passed];
        }, $assertions);
    }
}
