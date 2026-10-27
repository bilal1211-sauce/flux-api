import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname,'..');
const listing = spawnSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'});
if (listing.status !== 0) throw new Error(listing.stderr);
const files = [...new Set([...listing.stdout.split('\0').filter(Boolean),'docs/CHANGED_FILES.md'])].sort();
writeFileSync(resolve(root,'docs/CHANGED_FILES.md'),`# Delivered file inventory\n\nThe workspace was empty before implementation. These ${files.length} project files were created. Dependencies, generated runtime data, local credentials, databases, build output and Git internals are excluded.\n\n\`\`\`text\n${files.join('\n')}\n\`\`\`\n\nLocal-only runtime assets: \`.tools/\` contains PHP, Composer, MySQL and CA certificates; \`.runtime/\` contains private demo credentials, database data, service PIDs and logs. These are deliberately excluded from source control.\n`);
console.log(`File inventory updated: ${files.length} source/documentation assets.`);
