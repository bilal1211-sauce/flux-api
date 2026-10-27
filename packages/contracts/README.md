# API contracts

API base: `/api/v1`. JSON responses use `{ data: ... }`, errors use `{ message, errors? }`. Paginated history returns Laravel pagination inside `data`.

Workspace routes start with `/workspaces/{workspace}`. IDs from other workspaces return 404; viewers cannot mutate resources. Owners manage membership, editors manage resources, viewers inspect results. Browser authentication uses an HttpOnly cookie via the Next.js same-origin gateway; direct API consumers use expiring Sanctum tokens.

Canonical executable contract: `apps/api/routes/api.php` and its request validation rules. A supported OpenAPI example lives in `docs/demo-openapi.json`.
