<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RequestRun extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['status' => 'integer', 'duration_ms' => 'integer', 'size_bytes' => 'integer', 'timings' => 'array'];
    }

    public function response()
    {
        return $this->hasOne(ResponseRecord::class);
    }

    public function assertions()
    {
        return $this->hasMany(AssertionResult::class);
    }
}
