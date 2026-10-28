import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { runNpm } from '../scripts/npm.mjs';

const SDK = fileURLToPath(new URL('../packages/sdk/', import.meta.url));
const built = fs.existsSync(path.join(SDK, 'dist/index.cjs'));

test('the browser bundle runs standalone and delivers market packets through the shared page runtime', { skip: !built }, async () => {
  const context = vm.createContext({ URL, structuredClone, EventTarget, Event, MessageEvent });
  vm.runInContext(
    `class Socket extends EventTarget {
       constructor(url) { super(); this.url = url; this.readyState = 1; this.sent = []; }
       send(text) { this.sent.push(text); }
     }
     globalThis.WebSocket = Socket;
     globalThis.location = {host:'game.test', href:'https://game.test/'};
    `,
    context,
  );
  const original = context.WebSocket;
  const bundle = fs.readFileSync(path.join(SDK, 'dist/pokeidle-sdk.iife.js'), 'utf8');
  vm.runInContext(bundle, context);
  assert.equal(context.WebSocket, original, 'loading exports alone does not install a hook');
  const actual = vm.runInContext(
    `(async () => {
       const {PokeIdleClient, bootstrapPageSession} = PokeIdleSDK;
       bootstrapPageSession();
       const client = new PokeIdleClient();
       let market;
       client.on('market', packet => { market = packet; });
       client.start();
       const socket = new WebSocket('wss://game.test/');
       socket.dispatchEvent(new Event('open'));
       socket.dispatchEvent(new MessageEvent('message', {data:'{"t":"market","medias":{"1":42},"resumo":[]}' }));
       const accepted = await client.sendCommand({t:'market.itens'});
       const result = JSON.stringify({market, accepted, sent:socket.sent, connected:client.connected});
       client.stop();
       return result;
     })()`,
    context,
  );
  assert.deepEqual(JSON.parse(await actual), {
    market: { t: 'market', medias: { 1: 42 }, resumo: [] },
    accepted: true,
    sent: ['{"t":"market.itens"}'],
    connected: true,
  });
});

test('independent browser bundles retain early state and isolate stop and socket replacement', { skip: !built }, async () => {
  const context = vm.createContext({ URL, structuredClone, EventTarget, Event, MessageEvent, setTimeout, clearTimeout, console });
  vm.runInContext(
    `class Socket extends EventTarget {
       constructor(url) { super(); this.url = url; this.readyState = 0; this.sent = []; }
       send(text) { if (this.readyState !== 1) throw Error('socket-not-open'); this.sent.push(text); }
       open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
       receive(packet) { this.dispatchEvent(new MessageEvent('message', {data:JSON.stringify(packet)})); }
       close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
     }
     globalThis.WebSocket = Socket;
     globalThis.location = {host:'game.test', href:'https://game.test/'};
    `,
    context,
  );
  const bundle = fs.readFileSync(path.join(SDK, 'dist/pokeidle-sdk.iife.js'), 'utf8');
  vm.runInContext(bundle, context);
  assert.equal(vm.runInContext('typeof PokeIdleSDK.bootstrapPageSession', context), 'function');
  vm.runInContext('globalThis.copyA = PokeIdleSDK; copyA.bootstrapPageSession(); globalThis.hookA = WebSocket;', context);
  vm.runInContext(bundle, context);
  vm.runInContext('globalThis.copyB = PokeIdleSDK; copyB.bootstrapPageSession();', context);
  assert.equal(context.WebSocket, context.hookA, 'a separately evaluated bundle must reuse the installed constructor');
  const actual = await vm.runInContext(
    `(async () => {
       const first = new WebSocket('wss://game.test/');
       first.open();
       first.receive({t:'welcome',estado:{cheio:true,gold:101,pokemons:[]}});
       const a = new copyA.PokeIdleClient({inspector:false});
       const b = new copyB.PokeIdleClient({inspector:false});
       const welcomes = [];
       const deltasA = [];
       const deltasB = [];
       a.on('welcome', () => welcomes.push('a'));
       b.on('welcome', () => welcomes.push('b'));
       a.on('estado', () => deltasA.push(a.state.gold));
       b.on('estado', () => deltasB.push(b.state.gold));
       a.start(); b.start();
       const late = [a.connected,a.state.complete,a.state.gold,b.connected,b.state.complete,b.state.gold];
       const lateWelcomes = welcomes.slice();
       first.receive({t:'estado',estado:{gold:102}});
       a.stop();
       first.receive({t:'estado',estado:{gold:103}});
       const stopped = [a.connected,a.state.complete,a.state.gold,b.connected,b.state.complete,b.state.gold,first.readyState];
       const beforeGeneration = b.generation;
       const second = new WebSocket('wss://game.test/');
       const connecting = [second.readyState,b.connected,b.state.complete,b.generation > beforeGeneration];
       first.receive({t:'estado',estado:{gold:999}});
       first.close();
       second.open();
       const opened = [b.connected,b.state.complete,b.state.gold];
       second.receive({t:'welcome',estado:{cheio:true,gold:201,pokemons:[]}});
       const accepted = await b.sendCommand({t:'ping'});
       const result = {late,lateWelcomes,welcomes,deltasA,deltasB,stopped,connecting,opened,
         current:[b.connected,b.state.complete,b.state.gold],accepted,oldFrames:first.sent,newFrames:second.sent};
       b.stop();
       second.receive({t:'estado',estado:{gold:202}});
       a.start();
       result.restart = [a.connected,a.state.complete,a.state.gold];
       a.stop();
       return JSON.stringify(result);
     })()`,
    context,
  );
  assert.deepEqual(JSON.parse(actual), {
    late: [true, true, 101, true, true, 101],
    lateWelcomes: [],
    welcomes: ['b'],
    deltasA: [102],
    deltasB: [102, 103],
    stopped: [false, false, 102, true, true, 103, 1],
    connecting: [0, false, false, true],
    opened: [true, false, 103],
    current: [true, true, 201],
    accepted: true,
    oldFrames: [],
    newFrames: ['{"t":"ping"}'],
    restart: [true, true, 202],
  });
});

test(
  'a relocated distribution runs and typechecks as both ESM and CommonJS without the source checkout',
  { skip: built ? false : 'run npm run build first' },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeidle-sdk-consumer-'));
    try {
      const target = path.join(root, 'node_modules/pokeidle-community-sdk');
      fs.mkdirSync(target, { recursive: true });
      const [packed] = JSON.parse(runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', root], { cwd: SDK }));
      runNpm(
        [
          'install',
          '--offline',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--no-package-lock',
          '--prefix',
          root,
          path.join(root, packed.filename),
        ],
        { cwd: root },
      );
      const vendor = path.join(root, 'vendor');
      fs.mkdirSync(vendor);
      fs.cpSync(path.join(target, 'dist/cjs'), path.join(vendor, 'sdk-types'), { recursive: true });
      fs.copyFileSync(path.join(target, 'dist/index.cjs'), path.join(vendor, 'pokeidle-sdk.cjs'));
      execFileSync(process.execPath, ['-e', "require('./vendor/pokeidle-sdk.cjs')"], { cwd: root, stdio: 'pipe' });
      for (const mode of ['module', 'commonjs']) {
        const code =
          mode === 'module'
            ? "import { PokeIdleClient, Ball } from 'pokeidle-community-sdk'; if (typeof PokeIdleClient !== 'function' || Ball.PokeBall !== 1) throw Error('bad exports');"
            : "const { PokeIdleClient, Ball } = require('pokeidle-community-sdk'); if (typeof PokeIdleClient !== 'function' || Ball.PokeBall !== 1) throw Error('bad exports');";
        execFileSync(process.execPath, [`--input-type=${mode}`, '-e', code], { cwd: root, stdio: 'pipe' });
      }
      const usage = `
        declare const vendorClient: import('./vendor/sdk-types/index.js').PokeIdleClient;
        const vendorAccepted: Promise<boolean> = vendorClient.sendCommand({t:'ping'});
        sdk.bootstrapPageSession({actions:{rateLimit:false}});
        const client = new sdk.PokeIdleClient();
        const accepted: Promise<boolean> = client.sendCommand({t:'shop.buy',kind:'ball',id:1,qty:1});
        const full: boolean = client.state.complete;
        const name: string | null = client.state.huntName('test');
        const quantity: number | null = client.state.itemQuantity(200);
        const automation: sdk.AutomationState | null = client.state.automation;
        const twitch: sdk.TwitchState | null = client.state.twitch;
        const inCenter: boolean | null = client.state.inCenter;
        const sendOptions: sdk.ActionCallOptions = {onSend(outcome: sdk.SendOutcome) {
          if (outcome.status === 'uncertain') { const error: unknown = outcome.error; void error; }
        }};
        const purchase: Promise<sdk.BuyResult> = client.actions.buyBall(1,1,sendOptions);
        // @ts-expect-error a real SDK declaration must reject invalid command fields
        client.sendCommand({t:'shop.buy',kind:'invalid',id:1,qty:1});
        const generation: number = client.generation;
        // @ts-expect-error transport selection is no longer public
        new sdk.PokeIdleClient({transport:{}});
        // @ts-expect-error the public state view cannot feed itself
        client.state.applyPacket({t:'welcome'});
        // @ts-expect-error no public PageTransport export
        new sdk.PageTransport();
        void [accepted, full, name, vendorAccepted, quantity, automation, twitch, inCenter, purchase, generation];
      `;
      const files = ['consumer.mts', 'consumer.cts'].map((name) => {
        const filename = path.join(root, name);
        const imports = name.endsWith('.mts')
          ? "import * as sdk from 'pokeidle-community-sdk';"
          : "import sdk = require('pokeidle-community-sdk');";
        fs.writeFileSync(filename, imports + usage);
        return filename;
      });
      const program = ts.createProgram(files, {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: true,
        noEmit: true,
        types: [],
        lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      });
      const diagnostics = ts.getPreEmitDiagnostics(program);
      assert.deepEqual(
        diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
        [],
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
