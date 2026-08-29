import fs from 'node:fs';
import path from 'node:path';

const publicDir = path.join(process.cwd(), 'public', 'monaco-editor', 'min', 'vs');
const required = [
  'loader.js',
  'editor/editor.main.js',
  'base/worker/workerMain.js',
];

let missing = [];
for (const rel of required) {
  const p = path.join(publicDir, rel);
  if (!fs.existsSync(p)) missing.push(rel);
}

if (missing.length > 0) {
  console.error('[verify-monaco-assets] missing required Monaco files:');
  for (const m of missing) console.error('  - ' + m);
  console.error('[verify-monaco-assets] the installed monaco-editor layout may have changed; update copy:monaco or pin to a compatible version.');
  process.exit(1);
}

console.log('[verify-monaco-assets] all required Monaco files present.');
