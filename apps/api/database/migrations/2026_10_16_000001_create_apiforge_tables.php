<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', fn (Blueprint $t) => $t->boolean('is_admin')->default(false));
        Schema::create('workspaces', function (Blueprint $t) {
            $t->id();
            $t->string('name');
            $t->foreignId('owner_id')->constrained('users');
            $t->unsignedInteger('daily_run_limit')->default(1000);
            $t->timestamps();
        });
        Schema::create('workspace_members', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->string('role', 16);
            $t->timestamps();
            $t->unique(['workspace_id', 'user_id']);
        });
        Schema::create('invitations', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->string('email');
            $t->string('role', 16);
            $t->string('token_hash', 64)->unique();
            $t->timestamp('expires_at');
            $t->timestamp('accepted_at')->nullable();
            $t->timestamps();
        });
        Schema::create('collections', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->string('name');
            $t->text('description')->nullable();
            $t->timestamps();
        });
        Schema::create('collection_folders', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->foreignId('collection_id')->constrained()->cascadeOnDelete();
            $t->string('name');
            $t->timestamps();
        });
        Schema::create('api_requests', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->foreignId('collection_id')->nullable()->constrained()->nullOnDelete();
            $t->foreignId('folder_id')->nullable()->constrained('collection_folders')->nullOnDelete();
            $t->string('name');
            $t->string('method', 10);
            $t->text('url');
            $t->json('headers');
            $t->json('query_params');
            $t->text('body')->nullable();
            $t->timestamps();
        });
        Schema::create('request_assertions', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->foreignId('api_request_id')->constrained()->cascadeOnDelete();
            $t->string('type', 30);
            $t->string('path')->nullable();
            $t->json('expected')->nullable();
            $t->timestamps();
        });
        Schema::create('environments', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->string('name');
            $t->timestamps();
        });
        Schema::create('environment_variables', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->foreignId('environment_id')->constrained()->cascadeOnDelete();
            $t->string('key');
            $t->text('value');
            $t->boolean('is_secret')->default(false);
            $t->timestamps();
            $t->unique(['environment_id', 'key']);
        });
        Schema::create('request_runs', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->foreignId('api_request_id')->nullable()->constrained()->nullOnDelete();
            $t->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $t->string('name');
            $t->string('method', 10);
            $t->text('url');
            $t->string('source', 20)->default('manual');
            $t->string('outcome', 20);
            $t->unsignedSmallInteger('status')->nullable();
            $t->unsignedInteger('duration_ms');
            $t->unsignedInteger('size_bytes')->default(0);
            $t->string('error_code')->nullable();
            $t->timestamps();
            $t->index(['workspace_id', 'created_at']);
        });
        Schema::create('response_records', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->foreignId('request_run_id')->unique()->constrained()->cascadeOnDelete();
            $t->json('headers');
            $t->mediumText('body')->nullable();
            $t->boolean('truncated')->default(false);
            $t->timestamps();
        });
        Schema::create('assertion_results', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->foreignId('request_run_id')->constrained()->cascadeOnDelete();
            $t->string('type', 30);
            $t->string('path')->nullable();
            $t->json('expected')->nullable();
            $t->json('actual')->nullable();
            $t->boolean('passed');
            $t->timestamps();
        });
        Schema::create('monitors', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->foreignId('api_request_id')->constrained()->cascadeOnDelete();
            $t->foreignId('environment_id')->nullable()->constrained()->nullOnDelete();
            $t->string('name');
            $t->unsignedInteger('interval_minutes')->default(5);
            $t->boolean('enabled')->default(true);
            $t->timestamp('next_run_at')->nullable()->index();
            $t->timestamp('last_run_at')->nullable();
            $t->string('last_outcome')->nullable();
            $t->unsignedInteger('consecutive_failures')->default(0);
            $t->timestamps();
        });
        Schema::create('monitor_runs', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->foreignId('monitor_id')->constrained()->cascadeOnDelete();
            $t->foreignId('request_run_id')->constrained()->cascadeOnDelete();
            $t->timestamps();
        });
        Schema::create('alert_rules', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->foreignId('monitor_id')->constrained()->cascadeOnDelete();
            $t->unsignedInteger('failure_threshold')->default(2);
            $t->boolean('enabled')->default(true);
            $t->timestamps();
            $t->unique('monitor_id');
        });
        Schema::create('alert_events', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->foreignId('monitor_id')->constrained()->cascadeOnDelete();
            $t->string('message');
            $t->timestamp('resolved_at')->nullable();
            $t->timestamp('acknowledged_at')->nullable();
            $t->timestamps();
        });
        Schema::create('audit_logs', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $t->string('action');
            $t->string('resource_type')->nullable();
            $t->unsignedBigInteger('resource_id')->nullable();
            $t->timestamps();
        });
        Schema::create('share_links', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->string('token_hash', 64)->unique();
            $t->string('name');
            $t->json('snapshot');
            $t->timestamp('expires_at');
            $t->timestamp('revoked_at')->nullable();
            $t->timestamps();
        });
        Schema::create('usage_records', function (Blueprint $t) {
            $t->id();
            $t->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $t->date('day');
            $t->unsignedInteger('runs')->default(0);
            $t->timestamps();
            $t->unique(['workspace_id', 'day']);
        });
    }

    public function down(): void
    {
        foreach (['usage_records', 'share_links', 'audit_logs', 'alert_events', 'alert_rules', 'monitor_runs', 'monitors', 'assertion_results', 'response_records', 'request_runs', 'environment_variables', 'environments', 'request_assertions', 'api_requests', 'collection_folders', 'collections', 'invitations', 'workspace_members', 'workspaces'] as $table) {
            Schema::dropIfExists($table);
        }
        Schema::table('users', fn (Blueprint $t) => $t->dropColumn('is_admin'));
    }
};
