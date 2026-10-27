import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const portable = resolve(root, '.tools/php/php.exe');
const php = process.env.PHP_BINARY || (existsSync(portable) ? portable : 'php');
const child = spawnSync(php, process.argv.slice(2), { cwd: resolve(root, 'apps/api'), stdio: 'inherit' });
if (child.error) console.error(child.error.message);
process.exit(child.status ?? 1);
