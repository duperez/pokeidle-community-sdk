import assert from 'node:assert/strict';
import test from 'node:test';
import { identifierFor, uniqueIdentifiers } from '../scripts/generate-catalog.mjs';

test('identifierFor builds PascalCase identifiers from names', () => {
  assert.equal(identifierFor('Air Tank'), 'AirTank');
  assert.equal(identifierFor("Farfetch'd Stick"), 'FarfetchdStick');
  assert.equal(identifierFor('Normal-Type TM Disk'), 'NormalTypeTMDisk');
  assert.equal(identifierFor('Poke Ball'), 'PokeBall');
  assert.equal(identifierFor('Poké Ball'), 'PokeBall'); // accents are dropped, not the whole letter
});

test('a name that starts with a digit gets an underscore, so the key is a valid identifier', () => {
  assert.equal(identifierFor('10000 Carat Emerald'), '_10000CaratEmerald');
});

test('uniqueIdentifiers keeps the clean key on the lowest id and suffixes the rest, regardless of input order', () => {
  const entries = [{ id: 59248, name: 'Band Aid' }, { id: 5, name: 'Band-Aid' }, { id: 7, name: 'Bee Sting' }];
  const keys = Object.fromEntries(uniqueIdentifiers(entries).map((e) => [e.id, e.key]));
  assert.deepEqual(keys, { 5: 'BandAid', 7: 'BeeSting', 59248: 'BandAid_59248' });
});

test('a name with no letters or digits is rejected instead of producing a broken key', () => {
  assert.throws(() => uniqueIdentifiers([{ id: 1, name: '???' }]), /cannot build an identifier/);
});

test('mergeItems adds the game\'s own items and lets the public catalog win on a shared id', async () => {
  const { mergeItems } = await import('../scripts/generate-catalog.mjs');
  const merged = mergeItems([{ id: 1, name: 'Public' }], [{ id: 1, name: 'Duplicate' }, { id: 70000, name: 'Own' }]);
  assert.deepEqual(merged.map((i) => [i.id, i.name]), [[1, 'Public'], [70000, 'Own']]);
});
