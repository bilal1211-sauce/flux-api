import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const bin = resolve(root, '.tools/mysql/mysql-8.4.11-winx64/bin');
const credentials = resolve(root, '.runtime/mysql-client.cnf');
if (!/^port=3307$/m.test(readFileSync(credentials,'utf8'))) throw new Error('This helper is only for the project-local database on port 3307.');
const defaults = `--defaults-extra-file=${credentials}`;
const directory = resolve(root, '.backups');
mkdirSync(directory, {recursive:true});
const filename = resolve(directory, `apiforge-${new Date().toISOString().replace(/[:.]/g,'-')}.sql.gz`);
function completed(child) {
  let error = '';
  child.stderr.on('data', chunk => { error += chunk; });
  return new Promise((done, fail) => {
    child.on('error',fail);
    child.on('close', code => code === 0 ? done() : fail(new Error(`MySQL exited ${code}: ${error}`)));
  });
}
const dump = spawn(resolve(bin,'mysqldump.exe'),[defaults,'--single-transaction','--no-tablespaces','--set-gtid-purged=OFF','apiforge'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
await Promise.all([completed(dump),pipeline(dump.stdout,createGzip(),createWriteStream(filename,{mode:0o600,flags:'wx'}))]);
console.log(`Backup created: ${filename}`);
if (process.argv.includes('--verify')) {
  const database = `apiforge_restore_check_${randomBytes(8).toString('hex')}`;
  if (!/^apiforge_restore_check_[a-f0-9]{16}$/.test(database)) throw new Error('Unexpected restore verification database name.');
  const sql = text => {
    const result = spawnSync(resolve(bin,'mysql.exe'),[defaults,'--batch','--skip-column-names'],{input:text,encoding:'utf8',windowsHide:true});
    if(result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  sql(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  try {
    const restore = spawn(resolve(bin,'mysql.exe'),[defaults,database],{windowsHide:true,stdio:['pipe','ignore','pipe']});
    await Promise.all([completed(restore),pipeline(createReadStream(filename),createGunzip(),restore.stdin)]);
    const restoredTables = sql(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${database}'`);
    if (Number(restoredTables) < 20) throw new Error('The restored database is missing application tables.');
    const original = sql('SELECT id,SHA2(value,256) FROM apiforge.environment_variables ORDER BY id');
    const restored = sql(`SELECT id,SHA2(value,256) FROM ${database}.environment_variables ORDER BY id`);
    const currentRows = new Set(original.split(/\r?\n/));
    if (!restored.split(/\r?\n/).every(row => currentRows.has(row))) throw new Error('Encrypted variable data differs after restore.');
    console.log(`Restore verified in a temporary database: ${restoredTables} tables; encrypted variables match.`);
  } finally {
    sql(`DROP DATABASE ${database}`);
  }
}
console.log('Keep a separate protected backup of apps/api/.env and APP_KEY. Database backups contain private data.');
