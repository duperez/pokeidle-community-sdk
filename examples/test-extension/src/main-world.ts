// Runs in the page's own world, before the game opens its socket (see manifest.json). READ-ONLY: it never sends anything.
import { Inspector, PageTransport, PokeIdleClient } from 'pokeidle-community-sdk';

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
  box.append(title, list, copy);
  document.documentElement.append(box);

  const render = (): void => {
    const { received, unknownTypes } = inspector.dump();
    title.textContent = `SDK test · ${client.connected ? 'connected' : 'waiting for the socket'}`;
    const rows = Object.entries(received).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([type, n]) => `${type}: ${n}`);
    list.textContent = rows.join('\n');
    list.style.whiteSpace = 'pre';
    if (unknownTypes.length) list.textContent += `\nunknown: ${unknownTypes.join(', ')}`;
  };
  setInterval(render, 1000);
  render();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountOverlay, { once: true });
else mountOverlay();
