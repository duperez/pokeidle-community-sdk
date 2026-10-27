import assert from 'node:assert/strict';
import test from 'node:test';
import { Item, itemInfo, npcShopPrice } from '../src/index.js';

test('npcShopPrice: the potions and revives the NPC shop sells, and null for everything else', () => {
  assert.equal(npcShopPrice(Item.SmallPotion), 50);
  assert.equal(npcShopPrice(205), 600);
  assert.equal(npcShopPrice(999_999), null);
  assert.equal(npcShopPrice(-1), null);
});

test('npcShopPrice is narrower than the catalog npcPrice: rare heal/revive items with an npcPrice are NOT sold', () => {
  // Max Revive (206) and Golden Potion (70070) carry an npcPrice in the catalog but no shop sells them.
  for (const id of [206, 70070]) {
    assert.ok((itemInfo(id)?.npcPrice ?? 0) > 0, `the catalog gives item ${id} an npcPrice`);
    assert.equal(npcShopPrice(id), null, `but the NPC shop does not sell item ${id}`);
  }
});
