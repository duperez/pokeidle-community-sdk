import assert from 'node:assert/strict';
import test from 'node:test';
import { BALL_CATALOG, Ball, ITEM_CATALOG, Item, ballInfo, itemInfo, itemsInCategory } from '../src/index.js';

test('well-known ids are reachable by name', () => {
  assert.equal(Item.SmallPotion, 200);
  assert.equal(Item.Revive, 205);
  assert.equal(Item.MaxRevive, 206);
  assert.equal(Ball.PokeBall, 1);
  assert.equal(Ball.GreatBall, 2);
});

test('itemInfo and ballInfo describe known ids and return undefined for unknown ones', () => {
  assert.deepEqual(itemInfo(Item.SmallPotion), { id: 200, name: 'Small Potion', category: 'heal', rare: false, npcPrice: itemInfo(200)?.npcPrice ?? null });
  assert.equal(itemInfo(999_999_999), undefined);
  assert.equal(ballInfo(Ball.GreatBall)?.name, 'Great Ball');
  assert.equal(ballInfo(-1), undefined);
});

test('itemsInCategory returns the items of one category', () => {
  const revives = itemsInCategory('revive');
  assert.deepEqual(revives.map((i) => i.id), [Item.Revive, Item.MaxRevive]);
  assert.ok(itemsInCategory('heal').every((i) => i.category === 'heal'));
});

test('the Item enum and the catalog describe exactly the same ids, with no duplicates', () => {
  const enumIds = Object.values(Item).sort((a, b) => a - b);
  const catalogIds = ITEM_CATALOG.map((i) => i.id).sort((a, b) => a - b);
  assert.deepEqual(enumIds, catalogIds);
  assert.equal(new Set(catalogIds).size, catalogIds.length);
  assert.deepEqual(Object.values(Ball).sort(), BALL_CATALOG.map((b) => b.id).sort());
});

test('items that share a name keep the clean key on the lowest id and the others get the id as a suffix', () => {
  assert.equal(Item.PotOfLava, 100);
  assert.equal(Item.PotOfLava_101, 101);
  assert.equal(Item.BandAid, 5);
  assert.equal(Item.BandAid_59248, 59248);
  assert.equal(Item._10000CaratEmerald, 27304);
});
