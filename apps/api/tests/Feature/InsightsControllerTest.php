<?php

namespace Tests\Feature;

use App\Domain\Executions\SafeTransport;
use App\Models\RequestRun;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMember;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class InsightsControllerTest extends TestCase
{
    use RefreshDatabase;

    private function account(): array
    {
        $user = User::factory()->create();
        $workspace = Workspace::create(['name' => 'Insights', 'owner_id' => $user->id]);
        WorkspaceMember::create(['workspace_id' => $workspace->id, 'user_id' => $user->id, 'role' => 'owner']);
        Sanctum::actingAs($user);

        return [$user, $workspace, '/api/v1/workspaces/'.$workspace->id];
    }

    private function requestPayload(array $overrides = []): array
    {
        return [...[
            'name' => 'Payments endpoint',
            'method' => 'GET',
            'url' => 'https://jsonplaceholder.typicode.com/payments',
            'collection_id' => null,
            'folder_id' => null,
            'headers' => ['Authorization' => 'Bearer {{token}}'],
            'query_params' => [],
            'body' => '',
            'assertions' => [['type' => 'status', 'expected' => 200]],
        ], ...$overrides];
    }

    private function record(Workspace $workspace, User $user, int $requestId, array $overrides = []): RequestRun
    {
        return RequestRun::create([...[
            'workspace_id' => $workspace->id,
            'api_request_id' => $requestId,
            'user_id' => $user->id,
            'name' => 'Payments endpoint',
            'method' => 'GET',
            'url' => 'https://jsonplaceholder.typicode.com/payments',
            'source' => 'manual',
            'execution_mode' => 'cloud',
            'outcome' => 'passed',
            'status' => 200,
            'duration_ms' => 120,
            'size_bytes' => 0,
            'error_code' => null,
            'created_at' => now(),
        ], ...$overrides]);
    }

    public function test_analytics_filters_aggregate_only_matching_workspace_runs(): void
    {
        [$user, $workspace, $base] = $this->account();
        $requestId = $this->postJson($base.'/requests', $this->requestPayload())->assertCreated()->json('data.id');
        $this->record($workspace, $user, $requestId);
        $this->record($workspace, $user, $requestId, ['source' => 'monitor', 'outcome' => 'failed', 'status' => 503, 'duration_ms' => 430]);
        $this->record($workspace, $user, $requestId, ['source' => 'manual', 'execution_mode' => 'local', 'outcome' => 'failed', 'status' => null, 'duration_ms' => 45, 'error_code' => 'NETWORK_ERROR']);
        $otherRequestId = $this->postJson($base.'/requests', $this->requestPayload(['name' => 'Profile endpoint', 'url' => 'https://jsonplaceholder.typicode.com/users/1']))->assertCreated()->json('data.id');
        $this->record($workspace, $user, $otherRequestId, ['name' => 'Profile endpoint', 'url' => 'https://jsonplaceholder.typicode.com/users/1']);

        $this->getJson($base.'/summary?days=7&endpoint=payments&source=manual&mode=cloud')
            ->assertOk()
            ->assertJsonPath('data.total_runs', 1)
            ->assertJsonPath('data.passed_runs', 1)
            ->assertJsonPath('data.avg_latency_ms', 120)
            ->assertJsonPath('data.p95_latency_ms', 120)
            ->assertJsonPath('data.analytics_daily.7.avg_ms', 120)
            ->assertJsonPath('data.analytics.sources.0.category', 'manual')
            ->assertJsonPath('data.analytics.sources.0.total', 1)
            ->assertJsonPath('data.analytics.execution_modes.0.category', 'cloud')
            ->assertJsonPath('data.status_classes.0.category', '2xx')
            ->assertJsonPath('data.status_classes.0.total', 1)
            ->assertJsonPath('data.analytics.highest_volume_endpoints.0.name', 'Payments endpoint');
    }

    public function test_endpoint_p95_uses_the_95th_ordered_sample_after_twenty_runs(): void
    {
        [$user, $workspace, $base] = $this->account();
        $requestId = $this->postJson($base.'/requests', $this->requestPayload())->assertCreated()->json('data.id');
        for ($duration = 20; $duration < 40; $duration++) {
            $this->record($workspace, $user, $requestId, ['duration_ms' => $duration]);
        }

        $this->getJson($base.'/summary?days=7&endpoint=payments')
            ->assertOk()
            ->assertJsonPath('data.analytics.slowest_endpoints.0.runs', 20)
            ->assertJsonPath('data.analytics.slowest_endpoints.0.avg_ms', 29.5)
            ->assertJsonPath('data.analytics.slowest_endpoints.0.p95_ms', 38);
    }

    public function test_monitor_history_is_bounded_secret_safe_and_workspace_scoped(): void
    {
        [$user, $workspace, $base] = $this->account();
        $requestId = $this->postJson($base.'/requests', $this->requestPayload())->assertCreated()->json('data.id');
        $environment = $this->postJson($base.'/environments', ['name' => 'Production', 'variables' => [['key' => 'token', 'value' => 'private-monitor-token', 'is_secret' => true]]])->assertCreated()->json('data.id');
        $monitorId = $this->postJson($base.'/monitors', [
            'name' => 'Payments availability',
            'api_request_id' => $requestId,
            'environment_id' => $environment,
            'interval_minutes' => 5,
            'enabled' => true,
            'failure_threshold' => 1,
        ])->assertCreated()->json('data.id');
        $this->mock(SafeTransport::class, fn ($mock) => $mock->shouldReceive('send')->once()->andReturn([
            'status' => 503,
            'duration_ms' => 310,
            'headers' => ['content-type' => 'text/plain'],
            'body' => 'private response body must not be returned',
            'truncated' => false,
            'error_code' => null,
        ]));
        $this->postJson($base.'/monitors/'.$monitorId.'/check')->assertOk();

        $history = $this->getJson($base.'/monitors/'.$monitorId.'/history?per_page=1')
            ->assertOk()
            ->assertJsonPath('data.monitor.name', 'Payments availability')
            ->assertJsonPath('data.monitor.request.endpoint', 'jsonplaceholder.typicode.com/payments')
            ->assertJsonPath('data.history.per_page', 1)
            ->assertJsonPath('data.history.data.0.status', 503)
            ->assertJsonMissingPath('data.history.data.0.url')
            ->assertJsonMissingPath('data.history.data.0.headers');
        $this->assertStringNotContainsString('Bearer {{token}}', $history->getContent());
        $this->assertStringNotContainsString('private-monitor-token', $history->getContent());
        $this->assertStringNotContainsString('private response body', $history->getContent());

        $otherUser = User::factory()->create();
        $otherWorkspace = Workspace::create(['name' => 'Other workspace', 'owner_id' => $otherUser->id]);
        WorkspaceMember::create(['workspace_id' => $otherWorkspace->id, 'user_id' => $otherUser->id, 'role' => 'owner']);
        Sanctum::actingAs($otherUser);
        $this->getJson('/api/v1/workspaces/'.$otherWorkspace->id.'/monitors/'.$monitorId.'/history')->assertNotFound();
    }

    public function test_analytics_rejects_a_request_filter_from_another_workspace(): void
    {
        [$user, , $base] = $this->account();
        [, , $otherBase] = $this->account();
        $otherRequestId = $this->postJson($otherBase.'/requests', $this->requestPayload())->assertCreated()->json('data.id');
        Sanctum::actingAs($user);

        $this->getJson($base.'/summary?request_id='.$otherRequestId)->assertUnprocessable();
    }
}
