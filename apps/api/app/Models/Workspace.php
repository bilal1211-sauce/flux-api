<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Workspace extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['daily_run_limit' => 'integer', 'email_alerts' => 'boolean', 'webhook_alerts' => 'boolean'];
    }
}
