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
        Schema::create('destination_approvals', function (Blueprint $table) {
            $table->id();
            $table->string('hostname', 253)->unique();
            $table->string('status', 16)->default('pending');
            $table->text('reason')->nullable();
            $table->foreignId('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['status', 'updated_at']);
        });
        Schema::table('collection_folders', function (Blueprint $table) {
            $table->foreignId('parent_id')->nullable()->after('collection_id')->constrained('collection_folders')->nullOnDelete();
            $table->unsignedInteger('sort_order')->default(0)->after('name');
            $table->index(['workspace_id', 'collection_id', 'parent_id', 'sort_order'], 'folders_tree_order_idx');
        });
        Schema::table('api_requests', function (Blueprint $table) {
            $table->string('body_mode', 20)->default('raw')->after('body');
            $table->string('auth_type', 20)->default('none')->after('body_mode');
            $table->json('auth_config')->nullable()->after('auth_type');
            $table->unsignedSmallInteger('timeout_ms')->default(15000)->after('auth_config');
            $table->boolean('pinned')->default(false)->after('timeout_ms');
            $table->unsignedInteger('sort_order')->default(0)->after('pinned');
            $table->index(['workspace_id', 'collection_id', 'folder_id', 'sort_order'], 'requests_tree_order_idx');
        });
        Schema::table('request_runs', function (Blueprint $table) {
            $table->string('execution_mode', 10)->default('cloud')->after('source');
            $table->uuid('execution_id')->nullable()->unique()->after('execution_mode');
            $table->json('timings')->nullable()->after('duration_ms');
            $table->index(['workspace_id', 'execution_mode', 'created_at'], 'runs_mode_time_idx');
            $table->index(['workspace_id', 'outcome', 'created_at'], 'runs_outcome_time_idx');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('destination_approvals');
        Schema::table('request_runs', function (Blueprint $table) {
            $table->dropIndex('runs_mode_time_idx');
            $table->dropIndex('runs_outcome_time_idx');
            $table->dropUnique(['execution_id']);
            $table->dropColumn(['execution_mode', 'execution_id', 'timings']);
        });
        Schema::table('api_requests', function (Blueprint $table) {
            $table->dropIndex('requests_tree_order_idx');
            $table->dropColumn(['body_mode', 'auth_type', 'auth_config', 'timeout_ms', 'pinned', 'sort_order']);
        });
        Schema::table('collection_folders', function (Blueprint $table) {
            $table->dropIndex('folders_tree_order_idx');
            $table->dropConstrainedForeignId('parent_id');
            $table->dropColumn('sort_order');
        });
    }
};
