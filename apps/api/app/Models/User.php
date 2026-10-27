<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Notifications\AccountMail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\Crypt;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['name', 'email', 'password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    public function sendPasswordResetNotification($token): void
    {
        $url = config('apiforge.web_url').'/reset-password#'.http_build_query(['token' => $token, 'email' => $this->email]);
        $this->notify(new AccountMail('Reset your APIForge password', 'A password reset was requested for your account.', 'Reset password', $url, ['This link expires in 60 minutes. Ignore this email if you did not request a reset.']));
    }

    public function sendVerificationEmail(): void
    {
        $token = Crypt::encryptString(json_encode(['id' => $this->id, 'email' => $this->email, 'expires' => now()->addHour()->timestamp]));
        $this->notify(new AccountMail('Verify your APIForge email', 'Confirm your email address to secure your account and receive notifications.', 'Verify email', config('apiforge.web_url').'/verify-email#token='.rawurlencode($token), ['This link expires in one hour.']));
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_admin' => 'boolean',
        ];
    }
}
