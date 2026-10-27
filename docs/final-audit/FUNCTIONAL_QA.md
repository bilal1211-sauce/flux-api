# Functional QA and regression results

Audit date: 27 October 2026. Browser tests ran through `scripts/e2e-phase7.mjs`, which creates a new isolated test database and test user for each invocation. Laravel feature tests used the checked-in PHPUnit configuration selecting `APP_ENV=testing` and SQLite `:memory:`. No tests touched the development database or production infrastructure.

## Exact validation results

| Check | Result | Evidence / limits |
| --- | --- | --- |
| Laravel backend tests | **63 passed / 63, 532 assertions**, 14.087 seconds | `npm.cmd run test:api`; PHPUnit uses an in-memory SQLite database. |
| PHP syntax | **Passed** | `php -l` scan over API app, routes, database and tests. |
| Pint | **Passed** | Ran against an isolated copy of the PHP source tree; repository PHP files were not rewritten. |
| ESLint | **Passed** | `npm.cmd run lint`, exit code 0. |
| TypeScript | **Passed** | `npm.cmd run typecheck`, exit code 0. Next.js production builds also completed their build-time TypeScript check. |
| Next.js production build | **Passed** | Full suite and focused E2E invocations built to isolated `.next-phase7-e2e-<id>` directories. Routes generated: `/`, `/_not-found`, `/icon.svg`, `/[section]`, `/api/gateway/[...path]`, `/report/[token]`. |
| Full Playwright regression | **27 passed / 27, 0 failed, 0 skipped**, 5.5 minutes | `npm.cmd run test:e2e`; final full-suite output was green after the 768px correction. |
| Focused Audit Trail/Admin Console | **1 passed / 1**, test body 26.7 seconds | `npm.cmd --prefix apps/web run test:e2e -- --grep "Audit Trail and Admin Console"`; exercises search, filters, export, detail, quota, admin authorization and widths 360/390/768/1024/1440/1920. |
| 768px corrected Audit screenshot | **1 passed / 1**, test body 8.3 seconds | A separate temporary capture test verified `.audit-mobile-list` and no page overflow, then saved light/dark screenshots. The temporary test file was removed. |
| Bounded performance E2E | **1 passed / 1**, test body 37.7 seconds | 25 saved requests and 20 local recorded runs in its own isolated database; no outbound target requests. Temporary benchmark test source was removed after capture. |
| Local companion | **3 passed / 3** | `scripts/companion.test.mjs`: token/origin/Host checks; DNS and private-address rules; loopback method/body/header, timeout/cancel and bounds. Uses only an ephemeral loopback HTTP fixture. |
| npm dependency advisories | **0 vulnerabilities** | `npm.cmd audit --prefix apps/web --audit-level=low`. |
| Composer dependency advisories | **No advisories** | Local `.tools/composer.phar audit --working-dir=apps/api --no-interaction`; system Composer was not required. |

One initial post-fix focused command was mistakenly invoked through the root npm wrapper, which consumed the Playwright `--grep` option and ended with “No tests found.” The fail-closed harness still created and migrated only a new E2E database before Playwright reported zero matching tests. The focused test was rerun correctly from `apps/web` and passed; the full 27-test suite also passed. That unused isolated database was retained under the project E2E naming scheme. No development or production database was targeted.

## Functional flows covered

| Area | Verified flows | Evidence and boundaries |
| --- | --- | --- |
| Authentication and account | Sign-in, registration, email verification, password recovery/reset, profile/preferences, session revocation and draft protection | `completion.spec.ts`, `settings.spec.ts`, `product.spec.ts`; backend `AccountAndDeliveryTest`. Mail was captured through the encrypted local outbox, not a real SMTP provider. |
| Overview | Period selection, real metric definitions, chart, run detail navigation, empty state, actionable load error/retry | `dashboard.spec.ts`; backend summary aggregation tests. |
| API Studio | Request save/reopen, per-tab response isolation, HTTP failure display, stop/cancel behavior, collection explorer paging, local companion pairing/history | `studio-phase3.spec.ts`, `studio-state.spec.ts`, `local-companion.spec.ts`, `product.spec.ts`. Some end-to-end HTTP/body/auth combinations remain incomplete; see below. |
| Collections and environments | Search, rename, move, duplicate, cross-workspace filter rejection, masked secrets, preservation of unchanged secrets, active Studio environment selection | `collections-environments.spec.ts`; backend resource and encrypted-environment tests. Not every delete-confirmation and empty/error control received an individual browser click. |
| Monitoring and Analytics | Monitor check/edit state and detail history, accurate failure health, analytics filters and History links, dark/light capture, responsive sweep | `monitoring-analytics.spec.ts`; backend incident, monitor-history and analytics aggregation tests. Scheduled real worker consumption was not exercised. |
| Run History and Alerts | Search/filter/pagination, compare, export, detail, saved Studio request, incident acknowledgment vs recovery, related monitor/history links | `phase6.spec.ts`; `RunHistoryControllerTest` and `IncidentCenterControllerTest`. |
| Reports and Integrations | Safe report preview/share/revoke, public read-only snapshot, OpenAPI import, workspace-scoped results | `reports-team.spec.ts`, `settings.spec.ts`, `product.spec.ts`; backend expiry/revocation/redaction and OpenAPI tests. |
| Team and Access | Invitation, revoke, role controls, preference authorization, member/workspace switching behavior | `reports-team.spec.ts`, `settings.spec.ts`; backend rejects owner removal/demotion and owner-role escalation. |
| Audit Trail and Admin Console | Audit search/detail/export, workspace scoping, admin-only workspace/user detail, quota confirmation and audit record | `audit-admin.spec.ts`; backend `AuditTrailControllerTest` and `AdminConsoleControllerTest`. |

## Postman-style request coverage

| Request case | Evidence | Audit result |
| --- | --- | --- |
| GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS | Loopback companion fixture sends all seven methods and checks recorded methods/results. | PASS for the companion transport path. |
| Request body bytes and Authorization header | Loopback fixture sends raw bytes and an Authorization header; verifies returned echo, headers, status and timing. | PASS for raw bytes/header transport. |
| URL-encoded/base64 body | Fixture checks an encoded byte payload. | PARTIAL; this does not prove the browser's `application/x-www-form-urlencoded` editor semantics. |
| JSON/text/raw body modes and multipart | Cloud/backend tests exercise JSON and assertion behavior; local fixture accepts raw or base64 bytes. | PARTIAL; semantic form encoding and a real multipart boundary/content-type pair were not comprehensively asserted. |
| Query parameters | Request validation and executor support query-bearing URLs; no dedicated local fixture assertion was found in the inspected E2E set. | NOT VERIFIED end to end. |
| Bearer, Basic and API-key auth | Basic auth with encrypted environment templates and request timeout is tested through mocked safe transport; local fixture checks a direct Authorization header. | PARTIAL; API-key and complete UI-to-fixture auth matrix not verified. |
| Environment interpolation and secret redaction | Backend tests verify secret templates, masked responses and stored run redaction; browser verifies selection/masking. | PASS for tested template/redaction paths. |
| Assertions, response headers, response status, timing | Backend assertion engine checks status, JSON, duration and headers; companion fixture checks headers/status/timings; Studio preserves HTTP 503 body as an HTTP response. | PASS for tested cases; no exhaustive assertion-type matrix. |
| Cancellation, timeout, transport/network failure and HTTP 4xx/5xx | Local fixture verifies timeout/cancel/redirect/large response; browser cancellation uses a controlled intercepted response; one browser test inspects HTTP 503. | PARTIAL; a real deterministic transport failure plus explicit 4xx/5xx local fixture matrix remains. |
| Multiple tabs and saved request reopen | Interleaved tab response test, request persistence and Collections-to-Studio flows. | PASS for tested paths. |

The browser suite contains one existing product flow that attempts a single Cloud request to the configured public demo hostname. The test accepts the resulting application outcome whether the public service responds or a network failure occurs, so that case is not a deterministic connectivity proof. It is one approved demo request, not a scan. No public target was used for the bounded performance benchmark or local companion fixture.

## Responsive defect found and fixed

The first full run after the audit began completed **26 of 27 tests**. `audit-admin.spec.ts` reported `document.documentElement.scrollWidth - innerWidth = 37` at 768px. Reproduction: sign in to the isolated E2E account, open Audit Trail at 768px with the collapsed desktop sidebar, and evaluate the document width difference. The existing Audit compact layout started only at 760px, leaving the 768px viewport in a wide desktop-table mode.

The Audit-specific compact view now applies from 761px through 820px, with the existing phone breakpoint retained at 760px and below. This uses the existing card/list and filter-drawer UI; no new component or dependency was added. The focused test passed the full width list, the complete regression suite passed 27/27, and a follow-up test captured the corrected 768px view with no horizontal overflow.

## Screenshot evidence

The screenshots contain synthetic `example.test` E2E account/workspace data only. They contain no development user records, real emails or secrets. Evidence files were copied into this audit package so the reports remain reviewable independently of generated build output.

- Audit Trail desktop: [light](evidence/audit-trail-desktop-light.png), [dark](evidence/audit-trail-desktop-dark.png)
- Audit Trail at 390px: [light](evidence/audit-trail-390-light.png), [dark](evidence/audit-trail-390-dark.png)
- Audit Trail at 768px after correction: [light](evidence/audit-trail-768-light.png), [dark](evidence/audit-trail-768-dark.png)
- Admin Console desktop: [light](evidence/admin-console-desktop-light.png), [dark](evidence/admin-console-desktop-dark.png)
- Admin Console at 390px: [light](evidence/admin-console-390-light.png), [dark](evidence/admin-console-390-dark.png)

Other Phase 1–7 screenshots remain in `test-results/phase7/<run-id>/`; they are generated test evidence, not tracked source files. There is no reliable pre-Phase-8 screenshot baseline in the repository, so this report does not claim a quantified before/after comparison.
