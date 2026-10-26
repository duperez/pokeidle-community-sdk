import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

// The public API is whatever `src/index.ts` exports, values and types. Changing it must be a decision: this test fails
// on ANY difference. After an intended change run `UPDATE_API_SNAPSHOT=1 npm test`, review the diff of the snapshot file
// and say it in the CHANGELOG.

const root = fileURLToPath(new URL('../', import.meta.url));
const snapshotPath = root + 'test/api-surface.snapshot.json';

function publicSurface(): string[] {
  const program = ts.createProgram([root + 'src/index.ts'], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    skipLibCheck: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const entry = program.getSourceFile(root + 'src/index.ts');
  assert.ok(entry);
  const moduleSymbol = checker.getSymbolAtLocation(entry);
  assert.ok(moduleSymbol);
  return checker
    .getExportsOfModule(moduleSymbol)
    .map((symbol) => {
      const real = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      return `${symbol.name} (${real.flags & ts.SymbolFlags.Value ? 'value' : 'type'})`;
    })
    .sort();
}

test('the public API surface matches the committed snapshot', () => {
  const current = publicSurface();
  if (process.env['UPDATE_API_SNAPSHOT'] === '1' || !existsSync(snapshotPath)) {
    writeFileSync(snapshotPath, JSON.stringify(current, null, 2) + '\n');
    return;
  }
  const expected = JSON.parse(readFileSync(snapshotPath, 'utf8')) as string[];
  assert.deepEqual(
    current.filter((n) => !expected.includes(n)),
    [],
    'new public exports (update the snapshot and the CHANGELOG if intended)',
  );
  assert.deepEqual(
    expected.filter((n) => !current.includes(n)),
    [],
    'public exports removed (a breaking change: update the snapshot and the CHANGELOG if intended)',
  );
});
