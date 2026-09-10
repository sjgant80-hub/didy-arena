#!/usr/bin/env node
// make-page.mjs — the one-kernel rule: index.html carries the REAL kernel.mjs between
// markers, injected by this script and never hand-edited. CI re-runs this and diffs;
// a page whose logic drifted from the gated kernel fails the build.
import { readFileSync, writeFileSync } from 'node:fs';

const kernel = readFileSync(new URL('./kernel.mjs', import.meta.url), 'utf8')
  .replace(/^export /gm, '')
  .replace(/\r\n/g, '\n')
  .trimEnd();

const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const BEGIN = '// ⟦KERNEL-BEGIN⟧ generated from kernel.mjs by make-page.mjs — do not edit here';
const END = '// ⟦KERNEL-END⟧';
const a = page.indexOf(BEGIN), b = page.indexOf(END);
if (a === -1 || b === -1 || b < a) { console.error('markers missing or reversed in index.html'); process.exit(1); }
const next = page.slice(0, a + BEGIN.length) + '\n' + kernel + '\n' + page.slice(b);
writeFileSync(new URL('./index.html', import.meta.url), next);
console.log('kernel injected: ' + kernel.length + ' chars between the markers');
