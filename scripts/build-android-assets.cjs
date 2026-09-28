'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const output = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'www');
fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(path.join(root, 'ui'), output, { recursive: true });
esbuild.buildSync({
  entryPoints: [path.join(root, 'android', 'adapter-entry.cjs')],
  outfile: path.join(output, 'adapter.js'),
  bundle: true,
  minify: true,
  platform: 'browser',
  target: 'es2022'
});
