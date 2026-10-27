import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const apiPath = resolve(root, 'apps/api');
const webPath = resolve(root, 'apps/web');
const mysqlBin = resolve(root, '.tools/mysql/mysql-8.4.11-winx64/bin');
const mysqlClient = resolve(mysqlBin, 'mysql.exe');
const mysqlAdminFile = resolve(root, '.runtime/mysql-client.cnf');
const php = process.env.PHP_BINARY || resolve(root, '.tools/php/php.exe');
const apiOrigin = 'http://127.0.0.1:8104';
const webOrigin = 'http://127.0.0.1:3001';
const executorPort = 8105;
const composeFile = readFileSync(resolve(root, 'infrastructure/compose.yaml'), 'utf8');
const localEnv = readFileSync(resolve(apiPath, '.env'), 'utf8');
const devDatabase = localEnv.match(/^DB_DATABASE=(.*)$/m)?.[1]?.trim();
const productionDatabase = composeFile.match(/^\s+DB_DATABASE:\s*(\S+)/m)?.[1];
const devUser = localEnv.match(/^DB_USERNAME=(.*)$/m)?.[1]?.trim();
const previewRoot = resolve(root, 'test-results/phase7');
const runtimeRoot = resolve(root, '.runtime/phase7');
const children = new Set();

function mysql(args, input, label) {
  const result = spawnSync(mysqlClient, [
    `--defaults-extra-file=${mysqlAdminFile}`,
    '--protocol=tcp', '-h127.0.0.1', '-P3307', ...args,
  ], { cwd: root, input, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed: ${result.error?.message || result.stderr || 'MySQL command failed.'}`);
  }
  return result.stdout.trim();
}

function phpRun(args, env, label) {
  const result = spawnSync(php, args, { cwd: apiPath, env, encoding: 'utf8', windowsHide: true });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed: ${result.error?.message || `exit ${result.status}`}`);
  }
}

function assertAvailablePort(port) {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`E2E port ${port} is already in use; no E2E database was created.`)));
    server.listen(port, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolvePromise()));
  });
}

function waitForExit(child, name) {
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`${name} exited before readiness (exit ${code}).`)));
  });
}

function launch(name, command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: 'inherit' });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

async function waitForHttp(url, label) {
  let lastError = 'not ready';
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  throw new Error(`${label} did not become ready: ${lastError}`);
}

async function waitForPort(port, label) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const connected = await new Promise((resolvePromise) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolvePromise(true); });
      socket.once('error', () => resolvePromise(false));
    });
    if (connected) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`${label} did not become ready on isolated port ${port}.`);
}

function envValue(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function buildNextIsolated(distDir) {
  const generatedConfigPaths = ['apps/web/tsconfig.json', 'apps/web/next-env.d.ts'].map((path) => resolve(root, path));
  const originalFiles = generatedConfigPaths.map((path) => ({ path, contents: readFileSync(path) }));
  const nextCli = resolve(webPath, 'node_modules/next/dist/bin/next');
  let result;
  try {
    result = spawnSync(process.execPath, [nextCli, 'build'], {
      cwd: webPath,
      env: { ...process.env, FLUXAPI_E2E_DIST_DIR: distDir, NEXT_TELEMETRY_DISABLED: '1' },
      stdio: 'inherit',
      windowsHide: true,
    });
  } finally {
    for (const file of originalFiles) {
      writeFileSync(file.path, file.contents);
    }
  }
  if (result.error || result.status !== 0) {
    throw new Error(`Isolated Next.js production build failed: ${result.error?.message || `exit ${result.status}`}`);
  }
}

async function createIsolatedDatabase(suffix) {
  if (!existsSync(mysqlClient) || !existsSync(mysqlAdminFile)) {
    throw new Error('E2E setup requires the project-local MySQL server and its ignored .runtime/mysql-client.cnf admin file. It will not fall back to the development database.');
  }
  if (!devDatabase || !productionDatabase || !devUser) {
    throw new Error('E2E setup could not read the development and production database names for comparison.');
  }

  const rootIdentity = mysql(['--batch', '--skip-column-names', '-e', "SELECT VERSION(), @@port, @@datadir, CURRENT_USER()"], undefined, 'Local MySQL identity check').split('\t');
  const normalizePath = (value) => value.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase();
  const expectedDataDir = normalizePath(resolve(root, '.runtime/mysql-data'));
  const actualDataDir = normalizePath(rootIdentity[2] || '');
  if (!rootIdentity[0]?.startsWith('8.4.11') || rootIdentity[1] !== '3307' || actualDataDir !== expectedDataDir || !rootIdentity[3]?.startsWith('root@')) {
    console.error(`Observed local MySQL identity: version=${rootIdentity[0] || 'missing'}, port=${rootIdentity[1] || 'missing'}, data_dir=${rootIdentity[2] || 'missing'}, admin=${rootIdentity[3] || 'missing'}. Expected MySQL 8.4.11 on 3307 at ${expectedDataDir} as local root.`);
    throw new Error('E2E setup refused MySQL because the connected server is not the project-local 8.4.11 instance under .runtime/mysql-data.');
  }

  const database = `fluxapi_e2e_phase7_${suffix}`;
  const username = `fluxapi_e2e_${suffix}`;
  if (database === devDatabase || database === productionDatabase || username === devUser) {
    throw new Error('E2E database guard rejected a name matching the development or production configuration.');
  }
  const exists = mysql(['--batch', '--skip-column-names', '-e', `SELECT (SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${database}'), (SELECT COUNT(*) FROM mysql.user WHERE user='${username}' AND host='127.0.0.1')`], undefined, 'E2E target availability check').split('\t');
  if (exists[0] !== '0' || exists[1] !== '0') {
    throw new Error('E2E setup refused to reuse an existing database or user.');
  }

  const password = randomBytes(32).toString('hex');
  const appKey = `base64:${randomBytes(32).toString('base64')}`;
  const sql = `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\nCREATE USER '${username}'@'127.0.0.1' IDENTIFIED BY '${password}';\nGRANT ALL PRIVILEGES ON \`${database}\`.* TO '${username}'@'127.0.0.1';\n`;
  mysql(['--batch'], sql, 'Dedicated E2E database and user creation');

  const targetCredentialFile = resolve(root, `.runtime/phase7-${suffix}.cnf`);
  writeFileSync(targetCredentialFile, `[client]\nhost=127.0.0.1\nport=3307\nuser=${username}\npassword=${password}\n`, { mode: 0o600, flag: 'wx' });
  const targetIdentity = spawnSync(mysqlClient, [`--defaults-extra-file=${targetCredentialFile}`, '--protocol=tcp', '-h127.0.0.1', '-P3307', `-D${database}`, '--batch', '--skip-column-names', '-e', "SELECT DATABASE(), SUBSTRING_INDEX(CURRENT_USER(), '@', 1), @@port"], { cwd: root, encoding: 'utf8', windowsHide: true });
  const actual = targetIdentity.stdout.trim().split('\t');
  if (targetIdentity.error || targetIdentity.status !== 0 || actual[0] !== database || actual[1] !== username || actual[2] !== '3307') {
    throw new Error('E2E setup created resources but could not verify the isolated application database identity. No migrations or tests were run.');
  }

  const workspace = resolve(runtimeRoot, suffix);
  mkdirSync(workspace, { recursive: true });
  const storage = resolve(workspace, 'storage');
  const bootstrap = resolve(workspace, 'bootstrap');
  mkdirSync(bootstrap, { recursive: true });
  const isolatedCachePath = (name) => relative(apiPath, resolve(bootstrap, name)).replaceAll('\\', '/');
  for (const directory of ['app/private/outbox', 'framework/cache/data', 'framework/sessions', 'framework/views', 'logs']) {
    mkdirSync(resolve(storage, directory), { recursive: true });
  }
  const executorToken = randomBytes(32).toString('hex');
  const appEnv = {
    APP_ENV: 'e2e', APP_DEBUG: 'false', APP_KEY: appKey,
    APP_URL: apiOrigin, WEB_URL: webOrigin,
    DB_CONNECTION: 'mysql', DB_HOST: '127.0.0.1', DB_PORT: '3307',
    DB_DATABASE: database, DB_USERNAME: username, DB_PASSWORD: password, DB_URL: '', DB_SOCKET: '',
    E2E_DATABASE_NAME: database, E2E_DATABASE_USER: username,
    LARAVEL_STORAGE_PATH: storage,
    APP_CONFIG_CACHE: isolatedCachePath('config.php'),
    APP_SERVICES_CACHE: isolatedCachePath('services.php'),
    APP_PACKAGES_CACHE: isolatedCachePath('packages.php'),
    APP_EVENTS_CACHE: isolatedCachePath('events.php'),
    MAIL_MAILER: 'outbox', MAIL_FROM_ADDRESS: 'e2e@example.test', MAIL_FROM_NAME: 'FluxAPI E2E',
    EMAIL_VERIFICATION_REQUIRED: 'false',
    CACHE_STORE: 'array', QUEUE_CONNECTION: 'sync', SESSION_DRIVER: 'array',
    BROADCAST_CONNECTION: 'log', FILESYSTEM_DISK: 'local',
    EXECUTOR_URL: `http://127.0.0.1:${executorPort}`, EXECUTOR_TOKEN: executorToken,
    EXECUTOR_APPROVED_HOSTS: 'jsonplaceholder.typicode.com,httpbin.org',
    RUN_RETENTION_DAYS: '30', LOG_CHANNEL: 'single', LOG_LEVEL: 'warning',
  };
  writeFileSync(resolve(workspace, 'api.env'), `${Object.entries(appEnv).map(([key, value]) => `${key}=${envValue(value)}`).join('\n')}\n`, { mode: 0o600, flag: 'wx' });

  return { suffix, database, username, password, appEnv, workspace, targetCredentialFile };
}

async function stopChildren() {
  for (const child of children) {
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      child.kill();
    } else {
      child.kill('SIGTERM');
    }
  }
  children.clear();
}

async function main() {
  await assertAvailablePort(8104);
  await assertAvailablePort(executorPort);
  await assertAvailablePort(3001);
  mkdirSync(runtimeRoot, { recursive: true });

  const suffix = randomBytes(6).toString('hex');
  const distDir = `.next-phase7-e2e-${suffix}`;
  buildNextIsolated(distDir);
  const target = await createIsolatedDatabase(suffix);
  const previewDir = resolve(previewRoot, target.suffix);
  mkdirSync(previewDir, { recursive: true });
  const apiEnv = { ...process.env, ...target.appEnv, NEXT_TELEMETRY_DISABLED: '1' };
  console.log(`Verified E2E target before migration: APP_ENV=e2e DB_DATABASE=${target.database} DB_USERNAME=${target.username} DB_HOST=127.0.0.1 DB_PORT=3307`);
  phpRun(['artisan', 'migrate', '--force', '--no-interaction'], apiEnv, 'Isolated E2E migrations');

  const executor = launch('isolated restricted executor', php, ['-S', `127.0.0.1:${executorPort}`, '-t', resolve(root, 'apps/executor/public'), resolve(root, 'apps/executor/public/index.php')], root, apiEnv);
  const executorExit = waitForExit(executor, 'Isolated restricted executor');
  await waitForPort(executorPort, 'Isolated restricted executor');
  const api = launch('isolated API', php, ['-S', '127.0.0.1:8104', '-t', resolve(apiPath, 'public'), resolve(apiPath, 'vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php')], resolve(apiPath, 'public'), apiEnv);
  const apiExit = waitForExit(api, 'Isolated API');
  await waitForHttp(`${apiOrigin}/api/v1/health`, 'Isolated API');
  const email = `phase7-demo-${target.suffix}@example.test`;
  const password = randomBytes(18).toString('hex');
  const registered = await fetch(`${apiOrigin}/api/v1/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Phase 7 E2E Owner', email, password, password_confirmation: password }),
  });
  if (registered.status !== 201) throw new Error(`Could not create the isolated E2E owner account (HTTP ${registered.status}).`);
  const adminFixture = spawnSync(mysqlClient, [`--defaults-extra-file=${target.targetCredentialFile}`, '--protocol=tcp', '-h127.0.0.1', '-P3307', `-D${target.database}`, '--batch', '--skip-column-names', '-e', `UPDATE users SET is_admin=1 WHERE email='${email}'; SELECT ROW_COUNT()`], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (adminFixture.error || adminFixture.status !== 0 || adminFixture.stdout.trim().split(/\r?\n/).at(-1) !== '1') {
    throw new Error('The isolated E2E account fixture could not be verified; tests were not run.');
  }
  writeFileSync(resolve(target.workspace, 'demo-account.json'), JSON.stringify({ email, password }, null, 2), { mode: 0o600, flag: 'wx' });

  const browserEnv = {
    ...process.env,
    API_ORIGIN: apiOrigin, WEB_ORIGIN: webOrigin,
    E2E_API_ORIGIN: apiOrigin, E2E_BASE_URL: webOrigin,
    E2E_ISOLATED_DB: '1', E2E_DATABASE_NAME: target.database, E2E_DATABASE_USER: target.username,
    E2E_DEMO_ACCOUNT_FILE: resolve(target.workspace, 'demo-account.json'),
    E2E_PREVIEW_DIR: previewDir,
    FLUXAPI_E2E_DIST_DIR: distDir,
    NEXT_TELEMETRY_DISABLED: '1',
  };
  const web = launch('isolated Next.js app', process.execPath, [resolve(webPath, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3001'], webPath, browserEnv);
  const webExit = waitForExit(web, 'Isolated Next.js app');
  await waitForHttp(webOrigin, 'Isolated Next.js app');

  const playwright = launch('Playwright', process.execPath, [resolve(webPath, 'node_modules/@playwright/test/cli.js'), 'test', ...process.argv.slice(2)], webPath, browserEnv);
  const result = await Promise.race([
    new Promise((resolvePromise) => playwright.once('exit', (code) => resolvePromise(code ?? 1))),
    executorExit,
    apiExit,
    webExit,
  ]);
  if (typeof result !== 'number') throw new Error('An isolated test server exited unexpectedly.');
  if (result !== 0) process.exitCode = result;
}

process.on('SIGINT', () => { void stopChildren().finally(() => process.exit(130)); });
process.on('SIGTERM', () => { void stopChildren().finally(() => process.exit(143)); });
try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await stopChildren();
}
