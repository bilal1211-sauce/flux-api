<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ShareLink extends Model
{
    protected $guarded = ['id'];

    protected $hidden = ['token_hash', 'snapshot'];

    protected function casts(): array
    {
        return ['snapshot' => 'array', 'expires_at' => 'datetime', 'revoked_at' => 'datetime'];
    }
}
