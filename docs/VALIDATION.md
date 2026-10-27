# Validation results

## APIForge 2.0 upgrade checks · 18 October 2026

These results are from the incremental upgrade. See `UPGRADE_2_AUDIT.md` for implemented scope and remaining limitations.

| Check | Result |
| --- | --- |
| API database | `apiforge:doctor` passed against local MySQL 8.4.11; cache round trip and configuration checks passed without printing credentials. |
| Migration status | All eight project migrations are applied, including the additive Studio/local-execution migration; no table reset was run. |
| Backend suite | **40 tests passed / 295 assertions**, using isolated SQLite. This includes a 101-resource pagination/scoping regression. |
| Local companion | **3 security/integration tests passed** for origin/token/Host, DNS and public HTTP policy, methods/body/headers, redirect/timeout/cancel and limits. |
| Frontend types and lint | TypeScript strict check and ESLint passed. |
| Responsive browser regression | The added workspace sweep checks all 11 modules at 360, 390, 768, 1024, 1440 and 1920 pixels; saved-request tree, context show/hide, light/dark CodeMirror and reduced motion pass. |
| Complete browser suite | **9 Playwright tests passed** in approximately 2.6 minutes, including real cloud execution, local companion integration, account/security flows, paged resources, responsive navigation, theme, and stale-response regressions. |
| Production build | Next.js 16.4.2 optimized production build and build-time TypeScript completed successfully. |
| Database preservation | Pre/post-upgrade and final backups restored into disposable databases; 30 original tables and then 31 post-migration tables restored, with encrypted variable hashes matching. The real MySQL database and application key were preserved. |

### Performance review

Before optimization, the seven-sample summary endpoint baseline was median **291.03 ms**, P95 **355.06 ms**, with 55 runs and 3 saved requests in the measured workspace. After the upgrade, nine warmed samples measured median **284.79 ms**, P95 **347.85 ms**, with 68 runs and 3 saved requests. The changing run count and small local sample mean this is an observed comparison, not evidence that the code alone caused a speedup or a production capacity benchmark. The summary computes run/assertion distributions, endpoint aggregates and P95 selection in SQL. Workspace resources are enabled by route: the dashboard avoids the five collections/folders/requests/environments/monitors list calls, while Studio/Collections/Monitoring fetch only the sets they use through API pages capped at 100 rows, four pages concurrently. The client assembles all pages to retain the complete searchable tree.

### Manual acceptance checklist

- Start with `npm.cmd run dev` and confirm the dashboard, API and worker are available.
- Send a Cloud request to one of the configured demo hosts; verify the new run appears in history and assertions reflect the current response.
- Start the local companion separately, pair using its current terminal token and run a developer-owned loopback API. Verify Local does not fall back to Cloud when disconnected or blocked.
- In Local mode, cancel a request, prompt for a secret variable, send a multipart file and inspect the sanitized local history entry. Stop the companion and confirm the connection ends.
- Create nested folders, filter the tree, pin and duplicate a request, and move sibling items with keyboard-accessible controls.
- Change the dashboard period, inspect recent active-monitor health and open-incidents data, then run a monitor check.
- Check the six recorded widths and both themes. Respect reduced-motion preference and keyboard navigation.
- Request a new exact cloud hostname as an administrator, review it, then verify it still fails when DNS/IP safety checks reject it.

Validated locally on 16 October 2026. All results below were actually executed; container deployment and public hosting were not.

| Check | Result |
| --- | --- |
| PHP runtime | Project-local PHP 8.3.35 with cURL, OpenSSL, mbstring, fileinfo, PDO MySQL/SQLite, intl and zip. |
| MySQL connection | `apiforge:doctor` connected to MySQL 8.4.11 on loopback; all seven migrations applied. |
| Cache / locks | Database cache round trip passed; workspace/monitor execution locks exercised. |
| Public health | `GET /api/v1/health` returns HTTP 200 and a non-sensitive service response. |
| Backend suite | **33 tests passed, 229 assertions**. Fresh in-memory SQLite; no developer MySQL reset. |
| Browser suite | **5 tests passed** in approximately 2 minutes 30 seconds against the running MySQL-backed app and separate executor. |
| Frontend lint | ESLint passed with zero warnings/errors. |
| TypeScript | Strict `tsc --noEmit` passed. |
| Frontend production build | Next.js production build passed. |
| PHP formatting | Laravel Pint passed. |
| Frontend formatting | Prettier applied to source and browser tests. |
| JS dependency review | `npm audit` reports **0 vulnerabilities**, including development dependencies. |
| PHP dependency review | `composer audit` reports no security advisories. |
| Live target execution | Real HTTPS calls to JSONPlaceholder returned HTTP 200 with captured timings, JSON responses and passing assertions. |
| Background monitoring | Scheduler dispatch and `App\Jobs\RunMonitor` consumption observed in worker logs; real scheduled checks completed. |
| Backup restore | Compressed local MySQL dump restored into a disposable database; 30 tables and encrypted variable hashes verified; temporary database removed. |
| UI previews | Desktop dark/light, mobile Studio, desktop Studio and sign-in screenshots captured from the running application. |
| Local service lifecycle | Project services stopped and restarted successfully; MySQL data and credentials persisted, API health and frontend both returned HTTP 200 afterward. |

## What the tests cover

Backend checks include authentication and expiring tokens; tenant isolation across all resource areas; viewer mutation restrictions; collection/folder/request persistence; foreign-workspace relation rejection; encrypted variables and secret preservation; assertion evaluation; redaction of echoed secrets; private/unapproved URL rejection; special IPv4/IPv6 ranges; quotas; separate API/execution rate counters; missing environment values; monitor failure thresholds, incident deduplication and recovery; due-only queue dispatch; email-bound invitation acceptance/reuse; atomic OpenAPI JSON/YAML import, local reference resolution, malformed/nested schema and remote-reference rejection; scoped/expiring/revocable report snapshots; comparison isolation; privileged admin quotas; and retention cascades.

Browser checks cover sign-in and HttpOnly/SameSite session cookies; saved collections across reloads; request saving; real request execution and assertions; history inspection; monitor creation/manual checks; report sharing and public read-only rendering; audit history; dark/light persistence; mobile navigation and no horizontal viewport overflow; cross-origin gateway rejection; private destination blocking; registration; encrypted environment editing with masked secret preservation; invitation creation; and JSON OpenAPI import into real collections. The completion flow additionally exercises queued verification email, verification links, profile/password changes, workspace preferences, current session display, sign-out everywhere, password reset through the encrypted local inbox, fragment removal and draft navigation/close protection.

## Integration defects found and fixed

- Daily usage's date cast wrote a timestamp on SQLite, causing repeat-run unique-key errors. Usage accounting now keeps an explicit date string; repeated-run quota and monitoring tests pass.
- Generic and execution throttles initially shared an identity key. Named limiters now keep the 120/min API and 20/min execution counters separate. A regression test verifies normal reads do not consume execution allowance.
- Next.js's internal request origin did not equal the browser's loopback origin. Gateway validation now compares against a configured exact `WEB_ORIGIN`.
- Port 8000 belonged to an existing unrelated local project. APIForge uses 8100/8101; that project was left running.
- The generated lint preset introduced an unpatched transitive dependency. Replacing the preset with the required maintained lint packages removed the affected dependency tree without forcing a framework downgrade.

## Limits of this verification

Docker/Redis containers, production HTTPS, host-level executor egress restrictions, real external SMTP/webhook delivery and public hosting have not been exercised. Local MySQL backup recovery was exercised in a temporary database: 30 tables restored and encrypted variable data matched; the real application database was preserved. Webhook failure/retry/deduplication is covered with a fake transport; real local queued email was captured and used in the browser recovery flow. The browser suite requires the approved public demo API to be reachable; deterministic backend transport tests use a fake transport and are independent of internet availability. Browser tests create separate local test accounts and may leave their saved test configuration for inspection.

The application is a working local product in the documented feature subset. It is not represented as a fully provisioned production SaaS deployment. See `DEPLOYMENT.md` and `R_AND_D.md` for the remaining operational and feature boundaries.

## Completion fixes

- Password reset consumes a hashed time-limited token and revokes sessions; verification is bound to current account email and expiry. Encrypted jobs and local mail files avoid plaintext recovery tokens in queues/logs.
- Alert delivery retries skip already accepted channels; configured queue counters work with Redis as well as the database driver.
- Request drafts survive client navigation in memory, responses belong to their request tabs, and closing/reloading an unsaved draft prompts before data loss.
- Form hints are associated as descriptions while the field label remains stable for assistive technology.
- The Windows stop script now handles an orphaned Laravel development server without touching the unrelated XAMPP project.
- Build context excludes local outbox files, backups and generated PHP provider caches.
