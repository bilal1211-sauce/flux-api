<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CollectionFolder extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['sort_order' => 'integer'];
    }
}
