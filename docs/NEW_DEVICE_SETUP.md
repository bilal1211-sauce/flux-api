# New Device Setup and Project Context

This guide explains how to clone FluxAPI, run it locally, and keep it updated. GitHub contains the application source and documentation. It does not contain this computer's database, accounts, credentials, environment files or local binaries.

## Clone the repository

Install Git and Node.js 24, then open PowerShell:

```powershell
git clone https://github.com/bilal1211-sauce/flux-api.git
cd flux-api
```

To bring down later commits on that computer:

```powershell
git pull --ff-only origin main
```

Commit or back up your own changes before pulling. Do not use `git reset --hard` to resolve ordinary update conflicts; inspect and resolve the changed files instead.

## First run on Windows

From the cloned project directory, run the bootstrap once:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-windows.ps1
```

The script installs project-local PHP, Composer and MySQL tools, installs locked PHP and JavaScript dependencies, creates ignored local environment files and applies the application's migrations. It does not install or replace system PHP/MySQL or modify XAMPP. It needs network access for verified tool downloads and package installation. Database migrations create/update the fresh local clone's database; they are not a way to copy this computer's data.

Start FluxAPI with its usual frontend port:

```powershell
npm.cmd run dev
```

Or use port 8012:

```powershell
$env:WEB_PORT = '8012'
npm.cmd run dev
```

Open `http://127.0.0.1:3000` by default, or `http://127.0.0.1:8012` when using the second command. Keep the terminal open while using the app. The launcher starts the API (8100), private executor (8101), queue worker, scheduler and frontend. The project-local MySQL server uses port 3307. Stop the launched services with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop.ps1
```

The browser origin should use `127.0.0.1`. If you choose another host/origin, configure it consistently in the ignored `apps/web/.env.local` and restart the frontend.

## Sign in on a fresh clone

The production seeder intentionally does not create a default user. Register through the app, or after starting the local API create a local-only administrator account:

```powershell
node scripts/create-demo.mjs
Get-Content .runtime/demo-account.json
```

The helper generates a password and saves it to `.runtime/demo-account.json`, which is excluded from Git. Treat that file as a password: do not paste it into commits, screenshots or public issue reports. The generated account has platform-admin access for local review and must not be reused on a public deployment.

## Optional local request execution

Cloud execution uses the private project executor. To send a request from the developer's own computer to a local service, start the separate companion in another terminal. Use the same web origin as the browser:

```powershell
npm.cmd run companion -- --origin "http://127.0.0.1:8012" --allow-localhost
```

Use port 3000 in that command if the frontend is running on 3000. Pair with the one-session token printed by the companion, and stop it with Ctrl+C when finished. Read [Local Execution](LOCAL_EXECUTION.md) for the security boundaries.

## What Git does and does not transfer

The repository ignores `.runtime/`, `.tools/`, `.env`, `.env.local`, local SQLite files, build output and test artifacts. A fresh clone therefore has a separate, empty local database and no login credentials from this machine. It does not copy workspace records, run history, monitor history, environment variables, encrypted secrets or the current demo password.

To move application data, use the documented backup and restore process in [Deployment and Restore](DEPLOYMENT.md), and securely transfer the matching Laravel `APP_KEY` through a private secret channel. Encrypted values cannot be recovered without the correct key. Never add database backups, `.env` files, `APP_KEY`, executor tokens or demo-account files to GitHub.

## Project context

FluxAPI is a Laravel API, a Next.js web application, and a private execution service. Its main code areas are:

- `apps/web/` — product UI, same-origin API gateway and Playwright browser tests.
- `apps/api/` — Laravel API, authorization, persistence, jobs, policies and backend tests.
- `apps/executor/` — restricted Cloud request execution.
- `packages/contracts/` — shared API conventions.
- `infrastructure/` — container and deployment configuration.
- `scripts/` — setup, local startup, paired Local companion, isolated E2E and maintenance commands.
- `docs/` — architecture, security, database, operations, validation and audit reports.

The completed product phases cover:

1. Application shell, authentication and FluxAPI branding.
2. Overview dashboard.
3. API Studio and request execution.
4. Collections and encrypted environments.
5. Monitoring and analytics.
6. Run History and incident/alert center.
7. Reports, integrations, team and workspace access.
8. Audit Trail and platform Admin Console.
9. Final requirements, functional, security, performance and release-readiness audit.

Start with [system architecture](architecture/SYSTEM.md), [research and module coverage](R_AND_D.md), [security boundaries](security/BOUNDARIES.md), [database schema](database/SCHEMA.md), and the [Phase 9 final gate](final-audit/FINAL_GATE.md). The Phase 9 assessment found the product suitable for local development and a controlled portfolio demonstration after a local startup check. It is **not ready for public production** until the host-level executor egress, HTTPS proxy, real delivery providers, worker/scheduler monitoring, production key custody and backup/restore controls are verified. Read the final gate before making deployment claims.

## Useful verification commands

```powershell
npm.cmd run test:api
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
node scripts/php.mjs artisan apiforge:doctor
```

Playwright uses the fail-closed isolated E2E setup; read [Phase 7 E2E isolation](phase7-e2e.md) before running state-changing browser tests. Tests and setup should never be pointed at a production database. More validation evidence is in [Validation](VALIDATION.md) and `docs/final-audit/`.
