import assert from 'node:assert/strict';
import test from 'node:test';
import { BALL_CATALOG, Ball, ITEM_CATALOG, Item, ballInfo, itemInfo, itemsInCategory } from '../src/index.js';

test('well-known ids are reachable by name', () => {
  assert.equal(Item.SmallPotion, 200);
  assert.equal(Item.Revive, 205);
  assert.equal(Item.MaxRevive, 206);
  assert.equal(Ball.PokeBall, 1);
  assert.equal(Ball.GreatBall, 2);
  assert.equal(Ball.UltraBall, 4);
  assert.equal(Ball.BeastBall, 5);
});

test('itemInfo and ballInfo describe known ids and return undefined for unknown ones', () => {
  assert.deepEqual(itemInfo(Item.SmallPotion), { id: 200, name: 'Small Potion', category: 'heal', rare: false, npcPrice: itemInfo(200)?.npcPrice ?? null });
  assert.equal(itemInfo(999_999_999), undefined);
  assert.equal(ballInfo(Ball.GreatBall)?.name, 'Great Ball');
  assert.deepEqual(ballInfo(Ball.BeastBall), { id: 5, name: 'Beast Ball', catchRate: 8, priceGold: null, buyable: false }); // not sold in the market
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

test('the game\'s own items (not in the public catalog) are part of Item, with their categories', () => {
  assert.equal(Item.BronzeBossToken, 70000); // from the public catalog
  assert.equal(Item.EscapeRope, 70010); // from the game's own list
  assert.equal(Item.MysteryEggP2, 70091);
  assert.equal(Item.Venusaurite, 71003);
  assert.equal(Item.ShinyVenusaurite, 72003);
  assert.equal(Item.CharizarditeX, 74006);
  assert.equal(itemInfo(Item.CommonHouse)?.category, 'casa');
  assert.equal(itemInfo(Item.FounderBox)?.category, 'caixa');
  assert.equal(itemInfo(Item.VenusaurHalloweenSkin)?.category, 'skin');
  assert.equal(itemInfo(Item.GoldenPotion)?.npcPrice, 2500);
  assert.equal(itemsInCategory('bicicleta').length, 5);
});

test('every shiny mega stone is its normal stone plus 1000 in id, with the "Shiny" prefix', () => {
  const stones = ITEM_CATALOG.filter((i) => i.category === 'stone' && i.id >= 71000 && i.id < 72000);
  assert.ok(stones.length >= 88);
  for (const stone of stones) {
    const shiny = itemInfo(stone.id + 1000);
    assert.equal(shiny?.name, `Shiny ${stone.name}`, stone.name);
  }
});
