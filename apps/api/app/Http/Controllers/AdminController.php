<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\DestinationApproval;
use App\Models\RequestRun;
use App\Models\UsageRecord;
use App\Models\User;
use App\Models\Workspace;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;

class AdminController extends Controller
{
    public function index(Request $r): array
    {
        $this->requirePlatformAdmin($r);
        $filters = $r->validate([
            'workspace_search' => 'nullable|string|max:100',
            'user_search' => 'nullable|string|max:100',
            'workspace_page' => 'sometimes|integer|min:1',
            'users_page' => 'sometimes|integer|min:1',
            'per_page' => 'sometimes|integer|min:1|max:50',
        ]);
        $perPage = (int) ($filters['per_page'] ?? 15);
        $today = today()->toDateString();

        $memberCounts = DB::table('workspace_members')
            ->selectRaw('workspace_id, COUNT(*) as member_count')
            ->groupBy('workspace_id');
        $dailyUsage = DB::table('usage_records')
            ->whereDate('day', $today)
            ->selectRaw('workspace_id, SUM(runs) as usage_today')
            ->groupBy('workspace_id');
        $workspaces = DB::table('workspaces as workspaces')
            ->leftJoin('users as workspace_owner', 'workspace_owner.id', '=', 'workspaces.owner_id')
            ->leftJoinSub($memberCounts, 'workspace_members_count', 'workspace_members_count.workspace_id', '=', 'workspaces.id')
            ->leftJoinSub($dailyUsage, 'workspace_daily_usage', 'workspace_daily_usage.workspace_id', '=', 'workspaces.id')
            ->select([
                'workspaces.id', 'workspaces.name', 'workspaces.owner_id', 'workspaces.daily_run_limit',
                'workspaces.created_at', 'workspace_owner.name as owner_name', 'workspace_owner.email as owner_email',
                DB::raw('COALESCE(workspace_members_count.member_count, 0) as member_count'),
                DB::raw('COALESCE(workspace_daily_usage.usage_today, 0) as usage_today'),
            ]);
        if (! empty($filters['workspace_search'])) {
            $search = trim($filters['workspace_search']);
            $workspaces->where(function ($query) use ($search) {
                $query->where('workspaces.name', 'like', '%'.$search.'%')
                    ->orWhere('workspace_owner.name', 'like', '%'.$search.'%')
                    ->orWhere('workspace_owner.email', 'like', '%'.$search.'%');
            });
        }
        $workspacePage = $workspaces->orderByDesc('workspaces.id')->paginate($perPage, ['*'], 'workspace_page');

        $userWorkspaceCounts = DB::table('workspace_members')
            ->selectRaw('user_id, COUNT(*) as workspace_count')
            ->groupBy('user_id');
        $users = User::query()
            ->leftJoinSub($userWorkspaceCounts, 'user_workspace_counts', 'user_workspace_counts.user_id', '=', 'users.id')
            ->select([
                'users.id', 'users.name', 'users.email', 'users.created_at', 'users.email_verified_at', 'users.is_admin',
                DB::raw('COALESCE(user_workspace_counts.workspace_count, 0) as workspace_count'),
            ]);
        if (! empty($filters['user_search'])) {
            $search = trim($filters['user_search']);
            $users->where(function ($query) use ($search) {
                $query->where('users.name', 'like', '%'.$search.'%')
                    ->orWhere('users.email', 'like', '%'.$search.'%');
            });
        }
        $userPage = $users->orderByDesc('users.id')->paginate($perPage, ['*'], 'users_page');

        $totalUsers = User::count();
        $totalWorkspaces = Workspace::count();
        $quotaCapacity = (int) Workspace::sum('daily_run_limit');
        $usedToday = (int) UsageRecord::whereDate('day', $today)->sum('runs');
        $failedJobs = Schema::hasTable('failed_jobs') ? DB::table('failed_jobs')->count() : 0;
        $recentFailedJobs = Schema::hasTable('failed_jobs')
            ? DB::table('failed_jobs')->orderByDesc('failed_at')->limit(5)->get(['id', 'queue', 'failed_at'])
            : collect();

        return ['data' => [
            'users' => $userPage->items(),
            'users_pagination' => $this->paginationSummary($userPage),
            'workspaces' => $workspacePage->items(),
            'workspaces_pagination' => $this->paginationSummary($workspacePage),
            'total_users' => $totalUsers,
            'total_workspaces' => $totalWorkspaces,
            'total_runs' => RequestRun::count(),
            'queued_jobs' => Queue::size(),
            'failed_jobs' => $failedJobs,
            'usage_today' => $usedToday,
            'daily_quota_capacity' => $quotaCapacity,
            'quota_used_percent' => $quotaCapacity > 0 ? round(($usedToday / $quotaCapacity) * 100, 1) : null,
            'queue_driver' => config('queue.default'),
            'worker_status' => 'not_monitored',
            'recent_failed_jobs' => $recentFailedJobs,
            'executor_hosts' => config('apiforge.approved_hosts'),
            'destination_approvals' => DestinationApproval::with(['requester:id,name,email', 'reviewer:id,name,email'])->latest('id')->limit(100)->get(),
        ]];
    }

    public function showWorkspace(Request $r, string $id): array
    {
        $this->requirePlatformAdmin($r);
        $today = today()->toDateString();
        $workspace = DB::table('workspaces as workspaces')
            ->leftJoin('users as workspace_owner', 'workspace_owner.id', '=', 'workspaces.owner_id')
            ->leftJoinSub(DB::table('workspace_members')->selectRaw('workspace_id, COUNT(*) as member_count')->groupBy('workspace_id'), 'members', 'members.workspace_id', '=', 'workspaces.id')
            ->leftJoinSub(DB::table('usage_records')->whereDate('day', $today)->selectRaw('workspace_id, SUM(runs) as usage_today')->groupBy('workspace_id'), 'usage', 'usage.workspace_id', '=', 'workspaces.id')
            ->where('workspaces.id', $id)
            ->select([
                'workspaces.id', 'workspaces.name', 'workspaces.owner_id', 'workspaces.daily_run_limit', 'workspaces.created_at',
                'workspace_owner.name as owner_name', 'workspace_owner.email as owner_email',
                DB::raw('COALESCE(members.member_count, 0) as member_count'),
                DB::raw('COALESCE(usage.usage_today, 0) as usage_today'),
            ])->first();
        abort_unless($workspace, 404);
        $members = DB::table('workspace_members')
            ->join('users', 'users.id', '=', 'workspace_members.user_id')
            ->where('workspace_members.workspace_id', $id)
            ->orderBy('users.name')
            ->limit(50)
            ->get(['users.id', 'users.name', 'users.email', 'workspace_members.role']);

        return ['data' => ['workspace' => $workspace, 'members' => $members]];
    }

    public function showUser(Request $r, string $id): array
    {
        $this->requirePlatformAdmin($r);
        $user = User::query()->select('id', 'name', 'email', 'is_admin', 'email_verified_at', 'created_at')->findOrFail($id);
        $workspaces = DB::table('workspace_members')
            ->join('workspaces', 'workspaces.id', '=', 'workspace_members.workspace_id')
            ->where('workspace_members.user_id', $id)
            ->orderBy('workspaces.name')
            ->limit(50)
            ->get(['workspaces.id', 'workspaces.name', 'workspaces.daily_run_limit', 'workspace_members.role']);

        return ['data' => ['user' => $user, 'workspaces' => $workspaces]];
    }

    public function requestDestination(Request $r): array
    {
        $this->requirePlatformAdmin($r);
        $r->merge(['hostname' => strtolower((string) $r->input('hostname'))]);
        $data = $r->validate(['hostname' => ['required', 'string', 'max:253', 'regex:/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/D']]);
        abort_unless(str_contains($data['hostname'], '.') && filter_var($data['hostname'], FILTER_VALIDATE_IP) === false, 422, 'Enter one exact public DNS hostname without a wildcard or port.');
        abort_if(in_array($data['hostname'], config('apiforge.approved_hosts'), true), 422, 'This hostname is already configured as an approved destination.');
        $approval = DestinationApproval::updateOrCreate(['hostname' => $data['hostname']], ['status' => 'pending', 'reason' => null, 'requested_by' => $r->user()->id, 'reviewed_by' => null]);

        return ['data' => $approval];
    }

    public function reviewDestination(Request $r, string $id): array
    {
        $this->requirePlatformAdmin($r);
        $data = $r->validate(['status' => 'required|in:approved,denied', 'reason' => 'nullable|string|max:1000']);
        $approval = DestinationApproval::findOrFail($id);
        $approval->update(['status' => $data['status'], 'reason' => $data['reason'] ?? null, 'reviewed_by' => $r->user()->id]);

        return ['data' => $approval->load(['requester:id,name,email', 'reviewer:id,name,email'])];
    }

    public function limit(Request $r, string $id): array
    {
        $this->requirePlatformAdmin($r);
        $data = $r->validate(['daily_run_limit' => 'required|integer|min:1|max:100000']);
        $w = Workspace::findOrFail($id);
        $w->update($data);
        AuditLog::create(['workspace_id' => $w->id, 'user_id' => $r->user()->id, 'action' => 'admin.quota.updated', 'resource_type' => 'Workspace', 'resource_id' => $w->id]);

        return ['data' => $w];
    }

    private function requirePlatformAdmin(Request $r): void
    {
        abort_unless((bool) $r->user()->is_admin, 403);
    }

    private function paginationSummary($paginator): array
    {
        return [
            'current_page' => $paginator->currentPage(),
            'last_page' => $paginator->lastPage(),
            'per_page' => $paginator->perPage(),
            'total' => $paginator->total(),
        ];
    }
}
