import { spawnSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const php = process.env.PHP_BINARY || (existsSync(resolve(root,'.tools/php/php.exe')) ? resolve(root,'.tools/php/php.exe') : 'php');
function run(cmd, args, cwd = root) { const result = spawnSync(cmd, args, { cwd, stdio:'inherit', windowsHide: true, shell: process.platform === 'win32' && cmd.endsWith('.cmd') }); if (result.status !== 0) throw new Error(`Setup failed: ${cmd}`); }
for (const app of ['api','web']) {
  const dest = resolve(root, `apps/${app}/${app === 'api' ? '.env' : '.env.local'}`);
  if (!existsSync(dest)) copyFileSync(resolve(root, `apps/${app}/.env.example`), dest);
}
const composer = resolve(root,'.tools/composer.phar');
if (existsSync(composer)) run(php, [composer,'install','--no-interaction'], resolve(root,'apps/api'));
else run(process.platform === 'win32' ? 'composer.bat' : 'composer', ['install','--no-interaction'], resolve(root,'apps/api'));
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci'], resolve(root,'apps/web'));
const fs = await import('node:fs');
const envFile = resolve(root,'apps/api/.env');
let envText = fs.readFileSync(envFile,'utf8');
if (!/^EXECUTOR_TOKEN=.+/m.test(envText)) {
  const token = randomBytes(32).toString('hex');
  envText = /^EXECUTOR_TOKEN=/m.test(envText) ? envText.replace(/^EXECUTOR_TOKEN=.*$/m, `EXECUTOR_TOKEN=${token}`) : `${envText}\nEXECUTOR_TOKEN=${token}\n`;
  fs.writeFileSync(envFile, envText);
}
if (/^DB_CONNECTION=mysql/m.test(envText) && existsSync(resolve(root,'.tools/mysql/mysql-8.4.11-winx64/bin/mysqld.exe'))) run(process.execPath,[resolve(root,'scripts/mysql-local.mjs')]);
if (/^DB_CONNECTION=sqlite/m.test(envText) && !existsSync(resolve(root,'apps/api/database/database.sqlite'))) (await import('node:fs')).writeFileSync(resolve(root,'apps/api/database/database.sqlite'),'');
if (!/^APP_KEY=.+/m.test(envText)) run(php,['artisan','key:generate'],resolve(root,'apps/api'));
run(php,['artisan','migrate','--force'],resolve(root,'apps/api'));
console.log('Dependencies installed and database migrated. Run npm run dev.');
