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

test('the browser bundle runs without a module loader and delivers market packets through PageTransport', { skip: !built }, () => {
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
    `(() => {
       const {PokeIdleClient, PageTransport} = PokeIdleSDK;
       const client = new PokeIdleClient({transport:new PageTransport(globalThis)});
       let market;
       client.on('market', packet => { market = packet; });
       client.start();
       const socket = new WebSocket('wss://game.test/');
       socket.dispatchEvent(new Event('open'));
       socket.dispatchEvent(new MessageEvent('message', {data:'{"t":"market","medias":{"1":42},"resumo":[]}' }));
       const accepted = client.sendCommand({t:'market.itens'});
       const result = JSON.stringify({market, accepted, sent:socket.sent, connected:client.connected});
       client.stop();
       return result;
     })()`,
    context,
  );
  assert.deepEqual(JSON.parse(actual), {
    market: { t: 'market', medias: { 1: 42 }, resumo: [] },
    accepted: true,
    sent: ['{"t":"market.itens"}'],
    connected: true,
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
        const vendored: import('./vendor/sdk-types/index.js').Transport<Promise<boolean>> = {
          readyState: 1, start() {}, stop() {}, async send() { return true; }
        };
        declare const vendorClient: import('./vendor/sdk-types/index.js').PokeIdleClient<Promise<boolean>>;
        const vendorAccepted: Promise<boolean> = vendorClient.sendCommand({t:'ping'});
        const transport: sdk.Transport<Promise<boolean>> = {
          readyState: 1,
          start(handlers: sdk.TransportHandlers) { handlers.onMessage('{"t":"pong"}'); },
          stop() {},
          async send(text: string) { return text.length > 0; }
        };
        const client = new sdk.PokeIdleClient({ transport });
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
        void [accepted, full, name, vendored, vendorAccepted, quantity, automation, twitch, inCenter, purchase];
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
