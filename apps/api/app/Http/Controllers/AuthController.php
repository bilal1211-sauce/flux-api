<?php

namespace App\Http\Controllers;

use App\Models\ApiRequest;
use App\Models\Collection;
use App\Models\Environment;
use App\Models\EnvironmentVariable;
use App\Models\RequestAssertion;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMember;
use App\Rules\PasswordBytes;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function register(Request $r)
    {
        if (is_string($r->input('email'))) {
            $r->merge(['email' => strtolower(trim($r->input('email')))]);
        }
        $data = $r->validate(['name' => 'required|string|max:100', 'email' => 'required|email|max:255|unique:users', 'password' => ['required', 'string', 'max:72', new PasswordBytes, 'confirmed', Password::min(10)->letters()->numbers()]]);
        $user = DB::transaction(function () use ($data) {
            $user = User::create($data);
            $w = Workspace::create(['name' => $data['name']."'s workspace", 'owner_id' => $user->id]);
            WorkspaceMember::create(['workspace_id' => $w->id, 'user_id' => $user->id, 'role' => 'owner']);
            $this->starter($w);

            return $user;
        });

        $user->sendVerificationEmail();

        return response()->json($this->session($user), 201);
    }

    public function login(Request $r)
    {
        if (is_string($r->input('email'))) {
            $r->merge(['email' => strtolower(trim($r->input('email')))]);
        }
        $data = $r->validate(['email' => 'required|email', 'password' => 'required|string|max:256']);
        $user = User::where('email', $data['email'])->first();
        if (! $user || ! Hash::check($data['password'], $user->password)) {
            throw ValidationException::withMessages(['email' => 'The email or password is incorrect.']);
        }

        return $this->session($user);
    }

    public function logout(Request $r)
    {
        $r->user()->currentAccessToken()?->delete();

        return ['data' => null];
    }

    public function me(Request $r)
    {
        return ['data' => [...$r->user()->toArray(), 'local_mail_preview' => app()->environment('local') && $r->user()->is_admin && config('mail.default') === 'outbox']];
    }

    private function session(User $user): array
    {
        $user->tokens()->where('expires_at', '<', now())->delete();

        return ['data' => ['user' => $user, 'token' => $user->createToken('apiforge-session', ['*'], now()->addHours(12))->plainTextToken]];
    }

    public function starter(Workspace $w): void
    {
        $collection = Collection::create(['workspace_id' => $w->id, 'name' => 'Getting started', 'description' => 'Safe requests to the operator-approved JSONPlaceholder demo API.']);
        foreach ([['List posts', '/posts'], ['Get a single post', '/posts/1'], ['List users', '/users']] as [$name, $path]) {
            $request = ApiRequest::create(['workspace_id' => $w->id, 'collection_id' => $collection->id, 'name' => $name, 'method' => 'GET', 'url' => '{{base_url}}'.$path, 'headers' => [], 'query_params' => [], 'body' => null]);
            RequestAssertion::create(['workspace_id' => $w->id, 'api_request_id' => $request->id, 'type' => 'status', 'expected' => 200]);
        }
        $env = Environment::create(['workspace_id' => $w->id, 'name' => 'Demo']);
        EnvironmentVariable::create(['workspace_id' => $w->id, 'environment_id' => $env->id, 'key' => 'base_url', 'value' => 'https://jsonplaceholder.typicode.com', 'is_secret' => false]);
    }
}
