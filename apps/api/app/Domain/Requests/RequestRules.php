<?php

namespace App\Domain\Requests;

use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class RequestRules
{
    public static function validate(Request $r, int $workspaceId): array
    {
        $data = $r->validate([
            'name' => 'required|string|max:150', 'method' => 'required|in:GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
            'url' => 'required|string|max:4096', 'collection_id' => ['nullable', 'integer', Rule::exists('collections', 'id')->where('workspace_id', $workspaceId)],
            'folder_id' => ['nullable', 'integer', Rule::exists('collection_folders', 'id')->where('workspace_id', $workspaceId)->where('collection_id', $r->input('collection_id'))],
            'headers' => 'present|array|max:40', 'headers.*' => 'string|max:4096',
            'query_params' => 'present|array|max:50', 'query_params.*' => 'string|max:4096',
            'body' => 'nullable|string|max:65536', 'assertions' => 'present|array|max:30',
            'body_base64' => 'sometimes|string|max:174764|regex:/^(?:[A-Za-z0-9+\/]{4})*(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?$/D',
            'body_mode' => 'sometimes|in:none,raw,json,urlencoded,multipart',
            'auth_type' => 'sometimes|in:none,bearer,basic,api_key',
            'auth_config' => 'sometimes|array|max:5', 'auth_config.*' => 'string|max:4096',
            'timeout_ms' => 'sometimes|integer|min:100|max:60000',
            'pinned' => 'sometimes|boolean', 'sort_order' => 'sometimes|integer|min:0|max:1000000',
            'assertions.*.type' => 'required|in:status,duration_lt,header_contains,json_equals,json_exists,body_contains',
            'assertions.*.path' => 'nullable|string|max:255', 'assertions.*.expected' => 'nullable',
            'environment_id' => ['nullable', 'integer', Rule::exists('environments', 'id')->where('workspace_id', $workspaceId)],
        ]);
        foreach ($data['headers'] as $key => $value) {
            if (! preg_match('/^[A-Za-z0-9-]+$/D', $key) || preg_match('/[\r\n\x00]/', $value)) {
                throw ValidationException::withMessages(['headers' => 'Invalid HTTP header.']);
            }
            if (preg_match('/authorization|cookie|token|api[-_]?key|secret/i', $key) && ! preg_match('/\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/', $value)) {
                throw ValidationException::withMessages(['headers' => 'Sensitive headers must reference an encrypted environment variable, for example Bearer {{token}}.']);
            }
        }
        if (isset($data['body_base64']) && strlen(base64_decode($data['body_base64'], true) ?: '') > 131072) {
            throw ValidationException::withMessages(['body_base64' => 'Cloud multipart uploads are limited to 128 KiB.']);
        }
        $authType = $data['auth_type'] ?? 'none';
        $auth = $data['auth_config'] ?? [];
        $authValues = match ($authType) {
            'bearer' => [$auth['token'] ?? null],
            'basic' => [$auth['username'] ?? null, $auth['password'] ?? null],
            'api_key' => [$auth['value'] ?? null],
            default => [],
        };
        if ($authType !== 'none' && in_array(null, $authValues, true)) {
            throw ValidationException::withMessages(['auth_config' => 'Authentication credentials must reference environment variables.']);
        }
        foreach ($authValues as $value) {
            if (! preg_match('/\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/', $value)) {
                throw ValidationException::withMessages(['auth_config' => 'Store credentials as encrypted environment variables and reference them with {{variable}}.']);
            }
        }
        if ($authType === 'api_key' && (! in_array($auth['in'] ?? null, ['header', 'query'], true) || ! preg_match('/^[A-Za-z0-9_.-]{1,100}$/D', $auth['key'] ?? ''))) {
            throw ValidationException::withMessages(['auth_config' => 'API key authentication needs a valid key name and header or query placement.']);
        }
        foreach ($data['assertions'] as $a) {
            if (in_array($a['type'], ['status', 'duration_lt'], true) && ! is_numeric($a['expected'] ?? null)) {
                throw ValidationException::withMessages(['assertions' => 'Status and duration checks need a numeric expected value.']);
            }
            if (in_array($a['type'], ['body_contains', 'header_contains'], true) && ! is_string($a['expected'] ?? null)) {
                throw ValidationException::withMessages(['assertions' => 'Contains checks need a string expected value.']);
            }
        }

        return $data;
    }
}
