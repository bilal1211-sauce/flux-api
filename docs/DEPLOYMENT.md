# Deployment runbook

The local application is tested. Container deployment files are prepared but have not been executed on this host, which does not have Docker. No public site or provider account has been provisioned.

## Prepare

Use a Linux host with Docker Compose. Copy `infrastructure/.env.example` to `infrastructure/.env` and supply unique database, root, Redis and executor passwords. Generate the Laravel key with `node scripts/php.mjs artisan key:generate --show` or `printf 'base64:'; openssl rand -base64 32`. Keep the key in a secret store and back it up securely. Configure SMTP and a verified sender; production enforces email verification before workspace mutations. Account recovery, verification, invitations and monitor email notifications use encrypted queued jobs.

Set `WEB_ORIGIN` to the exact HTTPS public origin; the gateway rejects mutations from any other origin. Expose only the frontend through your reverse proxy. API, executor, MySQL and Redis have no published host ports in the Compose topology. Do not expose an unencrypted production origin: browser authentication cookies require HTTPS.

```sh
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml build
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml up -d mysql redis
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml run --rm api php artisan migrate --force
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml up -d
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml exec api php artisan apiforge:doctor
```

For the included HTTPS reverse proxy, set `WEB_HOST` and `ACME_EMAIL`, point public DNS to the host, open 80/443 and start with both files:

```sh
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml -f infrastructure/proxy.compose.yaml up -d
sudo bash infrastructure/executor-firewall.sh
```

The firewall helper is for Docker's iptables backend with `DOCKER-USER`; verify it on your Linux host. It changes only a project-owned chain, restricts executor source IPs to public TCP 443 and configured DNS, and must be reapplied after container recreation or reboot. The executor disables IPv6 in this topology. Hostname approval and DNS pinning remain application controls; the helper is not an IP allowlist for every approved hostname. Run a blocked private-target check and an allowed request after applying it.

The API/worker have database and executor-control access. The executor has its separate control/egress networks and no database credentials/application key. The gateway only connects to the trusted API service. Add host/firewall egress rules to allow the executor's DNS resolver and approved public HTTPS targets while denying access to internal services. Compose's network separation does not by itself enforce an outbound destination allowlist at the network layer.

## Verify before public traffic

1. Confirm health, TLS certificates, exact origin validation and Secure/HttpOnly/SameSite cookies.
2. Register a standard account and execute an approved request. Verify private addresses, redirect destinations and unapproved hosts cannot execute.
3. Check two accounts in separate workspaces cannot read or modify each other's records.
4. Confirm a due monitor is queued, consumed by the worker and advances its next due time. Check failed job counters and scheduler logs.
5. Back up and restore the database plus app key, then confirm an encrypted variable can still be resolved.
6. Configure host-level logs, disk/database monitoring, retention and alert delivery appropriate to the deployment. Application payloads and secrets must not be logged by reverse proxies or error reporters.

A platform administrator can be granted only from the trusted server console: `php artisan apiforge:admin your-email@example.com`. Public signup cannot grant administration. Do not deploy local `.runtime/`, `.tools/`, `.env`, database files or demo-account credentials.

## Operations

- Keep one scheduler per deployment, and use a shared Redis cache for job uniqueness and locks. Scale workers with workspace concurrency limits intact.
- Worker timeout is 65 seconds with three attempts; alert jobs use 30/120/300-second backoff and skip delivery rows already marked sent. The target HTTP timeout is 15 seconds; SMTP timeout is 10 seconds. Redis queue retry-after must exceed worker timeout (Laravel's 90-second default does). A delivery marked sent means the configured transport accepted it, not proof that it reached an inbox.
- `php artisan runs:prune` removes request bodies and assertion records after the configured retention period. The scheduler invokes it daily.
- Monitor `failed_jobs`, queue depth, database size, service logs and executor availability. The Admin console shows application counters; it is not a replacement for host telemetry.
- Apply migrations to backed-up data. Never use `migrate:fresh` in a deployed environment.
- Rotate credentials and application keys with a migration plan; replacing the app key without re-encrypting stored variables makes them unreadable.
- Build and test in CI before deployment. The included workflow validates code, tests and dependencies; no deployment secrets or remote publish actions are included.

## Email and webhooks

`MAIL_HOST`, `MAIL_PORT`, `MAIL_SCHEME`, `MAIL_USERNAME`, `MAIL_PASSWORD` and `MAIL_FROM_ADDRESS` configure production SMTP. Port 587 uses SMTP with STARTTLS negotiation; port 465 typically uses the `smtps` scheme. API/worker have a notification-egress network. Verify provider authentication, sender verification and delivery on the actual host. Never switch production mail to the log transport because recovery URLs contain credentials.

Local development uses `MAIL_MAILER=outbox`: mail contents are encrypted in private storage, and an admin can preview the latest 50 emails in Team & settings. The endpoint is unavailable outside the local environment, including to production admins. The queue worker must run to capture mail.

Workspace owners enable monitor emails/webhooks in preferences. Only verified owners/editors receive incident and recovery email. Configure `ALERT_WEBHOOK_URL` and optionally `ALERT_WEBHOOK_TOKEN` on the server, and add that exact HTTPS hostname to `EXECUTOR_APPROVED_HOSTS` on both API and executor. Webhook payloads contain incident/workspace metadata, not response bodies or environment values. Delivery status appears under Alerts. There is no dedicated Slack integration.

## Backup and restore

```sh
bash infrastructure/backup.sh
# Copy the resulting private .sql.gz to protected storage outside this host.
```

Store `APP_KEY` and the deployment `.env` in an encrypted secret store separately. A database backup alone cannot decrypt environment values after key loss. Backups include sensitive application data and must remain private.

Restore only after taking a fresh backup and stopping application writers:

```sh
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml stop web worker scheduler api
# Mount the proxy's maintenance page or stop it during recovery.
bash infrastructure/restore.sh .backups/YOUR_BACKUP.sql.gz --replace-database
# The restore helper runs migrations using an ephemeral API container.
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml -f infrastructure/proxy.compose.yaml up -d
sudo bash infrastructure/executor-firewall.sh
```

Use the original matching app key, verify an encrypted variable and sign in before reopening traffic. Test restores in an isolated environment periodically. The local Windows equivalent, `node scripts/backup-local.mjs --verify`, was exercised against a disposable MySQL database without replacing the developer database. Container scripts and cloud restore still require execution on a Docker host.

For the current free-hosting route and its account/provider limits, see [FREE_HOSTING.md](FREE_HOSTING.md). `.github/workflows/containers.yml` supplies a real Compose/MySQL/Redis build, health and backup smoke job; it has not been run remotely from this workspace.
