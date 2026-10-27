# Phase 7 isolated browser tests

Run the full browser suite from the repository root:

```powershell
npm.cmd run test:e2e
```

The command requires the project-local MySQL 8.4 server to be running on `127.0.0.1:3307` and its ignored `.runtime/mysql-client.cnf` administrator file to be present. Start it through the existing development startup (`npm run dev`) when needed; the harness uses its own API, restricted execution, and Next.js ports (`8104`, `8105`, and `3001`) and a separate ignored Next.js build directory, without changing the normal development ports or startup command. The E2E executor receives a fresh token for each run and retains the configured approved-host allow-list (`jsonplaceholder.typicode.com`, `httpbin.org`); it runs only on loopback and never uses the development executor.

Each invocation creates a new database named `fluxapi_e2e_phase7_<random-id>` and a separate application account named `fluxapi_e2e_<random-id>`. That account receives privileges only on its matching database. Before migration, the harness verifies the local MySQL version, port, data directory, target database absence, target account absence, and the live database/user identity. Laravel repeats the connection check whenever the API or an Artisan command boots in `APP_ENV=e2e`; Playwright also verifies the API health identity before discovering or executing tests. The suite stops if any check fails.

The database, credentials, demo user, mail outbox, logs, and application storage for each run live under ignored `.runtime/phase7/<random-id>/` files. The harness builds and serves the browser app from its own ignored `.next-phase7-e2e-<random-id>/` directory, preserving the normal `.next` output. Screenshots go under `test-results/phase7/<random-id>/`. The harness does not reuse, truncate, reset, or delete any development, production, or earlier test database. It also does not automatically remove E2E databases or accounts: each is retained for review, and cleanup is a deliberate local database-administration task performed by the database owner.

Backend feature tests use the PHPUnit configuration in `apps/api/phpunit.xml`, which selects `APP_ENV=testing` and in-memory SQLite (`DB_DATABASE=:memory:`). Verify those values before running tests if PHPUnit configuration changes. From the repository root:

```powershell
npm.cmd run test:api
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
```

Do not run `migrate:fresh`, database reset commands, or the browser tests directly with Playwright. `apps/web/playwright.config.ts` fails closed unless the isolated harness is active, and the harness only runs ordinary `artisan migrate` after its target identity checks pass.
