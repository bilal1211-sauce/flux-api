<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MonitorRun extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [];
    }
}
