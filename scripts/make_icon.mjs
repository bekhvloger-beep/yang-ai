// Generates renderer/icon.ico (256x256) using the zero-dep PNG writer.
import fs from 'node:fs';
import path from 'node:path';
import { createPng, pngToIco } from '../agent/formats.js';

const hexagon = (cx, cy, r) => {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push([Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))]);
  }
  return pts;
};

const S = 256;
const png = createPng({
  width: S,
  height: S,
  background: '#101423',
  ops: [
    { op: 'rect', x: 0, y: 0, w: S, h: 6, color: '#6c8cff' },
    { op: 'rect', x: 0, y: S - 6, w: S, h: 6, color: '#35c39a' },
    { op: 'polygon', points: hexagon(128, 128, 104), color: '#6c8cff', fill: true },
    { op: 'polygon', points: hexagon(128, 128, 80), color: '#101423', fill: true },
    { op: 'polygon', points: hexagon(128, 128, 56), color: '#6c8cff', fill: true },
    { op: 'text', x: 128 - 18, y: 128 - 30, text: 'Y', color: '#ffffff', scale: 12 },
  ],
});

const ico = pngToIco(png);
const out = path.resolve(import.meta.dirname, '..', 'renderer', 'icon.ico');
fs.writeFileSync(out, ico);
console.log('icon written:', out, ico.length, 'bytes');
// also keep a png copy for docs
fs.writeFileSync(path.resolve(import.meta.dirname, '..', 'renderer', 'icon.png'), png);
