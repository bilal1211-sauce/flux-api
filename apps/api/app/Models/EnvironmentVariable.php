<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class EnvironmentVariable extends Model
{
    protected $guarded = ['id'];

    protected $hidden = ['value'];

    protected function casts(): array
    {
        return ['value' => 'encrypted', 'is_secret' => 'boolean'];
    }
}
