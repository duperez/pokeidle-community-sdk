#!/usr/bin/env node
// Generates the protocol registry from the game's public web client.
//
//   node scripts/generate-protocol.mjs           write packages/sdk/src/protocol/registry.generated.ts
//   node scripts/generate-protocol.mjs --check   exit 1 if the registry is out of date with the game
//
// It reads the client's own source (the page's `app.js`) and extracts only NAMES, never code:
//   - the packet types the client handles when they arrive (`m.t === '...'` in its `onmessage`),
//   - the battle event kinds inside `batalha` packets (`case '...'` in `aoEvento`),
//   - the commands the client sends (`{ t: '...' }` literals),
//   - for each received packet and battle event, the field names the client reads from it.
// The field lists are evidence of what the server sends, not types: values stay `unknown` until verified in traffic.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'packages/sdk/src/protocol/registry.generated.ts');
const PAGE = 'https://pokeidle.io/app';
const check = process.argv.includes('--check');

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const sorted = (set) => [...set].sort();

/** The text between a `{` at `open` and its matching `}`, skipping strings, template literals and `//` comments. */
export function balancedBlock(source, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '/' && source[i + 1] === '/') i = source.indexOf('\n', i);
    else if (c === '{') depth += 1;
    else if (c === '}' && --depth === 0) return source.slice(open, i + 1);
    if (i < 0) break;
  }
  return null;
}

/** The body and first parameter of `function name(param) {...}`, or null. */
function functionBody(source, name) {
  const match = new RegExp(`(?:async )?function ${name.replace(/\W/g, '\\$&')}\\s*\\(([^)]*)\\)\\s*\\{`).exec(source);
  if (!match) return null;
  const block = balancedBlock(source, match.index + match[0].length - 1);
  const param = match[1].split(',')[0].split('=')[0].trim();
  return block ? { body: block, param } : null;
}

/** Field names read from `param` in a piece of code: `param.x`, `param?.x` and `const { x, y } = param`. */
export function fieldsRead(code, param) {
  const fields = new Set();
  if (!IDENT.test(param)) return fields;
  for (const m of code.matchAll(new RegExp(`\\b${param}\\??\\.([A-Za-z_][A-Za-z0-9_]*)`, 'g'))) fields.add(m[1]);
  for (const m of code.matchAll(new RegExp(`const \\{([^}]*)\\}\\s*=\\s*${param}\\b`, 'g'))) {
    for (const part of m[1].split(',')) {
      const key = part.trim().split(':')[0].split('=')[0].trim();
      if (IDENT.test(key)) fields.add(key);
    }
  }
  fields.delete('t');
  return fields;
}

/** What a sane extraction finds today (51 packets, 133 events, 208 commands), with room for the game to remove a few. */
const MINIMUMS = { server: 40, events: 100, commands: 150 };

/** The source without comments (the client's comments are prose and would be read as code). Strings are left alone. */
export function stripComments(source) {
  let out = '';
  let quote = null;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      out += c;
      if (c === '\\') out += source[++i] ?? '';
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
    } else if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      out += '\n';
    } else if (c === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      i = close < 0 ? source.length : close + 1;
    } else out += c;
  }
  return out;
}

/** Everything the registry holds, extracted from the client's source text. */
export function extractProtocol(rawSource, { minimums = MINIMUMS } = {}) {
  const source = stripComments(rawSource);
  // 1) received packets: the branches of the client's `onmessage`
  const start = source.indexOf('ws.onmessage = (ev) =>');
  if (start < 0) throw new Error("could not find the client's onmessage handler: the client changed shape");
  const ends = ['ws.onclose', 'ws.onerror'].map((s) => source.indexOf(s, start)).filter((i) => i > 0);
  if (ends.length === 0) throw new Error("could not find the end of the client's onmessage handler: the client changed shape");
  const end = Math.min(...ends);
  const region = source.slice(start, end);
  const branches = [...region.matchAll(/\bm\.t === '([A-Za-z0-9.]+)'/g)];
  const server = new Map();
  branches.forEach((match, index) => {
    const type = match[1];
    const text = region.slice(match.index, branches[index + 1]?.index ?? region.length);
    const fields = fieldsRead(text, 'm');
    // Only handlers that receive the packet itself (`handler(m)`) count: `aoEvento(e)` or `aplicarHeroiAtivo(estado.eu)` read other objects.
    for (const call of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\(\s*m\s*[,)]/g)) {
      const handler = functionBody(source, call[1]);
      if (handler) for (const f of fieldsRead(handler.body, handler.param)) fields.add(f);
    }
    const known = server.get(type) ?? new Set();
    for (const f of fields) known.add(f);
    server.set(type, known);
  });

  // 2) battle events: the `case`s of `aoEvento`
  const eventFn = functionBody(source, 'aoEvento');
  if (!eventFn) throw new Error('could not find aoEvento: the client changed shape');
  const parts = eventFn.body.split(/\n {4}case '([A-Za-z]+)':/);
  const events = new Map();
  let pending = [];
  for (let i = 1; i < parts.length; i += 2) {
    pending.push(parts[i]);
    const text = parts[i + 1] ?? '';
    if (text.trim() === '') continue; // fall-through: the next body belongs to all pending names
    const fields = fieldsRead(text, eventFn.param);
    for (const kind of pending) events.set(kind, fields);
    pending = [];
  }

  // 3) commands: every `{ t: '...' }` literal that is not only a received packet
  const commands = new Set();
  const NAME = "'([A-Za-z][A-Za-z0-9.]*)'";
  for (const m of source.matchAll(new RegExp(`\\bt:\\s*${NAME}`, 'g'))) commands.add(m[1]);
  // `t: cond ? 'a' : 'b'`
  for (const m of source.matchAll(new RegExp(`\\bt:\\s*[^,}\\n]{1,120}?\\?\\s*${NAME}\\s*:\\s*${NAME}`, 'g'))) {
    commands.add(m[1]);
    commands.add(m[2]);
  }
  // request tables: `{ t: modo.msg }` with `msg: 'market.historico'` elsewhere
  for (const m of source.matchAll(/\b(?:msg|mensagem):\s*'([a-z][A-Za-z0-9]*\.[A-Za-z0-9.]+)'/g)) commands.add(m[1]);

  // A client change that makes the extraction come back nearly empty must fail the build, not write a shrunken registry.
  if (server.size < minimums.server || events.size < minimums.events || commands.size < minimums.commands) {
    throw new Error(
      `the extraction found too little (packets ${server.size}, events ${events.size}, commands ${commands.size}): the client changed shape`,
    );
  }
  return { server, events, commands };
}

const quoteList = (values) => values.map((v) => `'${v}'`).join(', ');
const record = (map) =>
  [...map]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, set]) => `  '${key}': [${quoteList(sorted(set))}],`)
    .join('\n');

export function renderRegistry({ server, events, commands }, version = 'unknown') {
  return `// GENERATED by scripts/generate-protocol.mjs from the game's web client. Do not edit by hand: run \`npm run protocol\`.
// Client version: ${version}
// Names only, extracted from the client's source. The field lists say what the client READS from a packet, which is
// evidence of what the server sends, not a type: see the hand-written types for what was verified in real traffic.
// The field lists are HEURISTIC: they come from reading the client's code (the packet's own branch and the handlers
// that receive it), so they can miss fields the client reads some other way and can include ones it does not use.

/** Packet types the game's client handles when they arrive. */
export const SERVER_PACKET_TYPES = [${quoteList(sorted(server.keys()))}] as const;

/** Kinds of event inside a \`batalha\` packet (\`ev[].k\`). */
export const BATTLE_EVENT_KINDS = [${quoteList(sorted(events.keys()))}] as const;

/** Commands the game's client sends. */
export const CLIENT_COMMAND_TYPES = [${quoteList(sorted(commands))}] as const;

/** Fields the client reads from each received packet type. */
export const SERVER_PACKET_READS = {
${record(server)}
} as const;

/** Fields the client reads from each battle event kind. */
export const BATTLE_EVENT_READS = {
${record(events)}
} as const;
`;
}

async function main() {
  const html = await (await fetch(PAGE, { signal: AbortSignal.timeout(30_000) })).text();
  const script = /type="module" src="(app\.js[^"]*)"/.exec(html)?.[1];
  if (!script) throw new Error('could not find the client script in the page');
  const response = await fetch(new URL(script, PAGE), { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`could not download the client script: HTTP ${response.status}`);
  const text = renderRegistry(extractProtocol(await response.text()), script);
  if (check) {
    // A new client version alone is not drift: compare without the version line.
    const sameContent = (a, b) => a.replace(/^\/\/ Client version:.*\n/m, '') === b.replace(/^\/\/ Client version:.*\n/m, '');
    if (!fs.existsSync(OUT) || !sameContent(fs.readFileSync(OUT, 'utf8'), text)) {
      console.error('the protocol registry is out of date with the game: run npm run protocol');
      process.exit(1);
    }
    console.log('the protocol registry is up to date');
    return;
  }
  fs.writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
