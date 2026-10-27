# Operational and release readiness

Audit date: 27 October 2026. Local development, a controlled portfolio demonstration and public production are separate gates. This review did not deploy, expose a service publicly or modify any development/production data.

## Release gates

| Gate | Decision | Evidence | Conditions / blockers |
| --- | --- | --- | --- |
| Local development | **Ready for development, with the documented startup workflow** | Laravel suite, Next.js production build, local MySQL-backed E2E services, executor and companion loopback fixtures all ran successfully. | The normal all-in-one developer launcher was not restarted as part of this audit. The E2E harness starts its own isolated services and does not replace the developer database. |
| Controlled portfolio demonstration | **Conditional** | Dashboard and feature flows render in both themes; isolated browser tests cover core request, collaboration and operations screens; screenshot evidence is included. | Before a live demo, manually start the standard local app, verify the intended account/workspace, confirm approved demo-host availability, and avoid presenting the one public demo API result as a guaranteed service. Real SMTP/webhooks are not configured. |
| Public production deployment | **NO-GO / not ready** | Application-level security and functional tests pass, but no production host was provisioned or deployed. | HTTPS proxy/certificates, host executor egress filtering, worker/scheduler telemetry, real delivery providers, production secret custody, backup/restore and rollback procedures have not been validated on a deployment environment. |

## Operations checklist

| Area | Status | Evidence / remaining work |
| --- | --- | --- |
| HTTPS and reverse proxy | **Not verified** | Compose/proxy guidance is present. No public DNS, certificate or proxy was configured. Verify Secure cookies, exact origin and forwarded headers at staging. |
| Cloud executor separation | **Application controls verified; host isolation not verified** | Application restricts exact approved hosts, validates and pins DNS addresses, checks TLS host identity, disables redirects/proxies and bounds request/response/time. Docker is unavailable here; host firewall/equivalent egress policy was not run. |
| Database/private networks | **Not verified for a deployed stack** | Compose files describe private database/cache/executor services. Network isolation and exposed ports must be inspected on the actual host. |
| Queue and worker | **Counters tested; liveness not monitored** | Admin Console reports queue counts and labels worker heartbeat **Not monitored**. Configured queue driver or zero pending jobs does not prove a worker is alive. Add heartbeat/queue-age alerts. |
| Scheduler | **Not verified live** | Unit tests assert that only enabled, due monitors are dispatched. No running production scheduler or real worker consumption was observed in this audit. |
| Mail and webhooks | **Fakes/local outbox verified; real delivery not verified** | Retry/idempotence and redaction tests use local/fake transport. Configure real provider credentials and verify provider-side outcomes in staging before enabling. |
| Logging/monitoring | **Partial** | App health endpoint is tested; safe counters are shown in Admin. Host, database, proxy, executor, queue and provider telemetry are not configured/verified here. |
| Backups and restore | **Documented; not re-run in this audit** | Backup/restore scripts and key guidance exist. `docs/VALIDATION.md` reports an earlier disposable restore and encrypted-value check, but that is historical evidence rather than a current Phase 9 drill. |
| APP_KEY and encrypted data | **Preserved during this audit; production custody not verified** | No command generated/rotated the development APP_KEY or wrote to the developer `.env`; E2E runs used separate random keys. This audit did not hash every existing user record or verify production key storage. |
| Resource limits | **Application bounds verified in source/tests** | Request/response limits, execution timeout, rate limits, workspace quotas and local companion concurrency are bounded. Host CPU/memory quotas and production capacity are not configured or benchmarked. |
| Health checks | **Application endpoint verified; not a full service-health proof** | E2E health returned successfully. Health must not be interpreted as evidence that a queue worker, scheduler, email provider or network egress path is healthy. |
| Deployment/rollback | **Not verified** | Compose and operational runbooks exist; no container build, migration on a release candidate, rollback rehearsal or production deployment was run. |
| Source/release baseline | **Not verified** | The checkout is wholly untracked in Git, so a reproducible baseline and clean release diff cannot be established from this workspace. |

## Data integrity and testing isolation

Backend feature tests used in-memory SQLite. Every browser/benchmark invocation used a distinct database and least-privileged account created by the Phase 7 fail-closed harness. Before migration the harness verified `APP_ENV=e2e`, a unique `fluxapi_e2e_phase7_<12-hex>` database, a matching `fluxapi_e2e_<12-hex>` database user, loopback host/port and database identity. Laravel repeats identity checks at app boot; Playwright global setup checks the health identity. The suite refuses direct Playwright execution without the guard.

Multiple new isolated E2E database/user pairs were created and retained for the full run, focused tests, performance benchmark and screenshot capture. One early wrapper invocation migrated a fresh isolated database but found no tests because the root npm script did not forward the grep argument; the focused test was rerun correctly and passed. No existing E2E database, backup, development database, production database, user record or encrypted secret was deleted or reset. The E2E harness uses its own generated APP_KEY and ignored runtime storage.

The data-preservation conclusion is that this audit performed no write operations against the development/production database or `.env`/APP_KEY. It did not compute a before/after content hash of all pre-existing development records, so this is a no-write assurance, not a record-by-record reconciliation.

## Priority actions before public release

1. Deploy to a private staging host with HTTPS and a verified proxy/origin/cookie setup.
2. Apply a host-level executor egress policy and prove that internal, loopback and metadata targets are blocked while approved HTTPS destinations work.
3. Instrument worker heartbeat, scheduler liveness, queue depth/age and failed-job alerts; keep the console at `Not monitored` until real telemetry exists.
4. Configure SMTP/webhook providers in staging and verify accepted, rejected, retried and safely redacted delivery outcomes.
5. Perform an isolated restore drill using the exact matching APP_KEY and verify a secret environment variable still decrypts. Document key custody/rotation.
6. Establish a tracked Git baseline and release branch, then run the full isolated suite and build against that exact revision.
7. Repeat the performance test with representative retained-history volume and query instrumentation; set capacity limits from measured staging data.

Do not use public production traffic as the next test environment. A controlled portfolio demo is reasonable after the local startup and approved demo target are manually confirmed; production remains blocked by the unverified controls above.
