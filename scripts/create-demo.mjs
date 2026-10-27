import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const file = resolve(root, '.runtime/demo-account.json');
if (existsSync(file)) { console.log('Local account already exists. Credentials: .runtime/demo-account.json'); process.exit(0); }
const email = 'bilal@apiforge.local';
const password = `Forge-${randomBytes(9).toString('base64url')}-7`;
const response = await fetch('http://127.0.0.1:8100/api/v1/auth/register', { method:'POST', headers: { 'Content-Type':'application/json', Accept:'application/json' }, body: JSON.stringify({ name:'Bilal', email, password, password_confirmation:password }) });
const json = await response.json();
if (!response.ok) throw new Error(json.message || 'Account could not be created.');
const php = resolve(root, '.tools/php/php.exe');
const promoted = spawnSync(existsSync(php) ? php : 'php', ['artisan','apiforge:admin',email], { cwd:resolve(root,'apps/api'), encoding:'utf8', windowsHide:true });
if (promoted.status !== 0) throw new Error(promoted.stderr || promoted.stdout);
mkdirSync(resolve(root,'.runtime'),{ recursive:true });
writeFileSync(file, JSON.stringify({ url:'http://127.0.0.1:3000',email,password,access:'Local platform administrator. Do not reuse in a public deployment.' },null,2)+'\n');
console.log('Local account ready; credentials saved privately to .runtime/demo-account.json');
