import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SDK = fileURLToPath(new URL('../packages/sdk/', import.meta.url));
const built = fs.existsSync(path.join(SDK, 'dist/index.cjs'));

test(
  'a relocated distribution runs and typechecks as both ESM and CommonJS without the source checkout',
  { skip: built ? false : 'run npm run build first' },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeidle-sdk-consumer-'));
    try {
      const target = path.join(root, 'node_modules/pokeidle-community-sdk');
      fs.mkdirSync(target, { recursive: true });
      fs.cpSync(path.join(SDK, 'dist'), path.join(target, 'dist'), { recursive: true });
      fs.copyFileSync(path.join(SDK, 'package.json'), path.join(target, 'package.json'));
      const vendor = path.join(root, 'vendor');
      fs.mkdirSync(vendor);
      fs.cpSync(path.join(SDK, 'dist/cjs'), path.join(vendor, 'sdk-types'), { recursive: true });
      fs.copyFileSync(path.join(SDK, 'dist/index.cjs'), path.join(vendor, 'pokeidle-sdk.cjs'));
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
        // @ts-expect-error a real SDK declaration must reject invalid command fields
        client.sendCommand({t:'shop.buy',kind:'invalid',id:1,qty:1});
        void [accepted, full, name, vendored, vendorAccepted];
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
