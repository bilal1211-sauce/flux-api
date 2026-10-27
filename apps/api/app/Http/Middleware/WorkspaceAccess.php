<?php

namespace App\Http\Middleware;

use App\Models\Workspace;
use App\Models\WorkspaceMember;
use Closure;
use Illuminate\Http\Request;

class WorkspaceAccess
{
    public function handle(Request $request, Closure $next)
    {
        $workspace = Workspace::findOrFail($request->route('workspace'));
        $member = WorkspaceMember::where('workspace_id', $workspace->id)->where('user_id', $request->user()->id)->firstOrFail();
        if (! in_array($request->method(), ['GET', 'HEAD', 'OPTIONS'], true)) {
            abort_if(config('apiforge.require_verification') && ! $request->user()->email_verified_at, 403, 'Verify your email address before changing workspace data.');
            abort_if($member->role === 'viewer', 403, 'This action requires an editor or owner.');
        }
        $request->attributes->set('workspace', $workspace);
        $request->attributes->set('workspace_role', $member->role);

        return $next($request);
    }
}
