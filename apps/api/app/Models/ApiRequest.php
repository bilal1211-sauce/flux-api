<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ApiRequest extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['headers' => 'array', 'query_params' => 'array', 'auth_config' => 'array', 'timeout_ms' => 'integer', 'pinned' => 'boolean', 'sort_order' => 'integer'];
    }

    public function assertions()
    {
        return $this->hasMany(RequestAssertion::class);
    }
}
