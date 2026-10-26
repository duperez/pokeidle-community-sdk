// Runs in the page's own world, before the game opens its socket (see manifest.json). READ-ONLY: it never sends anything.
import { Ball, Inspector, Item, PageTransport, PokeIdleClient } from 'pokeidle-community-sdk';

const inspector = new Inspector();
const client = new PokeIdleClient({ transport: new PageTransport(), inspector });
client.start();

// Handle for experiments in the DevTools console: window.__pokeidleSdk.inspector.dump()
(window as unknown as Record<string, unknown>).__pokeidleSdk = { client, inspector };

function mountOverlay(): void {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647;max-width:280px;max-height:40vh;overflow:auto;background:#1b1320;color:#eee;font:12px/1.4 system-ui,sans-serif;border:1px solid #555;border-radius:6px;padding:8px;opacity:.92';
  const title = document.createElement('div');
  title.style.fontWeight = '600';
  const list = document.createElement('div');
  const copy = document.createElement('button');
  copy.textContent = 'Copy redacted dump';
  copy.style.cssText = 'margin-top:6px;cursor:pointer';
  copy.addEventListener('click', () => void navigator.clipboard.writeText(JSON.stringify(inspector.dump(), null, 2)));
  // The game's catalogs (ball and shop lists) are game data, not account data: nothing about the player is in this copy.
  const copyCatalogs = document.createElement('button');
  copyCatalogs.textContent = 'Copy game catalogs';
  copyCatalogs.style.cssText = 'margin:6px 0 0 6px;cursor:pointer';
  copyCatalogs.addEventListener('click', () => void navigator.clipboard.writeText(JSON.stringify({ balls: client.state.ballCatalog, shopItems: client.state.shopItems, extraItems: client.state.extraItems }, null, 2)));
  // Actions: the first is a dry run (sends nothing); the second REALLY buys one Poke Ball (5 gold) to see the game confirm it.
  const lastAction = document.createElement('div');
  lastAction.style.cssText = 'margin-top:6px;white-space:pre-wrap;word-break:break-word;font-size:11px';
  const show = (label: string, result: unknown): void => { lastAction.textContent = `${label}: ${JSON.stringify(result)}`; };
  const dryRun = document.createElement('button');
  dryRun.textContent = 'Dry run: buy 1 Poke Ball';
  dryRun.style.cssText = 'margin-top:6px;cursor:pointer';
  dryRun.addEventListener('click', () => void client.actions.buyBall(Ball.PokeBall, 1, { dryRun: true }).then((r) => show('dry run', r)));
  const realBuy = document.createElement('button');
  realBuy.textContent = 'REALLY buy 1 Poke Ball (5 gold)';
  realBuy.style.cssText = 'margin:6px 0 0 6px;cursor:pointer';
  realBuy.addEventListener('click', () => void client.actions.buyBall(Ball.PokeBall, 1).then((r) => show('buy', r)));
  box.append(title, list, copy, copyCatalogs, document.createElement('br'), dryRun, realBuy, lastAction);
  document.documentElement.append(box);

  const render = (): void => {
    const { received, unknownTypes, unknownBattleEvents, unknownSentTypes, ignored } = inspector.dump();
    title.textContent = `SDK test · ${client.connected ? 'connected' : 'waiting for the socket'}`;
    const { state } = client;
    const rows: string[] = [];
    if (state.player && !state.complete) rows.push('PARTIAL STATE: the welcome packet was missed.\nReload the game page (F5) to receive it.', '');
    if (state.player) {
      // Just a look at what the SDK reads; this stays on your screen.
      rows.push(`level ${state.level} · gold ${state.gold} · diamonds ${state.diamonds}`);
      rows.push(`balls: ${state.ballCatalog.map((b) => `${b.name} ${state.ballCount(b.id)}`).join(', ') || '(no catalog yet)'}`);
      rows.push(`revives: ${state.itemCount(Item.Revive)} · max revives: ${state.itemCount(Item.MaxRevive)} · small potions: ${state.itemCount(Item.SmallPotion)}`);
      rows.push(`poke balls: ${state.ballCount(Ball.PokeBall)} · pokémon: ${state.player.pokemons.length}`);
      rows.push('');
    }
    rows.push(...Object.entries(received).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([type, n]) => `${type}: ${n}`));
    // What the game sends that the SDK does not know yet: a protocol change shows up here.
    if (unknownTypes.length) rows.push(`unknown packets: ${unknownTypes.join(', ')}`);
    if (unknownBattleEvents.length) rows.push(`unknown battle events: ${unknownBattleEvents.join(', ')}`);
    if (unknownSentTypes.length) rows.push(`unknown commands: ${unknownSentTypes.join(', ')}`);
    if (Object.keys(ignored).length) rows.push(`ignored frames: ${JSON.stringify(ignored)}`);
    list.textContent = rows.join('\n');
    list.style.whiteSpace = 'pre-wrap';
  };
  setInterval(render, 1000);
  render();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountOverlay, { once: true });
else mountOverlay();
