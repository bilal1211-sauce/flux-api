# Persistence and tenant boundaries

The initial schema is `apps/api/database/migrations/2026_10_16_000001_create_apiforge_tables.php`. The additive APIForge 2.0 changes are in `apps/api/database/migrations/2026_10_18_162025_add_professional_studio_execution_fields.php`; it was applied locally without recreating tables or changing the application key. Laravel's standard migrations add users, sessions, jobs, failed jobs, cache/locks; Sanctum adds personal access tokens.

| Domain | Entities and relationships |
| --- | --- |
| Identity | `users` → `personal_access_tokens`; tokens expire after 12 hours. |
| Organization | `workspaces.owner_id` → user; `workspace_members` unique workspace/user and role; `invitations` email-bound one-time hashed tokens. |
| Requests | Workspace → collections → self-parented nested folders with explicit ordering; `api_requests` optionally belong to collection/folder and store body/auth/timeout/pin/order configuration; request assertions are separate rows. |
| Configuration | Workspace → environments → variables, unique environment/key; all values use Laravel encrypted casts and require the application key. |
| Executions | `request_runs` keep method, redacted URL, status, duration, outcome, error code, local/cloud mode, optional unique execution UUID and timings; one response record and multiple assertion results. Local records are client-reported. |
| Observability | `monitors` reference a saved request/environment; `monitor_runs` connect monitors to real request runs; alert rules and incident events belong to the workspace. |
| Platform | Append-only application audit actions; immutable expiring `share_links` snapshots; exact-host `destination_approvals` with requester/reviewer state; `usage_records` unique workspace/UTC day. |

Workspace-owned tables carry `workspace_id` and a cascading workspace foreign key. The API enforces tenant scoping for every access and related-resource assignment. Most foreign keys constrain resource existence; they do not replace the application's tenant checks. Direct database access bypasses these application protections and must remain private.

Collection, folder, request, environment and monitor index routes return bounded pages (100 rows by default, maximum 100) with `current_page`, `last_page`, `per_page` and `total` metadata. The web console retrieves additional pages in small batches to assemble its complete searchable collection tree.

Deleting a collection preserves its requests as unfiled and clears folder links. Deleting a saved request clears the request reference in historical runs and removes its monitors. Deleting a run cascades its response, assertion results, and monitor-run relation. Configuration deletion is permanent. Only the owner membership is immutable through the public API.

MySQL is used by the running local application. Automated feature tests use a fresh in-memory SQLite database, with foreign keys enabled, and never migrate or reset the developer's MySQL database. Browser tests exercise the real MySQL-backed application and create their own test accounts.

Back up the database and application key together. Losing the key prevents decryption of saved environment variables. Back up MySQL volumes before applying production migrations; run `artisan migrate --force`, never `migrate:fresh`, against a deployed instance.
