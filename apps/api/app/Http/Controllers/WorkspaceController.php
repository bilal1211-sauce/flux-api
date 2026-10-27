<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Invitation;
use App\Models\Workspace;
use App\Models\WorkspaceMember;
use App\Notifications\AccountMail;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class WorkspaceController extends Controller
{
    public function index(Request $r)
    {
        return ['data' => Workspace::join('workspace_members', 'workspaces.id', '=', 'workspace_members.workspace_id')->where('workspace_members.user_id', $r->user()->id)->select('workspaces.*', 'workspace_members.role')->get()->map(fn ($workspace) => [...$workspace->toArray(), 'webhook_available' => (bool) config('apiforge.alert_webhook_url')])];
    }

    public function store(Request $r)
    {
        abort_if(config('apiforge.require_verification') && ! $r->user()->email_verified_at, 403, 'Verify your email address first.');
        $data = $r->validate(['name' => 'required|string|max:100']);
        abort_if(WorkspaceMember::where('user_id', $r->user()->id)->where('role', 'owner')->count() >= 10, 422, 'Workspace limit reached.');
        $w = DB::transaction(function () use ($r, $data) {
            $w = Workspace::create([...$data, 'owner_id' => $r->user()->id]);
            WorkspaceMember::create(['workspace_id' => $w->id, 'user_id' => $r->user()->id, 'role' => 'owner']);

            return $w;
        });

        return response()->json(['data' => $w], 201);
    }

    public function members(Request $r)
    {
        $id = $r->attributes->get('workspace')->id;

        return ['data' => [
            'members' => WorkspaceMember::join('users', 'users.id', '=', 'workspace_members.user_id')->where('workspace_id', $id)->select('workspace_members.id', 'user_id', 'role', 'users.name', 'users.email')->orderBy('users.name')->get(),
            'invitations' => Invitation::where('workspace_id', $id)->latest('id')->limit(100)->get(),
        ]];
    }

    public function invite(Request $r)
    {
        abort_unless($r->attributes->get('workspace_role') === 'owner', 403);
        if (is_string($r->input('email'))) {
            $r->merge(['email' => strtolower(trim($r->input('email')))]);
        }
        $data = $r->validate(['email' => 'required|email|max:255', 'role' => 'required|in:editor,viewer']);
        $workspaceId = $r->attributes->get('workspace')->id;
        if (WorkspaceMember::join('users', 'users.id', '=', 'workspace_members.user_id')->where('workspace_members.workspace_id', $workspaceId)->whereRaw('LOWER(users.email) = ?', [$data['email']])->exists()) {
            throw ValidationException::withMessages(['email' => 'This person already belongs to the workspace.']);
        }
        if (Invitation::where('workspace_id', $workspaceId)->whereRaw('LOWER(email) = ?', [$data['email']])->whereNull('accepted_at')->whereNull('revoked_at')->where('expires_at', '>', now())->exists()) {
            throw ValidationException::withMessages(['email' => 'An active invitation already exists for this email address.']);
        }
        $token = Str::random(48);
        $invite = Invitation::create([...$data, 'workspace_id' => $workspaceId, 'token_hash' => hash('sha256', $token), 'expires_at' => now()->addDays(7)]);
        $this->audit($r, 'invitation.created', $invite);
        Notification::route('mail', $invite->email)->notify(new AccountMail('Your APIForge workspace invitation', 'You have been invited to '.$r->attributes->get('workspace')->name.' as '.$invite->role.'.', 'Accept invitation', config('apiforge.web_url').'/settings#invite='.$token, ['Sign in using this email address. The invitation expires in seven days.']));

        return response()->json(['data' => ['invitation' => $invite, 'token' => $token]], 201);
    }

    public function revokeInvitation(Request $r, string $workspace, string $id)
    {
        abort_unless($r->attributes->get('workspace_role') === 'owner', 403);
        $invitation = Invitation::where('workspace_id', $workspace)->findOrFail($id);
        abort_if($invitation->accepted_at, 422, 'An accepted invitation cannot be revoked.');

        if (! $invitation->revoked_at) {
            $invitation->update(['revoked_at' => now()]);
            $this->audit($r, 'invitation.revoked', $invitation);
        }

        return ['data' => $invitation];
    }

    public function preferences(Request $request, string $workspace): array
    {
        abort_unless($request->attributes->get('workspace_role') === 'owner', 403);
        $data = $request->validate(['name' => 'required|string|max:100', 'email_alerts' => 'required|boolean', 'webhook_alerts' => 'required|boolean']);
        if ($data['webhook_alerts'] && ! config('apiforge.alert_webhook_url')) {
            throw ValidationException::withMessages(['webhook_alerts' => 'An administrator must connect the notification webhook first.']);
        }
        $item = $request->attributes->get('workspace');
        $item->update($data);
        $this->audit($request, 'workspace.preferences.updated', $item);

        return ['data' => $item];
    }

    public function accept(Request $r)
    {
        $r->validate(['token' => 'required|string|max:128']);
        $invite = DB::transaction(function () use ($r) {
            $invite = Invitation::where('token_hash', hash('sha256', $r->input('token')))->whereNull('accepted_at')->whereNull('revoked_at')->where('expires_at', '>', now())->lockForUpdate()->firstOrFail();
            abort_unless(strtolower($r->user()->email) === strtolower($invite->email), 403, 'Sign in with the invited email address.');
            WorkspaceMember::firstOrCreate(['workspace_id' => $invite->workspace_id, 'user_id' => $r->user()->id], ['role' => $invite->role]);
            $invite->update(['accepted_at' => now()]);
            AuditLog::create(['workspace_id' => $invite->workspace_id, 'user_id' => $r->user()->id, 'action' => 'invitation.accepted', 'resource_type' => 'Invitation', 'resource_id' => $invite->id]);

            return $invite;
        });

        return ['data' => ['workspace_id' => $invite->workspace_id]];
    }

    public function changeMember(Request $r, string $workspace, string $id)
    {
        abort_unless($r->attributes->get('workspace_role') === 'owner', 403);
        $member = WorkspaceMember::where('workspace_id', $workspace)->findOrFail($id);
        abort_if($member->role === 'owner', 422, 'The workspace owner cannot be removed or demoted.');
        if ($r->isMethod('delete')) {
            $this->audit($r, 'member.removed', $member);
            $member->delete();

            return response()->json(['data' => null]);
        }
        $member->update($r->validate(['role' => 'required|in:editor,viewer']));
        $this->audit($r, 'member.updated', $member);

        return ['data' => $member];
    }
}
