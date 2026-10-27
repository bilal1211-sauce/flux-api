# APIForge 2.0 upgrade audit

Audit date: 18 October 2026. This is an incremental upgrade to the existing Laravel, Next.js and MySQL application. The original application, local database and application key were retained.

## Baseline and data safety

- The existing baseline passed 33 backend tests / 229 assertions. Its PHPUnit suite uses isolated SQLite; it did not migrate or reset the developer's MySQL database.
- Before changing the live local schema, a compressed backup was restored into a disposable database. All original 30 tables restored and encrypted environment-variable hashes matched.
- The additive migration `2026_10_18_162025_add_professional_studio_execution_fields.php` adds nested folder/order fields, request body/auth/timeout/pin fields, execution mode/UUID/timings and the exact-host approval table. It was applied normally; no `migrate:fresh`, `db:wipe`, destructive seeder or key regeneration was used.
- A post-upgrade dump restored to a disposable database with 31 tables and matching encrypted-variable hashes. The application database and key were left in place.

## Findings before the upgrade

The Studio kept old responses after a failed/new send, only offered the operator's fixed cloud allowlist, and had no secured developer-local execution. Requests had flat folders and no pin/order/duplicate controls. The dashboard's fixed period and some run/request labels did not match their underlying counts. Analytics loaded all latency samples into PHP for P95. Workspace-wide resource lists were fetched on routes that did not use them. The interface had a narrow Studio, no request tree or optional context panel, and mobile layout needed a six-width sweep.

## Milestone status

| Milestone | Status | Delivered / remaining |
| --- | --- | --- |
| 1. Audit and data-safe baseline | Complete | Repository, runtime, tests and data were inspected; before/after disposable restore checks completed. |
| 2. Execution state and policy feedback | Complete | Per-tab execution UUID/controller, old-response clearing, explicit states and cancellation/stop-waiting actions. |
| 3. Secure local companion | Complete | Opt-in Node service; loopback bind, random one-session token, exact Origin/Host, explicit localhost authorization, DNS pinning, TLS checks, body/time/rate/concurrency limits and cancellation. Deterministic and real-loopback tests pass. |
| 4. Local / Cloud integration | Complete | Explicit Studio selector, pairing UX, no silent fallback, temporary local secret prompt and sanitized, separately labeled local history records. |
| 5. Studio redesign | Complete for the shipped workflow | Searchable nested collection tree, saved-request tabs, auth/body/settings editors, response inspection and collapsible right context. Drag-and-drop ordering is not included; keyboard-accessible move controls are available in Collections. |
| 6. Dashboard | Complete for the shipped workflow | Real period metrics, average/P95, request activity and assertion-history charts, status groups, endpoint summaries, active monitor rows, open incidents and recent activity. Chart tooltips and empty states use actual aggregates. |
| 7. Collections, environments and history | Complete | Tenant-scoped nested folders, reorder, request duplication/pinning, encrypted environment preservation and local/cloud history filtering. |
| 8. Monitoring, analytics and reports | Complete for current feature scope | Existing scheduled cloud-only monitors, alert delivery/recovery, sampled 1/7/30-day analytics and scoped expiring reports retained; dashboard now includes bounded monitor health snapshots. |
| 9. Responsive design | Complete for verified viewports | Layout/browser regression covers 360, 390, 768, 1024, 1440 and 1920 pixels, theme switching and reduced motion. Desktop sidebars are fixed width rather than resizable. |
| 10. Performance | Partial | P95 uses SQL selection; endpoint summaries are aggregated in SQL; invalidation is targeted; unused workspace resources are not loaded on every route; resource APIs return at most 100 rows with page metadata. The current console fetches bounded pages in batches to preserve the complete tree, so the browser still holds all those rows. Virtualizing the largest trees remains recommended for very large workspaces. |
| 11. Security and regressions | Complete for the verified local environment | PHP, Node companion, frontend, nine-browser-test suite, backup restore and database doctor pass; production/Docker egress remains unverified. |
| 12. Documentation and final review | Complete | Startup, local execution, schema, security, validation, file inventory and manual acceptance steps are documented. |

## Execution boundaries

Cloud requests still require an operator-configured or platform-admin-approved exact hostname. The executor independently validates every DNS answer, pins a permitted public IP, verifies TLS, blocks redirects and private/reserved addresses, limits time/body/response size and uses isolated service credentials. An admin approval adds an exact hostname only; it does not bypass the transport checks.

Local mode exists for a developer's trusted browser session. A paired companion receives the target request directly from that browser. Local response history and assertion results are client-reported; Cloud results remain server-evaluated. Local runs cannot become scheduled monitor checks. Encrypted server-side secrets stay masked and are not exposed to the browser; local mode asks for referenced secret values for that execution only. Stop-waiting on Cloud cancels the browser request, not necessarily work already accepted by a remote target.

## Operational limits

- Cloud destination timeout is capped at 15 seconds; Local timeout is capped at 60 seconds.
- Cloud request-body cap is 128 KiB after multipart expansion. Local request and response caps are 1 MiB.
- The local companion is not launched by normal `npm run dev`; pair it only when needed and stop it when done.
- Public hosting, Docker execution, production HTTPS/egress firewall, external SMTP/webhook delivery and public account setup were not performed. See `DEPLOYMENT.md` and `FREE_HOSTING.md`.
- This work does not claim production readiness. Virtualizing large client-side collection trees and resizable desktop panels are the highest-value remaining product work.
