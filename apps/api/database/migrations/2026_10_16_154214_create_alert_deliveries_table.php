<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('alert_deliveries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->foreignId('alert_event_id')->constrained()->cascadeOnDelete();
            $table->string('channel', 16);
            $table->string('recipient', 32);
            $table->boolean('recovery')->default(false);
            $table->string('status', 16)->default('pending');
            $table->string('error_code')->nullable();
            $table->timestamp('delivered_at')->nullable();
            $table->timestamps();
            $table->unique(['alert_event_id', 'channel', 'recipient', 'recovery'], 'alert_delivery_identity');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('alert_deliveries');
    }
};
