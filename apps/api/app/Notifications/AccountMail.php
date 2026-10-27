<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class AccountMail extends Notification implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    /**
     * Create a new notification instance.
     */
    public int $tries = 3;

    public function __construct(public string $subject, public string $intro, public string $actionLabel = '', public string $actionUrl = '', public array $lines = [])
    {
        $this->afterCommit();
    }

    /**
     * Get the notification's delivery channels.
     *
     * @return array<int, string>
     */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    /**
     * Get the mail representation of the notification.
     */
    public function toMail(object $notifiable): MailMessage
    {
        $mail = (new MailMessage)->subject($this->subject)->greeting('Hello,')->line(e($this->intro));
        if ($this->actionLabel !== '') {
            $mail->action($this->actionLabel, $this->actionUrl);
        }
        foreach ($this->lines as $line) {
            $mail->line(e($line));
        }

        return $mail->salutation('APIForge');
    }

    /**
     * Get the array representation of the notification.
     *
     * @return array<string, mixed>
     */
    public function toArray(object $notifiable): array
    {
        return [
            //
        ];
    }
}
