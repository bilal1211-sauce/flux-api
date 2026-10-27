<?php

return [
    'paths' => [resource_path('views')],
    'compiled' => env('VIEW_COMPILED_PATH', storage_path('framework/views')),
    'cache' => env('VIEW_CACHE', true),
    'relative_hash' => false,
    'compiled_extension' => 'php',
    'check_cache_timestamps' => true,
];
