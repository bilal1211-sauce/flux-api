<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Monitor extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['enabled' => 'boolean', 'interval_minutes' => 'integer', 'next_run_at' => 'datetime', 'last_run_at' => 'datetime'];
    }
}
