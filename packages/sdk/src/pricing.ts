import type { ActionsState } from './actions-host.js';
import { NPC_SHOP_ITEMS } from './catalog/npc-shop.generated.js';

/** What the NPC shop charges per unit, or `null` with the reason when the SDK cannot say it sells this. */
export function priceOf(state: ActionsState, kind: 'ball' | 'item', id: number): { unit: number | null; reason?: string } {
  if (kind === 'ball') {
    const ball = state.ballCatalog.find((b) => b.id === id);
    if (!ball) return { unit: null, reason: `the server's ball catalog has no ball ${id}` };
    if (!ball.buyable || ball.priceGold === null || ball.priceGold <= 0)
      return { unit: null, reason: `${ball.name} is not sold in the shop` };
    return { unit: ball.priceGold };
  }
  const offered = state.shopItems.find((s) => s.itemId === id);
  if (offered)
    return offered.price === null || offered.price <= 0 ? { unit: null, reason: `${offered.name} has no price` } : { unit: offered.price };
  // Potions and revives: the NPC shop sells them at the catalog's `npcPrice` (checked against real purchases).
  const npc = NPC_SHOP_ITEMS.find((i) => i.id === id);
  return npc ? { unit: npc.price } : { unit: null, reason: `item ${id} is not an item the NPC shop is known to sell` };
}
