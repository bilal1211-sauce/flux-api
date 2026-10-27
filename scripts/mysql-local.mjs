import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const bin = resolve(root, '.tools/mysql/mysql-8.4.11-winx64/bin');
const runtime = resolve(root, '.runtime');
const data = resolve(runtime, 'mysql-data');
mkdirSync(runtime, { recursive: true });
const existingCredentials = resolve(runtime, 'mysql-client.cnf');
if (existsSync(existingCredentials)) {
  const probe = spawnSync(resolve(bin, 'mysql.exe'), [`--defaults-extra-file=${existingCredentials}`, '-e', 'SELECT VERSION()'], { windowsHide:true, encoding:'utf8' });
  if (probe.status === 0) { console.log('Project MySQL is already running on 127.0.0.1:3307.'); process.exit(0); }
}
if (!existsSync(resolve(bin, 'mysqld.exe'))) throw new Error('Download the official MySQL 8.4.11 Windows ZIP into .tools/mysql first.');
if (!existsSync(data)) {
  const init = spawnSync(resolve(bin, 'mysqld.exe'), ['--no-defaults', '--initialize-insecure', `--basedir=${resolve(bin, '..')}`, `--datadir=${data}`], { windowsHide: true, encoding: 'utf8' });
  if (init.status !== 0) throw new Error(init.stderr);
}
const log = openSync(resolve(runtime, 'mysql.log'), 'a');
const db = spawn(resolve(bin, 'mysqld.exe'), ['--no-defaults', `--basedir=${resolve(bin, '..')}`, `--datadir=${data}`, '--bind-address=127.0.0.1', '--port=3307', '--mysqlx=0', '--console'], { detached: true, windowsHide: true, stdio: ['ignore', log, log] });
db.unref();
writeFileSync(resolve(runtime, 'mysql.pid'), String(db.pid));
const credentialsFile = resolve(runtime, 'mysql-client.cnf');
let ready = false;
for (let i = 0; i < 90; i++) {
  const args = existsSync(credentialsFile) ? [`--defaults-extra-file=${credentialsFile}`] : ['--no-defaults', '-h127.0.0.1', '-P3307', '-uroot'];
  const ping = spawnSync(resolve(bin, 'mysql.exe'), [...args, '-e', 'SELECT 1'], { windowsHide: true, encoding: 'utf8' });
  if (ping.status === 0) { ready = true; break; }
  await new Promise(r => setTimeout(r, 1000));
}
if (!ready) throw new Error('MySQL did not become ready. Check .runtime/mysql.log.');
if (!existsSync(credentialsFile)) {
  const rootPassword = randomBytes(24).toString('hex');
  const appPassword = randomBytes(24).toString('hex');
  const sql = `CREATE DATABASE IF NOT EXISTS apiforge CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'apiforge'@'127.0.0.1' IDENTIFIED BY '${appPassword}'; GRANT ALL ON apiforge.* TO 'apiforge'@'127.0.0.1'; ALTER USER 'root'@'localhost' IDENTIFIED BY '${rootPassword}';`;
  const setup = spawnSync(resolve(bin, 'mysql.exe'), ['--no-defaults','-h127.0.0.1','-P3307','-uroot'], { input: sql, windowsHide: true, encoding: 'utf8' });
  if (setup.status !== 0) throw new Error(setup.stderr);
  writeFileSync(credentialsFile, `[client]\nhost=127.0.0.1\nport=3307\nuser=root\npassword=${rootPassword}\n`);
  const envFile = resolve(root, 'apps/api/.env');
  let env = readFileSync(envFile, 'utf8');
  for (const [key, value] of Object.entries({APP_NAME:'APIForge',APP_URL:'http://127.0.0.1:8100',DB_CONNECTION:'mysql',DB_HOST:'127.0.0.1',DB_PORT:'3307',DB_DATABASE:'apiforge',DB_USERNAME:'apiforge',DB_PASSWORD:appPassword,QUEUE_CONNECTION:'database',CACHE_STORE:'database',REDIS_CLIENT:'predis'})) {
    const pattern = new RegExp(`^#? ?${key}=.*$`, 'm');
    env = pattern.test(env) ? env.replace(pattern, `${key}=${value}`) : `${env}\n${key}=${value}`;
  }
  writeFileSync(envFile, env);
}
console.log('MySQL 8.4 is ready at 127.0.0.1:3307; app database and isolated credentials configured.');
