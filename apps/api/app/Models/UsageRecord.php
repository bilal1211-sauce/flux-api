<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UsageRecord extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['runs' => 'integer'];
    }
}
