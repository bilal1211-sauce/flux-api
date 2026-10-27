<?php

namespace Tests\Feature;

use App\Models\ApiRequest;
use App\Models\AssertionResult;
use App\Models\Environment;
use App\Models\EnvironmentVariable;
use App\Models\RequestRun;
use App\Models\ResponseRecord;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMember;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class RunHistoryControllerTest extends TestCase
{
    use RefreshDatabase;

    private function account(): array
    {
        $user = User::factory()->create();
        $workspace = Workspace::create(['name' => 'History workspace', 'owner_id' => $user->id]);
        WorkspaceMember::create(['workspace_id' => $workspace->id, 'user_id' => $user->id, 'role' => 'owner']);
        Sanctum::actingAs($user);

        return [$user, $workspace, '/api/v1/workspaces/'.$workspace->id];
    }

    private function requestFor(Workspace $workspace): int
    {
        return ApiRequest::create([
            'workspace_id' => $workspace->id,
            'name' => 'Payments endpoint',
            'method' => 'GET',
            'url' => 'https://api.example.test/payments?token=private-url-token',
            'collection_id' => null,
            'folder_id' => null,
            'headers' => [],
            'query_params' => [],
            'body' => '',
        ])->id;
    }

    private function createRun(Workspace $workspace, User $user, int $requestId, array $overrides = []): RequestRun
    {
        return RequestRun::create([...[
            'workspace_id' => $workspace->id,
            'api_request_id' => $requestId,
            'user_id' => $user->id,
            'name' => 'Payments endpoint',
            'method' => 'GET',
            'url' => 'https://api.example.test/payments?token=[REDACTED]',
            'source' => 'manual',
            'execution_mode' => 'cloud',
            'outcome' => 'passed',
            'status' => 200,
            'duration_ms' => 120,
            'size_bytes' => 12,
            'error_code' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ], ...$overrides]);
    }

    public function test_run_filters_are_workspace_scoped_and_server_paginated(): void
    {
        [$user, $workspace, $base] = $this->account();
        $requestId = $this->requestFor($workspace);
        for ($index = 0; $index < 28; $index++) {
            $this->createRun($workspace, $user, $requestId, [
                'name' => $index === 27 ? 'Payments outage' : 'Payments endpoint',
                'outcome' => 'failed',
                'status' => 503,
                'source' => 'monitor',
                'duration_ms' => 200 + $index,
                'created_at' => now()->subMinutes($index),
            ]);
        }
        $latest = $this->getJson($base.'/runs?search=Payments&method=GET&source=monitor&mode=cloud&status=5xx&classification=http_failure&outcome=failed&date_from='.now()->toDateString().'&date_to='.now()->toDateString())
            ->assertOk()
            ->assertJsonPath('data.total', 28)
            ->assertJsonPath('data.per_page', 25)
            ->assertJsonPath('data.current_page', 1)
            ->assertJsonPath('data.data.0.failure_classification', 'http_failure')
            ->assertJsonPath('data.data.0.assertion_outcome', 'none');
        $this->assertCount(25, $latest->json('data.data'));

        $this->getJson($base.'/runs?search=outage&status=503&per_page=100')
            ->assertOk()
            ->assertJsonPath('data.total', 1)
            ->assertJsonPath('data.data.0.name', 'Payments outage');
        $this->getJson($base.'/runs?monitor_id=999999')->assertUnprocessable();
    }

    public function test_execution_http_and_assertion_failures_are_separate_filters(): void
    {
        [$user, $workspace, $base] = $this->account();
        $requestId = $this->requestFor($workspace);
        $transport = $this->createRun($workspace, $user, $requestId, ['outcome' => 'failed', 'status' => null, 'error_code' => 'NETWORK_ERROR']);
        $http = $this->createRun($workspace, $user, $requestId, ['outcome' => 'failed', 'status' => 503]);
        $assertion = $this->createRun($workspace, $user, $requestId, ['outcome' => 'failed', 'status' => 200]);
        AssertionResult::create(['workspace_id' => $workspace->id, 'request_run_id' => $assertion->id, 'type' => 'json_equals', 'path' => 'state', 'expected' => 'ready', 'actual' => 'down', 'passed' => false]);

        $this->getJson($base.'/runs?classification=execution_failure')
            ->assertOk()->assertJsonPath('data.total', 1)->assertJsonPath('data.data.0.id', $transport->id);
        $this->getJson($base.'/runs?classification=http_failure')
            ->assertOk()->assertJsonPath('data.total', 1)->assertJsonPath('data.data.0.id', $http->id);
        $this->getJson($base.'/runs?classification=assertion_failure&assertion_outcome=failed')
            ->assertOk()->assertJsonPath('data.total', 1)->assertJsonPath('data.data.0.id', $assertion->id);
        $this->getJson($base.'/runs?assertion_outcome=none')
            ->assertOk()->assertJsonPath('data.total', 2);
    }

    public function test_run_details_and_exports_redact_saved_secrets_and_omit_unneeded_payloads(): void
    {
        [$user, $workspace, $base] = $this->account();
        $requestId = $this->requestFor($workspace);
        $environment = Environment::create(['workspace_id' => $workspace->id, 'name' => 'Production']);
        EnvironmentVariable::create(['workspace_id' => $workspace->id, 'environment_id' => $environment->id, 'key' => 'token', 'value' => 'private-run-secret-9381', 'is_secret' => true]);
        $run = $this->createRun($workspace, $user, $requestId, ['url' => 'https://api.example.test/payments?token=private-run-secret-9381']);
        $this->getJson($base.'/requests/'.$requestId)->assertOk()->assertJsonPath('data.id', $requestId);
        ResponseRecord::create([
            'workspace_id' => $workspace->id,
            'request_run_id' => $run->id,
            'headers' => ['Authorization' => 'Bearer private-run-secret-9381', 'content-type' => 'application/json', 'x-debug' => 'private-run-secret-9381'],
            'body' => '{"access_token":"private-run-secret-9381","note":"private-run-secret-9381","ok":true}',
            'truncated' => false,
        ]);
        AssertionResult::create(['workspace_id' => $workspace->id, 'request_run_id' => $run->id, 'type' => 'body_contains', 'expected' => 'private-run-secret-9381', 'actual' => 'private-run-secret-9381', 'passed' => true]);

        $detail = $this->getJson($base.'/runs/'.$run->id)->assertOk()->assertJsonPath('data.response_available', true);
        $this->assertSame('api.example.test/payments', $detail->json('data.url'));
        $this->assertSame('[REDACTED]', $detail->json('data.response.headers.x-debug'));
        $this->assertArrayNotHasKey('Authorization', $detail->json('data.response.headers'));
        $this->assertStringNotContainsString('private-run-secret-9381', $detail->getContent());
        $this->assertStringNotContainsString('private-url-token', $detail->getContent());

        $export = $this->getJson($base.'/runs/export?search=Payments')->assertOk()->assertJsonPath('data.meta.exported', 1);
        $this->assertArrayNotHasKey('response', $export->json('data.records.0'));
        $this->assertStringNotContainsString('private-run-secret-9381', $export->getContent());
        $this->assertStringNotContainsString('private-url-token', $export->getContent());
    }

    public function test_comparison_handles_missing_retained_bodies_and_rejects_cross_workspace_runs(): void
    {
        [$user, $workspace, $base] = $this->account();
        $requestId = $this->requestFor($workspace);
        $first = $this->createRun($workspace, $user, $requestId, ['duration_ms' => 100, 'size_bytes' => 50]);
        $second = $this->createRun($workspace, $user, $requestId, ['status' => 503, 'outcome' => 'failed', 'duration_ms' => 150, 'size_bytes' => 80]);
        ResponseRecord::create(['workspace_id' => $workspace->id, 'request_run_id' => $first->id, 'headers' => ['content-type' => 'text/plain'], 'body' => 'old body', 'truncated' => false]);

        $this->getJson($base.'/runs/compare?first='.$first->id.'&second='.$second->id)
            ->assertOk()
            ->assertJsonPath('data.duration_delta_ms', 50)
            ->assertJsonPath('data.size_delta_bytes', 30)
            ->assertJsonPath('data.status_changed', true)
            ->assertJsonPath('data.body_comparable', false)
            ->assertJsonPath('data.body_changed', null);

        [$otherUser, $otherWorkspace, $otherBase] = $this->account();
        $otherRequestId = $this->requestFor($otherWorkspace);
        $otherRun = $this->createRun($otherWorkspace, $otherUser, $otherRequestId);
        $this->getJson($otherBase.'/runs/'.$first->id)->assertNotFound();
        $this->getJson($otherBase.'/requests/'.$requestId)->assertNotFound();
        $this->getJson($otherBase.'/runs/compare?first='.$first->id.'&second='.$otherRun->id)->assertNotFound();
    }
}
