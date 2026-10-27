#!/usr/bin/env node
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SDK = fileURLToPath(new URL('../packages/sdk/', import.meta.url));
const DIST = path.join(SDK, 'dist');
const TYPES = path.join(DIST, 'cjs');

const common = {
  absWorkingDir: SDK,
  entryPoints: [path.join(SDK, 'src/index.ts')],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
};

await Promise.all([
  build({ ...common, outfile: path.join(DIST, 'index.cjs'), format: 'cjs' }),
  build({
    ...common,
    outfile: path.join(DIST, 'pokeidle-sdk.iife.js'),
    format: 'iife',
    globalName: 'PokeIdleSDK',
    minify: true,
  }),
]);

// CJS declarations need their own package scope; their relative .js imports resolve to the adjacent .d.ts files.
function copyDeclarations(directory, relative = '') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'cjs' && relative === '') continue;
    const source = path.join(directory, entry.name);
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) copyDeclarations(source, name);
    else if (entry.name.endsWith('.d.ts')) {
      const target = path.join(TYPES, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const declaration = fs.readFileSync(source, 'utf8').replace(/^\/\/# sourceMappingURL=.*\n?/gm, '');
      fs.writeFileSync(target, declaration);
    }
  }
}

copyDeclarations(DIST);
fs.writeFileSync(path.join(TYPES, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
