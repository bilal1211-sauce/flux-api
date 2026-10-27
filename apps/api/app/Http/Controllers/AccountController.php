<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Rules\PasswordBytes;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password as PasswordRule;
use Illuminate\Validation\ValidationException;

class AccountController extends Controller
{
    public function forgot(Request $request): array
    {
        $request->validate(['email' => 'required|email|max:255']);
        Password::sendResetLink(['email' => strtolower($request->input('email'))]);

        return ['data' => ['message' => 'If an account exists for that address, a password reset email has been queued.']];
    }

    public function reset(Request $request): array
    {
        $data = $request->validate(['email' => 'required|email|max:255', 'token' => 'required|string|max:255', 'password' => ['required', 'string', 'max:72', new PasswordBytes, 'confirmed', PasswordRule::min(10)->letters()->numbers()]]);
        $data['email'] = strtolower($data['email']);
        $status = Password::reset($data, function (User $user, string $password): void {
            DB::transaction(function () use ($user, $password): void {
                $user->password = $password;
                $user->setRememberToken(Str::random(60));
                $user->save();
                $user->tokens()->delete();
                DB::table('sessions')->where('user_id', $user->id)->delete();
            });
            event(new PasswordReset($user));
        });
        if ($status !== Password::PASSWORD_RESET) {
            throw ValidationException::withMessages(['token' => 'This password reset link is invalid or has expired.']);
        }

        return ['data' => ['message' => 'Password updated. Sign in with your new password.']];
    }

    public function resend(Request $request): array
    {
        if (! $request->user()->email_verified_at) {
            $request->user()->sendVerificationEmail();
        }

        return ['data' => ['message' => 'A verification email has been queued if your address is not already verified.']];
    }

    public function verify(Request $request): array
    {
        $request->validate(['token' => 'required|string|max:4096']);
        try {
            $payload = json_decode(Crypt::decryptString($request->input('token')), true, 8, JSON_THROW_ON_ERROR);
        } catch (\Throwable $exception) {
            throw ValidationException::withMessages(['token' => 'This verification link is invalid or has expired.']);
        }
        if (! is_array($payload) || ($payload['expires'] ?? 0) < now()->timestamp) {
            throw ValidationException::withMessages(['token' => 'This verification link is invalid or has expired.']);
        }
        $user = User::where('id', $payload['id'] ?? 0)->where('email', $payload['email'] ?? '')->first();
        if (! $user) {
            throw ValidationException::withMessages(['token' => 'This verification link is invalid or has expired.']);
        }
        if (! $user->email_verified_at) {
            $user->forceFill(['email_verified_at' => now()])->save();
            event(new Verified($user));
        }

        return ['data' => ['message' => 'Your email address is verified.']];
    }

    public function profile(Request $request): array
    {
        $data = $request->validate(['name' => 'required|string|max:100']);
        $request->user()->update($data);

        return ['data' => $request->user()->fresh()];
    }

    public function password(Request $request): array
    {
        $data = $request->validate(['current_password' => 'required|string|max:256', 'password' => ['required', 'string', 'max:72', new PasswordBytes, 'confirmed', PasswordRule::min(10)->letters()->numbers()]]);
        $user = $request->user();
        if (! Hash::check($data['current_password'], $user->password)) {
            throw ValidationException::withMessages(['current_password' => 'Your current password is incorrect.']);
        }
        DB::transaction(function () use ($user, $data): void {
            $user->password = $data['password'];
            $user->save();
            $user->tokens()->where('id', '!=', $user->currentAccessToken()->id)->delete();
            Password::deleteToken($user);
            DB::table('sessions')->where('user_id', $user->id)->delete();
        });

        return ['data' => ['message' => 'Password changed. Other sessions have been signed out.']];
    }

    public function sessions(Request $request): array
    {
        return ['data' => $request->user()->tokens()->where('expires_at', '>', now())->latest('id')->get(['id', 'name', 'created_at', 'last_used_at', 'expires_at'])->map(fn ($token) => [...$token->toArray(), 'current' => $token->id === $request->user()->currentAccessToken()->id])];
    }

    public function revokeSession(Request $request, string $id): array
    {
        $request->user()->tokens()->findOrFail($id)->delete();

        return ['data' => ['message' => 'Session revoked.']];
    }

    public function logoutAll(Request $request): array
    {
        $request->user()->tokens()->delete();

        return ['data' => null];
    }

    public function outbox(Request $request): array
    {
        abort_unless(app()->environment(['local', 'e2e']) && $request->user()->is_admin && config('mail.default') === 'outbox', 404);
        $files = collect(Storage::disk('local')->files('outbox'))->filter(fn ($path) => str_ends_with($path, '.json'))->sortByDesc(fn ($path) => Storage::disk('local')->lastModified($path))->take(50);

        return ['data' => $files->map(function ($path): ?array {
            try {
                return json_decode(Crypt::decryptString(Storage::disk('local')->get($path)), true, 16, JSON_THROW_ON_ERROR);
            } catch (\Throwable $exception) {
                return null;
            }
        })->filter()->values()];
    }
}
