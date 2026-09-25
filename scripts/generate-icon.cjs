'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

const assetDir = path.join(__dirname, '..', 'desktop', 'assets');
const source = fs.readFileSync(path.join(assetDir, 'dumbpark.svg'));
const sizes = [16, 32, 48, 256];
const images = sizes.map(size => new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng());

fs.writeFileSync(path.join(assetDir, 'dumbpark.png'),
  new Resvg(source, { fitTo: { mode: 'width', value: 512 } }).render().asPng());

const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((png, index) => {
  const entry = 6 + index * 16;
  header[entry] = sizes[index] === 256 ? 0 : sizes[index];
  header[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
  header[entry + 2] = 0;
  header[entry + 3] = 0;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
fs.writeFileSync(path.join(assetDir, 'dumbpark.ico'), Buffer.concat([header, ...images]));
