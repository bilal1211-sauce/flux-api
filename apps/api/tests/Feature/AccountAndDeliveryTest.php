<?php

namespace Tests\Feature;

use App\Domain\Executions\SafeTransport;
use App\Jobs\DeliverAlert;
use App\Models\AlertEvent;
use App\Models\ApiRequest;
use App\Models\Monitor;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMember;
use App\Notifications\AccountMail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AccountAndDeliveryTest extends TestCase
{
    use RefreshDatabase;

    private function workspace(User $user, string $role = 'owner'): string
    {
        $workspace = Workspace::create(['name' => 'Engineering', 'owner_id' => $user->id, 'email_alerts' => true]);
        WorkspaceMember::create(['workspace_id' => $workspace->id, 'user_id' => $user->id, 'role' => $role]);
        Sanctum::actingAs($user);

        return '/api/v1/workspaces/'.$workspace->id;
    }

    public function test_password_recovery_is_private_and_reset_revokes_sessions_and_cannot_be_reused(): void
    {
        Notification::fake();
        $user = User::factory()->create();
        $user->createToken('old-session', ['*'], now()->addHours(12));
        $existing = $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email])->assertOk();
        $unknown = $this->postJson('/api/v1/auth/forgot-password', ['email' => 'missing@example.test'])->assertOk();
        $this->assertSame($existing->json(), $unknown->json());
        Notification::assertSentTo($user, AccountMail::class, fn ($mail) => str_contains($mail->actionUrl, '/reset-password#token='));
        $token = Password::createToken($user);
        $data = ['email' => $user->email, 'token' => $token, 'password' => 'ChangedPassword2026!', 'password_confirmation' => 'ChangedPassword2026!'];
        $this->postJson('/api/v1/auth/reset-password', [...$data, 'token' => 'invalid'])->assertUnprocessable();
        $this->postJson('/api/v1/auth/reset-password', $data)->assertOk();
        $this->assertTrue(Hash::check($data['password'], $user->fresh()->password));
        $this->assertSame(0, $user->tokens()->count());
        $this->postJson('/api/v1/auth/reset-password', $data)->assertUnprocessable();
    }

    public function test_verification_requires_valid_unexpired_token_bound_to_current_email(): void
    {
        $user = User::factory()->unverified()->create();
        $payload = ['id' => $user->id, 'email' => $user->email, 'expires' => now()->addHour()->timestamp];
        $this->postJson('/api/v1/auth/verify-email', ['token' => 'invalid'])->assertUnprocessable();
        $this->postJson('/api/v1/auth/verify-email', ['token' => Crypt::encryptString(json_encode([...$payload, 'expires' => now()->subMinute()->timestamp]))])->assertUnprocessable();
        $this->postJson('/api/v1/auth/verify-email', ['token' => Crypt::encryptString(json_encode([...$payload, 'email' => 'other@example.test']))])->assertUnprocessable();
        $this->assertNull($user->fresh()->email_verified_at);
        $this->postJson('/api/v1/auth/verify-email', ['token' => Crypt::encryptString(json_encode($payload))])->assertOk();
        $this->assertNotNull($user->fresh()->email_verified_at);
    }

    public function test_verification_gate_and_owner_preferences(): void
    {
        $user = User::factory()->unverified()->create();
        $base = $this->workspace($user);
        config(['apiforge.require_verification' => true]);
        $this->postJson($base.'/collections', ['name' => 'Blocked'])->assertForbidden();
        $user->forceFill(['email_verified_at' => now()])->save();
        $this->postJson($base.'/collections', ['name' => 'Allowed'])->assertCreated();
        $data = ['name' => 'Renamed', 'email_alerts' => true, 'webhook_alerts' => false];
        $this->patchJson($base.'/preferences', $data)->assertOk()->assertJsonPath('data.name', 'Renamed');
        $this->patchJson($base.'/preferences', [...$data, 'webhook_alerts' => true])->assertUnprocessable();
        $outsider = User::factory()->create();
        Sanctum::actingAs($outsider);
        $this->getJson($base.'/alert-deliveries')->assertNotFound();
        $this->patchJson($base.'/preferences', $data)->assertNotFound();
    }

    public function test_profile_session_revocation_and_admin_mail_boundary(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);
        $other = User::factory()->create()->createToken('other', ['*'], now()->addHour())->accessToken;
        $own = $user->createToken('mine', ['*'], now()->addHour())->accessToken;
        $this->patchJson('/api/v1/auth/profile', ['name' => 'Updated', 'is_admin' => true])->assertOk()->assertJsonPath('data.name', 'Updated');
        $this->assertFalse($user->fresh()->is_admin);
        $this->getJson('/api/v1/auth/sessions')->assertOk()->assertJsonCount(1, 'data');
        $this->deleteJson('/api/v1/auth/sessions/'.$other->id)->assertNotFound();
        $this->deleteJson('/api/v1/auth/sessions/'.$own->id)->assertOk();
        $this->getJson('/api/v1/dev/mail')->assertNotFound();
        $user->forceFill(['is_admin' => true])->save();
        $this->getJson('/api/v1/dev/mail')->assertNotFound(); // Testing/production never expose the local inbox.
    }

    public function test_local_mail_is_encrypted_at_rest_and_jobs_encrypt_tokens(): void
    {
        Storage::fake('local');
        config(['mail.default' => 'outbox']);
        $user = User::factory()->create();
        Notification::sendNow($user, new AccountMail('Recovery', 'Reset your password', 'Reset', 'http://localhost/reset-password#token=private-test-token'));
        $files = Storage::disk('local')->files('outbox');
        $this->assertCount(1, $files);
        $stored = Storage::disk('local')->get($files[0]);
        $this->assertStringNotContainsString('private-test-token', $stored);
        $this->assertStringContainsString('private-test-token', Crypt::decryptString($stored));
        config(['queue.default' => 'database']);
        $user->sendPasswordResetNotification('queued-private-token');
        $payload = DB::table('jobs')->value('payload');
        $this->assertNotNull($payload);
        $this->assertStringNotContainsString('queued-private-token', $payload);
    }

    public function test_alert_delivery_is_idempotent_and_only_emails_verified_editors_and_owners(): void
    {
        Notification::fake();
        $user = User::factory()->create();
        $base = $this->workspace($user);
        $workspace = Workspace::firstOrFail();
        foreach (['viewer', 'editor'] as $role) {
            $member = User::factory()->unverified()->create();
            WorkspaceMember::create(['workspace_id' => $workspace->id, 'user_id' => $member->id, 'role' => $role]);
        }
        $request = ApiRequest::create(['workspace_id' => $workspace->id, 'name' => 'Check', 'headers' => [], 'query_params' => [], 'method' => 'GET', 'url' => 'https://jsonplaceholder.typicode.com/users']);
        $monitor = Monitor::create(['workspace_id' => $workspace->id, 'api_request_id' => $request->id, 'name' => 'Availability']);
        $event = AlertEvent::create(['workspace_id' => $workspace->id, 'monitor_id' => $monitor->id, 'message' => 'Monitor failed']);
        (new DeliverAlert($event->id))->handle();
        (new DeliverAlert($event->id))->handle();
        Notification::assertSentToTimes($user, AccountMail::class, 1);
        $this->assertDatabaseCount('alert_deliveries', 1);
        (new DeliverAlert($event->id, true))->handle();
        Notification::assertSentToTimes($user, AccountMail::class, 2);
        Notification::assertCount(2);
        $this->getJson($base.'/alert-deliveries')->assertOk()->assertJsonCount(2, 'data');
        $this->assertDatabaseHas('alert_deliveries', ['status' => 'sent', 'recovery' => true]);
    }

    public function test_openapi_json_yaml_and_local_references_are_validated_offline(): void
    {
        $user = User::factory()->create();
        $base = $this->workspace($user);
        $spec = ['openapi' => '3.0.3', 'info' => ['title' => 'Users', 'version' => '1'], 'servers' => [['url' => 'https://jsonplaceholder.typicode.com']], 'components' => ['parameters' => ['ID' => ['name' => 'id', 'in' => 'path', 'required' => true, 'schema' => ['type' => 'integer'], 'example' => 1]]], 'paths' => ['/users/{id}' => ['get' => ['parameters' => [['$ref' => '#/components/parameters/ID']], 'responses' => ['200' => ['description' => 'Success']]]]]];
        $this->postJson($base.'/openapi/import', ['spec' => $spec])->assertCreated()->assertJsonPath('data.imported_requests', 1);
        $this->assertDatabaseHas('api_requests', ['url' => 'https://jsonplaceholder.typicode.com/users/1']);
        $spec['openapi'] = '3.1.0';
        $this->postJson($base.'/openapi/import', ['document' => json_encode($spec)])->assertCreated();
        $yaml = "openapi: 3.1.0\ninfo:\n  title: YAML API\n  version: '1'\nservers:\n  - url: https://jsonplaceholder.typicode.com\npaths:\n  /users:\n    get:\n      responses:\n        '200':\n          description: Success\n";
        $this->postJson($base.'/openapi/import', ['document' => $yaml])->assertCreated();
        $this->postJson($base.'/openapi/import', ['spec' => [...$spec, 'openapi' => []]])->assertUnprocessable();
        $withoutPaths = $spec;
        unset($withoutPaths['paths']);
        $this->postJson($base.'/openapi/import', ['spec' => $withoutPaths])->assertUnprocessable();
        $invalidNested = $spec;
        $invalidNested['components']['parameters']['ID']['schema'] = ['type' => 'object', 'properties' => ['bad' => ['type' => 123]]];
        $this->postJson($base.'/openapi/import', ['spec' => $invalidNested])->assertUnprocessable();
        $spec['paths']['/users/{id}']['get']['responses'] = 'invalid';
        $this->postJson($base.'/openapi/import', ['spec' => $spec])->assertUnprocessable();
        $spec['paths']['/users/{id}']['get']['responses'] = ['200' => ['description' => 'Success']];
        $spec['components']['parameters']['ID']['schema']['type'] = 123;
        $this->postJson($base.'/openapi/import', ['spec' => $spec])->assertUnprocessable();
        $spec['paths']['/users/{id}']['get']['parameters'][0]['$ref'] = 'https://example.com/remote.json';
        $this->postJson($base.'/openapi/import', ['spec' => $spec])->assertUnprocessable();
        $this->assertDatabaseCount('collections', 3);
    }

    public function test_webhook_failure_is_recorded_and_retry_skips_accepted_email(): void
    {
        Notification::fake();
        $user = User::factory()->create();
        $this->workspace($user);
        $workspace = Workspace::firstOrFail();
        $workspace->update(['webhook_alerts' => true]);
        config(['apiforge.alert_webhook_url' => 'https://httpbin.org/post']);
        $request = ApiRequest::create(['workspace_id' => $workspace->id, 'name' => 'Check', 'headers' => [], 'query_params' => [], 'method' => 'GET', 'url' => 'https://jsonplaceholder.typicode.com/users']);
        $monitor = Monitor::create(['workspace_id' => $workspace->id, 'api_request_id' => $request->id, 'name' => 'Availability']);
        $event = AlertEvent::create(['workspace_id' => $workspace->id, 'monitor_id' => $monitor->id, 'message' => 'Monitor failed']);
        $this->mock(SafeTransport::class, fn ($mock) => $mock->shouldReceive('send')->twice()->andReturn(['status' => 503, 'error_code' => null], ['status' => 204, 'error_code' => null]));
        try {
            (new DeliverAlert($event->id))->handle();
            $this->fail('The failed transport must cause a retry.');
        } catch (\RuntimeException $exception) {
            $this->assertStringNotContainsString('httpbin', $exception->getMessage());
        }
        $this->assertDatabaseHas('alert_deliveries', ['channel' => 'webhook', 'status' => 'failed', 'error_code' => 'WEBHOOK_TRANSPORT_FAILED']);
        (new DeliverAlert($event->id))->handle();
        $this->assertDatabaseHas('alert_deliveries', ['channel' => 'webhook', 'status' => 'sent', 'error_code' => null]);
        Notification::assertSentToTimes($user, AccountMail::class, 1);
        $this->assertDatabaseCount('alert_deliveries', 2);
    }
}
