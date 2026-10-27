# APIForge

A working Laravel + Next.js API workspace with secure request execution, team workspaces, declarative tests, monitoring and reports.

Open the application locally at **http://127.0.0.1:3000** by default. Set `WEB_PORT` to use another port, such as 8012. API health: **http://127.0.0.1:8100/api/v1/health**. Local demo credentials, when created, are stored privately in the ignored file **`.runtime/demo-account.json`**. The local demo account has platform access so you can review the admin console; do not reuse it for a public deployment. You can also register your own account from the sign-in screen.

## Public homepage

The root URL now opens an original APIForge landing page with floating icons and a mint glow divider. **Open your workspace** leads to `/dashboard`, where existing sign-in and workspace behavior is preserved. The licensed React Bits Pro Hero 13 could not be installed without a license key; both registry entries are configured for a future licensed install. See [React Bits setup and implementation](docs/REACT_BITS.md).

## Run on this machine

Node 24, portable PHP 8.3.35, Composer, MySQL 8.4.11 and application dependencies have been installed. Existing XAMPP and other project services were preserved. APIForge uses MySQL port 3307 and backend/executor ports 8100/8101.

```powershell
cd flux-api
npm.cmd run dev
```

To run the frontend at port 8012:

```powershell
$env:WEB_PORT = '8012'
npm.cmd run dev
```

The launcher starts the project database if needed, the API, private executor, queue worker, scheduler and web frontend. Services already launched in the background are reused. Background launch is also available with `node scripts/dev.mjs --background`; logs are in `.runtime/`. Stop project services with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop.ps1`. The stop script checks project paths before stopping its recorded processes.

Use **127.0.0.1**, including in the browser, because the gateway's origin validation defaults to that exact origin. For a different address set `WEB_ORIGIN` in `apps/web/.env.local` and restart Next.js.

## Fresh Windows setup

Install Node.js 24 and Git first, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-windows.ps1
npm.cmd run dev
```

The bootstrap installs project-local PHP/Composer/MySQL, verifies download checksums, configures extensions and CA certificates, installs locked dependencies, and applies migrations. It does not modify system execution policy or XAMPP. Portable binaries and generated credentials are ignored by Git. A normal cross-platform PHP/Composer environment can instead use `npm run setup` and configure its database in `apps/api/.env`. SQLite is available as a development fallback; MySQL is used on this machine.

For an optional local demo account, after starting the API run `node scripts/create-demo.mjs`. To record real sample runs and create a five-minute monitor, run `node scripts/populate-demo.mjs`. These scripts call the actual application and approved demo API; they do not fabricate analytics. Account creation is idempotent. Re-running sample execution adds real run history.

## Try the product

1. Sign in or create an account. The starter collection has three approved demo requests.
2. Open **Collections → Get a single post** and select the **Demo** environment.
3. Press **Send** or **Ctrl+Enter**. Inspect the real response, headers and assertion results.
4. Edit the request and press **Save** or **Ctrl+S**. Reopen it from Collections.
5. Create an environment with a secret, then reference it as `{{token}}` in a header. Saved secret values are never displayed again.
6. Add a saved request to **Monitors**. Try **Check now**, then leave the worker and scheduler running for scheduled checks.
7. Review **Analytics**, **Run history**, **Alerts** and **Audit log**. Use **Reports** to create an expiring read-only snapshot or import `docs/demo-openapi.json`.
8. Use **Team & settings** for workspace creation, invitations and role changes. Queued invitation emails and copyable links are available. Local email previews are in the admin development inbox.

Cloud requests run only against operator-approved HTTPS hosts. A platform administrator can review exact-host requests in **Platform console → Destination approvals**; approval adds that hostname to the allowlist, while DNS/IP validation, private-network blocking and redirect restrictions still apply. Wildcards and user-provided proxy destinations are not accepted. The default demo targets should not receive production credentials.

For developer-authorized local APIs, start the separately paired loopback companion in another terminal:

```powershell
npm.cmd run companion -- --origin "http://127.0.0.1:3000" --allow-localhost
```

In **Request Studio → Local**, paste the one-session token printed in that terminal and connect. The companion is opt-in, binds only to `127.0.0.1:8102`, accepts requests only from the exact UI origin, and exits when you stop that terminal. Localhost HTTP access requires the explicit `--allow-localhost` switch; other public destinations must use HTTPS and pass DNS checks. Local runs are browser-reported history records and do not become scheduled cloud monitor checks. Encrypted server-side secrets are never revealed to local mode; enter any referenced secret in the temporary local prompt when asked.

## Validation commands

```powershell
npm.cmd run test:api
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
node scripts/php.mjs artisan apiforge:doctor
```

Browser tests require running local services and internet access to the approved demo API. Install Chromium once with `npx.cmd --prefix apps/web playwright install chromium`. PHPUnit uses a fresh in-memory SQLite database; it never resets the local MySQL database. Browser tests create separate test accounts in the actual app.

The companion's isolated security suite can be run with `node --test scripts/companion.test.mjs`. See [local execution setup and boundaries](docs/LOCAL_EXECUTION.md) before pairing it with a non-loopback UI origin.

## Modules and boundaries

Implemented: registration/login, password recovery, email verification, profile/password settings and session revocation; workspace roles and invitations; nested collection trees with bounded 100-row API pages, request search, pinning, duplication and ordering; CodeMirror Request Studio with saved-request tree, multi-request tabs, in-memory drafts, per-tab execution states and stale-response protection, optional context panel, auth/body/settings editors and unsaved-change prompts; encrypted environments; isolated Cloud execution and paired Local execution; response inspection; six assertion types; local/cloud history filters and comparisons/export; real period-filtered dashboard/analytics, request activity and assertion history, bounded endpoint summaries, active monitor snapshots and open-incident counts; queued monitoring; deduplicated in-app alerts, optional queued email/operator-webhook delivery and delivery history; offline OpenAPI 3.0/3.1 JSON/YAML import with local references; expiring/revocable report links; audit logs; restricted platform overview, destination approval and quota management.

Local jobs and locks use MySQL-backed Laravel drivers. Redis deployment configuration and its PHP client are supplied; a Redis server and Docker are not installed on this Windows host. Public hosting, verified production firewall rules and a real SMTP provider have not been provisioned. HTTPS proxy, production mail configuration, backup/restore helpers and a container CI smoke workflow are included. OpenAPI import validates the documented supported dialect profile; remote references, custom dialects and YAML aliases are rejected.

## Finish and deployment

The interface uses self-hosted IBM Plex Sans and IBM Plex Mono, with larger readable labels and simpler copy. No font requests go to an external provider.

Use `node scripts/backup-local.mjs --verify` to create a local MySQL backup and verify its restore in a disposable database. The real application database is preserved. Keep `.env` and `APP_KEY` protected separately.

See [free hosting instructions](docs/FREE_HOSTING.md), [deployment and restore](docs/DEPLOYMENT.md) and [validation evidence](docs/VALIDATION.md). Local mail is captured encrypted in a development-only admin inbox. Production requires SMTP credentials and enables email verification before workspace mutations.

## Project layout

```text
apps/api/             Laravel API, domain services, jobs, models and tests
apps/executor/        Private HTTP request executor entry point
apps/web/             Next.js interface, same-origin gateway, browser tests
packages/contracts/   API response and tenancy conventions
infrastructure/       Container definitions and private network topology
scripts/              Setup, launch, runtime and local demo helpers
docs/                 Research, architecture, schema, security and validation
```

Start with [research and module coverage](docs/R_AND_D.md), [architecture](docs/architecture/SYSTEM.md), [schema](docs/database/SCHEMA.md), [security boundaries](docs/security/BOUNDARIES.md), [deployment](docs/DEPLOYMENT.md), [validation results](docs/VALIDATION.md) and [the file inventory](docs/CHANGED_FILES.md). Screenshots are in `docs/previews/`.

For cloning this project on another computer, first-time setup, safe code updates, local accounts and the Phase 1–9 context, see [New Device Setup and Project Context](docs/NEW_DEVICE_SETUP.md).
