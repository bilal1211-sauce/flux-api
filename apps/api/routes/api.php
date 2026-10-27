<?php

use App\Http\Controllers\AccountController;
use App\Http\Controllers\AdminController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\InsightsController;
use App\Http\Controllers\IntegrationController;
use App\Http\Controllers\ResourceController;
use App\Http\Controllers\RunController;
use App\Http\Controllers\WorkspaceController;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::get('health', function () {
        $data = ['service' => 'APIForge API', 'status' => 'ok', 'version' => '1.0.0'];

        if (app()->environment('e2e')) {
            $identity = DB::selectOne("SELECT DATABASE() AS database_name, SUBSTRING_INDEX(CURRENT_USER(), '@', 1) AS database_user, @@port AS database_port");
            $data['e2e_guard'] = [
                'environment' => app()->environment(),
                'database' => $identity->database_name,
                'database_user' => $identity->database_user,
                'database_host' => config('database.connections.mysql.host'),
                'database_port' => (int) $identity->database_port,
            ];
        }

        return ['data' => $data];
    });
    Route::get('reports/{token}', [IntegrationController::class, 'publicReport'])->middleware('throttle:60,1');
    Route::post('auth/register', [AuthController::class, 'register'])->middleware('throttle:registration');
    Route::post('auth/login', [AuthController::class, 'login'])->middleware('throttle:login');
    Route::post('auth/forgot-password', [AccountController::class, 'forgot'])->middleware('throttle:recovery');
    Route::post('auth/reset-password', [AccountController::class, 'reset'])->middleware('throttle:recovery');
    Route::post('auth/verify-email', [AccountController::class, 'verify'])->middleware('throttle:recovery');
    Route::middleware(['auth:sanctum', 'throttle:api'])->group(function () {
        Route::get('auth/me', [AuthController::class, 'me']);
        Route::post('auth/logout', [AuthController::class, 'logout']);
        Route::post('auth/logout-all', [AccountController::class, 'logoutAll']);
        Route::post('auth/verification-email', [AccountController::class, 'resend'])->middleware('throttle:verification');
        Route::patch('auth/profile', [AccountController::class, 'profile']);
        Route::put('auth/password', [AccountController::class, 'password'])->middleware('throttle:verification');
        Route::get('auth/sessions', [AccountController::class, 'sessions']);
        Route::delete('auth/sessions/{id}', [AccountController::class, 'revokeSession']);
        Route::get('dev/mail', [AccountController::class, 'outbox']);
        Route::get('workspaces', [WorkspaceController::class, 'index']);
        Route::post('workspaces', [WorkspaceController::class, 'store']);
        Route::post('invitations/accept', [WorkspaceController::class, 'accept']);
        Route::get('admin', [AdminController::class, 'index']);
        Route::get('admin/users/{id}', [AdminController::class, 'showUser']);
        Route::get('admin/workspaces/{id}', [AdminController::class, 'showWorkspace']);
        Route::post('admin/destinations', [AdminController::class, 'requestDestination']);
        Route::patch('admin/destinations/{id}', [AdminController::class, 'reviewDestination']);
        Route::patch('admin/workspaces/{id}/limit', [AdminController::class, 'limit']);
        Route::prefix('workspaces/{workspace}')->middleware('workspace')->group(function () {
            Route::get('members', [WorkspaceController::class, 'members']);
            Route::patch('preferences', [WorkspaceController::class, 'preferences']);
            Route::post('invitations', [WorkspaceController::class, 'invite']);
            Route::delete('invitations/{id}', [WorkspaceController::class, 'revokeInvitation']);
            Route::match(['patch', 'delete'], 'members/{id}', [WorkspaceController::class, 'changeMember']);
            Route::post('execute', [RunController::class, 'execute'])->middleware('throttle:executions');
            Route::post('runs/local', [RunController::class, 'recordLocal'])->middleware('throttle:executions');
            Route::get('runs', [RunController::class, 'index']);
            Route::get('runs/export', [RunController::class, 'export']);
            Route::get('runs/compare', [RunController::class, 'compare']);
            Route::get('runs/{id}', [RunController::class, 'show']);
            Route::get('summary', [InsightsController::class, 'summary']);
            Route::get('alerts', [InsightsController::class, 'alerts']);
            Route::get('alerts/{id}', [InsightsController::class, 'incidentDetail']);
            Route::get('alert-deliveries', [InsightsController::class, 'deliveries']);
            Route::patch('alerts/{id}/acknowledge', [InsightsController::class, 'acknowledge']);
            Route::get('audit', [InsightsController::class, 'auditLog']);
            Route::get('audit/export', [InsightsController::class, 'exportAudit']);
            Route::get('audit/{id}', [InsightsController::class, 'auditDetail']);
            Route::post('monitors/{id}/check', [InsightsController::class, 'monitorRun'])->middleware('throttle:executions');
            Route::get('monitors/{id}/history', [InsightsController::class, 'monitorHistory']);
            Route::get('requests/{id}', [ResourceController::class, 'showRequest']);
            Route::post('requests/{id}/duplicate', [ResourceController::class, 'duplicate']);
            Route::patch('folders/order', [ResourceController::class, 'reorderFolders']);
            Route::patch('requests/order', [ResourceController::class, 'reorderRequests']);
            Route::post('openapi/import', [IntegrationController::class, 'import']);
            Route::get('shares/overview', [IntegrationController::class, 'shareOverview']);
            Route::get('shares/preview', [IntegrationController::class, 'previewShare']);
            Route::get('shares', [IntegrationController::class, 'shares']);
            Route::get('shares/{id}', [IntegrationController::class, 'showShare']);
            Route::post('shares', [IntegrationController::class, 'createShare']);
            Route::delete('shares/{id}', [IntegrationController::class, 'revokeShare']);
            Route::get('{resource}', [ResourceController::class, 'index'])->whereIn('resource', ['collections', 'folders', 'requests', 'environments', 'monitors']);
            Route::post('{resource}', [ResourceController::class, 'save'])->whereIn('resource', ['collections', 'folders', 'requests', 'environments', 'monitors']);
            Route::put('{resource}/{id}', [ResourceController::class, 'save'])->whereIn('resource', ['collections', 'folders', 'requests', 'environments', 'monitors']);
            Route::delete('{resource}/{id}', [ResourceController::class, 'destroy'])->whereIn('resource', ['collections', 'folders', 'requests', 'environments', 'monitors']);
        });
    });
});
