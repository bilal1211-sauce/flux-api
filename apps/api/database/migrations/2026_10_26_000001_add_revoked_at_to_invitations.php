<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invitations', function (Blueprint $table) {
            $table->timestamp('revoked_at')->nullable()->after('accepted_at');
        });
    }

    public function down(): void
    {
        throw new LogicException('This migration is forward-only because removing revoked_at would discard invitation revocation history.');
    }
};
