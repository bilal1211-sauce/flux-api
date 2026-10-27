<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AlertEvent extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['resolved_at' => 'datetime', 'acknowledged_at' => 'datetime'];
    }
}
