'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const output = path.join(root, 'dist-web');
fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(path.join(root, 'ui'), output, { recursive: true });
fs.writeFileSync(path.join(output, '.nojekyll'), '');

esbuild.buildSync({
  entryPoints: [path.join(root, 'web', 'adapter-entry.cjs')],
  outfile: path.join(output, 'adapter.js'),
  bundle: true,
  minify: true,
  platform: 'browser',
  target: 'es2022'
});

const fingerprint = file => crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(output, file))).digest('hex').slice(0, 12);
let html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
for (const file of ['styles.css', 'adapter.js', 'renderer.js']) {
  html = html.replace(`"${file}"`, `"${file}?v=${fingerprint(file)}"`);
}
fs.writeFileSync(path.join(output, 'index.html'), html);
