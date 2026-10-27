<?php

return [
    'web_url' => rtrim(env('WEB_URL', 'http://127.0.0.1:3000'), '/'),
    'require_verification' => (bool) env('EMAIL_VERIFICATION_REQUIRED', false),
    'alert_webhook_url' => env('ALERT_WEBHOOK_URL'),
    'alert_webhook_token' => env('ALERT_WEBHOOK_TOKEN', ''),
    'executor_url' => env('EXECUTOR_URL'),
    'executor_token' => env('EXECUTOR_TOKEN', ''),
    // Only operators can approve targets; workspace members cannot extend this list.
    'approved_hosts' => array_values(array_filter(array_map('trim', explode(',', env('EXECUTOR_APPROVED_HOSTS', 'jsonplaceholder.typicode.com,httpbin.org'))))),
    'max_response_bytes' => (int) env('EXECUTOR_MAX_RESPONSE_BYTES', 262144),
    'timeout_seconds' => (int) env('EXECUTOR_TIMEOUT_SECONDS', 15),
    'retention_days' => (int) env('RUN_RETENTION_DAYS', 30),
];
