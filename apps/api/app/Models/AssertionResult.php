<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AssertionResult extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['expected' => 'json', 'actual' => 'json', 'passed' => 'boolean'];
    }
}
