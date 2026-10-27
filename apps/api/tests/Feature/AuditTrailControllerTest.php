<?php

namespace Tests\Feature;

use App\Models\ApiRequest;
use App\Models\AuditLog;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMember;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AuditTrailControllerTest extends TestCase
{
    use RefreshDatabase;

    private function account(): array
    {
        $user = User::factory()->create(['name' => 'Audit Reviewer']);
        $workspace = Workspace::create(['name' => 'Audit Workspace', 'owner_id' => $user->id]);
        WorkspaceMember::create(['workspace_id' => $workspace->id, 'user_id' => $user->id, 'role' => 'owner']);
        Sanctum::actingAs($user);

        return [$user, $workspace, '/api/v1/workspaces/'.$workspace->id];
    }

    public function test_audit_filters_sort_and_paginate_only_the_active_workspace(): void
    {
        [$user, $workspace, $base] = $this->account();
        foreach ([1, 2] as $n) {
            AuditLog::create([
                'workspace_id' => $workspace->id,
                'user_id' => $user->id,
                'action' => 'request.executed',
                'resource_type' => 'ApiRequest',
                'resource_id' => $n,
                'created_at' => now()->subMinutes($n),
            ]);
        }
        $otherWorkspace = Workspace::create(['name' => 'Private audit space', 'owner_id' => $user->id]);
        AuditLog::create(['workspace_id' => $otherWorkspace->id, 'user_id' => $user->id, 'action' => 'request.executed', 'resource_type' => 'ApiRequest', 'resource_id' => 99]);
        AuditLog::create(['workspace_id' => $workspace->id, 'user_id' => $user->id, 'action' => 'member.updated', 'resource_type' => 'WorkspaceMember', 'resource_id' => 8]);

        $this->getJson($base.'/audit?search=request&action=requests&actor=Audit%20Reviewer&resource_type=ApiRequest&sort=oldest&per_page=1')
            ->assertOk()
            ->assertJsonPath('data.total', 2)
            ->assertJsonPath('data.current_page', 1)
            ->assertJsonPath('data.last_page', 2)
            ->assertJsonPath('data.data.0.action', 'request.executed')
            ->assertJsonPath('data.data.0.actor_name', 'Audit Reviewer')
            ->assertJsonPath('data.data.0.resource_id', 2);

        $this->getJson($base.'/audit?action=not-a-category')->assertUnprocessable();
        $this->getJson($base.'/audit?per_page=1000')->assertUnprocessable();
    }

    public function test_audit_detail_returns_only_recorded_safe_fields_and_scoped_related_link(): void
    {
        [$user, $workspace, $base] = $this->account();
        $request = ApiRequest::create([
            'workspace_id' => $workspace->id,
            'name' => 'Private request',
            'method' => 'GET',
            'url' => 'https://service.example.test/?token=do-not-return-this',
            'headers' => ['Authorization' => 'Bearer do-not-return-this'],
            'query_params' => [],
            'body' => 'do-not-return-this',
        ]);
        $event = AuditLog::create(['workspace_id' => $workspace->id, 'user_id' => $user->id, 'action' => 'request.saved', 'resource_type' => 'ApiRequest', 'resource_id' => $request->id]);

        $this->getJson($base.'/audit/'.$event->id)
            ->assertOk()
            ->assertJsonPath('data.id', $event->id)
            ->assertJsonPath('data.actor_name', 'Audit Reviewer')
            ->assertJsonPath('data.workspace_name', 'Audit Workspace')
            ->assertJsonPath('data.resource_url', '/studio?request='.$request->id)
            ->assertJsonMissing(['url' => $request->url])
            ->assertDontSee('do-not-return-this');

        $outsider = User::factory()->create();
        Sanctum::actingAs($outsider);
        $otherWorkspace = Workspace::create(['name' => 'Other workspace', 'owner_id' => $outsider->id]);
        WorkspaceMember::create(['workspace_id' => $otherWorkspace->id, 'user_id' => $outsider->id, 'role' => 'owner']);
        $this->getJson('/api/v1/workspaces/'.$otherWorkspace->id.'/audit/'.$event->id)->assertNotFound();
    }

    public function test_audit_export_is_bounded_to_safe_event_columns(): void
    {
        [$user, $workspace, $base] = $this->account();
        AuditLog::create(['workspace_id' => $workspace->id, 'user_id' => $user->id, 'action' => 'report.shared', 'resource_type' => 'ShareLink', 'resource_id' => 12]);
        AuditLog::create(['workspace_id' => $workspace->id, 'user_id' => null, 'action' => 'monitor.checked', 'resource_type' => 'Monitor', 'resource_id' => 4]);

        $this->getJson($base.'/audit/export?action=reports')
            ->assertOk()
            ->assertJsonPath('data.exported', 1)
            ->assertJsonPath('data.total_matching', 1)
            ->assertJsonPath('data.limited', false)
            ->assertJsonPath('data.records.0.action', 'report.shared')
            ->assertJsonMissing(['workspace_id' => $workspace->id, 'url' => 'https://example.test']);
    }

    public function test_audit_export_caps_large_results_at_five_hundred_records(): void
    {
        [$user, $workspace, $base] = $this->account();
        $now = now();
        $events = [];
        for ($index = 0; $index < 501; $index++) {
            $events[] = [
                'workspace_id' => $workspace->id,
                'user_id' => $user->id,
                'action' => 'request.executed',
                'resource_type' => 'ApiRequest',
                'resource_id' => $index + 1,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }
        AuditLog::insert($events);

        $this->getJson($base.'/audit/export')
            ->assertOk()
            ->assertJsonPath('data.exported', 500)
            ->assertJsonPath('data.total_matching', 501)
            ->assertJsonPath('data.limited', true);
    }
}
