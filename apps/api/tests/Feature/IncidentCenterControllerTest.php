<?php

namespace Tests\Feature;

use App\Models\AlertDelivery;
use App\Models\AlertEvent;
use App\Models\AlertRule;
use App\Models\ApiRequest;
use App\Models\Environment;
use App\Models\EnvironmentVariable;
use App\Models\Monitor;
use App\Models\MonitorRun;
use App\Models\RequestRun;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMember;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class IncidentCenterControllerTest extends TestCase
{
    use RefreshDatabase;

    private function account(): array
    {
        $user = User::factory()->create();
        $workspace = Workspace::create(['name' => 'Incident workspace', 'owner_id' => $user->id]);
        WorkspaceMember::create(['workspace_id' => $workspace->id, 'user_id' => $user->id, 'role' => 'owner']);
        Sanctum::actingAs($user);

        return [$user, $workspace, '/api/v1/workspaces/'.$workspace->id];
    }

    private function monitor(Workspace $workspace): Monitor
    {
        $request = ApiRequest::create([
            'workspace_id' => $workspace->id,
            'name' => 'Checkout API',
            'method' => 'GET',
            'url' => 'https://api.example.test/checkout',
            'collection_id' => null,
            'folder_id' => null,
            'headers' => [],
            'query_params' => [],
            'body' => '',
        ]);
        $monitor = Monitor::create([
            'workspace_id' => $workspace->id,
            'api_request_id' => $request->id,
            'environment_id' => null,
            'name' => 'Checkout availability',
            'interval_minutes' => 5,
            'enabled' => true,
            'consecutive_failures' => 2,
        ]);
        AlertRule::create(['workspace_id' => $workspace->id, 'monitor_id' => $monitor->id, 'failure_threshold' => 2, 'enabled' => true]);

        return $monitor;
    }

    private function createRun(Workspace $workspace, User $user, Monitor $monitor, array $overrides = []): RequestRun
    {
        $requestId = $monitor->api_request_id;
        $run = RequestRun::create([...[
            'workspace_id' => $workspace->id,
            'api_request_id' => $requestId,
            'user_id' => $user->id,
            'name' => 'Checkout API',
            'method' => 'GET',
            'url' => 'https://api.example.test/checkout',
            'source' => 'monitor',
            'execution_mode' => 'cloud',
            'outcome' => 'failed',
            'status' => 503,
            'duration_ms' => 88,
            'size_bytes' => 0,
            'error_code' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ], ...$overrides]);
        MonitorRun::create(['workspace_id' => $workspace->id, 'monitor_id' => $monitor->id, 'request_run_id' => $run->id]);

        return $run;
    }

    public function test_incident_filters_counts_and_pagination_use_workspace_records(): void
    {
        [, $workspace, $base] = $this->account();
        $monitor = $this->monitor($workspace);
        for ($index = 0; $index < 28; $index++) {
            AlertEvent::create([
                'workspace_id' => $workspace->id,
                'monitor_id' => $monitor->id,
                'message' => 'Checkout availability reached two failures.',
                'created_at' => now()->subMinutes($index),
                'resolved_at' => $index > 0 ? now()->subMinutes(max(0, $index - 1)) : null,
                'acknowledged_at' => $index % 2 === 0 ? now()->subMinutes(max(0, $index - 1)) : null,
            ]);
        }

        $this->getJson($base.'/alerts?search=Checkout&monitor_id='.$monitor->id.'&date_from='.now()->toDateString().'&date_to='.now()->toDateString())
            ->assertOk()
            ->assertJsonPath('data.incidents.total', 28)
            ->assertJsonPath('data.incidents.per_page', 25)
            ->assertJsonPath('data.incidents.data.0.monitor_name', 'Checkout availability')
            ->assertJsonPath('data.summary.open', 1)
            ->assertJsonPath('data.summary.resolved', 27)
            ->assertJsonPath('data.summary.acknowledged', 14);
        $this->getJson($base.'/alerts?status=unacknowledged&per_page=100')
            ->assertOk()->assertJsonPath('data.incidents.total', 14);
        $this->getJson($base.'/alerts?monitor_id=99999')->assertUnprocessable();
    }

    public function test_incident_detail_builds_timeline_from_real_checks_and_redacts_delivery_fields(): void
    {
        [$user, $workspace, $base] = $this->account();
        $monitor = $this->monitor($workspace);
        $environment = Environment::create(['workspace_id' => $workspace->id, 'name' => 'Production']);
        EnvironmentVariable::create(['workspace_id' => $workspace->id, 'environment_id' => $environment->id, 'key' => 'token', 'value' => 'incident-private-secret-9021', 'is_secret' => true]);
        $start = now()->subMinutes(10);
        $firstRun = $this->createRun($workspace, $user, $monitor, ['created_at' => $start, 'updated_at' => $start]);
        $secondRun = $this->createRun($workspace, $user, $monitor, ['created_at' => $start->copy()->addMinute(), 'updated_at' => $start->copy()->addMinute(), 'status' => null, 'error_code' => 'NETWORK_ERROR']);
        $event = AlertEvent::create([
            'workspace_id' => $workspace->id,
            'monitor_id' => $monitor->id,
            'message' => 'Checkout availability with incident-private-secret-9021 reached two failures.',
            'created_at' => $start->copy()->addMinutes(2),
            'acknowledged_at' => $start->copy()->addMinutes(3),
            'resolved_at' => $start->copy()->addMinutes(5),
        ]);
        $recoveryRun = $this->createRun($workspace, $user, $monitor, ['created_at' => $start->copy()->addMinutes(5), 'updated_at' => $start->copy()->addMinutes(5), 'outcome' => 'passed', 'status' => 200]);
        AlertDelivery::create([
            'workspace_id' => $workspace->id,
            'alert_event_id' => $event->id,
            'channel' => 'email',
            'recipient' => 'secret-recipient@test.invalid',
            'recovery' => false,
            'status' => 'failed',
            'error_code' => 'MAIL_TRANSPORT_FAILED',
            'delivered_at' => null,
            'created_at' => $start->copy()->addMinutes(2)->addSeconds(10),
        ]);

        $detail = $this->getJson($base.'/alerts/'.$event->id)
            ->assertOk()
            ->assertJsonPath('data.monitor.id', $monitor->id)
            ->assertJsonPath('data.timeline.0.title', 'First recorded failed check')
            ->assertJsonPath('data.timeline.0.run_id', $firstRun->id)
            ->assertJsonPath('data.checks_total', 3)
            ->assertJsonPath('data.checks_truncated', false);
        $timeline = $detail->json('data.timeline');
        $titles = array_column($timeline, 'title');
        $this->assertContains('Subsequent failed check', $titles);
        $this->assertContains('Alert threshold reached', $titles);
        $this->assertContains('Failure notification attempt', $titles);
        $this->assertContains('Incident acknowledged', $titles);
        $this->assertContains('Recovery check', $titles);
        $this->assertContains('Monitor recovery resolved the incident', $titles);
        $this->assertStringNotContainsString('incident-private-secret-9021', $detail->getContent());
        $this->assertStringNotContainsString('secret-recipient@test.invalid', $detail->getContent());
        $this->assertSame($recoveryRun->id, collect($timeline)->firstWhere('title', 'Recovery check')['run_id']);

        $this->getJson($base.'/alert-deliveries')
            ->assertOk()
            ->assertJsonPath('data.0.error_code', 'MAIL_TRANSPORT_FAILED');
        $this->assertStringNotContainsString('recipient', $this->getJson($base.'/alert-deliveries')->getContent());
        $this->assertNotSame($secondRun->id, $recoveryRun->id);
    }

    public function test_acknowledgment_does_not_resolve_an_incident_and_other_workspaces_cannot_read_it(): void
    {
        [, $workspace, $base] = $this->account();
        $monitor = $this->monitor($workspace);
        $event = AlertEvent::create(['workspace_id' => $workspace->id, 'monitor_id' => $monitor->id, 'message' => 'Failure threshold reached.']);
        $acknowledged = $this->patchJson($base.'/alerts/'.$event->id.'/acknowledge')->assertOk();
        $this->assertIsString($acknowledged->json('data.acknowledged_at'));
        $detail = $this->getJson($base.'/alerts/'.$event->id)->assertOk();
        $this->assertNull($detail->json('data.incident.resolved_at'));
        $this->assertIsString($detail->json('data.incident.acknowledged_at'));

        [$otherUser, $otherWorkspace] = $this->account();
        $otherMonitor = $this->monitor($otherWorkspace);
        $otherEvent = AlertEvent::create(['workspace_id' => $otherWorkspace->id, 'monitor_id' => $otherMonitor->id, 'message' => 'Another incident.']);
        Sanctum::actingAs($otherUser);
        $otherBase = '/api/v1/workspaces/'.$otherWorkspace->id;
        $this->getJson($otherBase.'/alerts/'.$event->id)->assertNotFound();
        $this->patchJson($otherBase.'/alerts/'.$event->id.'/acknowledge')->assertNotFound();
        $this->getJson($otherBase.'/alerts/'.$otherEvent->id)->assertOk();
    }
}
