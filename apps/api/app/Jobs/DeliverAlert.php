<?php

namespace App\Jobs;

use App\Domain\Executions\SafeTransport;
use App\Models\AlertDelivery;
use App\Models\AlertEvent;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMember;
use App\Notifications\AccountMail;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Notification;

class DeliverAlert implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    /**
     * Create a new job instance.
     */
    public int $tries = 3;

    public int $timeout = 50;

    public function __construct(public int $eventId, public bool $recovery = false) {}

    public function backoff(): array
    {
        return [30, 120, 300];
    }

    /**
     * Execute the job.
     */
    public function handle(): void
    {
        Cache::lock('deliver-alert:'.$this->eventId.':'.(int) $this->recovery, 60)->get(function (): void {
            $event = AlertEvent::find($this->eventId);
            if (! $event) {
                return;
            }
            $workspace = Workspace::find($event->workspace_id);
            if (! $workspace) {
                return;
            }
            $subject = $this->recovery ? 'APIForge monitor recovered' : 'APIForge monitor incident';
            $message = $this->recovery ? 'The monitor incident has recovered.' : $event->message;
            $failed = false;
            if ($workspace->email_alerts) {
                $users = User::whereIn('id', WorkspaceMember::where('workspace_id', $workspace->id)->whereIn('role', ['owner', 'editor'])->select('user_id'))->whereNotNull('email_verified_at')->get();
                foreach ($users as $user) {
                    $delivery = $this->delivery($event, 'email', 'user:'.$user->id);
                    if ($delivery->status === 'sent') {
                        continue;
                    }
                    try {
                        Notification::sendNow($user, new AccountMail($subject, $message, 'View alerts', config('apiforge.web_url').'/alerts', ['Workspace: '.$workspace->name]));
                        $delivery->update(['status' => 'sent', 'delivered_at' => now(), 'error_code' => null]);
                    } catch (\Throwable $exception) {
                        $delivery->update(['status' => 'failed', 'error_code' => 'MAIL_TRANSPORT_FAILED']);
                        $failed = true;
                    }
                }
            }
            if ($workspace->webhook_alerts) {
                $delivery = $this->delivery($event, 'webhook', 'operator-webhook');
                if ($delivery->status !== 'sent') {
                    try {
                        $url = config('apiforge.alert_webhook_url');
                        if (! $url) {
                            throw new \RuntimeException('Webhook is not configured.');
                        }
                        $headers = ['Content-Type' => 'application/json'];
                        if (config('apiforge.alert_webhook_token')) {
                            $headers['Authorization'] = 'Bearer '.config('apiforge.alert_webhook_token');
                        }
                        $response = app(SafeTransport::class)->send('POST', $url, $headers, json_encode(['event_id' => $event->id, 'event' => $this->recovery ? 'monitor.recovered' : 'monitor.failed', 'workspace' => $workspace->name, 'message' => $message, 'occurred_at' => now()->toIso8601String()]));
                        if ($response['error_code'] || $response['status'] < 200 || $response['status'] >= 300) {
                            throw new \RuntimeException('Webhook transport rejected delivery.');
                        }
                        $delivery->update(['status' => 'sent', 'delivered_at' => now(), 'error_code' => null]);
                    } catch (\Throwable $exception) {
                        $delivery->update(['status' => 'failed', 'error_code' => 'WEBHOOK_TRANSPORT_FAILED']);
                        $failed = true;
                    }
                }
            }
            if ($failed) {
                throw new \RuntimeException('One or more alert transports failed. Inspect delivery status; message contents are excluded from this error.');
            }
        });
    }

    private function delivery(AlertEvent $event, string $channel, string $recipient): AlertDelivery
    {
        return AlertDelivery::firstOrCreate(['workspace_id' => $event->workspace_id, 'alert_event_id' => $event->id, 'channel' => $channel, 'recipient' => $recipient, 'recovery' => $this->recovery], ['status' => 'pending']);
    }
}
