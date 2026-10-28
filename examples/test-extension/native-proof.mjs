/* global proof, __proofA, __proofB, location */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv.includes('--help')) {
  process.stdout.write(
    'Usage: SDK_PROOF_TOOLS=/absolute/disposable/tool-directory node examples/test-extension/native-proof.mjs\n' +
      'Requires ws and playwright in that directory, plus its installed Chromium. Starts owned loopback/browser helpers.\n' +
      'Run only in the coordinator-reserved serial window, after building the SDK. No game URL is accessed.\n',
  );
} else {
  await run();
}

async function run() {
  const stages = [];
  let context;
  let server;
  let sockets;
  let directory;
  let pendingUpgrade;
  let report;
  try {
    const tools = process.env.SDK_PROOF_TOOLS;
    assert.ok(tools && path.isAbsolute(tools), 'proof-tools-required');
    const requireTools = createRequire(path.join(tools, 'package.json'));
    const { chromium } = requireTools('playwright');
    const { WebSocketServer } = requireTools('ws');
    const bundlePath = fileURLToPath(new URL('../../packages/sdk/dist/pokeidle-sdk.iife.js', import.meta.url));
    const bundle = await fs.readFile(bundlePath, 'utf8');
    const hash = (text) => createHash('sha256').update(text).digest('hex');
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pokeidle-native-proof-'));
    const extension = path.join(directory, 'extension');
    await fs.mkdir(extension);
    const wrapperA = `${bundle}\n;globalThis.__proofA = PokeIdleSDK; __proofA.bootstrapPageSession(); globalThis.__proofEarly = true;\n`;
    const wrapperB = `${bundle}\n;globalThis.__proofB = PokeIdleSDK; __proofB.bootstrapPageSession();\n`;
    await Promise.all([
      fs.writeFile(path.join(extension, 'a.js'), wrapperA),
      fs.writeFile(path.join(extension, 'b.js'), wrapperB),
      fs.writeFile(
        path.join(extension, 'manifest.json'),
        JSON.stringify({
          manifest_version: 3,
          name: 'Local SDK proof fixture',
          version: '0.0.1',
          content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['a.js', 'b.js'], world: 'MAIN', run_at: 'document_start' }],
        }),
      ),
    ]);

    const peers = [];
    const frames = [];
    let upgradeCount = 0;
    let requestSuccessor;
    const successorRequested = new Promise((resolve) => (requestSuccessor = resolve));
    let receiveCommand;
    const commandReceived = new Promise((resolve) => (receiveCommand = resolve));
    sockets = new WebSocketServer({ noServer: true });
    server = http.createServer((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end(`<!doctype html><meta charset="utf-8"><title>Local SDK proof</title><script>
        globalThis.proof = {early:globalThis.__proofEarly === true, received:0, opened:false};
        proof.first = new WebSocket('ws://' + location.host + '/');
        proof.first.addEventListener('message', event => {
          const packet = JSON.parse(event.data);
          if (packet.t === 'welcome') proof.received++;
          if (packet.estado?.gold === 999) proof.oldSeen = true;
        });
      </script>`);
    });
    const upgrade = (request, socket, head) => {
      sockets.handleUpgrade(request, socket, head, (peer) => {
        const index = peers.length;
        peers.push(peer);
        peer.on('message', (data) => {
          frames.push({ socket: index, text: data.toString() });
          receiveCommand();
        });
        if (index === 0) peer.send(JSON.stringify({ t: 'welcome', estado: { cheio: true, gold: 101, pokemons: [] } }));
      });
    };
    server.on('upgrade', (request, socket, head) => {
      upgradeCount++;
      if (request.url !== '/' || request.headers.host !== `127.0.0.1:${server.address().port}`) {
        socket.destroy();
        return;
      }
      if (upgradeCount === 2) {
        pendingUpgrade = { request, socket, head };
        requestSuccessor();
      } else {
        upgrade(request, socket, head);
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    context = await chromium.launchPersistentContext(path.join(directory, 'profile'), {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    // The page must remain entirely local, including any unexpected browser request.
    await page.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
    const check = (stage, actual, expected) => {
      assert.deepEqual(actual, expected, stage);
      stages.push(stage);
    };
    await page.goto(`${origin}/fixture`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.proof?.received === 1);
    check('document-start-before-native-welcome', await page.evaluate(() => proof.early), true);
    check('only-page-owned-first-connection', peers.length, 1);
    check(
      'late-attach-without-replay',
      await page.evaluate(() => {
        proof.a = new __proofA.PokeIdleClient({ inspector: false });
        proof.b = new __proofB.PokeIdleClient({ inspector: false });
        proof.welcomes = 0;
        proof.aDeltas = [];
        proof.bDeltas = [];
        proof.a.on('welcome', () => proof.welcomes++);
        proof.b.on('welcome', () => proof.welcomes++);
        proof.a.on('estado', () => proof.aDeltas.push(proof.a.state.gold));
        proof.b.on('estado', () => proof.bDeltas.push(proof.b.state.gold));
        proof.a.start();
        proof.b.start();
        return [proof.a.connected, proof.a.state.complete, proof.a.state.gold, proof.b.state.gold, proof.welcomes];
      }),
      [true, true, 101, 101, 0],
    );
    peers[0].send(JSON.stringify({ t: 'estado', estado: { gold: 102 } }));
    await page.waitForFunction(() => proof.bDeltas.length === 1);
    check('both-consumers-see-current-delta', await page.evaluate(() => [proof.aDeltas, proof.bDeltas]), [[102], [102]]);
    await page.evaluate(() => proof.a.stop());
    peers[0].send(JSON.stringify({ t: 'estado', estado: { gold: 103 } }));
    await page.waitForFunction(() => proof.bDeltas.length === 2);
    check(
      'stop-a-preserves-b-and-native-socket',
      await page.evaluate(() => [
        proof.a.connected,
        proof.a.state.complete,
        proof.a.state.gold,
        proof.aDeltas.length,
        proof.b.connected,
        proof.b.state.complete,
        proof.b.state.gold,
        proof.first.readyState,
      ]),
      [false, false, 102, 1, true, true, 103, 1],
    );
    check(
      'connecting-successor-invalidates-in-same-turn',
      await page.evaluate(() => {
        const previous = proof.b.generation;
        proof.second = new WebSocket('ws://' + location.host + '/');
        proof.second.addEventListener('open', () => (proof.opened = true));
        return [proof.second.readyState, proof.b.connected, proof.b.state.complete, proof.b.generation > previous];
      }),
      [0, false, false, true],
    );
    await deadline(successorRequested);
    check('second-handshake-held', peers.length, 1);
    upgrade(pendingUpgrade.request, pendingUpgrade.socket, pendingUpgrade.head);
    pendingUpgrade = null;
    await page.waitForFunction(() => proof.opened);
    check('open-is-not-complete', await page.evaluate(() => [proof.b.connected, proof.b.state.complete]), [true, false]);
    peers[0].send(JSON.stringify({ t: 'estado', estado: { gold: 999 } }));
    await page.waitForFunction(() => proof.oldSeen === true);
    peers[0].close();
    await page.waitForFunction(() => proof.first.readyState === WebSocket.CLOSED);
    check('old-traffic-and-close-ignored', await page.evaluate(() => [proof.b.connected, proof.b.state.gold]), [true, 103]);
    peers[1].send(JSON.stringify({ t: 'welcome', estado: { cheio: true, gold: 201, pokemons: [] } }));
    await page.waitForFunction(() => proof.b.state.complete);
    check('successor-welcome-restores-readiness', await page.evaluate(() => proof.b.state.gold), 201);
    check('local-send-acceptance', await page.evaluate(() => proof.b.sendCommand({ t: 'ping' })), true);
    await deadline(commandReceived);
    check('exactly-one-send-on-current-socket', frames, [{ socket: 1, text: '{"t":"ping"}' }]);
    check('no-extra-game-connections', peers.length, 2);
    report = {
      status: 'PASS',
      stages,
      browserVersion: context.browser().version(),
      sdkSha256: hash(bundle),
      wrappersSha256: [hash(wrapperA), hash(wrapperB)],
      connections: peers.length,
      commandFrames: frames.length,
    };
  } catch {
    report = { status: 'FAIL', code: 'native-proof-incomplete', completedStages: stages };
    process.exitCode = 1;
  } finally {
    try {
      try {
        await context?.close();
      } finally {
        pendingUpgrade?.socket.destroy();
        for (const peer of sockets?.clients ?? []) peer.terminate();
        if (sockets) await new Promise((resolve) => sockets.close(resolve));
        if (server?.listening) await new Promise((resolve) => server.close(resolve));
        if (directory) await fs.rm(directory, { recursive: true, force: true });
      }
    } catch {
      report = { status: 'FAIL', code: 'native-proof-cleanup-failed', completedStages: stages };
      process.exitCode = 1;
    }
  }
  process.stdout.write(JSON.stringify(report) + '\n');
}

async function deadline(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('proof-timeout')), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
