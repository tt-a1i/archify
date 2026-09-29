import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
for(const city of ['shanghai','paris'])execFileSync(process.execPath,[fileURLToPath(new URL('./build.mjs',import.meta.url)),'--demo',city,'--output',fileURLToPath(new URL(`./demo/${city}.html`,import.meta.url))],{stdio:'inherit'});
