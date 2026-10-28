import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// A browser extension ships this code to every page it runs on. The client and the page transport (what every extension
// needs) must stay small: the big catalogs and the protocol registry are opt-in imports, so they must not be pulled in.

const BUDGET_BYTES = 40 * 1024; // about 30 KB today (it was 133 KB before the catalogs became opt-in)
const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));

async function bundle(code: string): Promise<{ bytes: number; text: string }> {
  const result = await build({
    stdin: { contents: code, resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts' },
    bundle: true,
    minify: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'chrome111',
    logLevel: 'silent',
  });
  const out = result.outputFiles[0];
  assert.ok(out);
  return { bytes: out.contents.length, text: out.text };
}

test(`standalone shared client bundle under ${BUDGET_BYTES / 1024} KB minified`, async () => {
  const { bytes, text } = await bundle(`import { PokeIdleClient } from ${JSON.stringify(entry)};
    new PokeIdleClient().start();`);
  assert.ok(bytes < BUDGET_BYTES, `${(bytes / 1024).toFixed(1)} KB, budget ${BUDGET_BYTES / 1024} KB`);
  assert.equal(text.includes('Armadillo Claw'), false, 'the full items catalog leaked into the client bundle');
});

test('importing the catalog is what brings the catalog in', async () => {
  const { text } = await bundle(`import { itemInfo } from ${JSON.stringify(entry)}; console.log(itemInfo(3));`);
  assert.equal(text.includes('Armadillo Claw'), true);
});
