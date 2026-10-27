<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AlertDelivery extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['recovery' => 'boolean', 'delivered_at' => 'datetime'];
    }
}
