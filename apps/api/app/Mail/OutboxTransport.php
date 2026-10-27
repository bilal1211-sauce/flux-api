<?php

namespace App\Mail;

use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Symfony\Component\Mime\Email;

class OutboxTransport extends AbstractTransport
{
    protected function doSend(SentMessage $message): void
    {
        $email = $message->getOriginalMessage();
        $record = [
            'id' => (string) Str::uuid(),
            'created_at' => now()->toIso8601String(),
            'subject' => $email instanceof Email ? $email->getSubject() : 'APIForge notification',
            'to' => array_map(fn ($address) => $address->getAddress(), $message->getEnvelope()->getRecipients()),
            'text' => $email instanceof Email ? $email->getTextBody() : '',
        ];
        Storage::disk('local')->put('outbox/'.$record['id'].'.json', Crypt::encryptString(json_encode($record, JSON_THROW_ON_ERROR)));
    }

    public function __toString(): string
    {
        return 'apiforge-outbox';
    }
}
