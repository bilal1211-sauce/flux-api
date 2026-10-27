import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const portable = resolve(root, '.tools/php/php.exe');
const php = process.env.PHP_BINARY || (existsSync(portable) ? portable : 'php');
const webPort = Number(process.env.WEB_PORT || 3000);
if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535) {
  console.error('WEB_PORT must be a valid TCP port.');
  process.exit(1);
}
if (existsSync(resolve(root,'.tools/mysql/mysql-8.4.11-winx64/bin/mysqld.exe')) && existsSync(resolve(root,'apps/api/.env')) && /^DB_CONNECTION=mysql/m.test(readFileSync(resolve(root,'apps/api/.env'),'utf8'))) {
  const mysql = spawnSync(process.execPath,[resolve(root,'scripts/mysql-local.mjs')],{ cwd:root, stdio:'inherit', windowsHide:true });
  if (mysql.status !== 0) process.exit(mysql.status || 1);
}
const detached = process.argv.includes('--background');
const children = [];
mkdirSync(resolve(root, '.runtime'), { recursive: true });
const launch = (name, binary, args, cwd) => {
  const pidFile = resolve(root, `.runtime/${name}.pid`);
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, 'utf8'));
    try { process.kill(pid, 0); return null; } catch { /* Stale PID; start again. */ }
  }
  const fd = detached ? openSync(resolve(root, `.runtime/${name}.log`), 'a') : null;
  const child = spawn(binary, args, { cwd, windowsHide: true, detached, stdio: detached ? ['ignore', fd, fd] : 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  children.push(child);
  child.on('error', e => console.error(`${name}: ${e.message}`));
  if (detached) { child.unref(); writeFileSync(pidFile, String(child.pid)); }
  return child;
};
// Start only project services; the portable MySQL process has its own lifecycle.
const health = await fetch('http://127.0.0.1:8100/api/v1/health').then(r => r.json()).then(j => j.data?.service === 'APIForge API').catch(() => false);
if (!health) launch('api', php, ['artisan','serve','--host=127.0.0.1','--port=8100','--no-reload'], resolve(root, 'apps/api'));
launch('executor', php, ['-S','127.0.0.1:8101','-t',resolve(root,'apps/executor/public'),resolve(root,'apps/executor/public/index.php')], root);
launch('worker', php, ['artisan','queue:work','--sleep=2','--tries=3','--timeout=65'], resolve(root, 'apps/api'));
launch('scheduler', php, ['artisan','schedule:work'], resolve(root, 'apps/api'));
const web = await fetch(`http://127.0.0.1:${webPort}`).then(r => r.ok).catch(() => false);
if (!web) launch('web', process.execPath, [resolve(root,'apps/web/node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',String(webPort)], resolve(root,'apps/web'));
console.log(`APIForge: http://127.0.0.1:${webPort} · API: http://127.0.0.1:8100/api/v1/health`);
if (!detached) {
  const stop = () => {
    for (const child of children) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio:'ignore' });
      else child.kill('SIGTERM');
    }
    process.exit();
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
