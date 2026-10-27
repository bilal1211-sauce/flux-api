# APIForge research and implementation decisions

Verified on 18 October 2026. The supplied blueprint is preserved in `product-blueprint.txt`. This document separates implemented behavior from deployment requirements.

## Runtime and dependencies

| Area | Installed / selected | Decision |
| --- | --- | --- |
| PHP | Portable 8.3.35, project-local | Existing XAMPP 8.2.12 remains untouched. PHP ZIP SHA-256 verified against PHP's release metadata. |
| Backend | Laravel 13.37.0 | Laravel 13 supports PHP 8.3; the Composer lock is authoritative. |
| Authentication | Sanctum 4.3.3 | Expiring, hashed bearer tokens; browser token is held only in an HttpOnly cookie by the Next gateway. |
| Database | MySQL Community 8.4.11, loopback port 3307 | Separate database and app user; portable installation avoids the user's XAMPP data. Official ZIP checksum verified. |
| Frontend | Next.js 16.4.2, React 19.3.0, TypeScript | Current stable versions resolved by the actual registry, compatible with installed Node 24.21.0. |
| State / editor | TanStack Query 5, CodeMirror 6 | Resource-specific invalidation and page-scoped resource loading; JSON editing without executing arbitrary JavaScript assertions. |
| Styling | Tailwind CSS 4 plus application tokens | Neutral graphite surfaces with mint, cyan and violet accents; self-hosted IBM Plex Sans/Mono fonts; larger readable labels. |
| Local jobs / locks | Laravel database queue and database cache | Fully functional without a Windows Redis server. Workers and scheduler run as separate local processes. |
| Deployment jobs / locks | Redis 7.4, Predis 3.7 | Compose service and client are configured; Docker and Redis containers could not be exercised on this host because Docker is absent. |
| Verification | PHPUnit 12, Playwright, ESLint 9, Prettier | Real browser tests complement deterministic backend tests. |
| Development support | Laravel Boost 2.10.3 | Installed as a development-only dependency according to Laravel's generated repository instructions; it is excluded from production Composer installs. |

Next's new cache components are disabled for this authenticated application. API data and public expiring report snapshots use `no-store`. The generated Next lint preset pulled in an unpatched `braces` dependency. It was replaced with ESLint, typescript-eslint, and React Hooks rules; the final dependency audit is recorded in `VALIDATION.md`.

## Product modules

| Module | Implemented behavior | Deliberate scope |
| --- | --- | --- |
| Authentication | Register, login, logout, 12-hour sessions, password hashing, login rate limits | Recovery, verification, profile/password changes, session revocation; production verification gate and SMTP configuration supplied. |
| Workspaces | Create/switch workspaces, owner/editor/viewer boundaries | Ten owned workspaces per account; owner transfer is excluded. |
| Collaboration | One-time email-bound invitations, seven-day expiry, membership changes/removal | Queued invitation emails plus copyable links; local encrypted previews and SMTP configuration. |
| Collections | Persistent collections, descriptions, nested folders, saved requests, searchable tree, pinning, duplication, sibling ordering and bounded 100-row API pages | The console loads remaining pages in four-request batches to preserve the full searchable tree; keyboard-operable move controls are provided, drag-and-drop is not implemented. |
| Request Studio | Seven HTTP methods, saved-request tree, multiple tabs, URL/query/header editors, auth/body/settings/assertion tabs, environment selection, per-execution states, cancel and theme-aware CodeMirror | Cloud and Local modes are explicit. Right context panel is optional; desktop sidebars are not resizable. |
| Environments | Encrypted variables, secret masking, template substitution, preservation of masked secrets | No secret reveal endpoint; replacement is explicit. |
| Execution | Cloud uses the separate token-protected executor with DNS validation/connection pinning. Local uses an opt-in loopback Node companion, session token and exact Origin check, DNS pinning for public HTTPS and explicit developer authorization for loopback HTTP. | Local lives in a trusted developer browser session and is not host-level sandboxing. Compose separates executor and database networks; enforce host egress policy before deployment. |
| Inspector | HTTP status, JSON/raw body, headers, time, size, truncation/errors, assertion results and available phase timings | Cloud responses cap at 256 KiB, cloud target timeout at 15 seconds; Local bodies cap at 1 MiB and timeout at 60 seconds. |
| Assertions | Status, duration, JSON dot path equality/existence, header/body containment | Declarative checks only; no user code execution, JSONPath filters or schema evaluator. |
| History | Stored runs, pagination, result/source/name filters, inspection, JSON export, comparisons | Comparisons indicate status/body changes and latency delta; no semantic JSON patch editor. |
| Dashboard | 1/7/30-day filters, saved/run/assertion metrics, average/P95, request-activity and assertion-history charts, status groups, slow endpoints, active monitor snapshots, incidents and recent activity | Empty states use real data; response-time chart is an average trend, not a continuous-uptime guarantee. |
| Monitoring | Persisted intervals, unique jobs, nonoverlapping execution, manual checks, pause/resume | Scheduler and worker must remain running; sampled availability is not continuous uptime. |
| Analytics | 1/7/30-day SQL aggregates, mean/P95 latency, daily run/assertion aggregates, activity and pass/fail charts, status classes, slow endpoints, failure categories and sampled monitor availability | Computed from retained run records; availability describes observed checks, not continuous uptime. |
| Alerts | Configurable failure threshold, one open incident per monitor, acknowledge and recover | In-app plus optional queued email and operator webhook, retries/deduplication and delivery history. No dedicated Slack app connector. |
| OpenAPI | Atomic 3.0/3.1 JSON/YAML import, offline official-schema validation, local references, tagged folders, example parameters/body, response-status assertion | Fixed supported dialect profile; remote references, custom dialects and YAML anchors/aliases rejected. Explicit approved HTTPS server required. |
| Reports | Scoped immutable summaries, random hashed link tokens, expiry and revocation | No raw URLs, bodies, headers or secret variables in public reports. |
| Audit | Workspace changes, executions, team/security events, admin quota changes | Resource IDs and action names only, with no credential payloads. |
| Admin | Restricted account/workspace overview, job counters, exact-host approval/review, quota editing | Admin elevation is a trusted CLI operation, never public registration input. Approval retains executor-side SSRF checks. |

## Primary references

- [Laravel release support and PHP compatibility](https://laravel.com/framework/docs/12.x/releases)
- [Laravel Sanctum authentication](https://laravel.com/docs/13.x/sanctum)
- [Laravel scheduling and overlap prevention](https://laravel.com/framework/docs/scheduling)
- [Laravel queues](https://laravel.com/framework/docs/13.x/queues)
- [Next.js installation and runtime requirements](https://nextjs.org/docs/app/getting-started/installation)
- [Official PHP Windows release metadata](https://www.php.net/~windows/releases/releases.json)
- [MySQL Windows installation packages](https://dev.mysql.com/doc/refman/8.4/en/windows-choosing-package.html)
- [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Unpatched braces advisory considered during dependency review](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)

These sources inform compatibility and security decisions. Actual installed versions are fixed in the lock files; passing a dependency audit is not a substitute for deployment security review.

## Completion additions

Account/recovery notifications and monitor deliveries use encrypted queued jobs. Local outbox files are encrypted and readable only by a platform admin in the local environment. Production uses SMTP and requires verified email for mutations. Notification preferences default off. Webhooks are configured by the operator and use the restricted executor; workspace members cannot supply arbitrary destinations.

Opis JSON Schema 2.6 and Symfony YAML 7.4 support offline imports. See `apps/api/resources/schemas/README.md` for source attribution and compatibility adaptations. HTTPS, backup/restore, firewall helper and container smoke CI files are included. Local backup restore was actually exercised; cloud runtime remains a separate verification step. Free hosting research and account-dependent steps are in `FREE_HOSTING.md`.
