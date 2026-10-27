<?php

namespace Tests\Feature;

use App\Domain\Executions\SafeTarget;
use App\Domain\Executions\SafeTransport;
use App\Jobs\RunMonitor;
use App\Models\AlertEvent;
use App\Models\AssertionResult;
use App\Models\Collection;
use App\Models\CollectionFolder;
use App\Models\Environment;
use App\Models\EnvironmentVariable;
use App\Models\Monitor;
use App\Models\RequestRun;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMember;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ApiForgeTest extends TestCase
{
    use RefreshDatabase;

    private function account(string $role = 'owner', ?Workspace $workspace = null): array
    {
        $user = User::factory()->create();
        $w = $workspace ?? Workspace::create(['name' => 'Engineering', 'owner_id' => $user->id]);
        WorkspaceMember::create(['workspace_id' => $w->id, 'user_id' => $user->id, 'role' => $role]);
        Sanctum::actingAs($user);

        return [$user, $w, '/api/v1/workspaces/'.$w->id];
    }

    private function requestData(array $extra = []): array
    {
        return [...['name' => 'Get post', 'method' => 'GET', 'url' => 'https://jsonplaceholder.typicode.com/posts/1', 'collection_id' => null, 'folder_id' => null, 'headers' => [], 'query_params' => [], 'body' => '', 'assertions' => [['type' => 'status', 'expected' => 200]]], ...$extra];
    }

    private function transport(array $extra = []): void
    {
        $this->mock(SafeTransport::class, fn ($m) => $m->shouldReceive('send')->andReturn([...['status' => 200, 'duration_ms' => 120, 'headers' => ['content-type' => 'application/json'], 'body' => '{"id":1,"title":"Hello"}', 'truncated' => false, 'error_code' => null], ...$extra]));
    }

    public function test_public_health_and_authentication_boundary(): void
    {
        $this->getJson('/api/v1/health')->assertOk()->assertJsonPath('data.status', 'ok');
        $this->getJson('/api/v1/workspaces')->assertUnauthorized();
    }

    public function test_registration_login_and_secure_token_expiry(): void
    {
        $response = $this->postJson('/api/v1/auth/register', ['name' => 'Bilal', 'email' => 'bilal@example.test', 'password' => 'TestPassword123', 'password_confirmation' => 'TestPassword123'])->assertCreated();
        $this->assertNotEmpty($response->json('data.token'));
        $this->assertDatabaseCount('workspace_members', 1);
        $this->assertDatabaseCount('api_requests', 3);
        $this->assertNotNull(DB::table('personal_access_tokens')->first()->expires_at);
        $this->postJson('/api/v1/auth/login', ['email' => 'bilal@example.test', 'password' => 'wrong'])->assertUnprocessable();
        $this->postJson('/api/v1/auth/login', ['email' => 'bilal@example.test', 'password' => 'TestPassword123'])->assertOk()->assertJsonMissingPath('data.user.password');
    }

    public function test_tenant_isolation_for_every_read_resource(): void
    {
        [$a, $w, $base] = $this->account();
        $this->account();
        foreach (['collections', 'folders', 'requests', 'environments', 'runs', 'summary', 'monitors', 'alerts', 'members', 'audit', 'shares'] as $resource) {
            $this->getJson($base.'/'.$resource)->assertNotFound();
        }
        $this->postJson($base.'/collections', ['name' => 'Stolen'])->assertNotFound();
    }

    public function test_resource_indexes_return_bounded_tenant_scoped_pages(): void
    {
        [, $workspace, $base] = $this->account();
        for ($index = 0; $index < 101; $index++) {
            Collection::create(['workspace_id' => $workspace->id, 'name' => 'Collection '.$index]);
        }

        $this->getJson($base.'/collections')->assertOk()->assertJsonCount(100, 'data')->assertJsonPath('meta.current_page', 1)->assertJsonPath('meta.last_page', 2)->assertJsonPath('meta.total', 101);
        $this->getJson($base.'/collections?page=2&per_page=100')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('meta.current_page', 2);
        $this->getJson($base.'/collections?per_page=101')->assertUnprocessable();
    }

    public function test_request_index_can_search_filter_and_sort_inside_workspace(): void
    {
        [, $workspace, $base] = $this->account();
        $collection = $this->postJson($base.'/collections', ['name' => 'Billing'])->json('data.id');
        $other = $this->postJson($base.'/collections', ['name' => 'Identity'])->json('data.id');
        $this->postJson($base.'/requests', $this->requestData(['name' => 'Zulu invoice', 'collection_id' => $collection]));
        $this->postJson($base.'/requests', $this->requestData(['name' => 'Alpha invoice', 'collection_id' => $collection]));
        $this->postJson($base.'/requests', $this->requestData(['name' => 'Alpha profile', 'collection_id' => $other]));

        $this->getJson($base.'/requests?collection_id='.$collection.'&search=invoice&sort=name')
            ->assertOk()
            ->assertJsonPath('meta.total', 2)
            ->assertJsonPath('data.0.name', 'Alpha invoice')
            ->assertJsonPath('data.1.name', 'Zulu invoice')
            ->assertJsonPath('meta.collection_counts.'.$collection, 2)
            ->assertJsonPath('meta.collection_counts.'.$other, 1);

        [, , $otherWorkspaceBase] = $this->account();
        $this->getJson($otherWorkspaceBase.'/requests?collection_id='.$collection)->assertUnprocessable();
    }

    public function test_viewers_cannot_mutate_or_execute(): void
    {
        [, $w] = $this->account();
        [, , $base] = $this->account('viewer', $w);
        $this->getJson($base.'/requests')->assertOk();
        $this->postJson($base.'/collections', ['name' => 'Blocked'])->assertForbidden();
        $this->postJson($base.'/execute', $this->requestData())->assertForbidden();
        $this->postJson($base.'/invitations', ['email' => 'other@example.test', 'role' => 'owner'])->assertForbidden();
    }

    public function test_collections_folders_and_requests_persist_with_assertions(): void
    {
        [, , $base] = $this->account();
        $c = $this->postJson($base.'/collections', ['name' => 'Payments'])->assertCreated()->json('data.id');
        $f = $this->postJson($base.'/folders', ['name' => 'Read', 'collection_id' => $c])->assertCreated()->json('data.id');
        $id = $this->postJson($base.'/requests', $this->requestData(['collection_id' => $c, 'folder_id' => $f, 'body_mode' => 'none']))->assertCreated()->assertJsonPath('data.body_mode', 'none')->json('data.id');
        $this->getJson($base.'/requests')->assertJsonPath('data.0.folder_id', $f)->assertJsonPath('data.0.assertions.0.expected', 200)->assertJsonPath('data.0.body_mode', 'none');
        $this->putJson($base.'/requests/'.$id, $this->requestData(['name' => 'Renamed']))->assertOk()->assertJsonPath('data.name', 'Renamed');
        $this->deleteJson($base.'/collections/'.$c)->assertOk();
        $this->assertDatabaseCount('api_requests', 1);
    }

    public function test_nested_folders_reject_cycles_without_changing_existing_hierarchy(): void
    {
        [, , $base] = $this->account();
        $collection = $this->postJson($base.'/collections', ['name' => 'API'])->json('data.id');
        $parent = $this->postJson($base.'/folders', ['name' => 'Parent', 'collection_id' => $collection])->json('data.id');
        $child = $this->postJson($base.'/folders', ['name' => 'Child', 'collection_id' => $collection, 'parent_id' => $parent])->assertCreated()->json('data.id');

        $this->putJson($base.'/folders/'.$parent, ['name' => 'Parent', 'collection_id' => $collection, 'parent_id' => $child])->assertUnprocessable();
        $this->assertNull(CollectionFolder::findOrFail($parent)->parent_id);
        $this->assertSame($parent, CollectionFolder::findOrFail($child)->parent_id);
    }

    public function test_collection_tree_reorders_siblings_and_duplicates_request_assertions(): void
    {
        [, , $base] = $this->account();
        $collection = $this->postJson($base.'/collections', ['name' => 'Catalog'])->json('data.id');
        $firstFolder = $this->postJson($base.'/folders', ['name' => 'First', 'collection_id' => $collection, 'sort_order' => 10])->json('data.id');
        $secondFolder = $this->postJson($base.'/folders', ['name' => 'Second', 'collection_id' => $collection, 'sort_order' => 20])->json('data.id');
        $this->patchJson($base.'/folders/order', ['collection_id' => $collection, 'parent_id' => null, 'ids' => [$secondFolder, $firstFolder]])->assertOk();
        $this->getJson($base.'/folders')->assertJsonPath('data.0.id', $secondFolder);
        $request = $this->postJson($base.'/requests', $this->requestData(['collection_id' => $collection, 'folder_id' => $firstFolder]))->assertCreated()->json('data.id');
        $duplicate = $this->postJson($base.'/requests/'.$request.'/duplicate')->assertCreated()->assertJsonPath('data.name', 'Copy of Get post')->json('data.id');
        $this->assertDatabaseCount('request_assertions', 2);
        $this->patchJson($base.'/requests/order', ['collection_id' => $collection, 'folder_id' => $firstFolder, 'pinned' => false, 'ids' => [$duplicate, $request]])->assertOk();
        $this->getJson($base.'/requests')->assertJsonPath('data.0.id', $duplicate)->assertJsonPath('data.1.id', $request);
    }

    public function test_local_runs_are_scoped_redacted_and_record_execution_metrics(): void
    {
        [, , $base] = $this->account();
        $data = [
            'execution_id' => (string) Str::uuid(),
            'request' => $this->requestData(['url' => 'http://localhost:9000/private?token=never-store']),
            'response' => ['status' => 200, 'headers' => ['content-type' => 'application/json', 'set-cookie' => 'session=private'], 'body' => '{"token":"private-token","ok":true}', 'duration_ms' => 84, 'size_bytes' => 34, 'truncated' => false, 'error_code' => null, 'timings' => ['dns_ms' => 2, 'connect_ms' => 4, 'first_byte_ms' => 81]],
            'assertion_results' => [['type' => 'status', 'expected' => 200, 'actual' => 200, 'passed' => true]],
        ];
        $run = $this->postJson($base.'/runs/local', $data)->assertOk()->assertJsonPath('data.execution_mode', 'local')->assertJsonPath('data.timings.dns_ms', 2)->json('data.id');
        $detail = $this->getJson($base.'/runs/'.$run)->assertOk();
        $this->assertStringNotContainsString('private-token', $detail->getContent());
        $this->assertStringNotContainsString('session=private', $detail->getContent());
        $this->assertStringNotContainsString('never-store', $detail->getContent());
        $detail->assertJsonPath('data.response.body', "{\n    \"token\": \"[REDACTED]\",\n    \"ok\": true\n}");
        $this->postJson($base.'/runs/local', $data)->assertStatus(409);
        $this->assertDatabaseHas('request_runs', ['id' => $run, 'execution_mode' => 'local', 'url' => 'http://localhost:9000/private']);
    }

    public function test_destination_hosts_need_platform_review_and_remain_exact(): void
    {
        $admin = User::factory()->create(['is_admin' => true]);
        Sanctum::actingAs($admin);
        $this->postJson('/api/v1/admin/destinations', ['hostname' => '*.example.test'])->assertUnprocessable();
        $approval = $this->postJson('/api/v1/admin/destinations', ['hostname' => 'api.review-example.test'])->assertOk()->json('data.id');
        $target = new SafeTarget;
        try {
            $target->host('https://api.review-example.test/v1');
            $this->fail('Pending destinations must not execute.');
        } catch (ValidationException) {
            $this->assertTrue(true);
        }
        $this->patchJson('/api/v1/admin/destinations/'.$approval, ['status' => 'approved', 'reason' => 'Reviewed endpoint'])->assertOk();
        $this->assertSame('api.review-example.test', $target->host('https://api.review-example.test/v1'));
        $this->assertDatabaseHas('destination_approvals', ['id' => $approval, 'status' => 'approved', 'reviewed_by' => $admin->id]);
        $this->patchJson('/api/v1/admin/destinations/'.$approval, ['status' => 'denied'])->assertOk();
        try {
            $target->host('https://api.review-example.test/v1');
            $this->fail('Denied destinations must not execute.');
        } catch (ValidationException) {
            $this->assertTrue(true);
        }
    }

    public function test_cross_workspace_foreign_keys_are_rejected(): void
    {
        [, $w] = $this->account();
        $c = Collection::create(['workspace_id' => $w->id, 'name' => 'Private']);
        [, , $base] = $this->account();
        $this->postJson($base.'/requests', $this->requestData(['collection_id' => $c->id]))->assertUnprocessable();
        $this->putJson($base.'/collections/'.$c->id, ['name' => 'Attack'])->assertNotFound();
        $this->deleteJson($base.'/collections/'.$c->id)->assertNotFound();
    }

    public function test_environment_values_are_encrypted_and_secrets_never_returned(): void
    {
        [, , $base] = $this->account();
        $data = ['name' => 'Staging', 'variables' => [['key' => 'token', 'value' => 'top-secret-123', 'is_secret' => true], ['key' => 'base_url', 'value' => 'https://httpbin.org', 'is_secret' => false]]];
        $id = $this->postJson($base.'/environments', $data)->assertCreated()->json('data.id');
        $this->assertStringNotContainsString('top-secret-123', DB::table('environment_variables')->where('key', 'token')->value('value'));
        $result = $this->getJson($base.'/environments')->assertOk();
        $this->assertStringNotContainsString('top-secret-123', $result->getContent());
        $result->assertJsonPath('data.0.variables.0.value', null)->assertJsonPath('data.0.variables.1.value', 'https://httpbin.org');
        $data['variables'][0]['value'] = null;
        $this->putJson($base.'/environments/'.$id, $data)->assertOk();
        $this->assertSame('top-secret-123', EnvironmentVariable::where('key', 'token')->first()->value);
        $data['variables'][0]['is_secret'] = false;
        $this->putJson($base.'/environments/'.$id, $data)->assertUnprocessable();
    }

    public function test_environment_in_use_by_a_monitor_cannot_be_deleted(): void
    {
        [, , $base] = $this->account();
        $environment = $this->postJson($base.'/environments', ['name' => 'Production', 'variables' => []])->assertCreated()->json('data.id');
        $request = $this->postJson($base.'/requests', $this->requestData())->assertCreated()->json('data.id');
        $this->postJson($base.'/monitors', ['name' => 'Production health', 'api_request_id' => $request, 'environment_id' => $environment, 'interval_minutes' => 5, 'enabled' => true, 'failure_threshold' => 2])->assertCreated();

        $this->deleteJson($base.'/environments/'.$environment)
            ->assertStatus(409)
            ->assertJsonPath('message', 'Reassign monitors before deleting this environment.');
        $this->assertDatabaseHas('monitors', ['environment_id' => $environment]);
    }

    public function test_executor_persists_response_assertions_history_and_metrics(): void
    {
        [, , $base] = $this->account();
        $this->transport();
        $data = $this->requestData(['assertions' => [['type' => 'status', 'expected' => 200], ['type' => 'json_equals', 'path' => '$.id', 'expected' => 1], ['type' => 'duration_lt', 'expected' => 1000], ['type' => 'header_contains', 'path' => 'Content-Type', 'expected' => 'json']]]);
        $run = $this->postJson($base.'/execute', $data)->assertOk()->assertJsonPath('data.outcome', 'passed')->assertJsonPath('data.assertions.1.passed', true)->json('data.id');
        $this->getJson($base.'/runs/'.$run)->assertOk()->assertJsonPath('data.response.body', "{\n    \"id\": 1,\n    \"title\": \"Hello\"\n}");
        $this->getJson($base.'/runs?outcome=passed')->assertJsonPath('data.total', 1);
        $this->getJson($base.'/summary')->assertJsonPath('data.total_runs', 1)->assertJsonPath('data.passed_runs', 1)->assertJsonPath('data.avg_latency_ms', 120);
        $this->assertDatabaseCount('audit_logs', 1);
    }

    public function test_cloud_authentication_templates_and_request_timeout_are_applied(): void
    {
        [, $workspace, $base] = $this->account();
        $environment = Environment::create(['workspace_id' => $workspace->id, 'name' => 'Credentials']);
        EnvironmentVariable::create(['workspace_id' => $workspace->id, 'environment_id' => $environment->id, 'key' => 'login', 'value' => 'demo-user', 'is_secret' => true]);
        EnvironmentVariable::create(['workspace_id' => $workspace->id, 'environment_id' => $environment->id, 'key' => 'password', 'value' => 'demo-password', 'is_secret' => true]);
        $data = $this->requestData(['environment_id' => $environment->id, 'auth_type' => 'basic', 'auth_config' => ['username' => '{{login}}', 'password' => '{{password}}'], 'timeout_ms' => 2400]);
        $saved = $this->postJson($base.'/requests', $data)->assertCreated()->json('data');
        $this->assertSame('{{login}}', $saved['auth_config']['username']);
        $this->assertArrayNotHasKey('value', $saved['auth_config']);
        $this->mock(SafeTransport::class, fn ($mock) => $mock->shouldReceive('send')->once()->with('GET', 'https://jsonplaceholder.typicode.com/posts/1', ['Authorization' => 'Basic '.base64_encode('demo-user:demo-password')], '', 2400, 'jsonplaceholder.typicode.com')->andReturn(['status' => 200, 'duration_ms' => 90, 'headers' => [], 'body' => '{}', 'truncated' => false, 'error_code' => null]));
        $this->postJson($base.'/execute', [...$data, 'saved_request_id' => $saved['id']])->assertOk();
        $this->assertDatabaseHas('request_runs', ['execution_mode' => 'cloud']);
    }

    public function test_summary_period_uses_bounded_aggregates_for_cloud_local_and_assertions(): void
    {
        [, $workspace, $base] = $this->account();
        foreach ([['cloud', 200, 'passed', -2], ['local', 503, 'failed', -20]] as [$mode, $status, $outcome, $age]) {
            $run = RequestRun::create(['workspace_id' => $workspace->id, 'name' => 'Get status', 'method' => 'GET', 'url' => 'https://api.example.test/status', 'source' => 'manual', 'execution_mode' => $mode, 'outcome' => $outcome, 'status' => $status, 'duration_ms' => 120, 'size_bytes' => 2, 'created_at' => now()->addDays($age)]);
            AssertionResult::create(['workspace_id' => $workspace->id, 'request_run_id' => $run->id, 'type' => 'status', 'expected' => 200, 'actual' => $status, 'passed' => $outcome === 'passed']);
        }
        $this->getJson($base.'/summary?days=7')->assertJsonPath('data.total_runs', 1)->assertJsonPath('data.cloud_runs', 1)->assertJsonPath('data.local_runs', 0)->assertJsonPath('data.assertions_passed', 1)->assertJsonPath('data.daily_assertions.0.passed', 1)->assertJsonPath('data.daily_assertions.0.failed', 0);
        $this->getJson($base.'/summary?days=30')->assertJsonPath('data.total_runs', 2)->assertJsonPath('data.local_runs', 1)->assertJsonPath('data.assertions_failed', 1)->assertJsonPath('data.status_classes.1.total', 1)->assertJsonPath('data.daily_assertions.0.passed', 0)->assertJsonPath('data.daily_assertions.0.failed', 1)->assertJsonPath('data.daily_assertions.1.passed', 1)->assertJsonPath('data.daily_assertions.1.failed', 0);
        $this->getJson($base.'/summary?days=90')->assertUnprocessable();
    }

    public function test_executor_marks_failed_assertions_and_large_responses_as_failures(): void
    {
        [, , $base] = $this->account();
        $this->transport(['truncated' => true]);
        $this->postJson($base.'/execute', $this->requestData(['assertions' => [['type' => 'json_equals', 'path' => 'id', 'expected' => 2]]]))->assertOk()->assertJsonPath('data.outcome', 'failed')->assertJsonPath('data.error_code', 'RESPONSE_TOO_LARGE')->assertJsonPath('data.assertions.0.passed', false);
    }

    public function test_executor_redacts_secrets_in_echoed_json_headers_urls_and_assertions(): void
    {
        [, $w, $base] = $this->account();
        $env = Environment::create(['workspace_id' => $w->id, 'name' => 'Secrets']);
        EnvironmentVariable::create(['workspace_id' => $w->id, 'environment_id' => $env->id, 'key' => 'token', 'value' => 'my-secret-789', 'is_secret' => true]);
        $this->transport(['body' => '{"echo":"my-secret-789","password":"another-password"}', 'headers' => ['set-cookie' => 'session=secret', 'x-echo' => 'my-secret-789']]);
        $data = $this->requestData(['environment_id' => $env->id, 'url' => 'https://httpbin.org/get?token={{token}}', 'headers' => ['Authorization' => 'Bearer {{token}}'], 'assertions' => [['type' => 'json_equals', 'path' => 'echo', 'expected' => 'my-secret-789']]]);
        $result = $this->postJson($base.'/execute', $data)->assertOk();
        $this->assertStringNotContainsString('my-secret-789', $result->getContent());
        $this->assertStringNotContainsString('another-password', $result->getContent());
        $this->assertStringNotContainsString('session=secret', $result->getContent());
    }

    public function test_unapproved_urls_and_literal_sensitive_headers_are_rejected(): void
    {
        [, , $base] = $this->account();
        foreach (['http://127.0.0.1', 'https://169.254.169.254/latest/meta-data', 'https://evil.example', 'https://jsonplaceholder.typicode.com.evil.test', 'https://user:pass@jsonplaceholder.typicode.com', 'https://jsonplaceholder.typicode.com:8443'] as $url) {
            $this->postJson($base.'/execute', $this->requestData(['url' => $url]))->assertUnprocessable();
        }
        $this->postJson($base.'/requests', $this->requestData(['headers' => ['Authorization' => 'Bearer literal-secret']]))->assertUnprocessable();
        $this->assertDatabaseCount('request_runs', 0);
    }

    public function test_special_ipv4_and_ipv6_addresses_are_denied(): void
    {
        $target = new SafeTarget;
        foreach (['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '192.168.1.1', '192.0.2.1', '198.18.0.1', '224.0.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::'] as $ip) {
            $this->assertFalse($target->publicIp($ip), $ip);
        }
        foreach (['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'] as $ip) {
            $this->assertTrue($target->publicIp($ip), $ip);
        }
    }

    public function test_execution_daily_quota_is_enforced(): void
    {
        [, $w, $base] = $this->account();
        $w->update(['daily_run_limit' => 1]);
        $this->transport();
        $this->postJson($base.'/execute', $this->requestData())->assertOk();
        $this->postJson($base.'/execute', $this->requestData())->assertStatus(429);
        $this->assertDatabaseCount('request_runs', 1);
    }

    public function test_api_reads_do_not_consume_the_execution_rate_limit(): void
    {
        [, , $base] = $this->account();
        $this->transport();
        for ($i = 0; $i < 25; $i++) {
            $this->getJson($base.'/collections')->assertOk();
        }
        $this->postJson($base.'/execute', $this->requestData())->assertOk();
    }

    public function test_missing_environment_variables_do_not_execute(): void
    {
        [, , $base] = $this->account();
        $this->postJson($base.'/execute', $this->requestData(['url' => '{{base_url}}/posts']))->assertUnprocessable();
        $this->assertDatabaseCount('usage_records', 0);
    }

    public function test_monitors_deduplicate_alerts_and_resolve_after_recovery(): void
    {
        [, , $base] = $this->account();
        $id = $this->postJson($base.'/requests', $this->requestData())->json('data.id');
        $m = $this->postJson($base.'/monitors', ['name' => 'Post health', 'api_request_id' => $id, 'environment_id' => null, 'interval_minutes' => 1, 'enabled' => true, 'failure_threshold' => 2])->assertCreated()->json('data.id');
        $this->transport(['status' => 500]);
        for ($i = 0; $i < 3; $i++) {
            $this->postJson($base.'/monitors/'.$m.'/check')->assertOk();
        }
        $this->assertDatabaseCount('alert_events', 1);
        $this->assertSame(3, Monitor::find($m)->consecutive_failures);
        $this->transport();
        $this->postJson($base.'/monitors/'.$m.'/check')->assertOk();
        $this->assertNotNull(AlertEvent::first()->resolved_at);
        $this->getJson($base.'/summary')->assertJsonPath('data.monitor_checks', 4)->assertJsonPath('data.monitor_availability', 25);
        $this->getJson($base.'/summary')->assertJsonPath('data.monitor_snapshots.0.name', 'Post health')->assertJsonPath('data.monitor_snapshots.0.last_outcome', 'passed')->assertJsonPath('data.monitor_snapshots.0.last_status', 200)->assertJsonPath('data.monitor_snapshots.0.last_duration_ms', 120)->assertJsonPath('data.monitor_snapshots.0.open_incidents', 0);
    }

    public function test_dispatch_only_queues_enabled_due_monitors(): void
    {
        [, $w, $base] = $this->account();
        $id = $this->postJson($base.'/requests', $this->requestData())->json('data.id');
        Monitor::create(['workspace_id' => $w->id, 'api_request_id' => $id, 'name' => 'Due', 'interval_minutes' => 5, 'enabled' => true, 'next_run_at' => now()->subMinute()]);
        Monitor::create(['workspace_id' => $w->id, 'api_request_id' => $id, 'name' => 'Paused', 'interval_minutes' => 5, 'enabled' => false]);
        Monitor::create(['workspace_id' => $w->id, 'api_request_id' => $id, 'name' => 'Later', 'interval_minutes' => 5, 'enabled' => true, 'next_run_at' => now()->addHour()]);
        Queue::fake();
        $this->artisan('monitors:dispatch')->assertSuccessful();
        Queue::assertPushed(RunMonitor::class, 1);
    }

    public function test_invitations_require_matching_identity_and_cannot_be_reused(): void
    {
        [$owner, $w, $base] = $this->account();
        $invite = $this->postJson($base.'/invitations', ['email' => 'teammate@example.test', 'role' => 'viewer'])->assertCreated()->json('data.token');
        [$other] = $this->account();
        $this->postJson('/api/v1/invitations/accept', ['token' => $invite])->assertForbidden();
        $other->update(['email' => 'teammate@example.test']);
        Sanctum::actingAs($other);
        $this->postJson('/api/v1/invitations/accept', ['token' => $invite])->assertOk();
        $this->postJson('/api/v1/invitations/accept', ['token' => $invite])->assertNotFound();
        $this->getJson($base.'/collections')->assertOk();
        $this->postJson($base.'/collections', ['name' => 'Forbidden'])->assertForbidden();
    }

    public function test_workspace_invites_can_be_revoked_without_deleting_history_or_escalating_roles(): void
    {
        [$owner, $workspace, $base] = $this->account();
        $ownerMembership = WorkspaceMember::where('workspace_id', $workspace->id)->where('user_id', $owner->id)->firstOrFail();
        $this->deleteJson($base.'/members/'.$ownerMembership->id)->assertUnprocessable();
        $this->patchJson($base.'/members/'.$ownerMembership->id, ['role' => 'viewer'])->assertUnprocessable();
        $this->assertDatabaseHas('workspace_members', ['id' => $ownerMembership->id, 'role' => 'owner']);

        $this->postJson($base.'/invitations', ['email' => 'privilege@example.test', 'role' => 'owner'])->assertUnprocessable();
        $response = $this->postJson($base.'/invitations', ['email' => 'teammate@example.test', 'role' => 'editor'])->assertCreated();
        $token = $response->json('data.token');
        $invitationId = $response->json('data.invitation.id');

        $this->postJson($base.'/invitations', ['email' => ' TEAMMATE@example.test ', 'role' => 'viewer'])->assertUnprocessable();
        $this->deleteJson($base.'/invitations/'.$invitationId)->assertOk()->assertJsonPath('data.email', 'teammate@example.test');
        $this->assertDatabaseHas('invitations', ['id' => $invitationId, 'workspace_id' => $workspace->id, 'accepted_at' => null]);
        $this->assertNotNull(DB::table('invitations')->where('id', $invitationId)->value('revoked_at'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'invitation.revoked', 'resource_id' => $invitationId]);

        [$invitee] = $this->account();
        $invitee->update(['email' => 'teammate@example.test']);
        $this->postJson('/api/v1/invitations/accept', ['token' => $token])->assertNotFound();

        Sanctum::actingAs($invitee);
        $this->deleteJson($base.'/invitations/'.$invitationId)->assertNotFound();
        $this->assertDatabaseCount('workspace_members', 2);
    }

    public function test_report_previews_are_safe_paginated_and_workspace_scoped(): void
    {
        [, , $base] = $this->account();
        $this->transport();
        $this->postJson($base.'/execute', $this->requestData())->assertOk();

        $preview = $this->getJson($base.'/shares/preview?period_days=1')->assertOk()
            ->assertJsonPath('data.period', 'Last 24 hours')
            ->assertJsonPath('data.total_runs', 1)
            ->assertJsonPath('data.passed', 1)
            ->assertJsonPath('data.failed', 0);
        $this->assertStringNotContainsString('jsonplaceholder', $preview->getContent());
        $this->assertStringNotContainsString('Hello', $preview->getContent());

        $created = $this->postJson($base.'/shares', ['name' => '24 hour review', 'expires_in_hours' => 24, 'period_days' => 1])->assertCreated();
        $id = $created->json('data.share.id');
        $this->getJson($base.'/shares?per_page=1')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('meta.total', 1);
        $this->getJson($base.'/shares/overview')->assertOk()->assertJsonPath('data.active', 1)->assertJsonPath('data.recently_created', 1);
        $this->getJson($base.'/shares/'.$id)->assertOk()->assertJsonPath('data.snapshot.period_days', 1)->assertJsonMissingPath('data.share.token_hash');

        [, , $otherBase] = $this->account();
        $this->getJson($otherBase.'/shares/'.$id)->assertNotFound();
    }

    public function test_viewers_cannot_create_or_revoke_report_links_or_change_workspace_preferences(): void
    {
        [, $workspace, $ownerBase] = $this->account();
        $share = $this->postJson($ownerBase.'/shares', ['name' => 'Owner report', 'expires_in_hours' => 24])->assertCreated();
        [$viewer] = $this->account('viewer', $workspace);
        $viewerBase = '/api/v1/workspaces/'.$workspace->id;
        $this->postJson($viewerBase.'/shares', ['name' => 'Unauthorized', 'expires_in_hours' => 24])->assertForbidden();
        $this->deleteJson($viewerBase.'/shares/'.$share->json('data.share.id'))->assertForbidden();
        $this->patchJson($viewerBase.'/preferences', ['name' => 'Escalated', 'email_alerts' => true, 'webhook_alerts' => false])->assertForbidden();
        $this->assertDatabaseMissing('share_links', ['name' => 'Unauthorized']);
        $this->assertDatabaseHas('workspace_members', ['workspace_id' => $workspace->id, 'user_id' => $viewer->id, 'role' => 'viewer']);
    }

    public function test_openapi_import_is_atomic_and_references_are_rejected(): void
    {
        [, , $base] = $this->account();
        $spec = json_decode(file_get_contents(base_path('../../docs/demo-openapi.json')), true);
        $this->postJson($base.'/openapi/import', ['spec' => $spec])->assertCreated()->assertJsonPath('data.imported_requests', 1);
        $this->assertDatabaseHas('api_requests', ['url' => 'https://jsonplaceholder.typicode.com/posts/1']);
        $spec['components'] = ['schemas' => ['External' => ['$ref' => 'https://evil.example/schema']]];
        $this->postJson($base.'/openapi/import', ['spec' => $spec])->assertUnprocessable();
        $this->assertDatabaseCount('collections', 1);
    }

    public function test_reports_are_scoped_expiring_revocable_snapshots_without_raw_responses(): void
    {
        [, , $base] = $this->account();
        $this->transport();
        $this->postJson($base.'/execute', $this->requestData())->assertOk();
        $response = $this->postJson($base.'/shares', ['name' => 'Weekly', 'expires_in_hours' => 24])->assertCreated();
        $token = $response->json('data.token');
        $id = $response->json('data.share.id');
        $report = $this->getJson('/api/v1/reports/'.$token)->assertOk()->assertJsonPath('data.total_runs', 1);
        $this->assertStringNotContainsString('jsonplaceholder', $report->getContent());
        $this->assertStringNotContainsString('Hello', $report->getContent());
        $this->deleteJson($base.'/shares/'.$id)->assertOk();
        $this->getJson('/api/v1/reports/'.$token)->assertNotFound();
        $response = $this->postJson($base.'/shares', ['name' => 'Expires', 'expires_in_hours' => 1]);
        $this->travel(2)->hours();
        $this->getJson('/api/v1/reports/'.$response->json('data.token'))->assertNotFound();
    }

    public function test_comparison_cannot_read_another_workspace_run(): void
    {
        [, , $base] = $this->account();
        $this->transport();
        $id = $this->postJson($base.'/execute', $this->requestData())->json('data.id');
        [, , $otherBase] = $this->account();
        $second = $this->postJson($otherBase.'/execute', $this->requestData())->json('data.id');
        $this->getJson($otherBase.'/runs/compare?first='.$id.'&second='.$second)->assertNotFound();
        $this->getJson($otherBase.'/runs/'.$id)->assertNotFound();
    }

    public function test_admin_routes_require_platform_privilege_and_audit_quota_changes(): void
    {
        [$user, $w] = $this->account();
        $this->getJson('/api/v1/admin')->assertForbidden();
        $user->forceFill(['is_admin' => true])->save();
        Sanctum::actingAs($user);
        $this->getJson('/api/v1/admin')->assertOk();
        $this->patchJson('/api/v1/admin/workspaces/'.$w->id.'/limit', ['daily_run_limit' => 200])->assertOk();
        $this->assertDatabaseHas('audit_logs', ['action' => 'admin.quota.updated']);
    }

    public function test_run_retention_deletes_response_bodies_and_assertions(): void
    {
        [, , $base] = $this->account();
        $this->transport();
        $this->postJson($base.'/execute', $this->requestData())->assertOk();
        RequestRun::query()->update(['created_at' => now()->subDays(31)]);
        $this->artisan('runs:prune')->assertSuccessful();
        $this->assertDatabaseCount('request_runs', 0);
        $this->assertDatabaseCount('response_records', 0);
        $this->assertDatabaseCount('assertion_results', 0);
    }
}
