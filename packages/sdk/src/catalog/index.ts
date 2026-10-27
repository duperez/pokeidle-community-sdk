import { BALL_CATALOG, type BallInfo } from './balls.generated.js';
import { ITEM_CATALOG, type ItemCategory, type ItemInfo } from './items.generated.js';

export { Ball, BALL_CATALOG, type BallId, type BallInfo } from './balls.generated.js';
export { Item, ITEM_CATALOG, type ItemCategory, type ItemId, type ItemInfo } from './items.generated.js';

// Built on first use, not at import: a module-level `new Map(...)` is a side effect a bundler cannot drop, and would keep
// the whole catalog in every bundle that merely imports this package.
let itemsById: Map<number, ItemInfo> | undefined;
let ballsById: Map<number, BallInfo> | undefined;

/** What the catalog knows about an item id, or `undefined` for an id it has never seen (the game may add items). */
export const itemInfo = (id: number): ItemInfo | undefined => {
  itemsById ??= new Map(ITEM_CATALOG.map((item) => [item.id, item]));
  return itemsById.get(id);
};

/** What the catalog knows about a ball id, or `undefined`. */
export const ballInfo = (id: number): BallInfo | undefined => {
  ballsById ??= new Map(BALL_CATALOG.map((ball) => [ball.id, ball]));
  return ballsById.get(id);
};

/** All items of one category, in id order. */
export const itemsInCategory = (category: ItemCategory): readonly ItemInfo[] => ITEM_CATALOG.filter((item) => item.category === category);
