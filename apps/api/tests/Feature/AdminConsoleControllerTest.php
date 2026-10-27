<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\RequestRun;
use App\Models\UsageRecord;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMember;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminConsoleControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_workspace_and_user_explorers_are_searchable_paginated_and_truthful(): void
    {
        $admin = User::factory()->create(['is_admin' => true]);
        $owner = User::factory()->create(['name' => 'Workspace Owner', 'email' => 'owner@admin.test']);
        $workspace = Workspace::create(['name' => 'Usage Workspace', 'owner_id' => $owner->id, 'daily_run_limit' => 120]);
        Workspace::create(['name' => 'Quiet workspace', 'owner_id' => $admin->id, 'daily_run_limit' => 80]);
        WorkspaceMember::create(['workspace_id' => $workspace->id, 'user_id' => $owner->id, 'role' => 'owner']);
        UsageRecord::create(['workspace_id' => $workspace->id, 'day' => today()->toDateString(), 'runs' => 7]);
        RequestRun::create([
            'workspace_id' => $workspace->id,
            'user_id' => $owner->id,
            'name' => 'Saved call',
            'method' => 'GET',
            'url' => 'https://example.test/',
            'source' => 'manual',
            'outcome' => 'passed',
            'status' => 200,
            'duration_ms' => 11,
            'size_bytes' => 0,
        ]);
        Sanctum::actingAs($admin);

        $this->getJson('/api/v1/admin?workspace_search=Usage&user_search=owner%40admin.test&per_page=1')
            ->assertOk()
            ->assertJsonPath('data.total_users', 2)
            ->assertJsonPath('data.total_workspaces', 2)
            ->assertJsonPath('data.total_runs', 1)
            ->assertJsonPath('data.usage_today', 7)
            ->assertJsonPath('data.daily_quota_capacity', 200)
            ->assertJsonPath('data.quota_used_percent', 3.5)
            ->assertJsonPath('data.workspaces.0.name', 'Usage Workspace')
            ->assertJsonPath('data.workspaces.0.owner_email', 'owner@admin.test')
            ->assertJsonPath('data.workspaces.0.member_count', 1)
            ->assertJsonPath('data.workspaces.0.usage_today', 7)
            ->assertJsonPath('data.users.0.email', 'owner@admin.test')
            ->assertJsonPath('data.users.0.workspace_count', 1)
            ->assertJsonPath('data.worker_status', 'not_monitored');

        $this->getJson('/api/v1/admin?per_page=1&workspace_page=2&users_page=2')
            ->assertOk()
            ->assertJsonPath('data.workspaces_pagination.current_page', 2)
            ->assertJsonPath('data.workspaces_pagination.total', 2)
            ->assertJsonPath('data.users_pagination.current_page', 2)
            ->assertJsonPath('data.users_pagination.total', 2);

        $this->getJson('/api/v1/admin/workspaces/'.$workspace->id)
            ->assertOk()
            ->assertJsonPath('data.workspace.id', $workspace->id)
            ->assertJsonPath('data.members.0.role', 'owner');
        $this->getJson('/api/v1/admin/users/'.$owner->id)
            ->assertOk()
            ->assertJsonPath('data.user.email', 'owner@admin.test')
            ->assertJsonPath('data.workspaces.0.id', $workspace->id);
    }

    public function test_non_admin_cannot_read_platform_data_or_change_quotas(): void
    {
        $user = User::factory()->create();
        $workspace = Workspace::create(['name' => 'Protected workspace', 'owner_id' => $user->id]);
        Sanctum::actingAs($user);

        $this->getJson('/api/v1/admin')->assertForbidden();
        $this->getJson('/api/v1/admin/users/'.$user->id)->assertForbidden();
        $this->getJson('/api/v1/admin/workspaces/'.$workspace->id)->assertForbidden();
        $this->patchJson('/api/v1/admin/workspaces/'.$workspace->id.'/limit', ['daily_run_limit' => 20])->assertForbidden();
        $this->assertDatabaseMissing('audit_logs', ['action' => 'admin.quota.updated']);
    }

    public function test_quota_changes_are_validated_and_append_a_workspace_audit_event(): void
    {
        $admin = User::factory()->create(['is_admin' => true]);
        $owner = User::factory()->create();
        $workspace = Workspace::create(['name' => 'Quota target', 'owner_id' => $owner->id]);
        Sanctum::actingAs($admin);

        $this->patchJson('/api/v1/admin/workspaces/'.$workspace->id.'/limit', ['daily_run_limit' => 0])->assertUnprocessable();
        $this->patchJson('/api/v1/admin/workspaces/'.$workspace->id.'/limit', ['daily_run_limit' => 100001])->assertUnprocessable();
        $this->patchJson('/api/v1/admin/workspaces/'.$workspace->id.'/limit', ['daily_run_limit' => 750])
            ->assertOk()
            ->assertJsonPath('data.daily_run_limit', 750);

        $this->assertDatabaseHas('audit_logs', [
            'workspace_id' => $workspace->id,
            'user_id' => $admin->id,
            'action' => 'admin.quota.updated',
            'resource_type' => 'Workspace',
            'resource_id' => $workspace->id,
        ]);
        $this->assertSame(1, AuditLog::where('workspace_id', $workspace->id)->count());
    }
}
