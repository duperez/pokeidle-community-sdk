import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createHash } from 'node:crypto';
import ts from 'typescript';

// The public API is whatever `src/index.ts` exports, values and types. Changing it must be a decision: this test fails
// on ANY difference in a name or in a type/member signature. After an intended change run `UPDATE_API_SNAPSHOT=1 npm test`, review the diff of the snapshot file
// and say it in the CHANGELOG.

const root = fileURLToPath(new URL('../', import.meta.url));
const snapshotPath = root + 'test/api-surface.snapshot.json';

/** Long types (the big unions of names) are kept as a fingerprint, so the snapshot stays readable and small. */
const brief = (text: string): string =>
  text.length <= 240
    ? text
    : `${text.slice(0, 80)}… [${text.length} chars, sha1 ${createHash('sha1').update(text).digest('hex').slice(0, 12)}]`;

/** One line per exported name with its full type; classes and interfaces list every member too. */
function publicSurface(): Record<string, string[]> {
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
  const flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias;
  const out: Record<string, string[]> = {};
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const real = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const decl = real.declarations?.[0];
    assert.ok(decl);
    const lines: string[] = [];
    if (real.flags & ts.SymbolFlags.Value) {
      lines.push(`value: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(real, decl), undefined, flags)}`);
    }
    if (real.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Enum)) {
      const declared = checker.getDeclaredTypeOfSymbol(real);
      lines.push(`type: ${checker.typeToString(declared, undefined, flags)}`);
      if (real.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface)) {
        for (const member of checker.getPropertiesOfType(declared)) {
          const memberDecl = member.declarations?.[0];
          if (memberDecl && ts.getCombinedModifierFlags(memberDecl) & ts.ModifierFlags.Private) continue;
          if (memberDecl && ts.isPropertyDeclaration(memberDecl) && ts.isPrivateIdentifier(memberDecl.name)) continue;
          const optional = member.flags & ts.SymbolFlags.Optional ? '?' : '';
          lines.push(
            `  ${member.name}${optional}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(member, decl), undefined, flags)}`,
          );
        }
      }
    }
    out[symbol.name] = lines.map(brief);
  }
  return Object.fromEntries(Object.entries(out).sort(([x], [y]) => x.localeCompare(y)));
}

test('the public API surface (names AND signatures) matches the committed snapshot', () => {
  const current = publicSurface();
  if (process.env['UPDATE_API_SNAPSHOT'] === '1') {
    writeFileSync(snapshotPath, JSON.stringify(current, null, 2) + '\n');
    return;
  }
  // A missing snapshot is a failure, never a silent re-creation.
  assert.ok(existsSync(snapshotPath), 'api-surface.snapshot.json is missing: run `UPDATE_API_SNAPSHOT=1 npm test` and commit it');
  const expected = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Record<string, string[]>;
  const names = (o: Record<string, unknown>) => Object.keys(o);
  assert.deepEqual(
    names(current).filter((n) => !(n in expected)),
    [],
    'new public exports (update the snapshot and the CHANGELOG if intended)',
  );
  assert.deepEqual(
    names(expected).filter((n) => !(n in current)),
    [],
    'public exports removed (breaking: update the snapshot and the CHANGELOG if intended)',
  );
  const changed = names(current).filter((n) => JSON.stringify(current[n]) !== JSON.stringify(expected[n]));
  assert.deepEqual(changed, [], 'the signature of these exports changed (update the snapshot and the CHANGELOG if intended)');
});
