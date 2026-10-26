import { BALL_CATALOG, type BallInfo } from './balls.generated.js';
import { ITEM_CATALOG, type ItemCategory, type ItemInfo } from './items.generated.js';

export { Ball, BALL_CATALOG, type BallId, type BallInfo } from './balls.generated.js';
export { Item, ITEM_CATALOG, type ItemCategory, type ItemId, type ItemInfo } from './items.generated.js';

const itemsById = new Map<number, ItemInfo>(ITEM_CATALOG.map((item) => [item.id, item]));
const ballsById = new Map<number, BallInfo>(BALL_CATALOG.map((ball) => [ball.id, ball]));

/** What the catalog knows about an item id, or `undefined` for an id it has never seen (the game may add items). */
export const itemInfo = (id: number): ItemInfo | undefined => itemsById.get(id);

/** What the catalog knows about a ball id, or `undefined`. */
export const ballInfo = (id: number): BallInfo | undefined => ballsById.get(id);

/** All items of one category, in id order. */
export const itemsInCategory = (category: ItemCategory): readonly ItemInfo[] => ITEM_CATALOG.filter((item) => item.category === category);
