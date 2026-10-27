<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;

abstract class Controller
{
    protected function audit(Request $r, string $action, Model $resource): void
    {
        AuditLog::create(['workspace_id' => $r->attributes->get('workspace')->id, 'user_id' => $r->user()->id, 'action' => $action, 'resource_type' => class_basename($resource), 'resource_id' => $resource->id]);
    }
}
