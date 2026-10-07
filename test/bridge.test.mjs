import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createBridge, startStdioBridge, ENDPOINT } from '../lib/bridge.mjs';

const key = 'zph_live_fixture_not_a_real_key';
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });

test('sends only to the canonical endpoint with Bearer auth and refuses redirects', async () => {
  const out = [];
  const bridge = createBridge({ apiKey: key, emit: x => out.push(x), fetchImpl: async (url, init) => {
    assert.equal(url, ENDPOINT);
    assert.equal(init.headers.Authorization, `Bearer ${key}`);
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), request(2, 'tools/list'));
    return json({ jsonrpc: '2.0', id: 2, result: { tools: [] } });
  } });
  await bridge.handle(request(2, 'tools/list'));
  assert.deepEqual(out, [{ jsonrpc: '2.0', id: 2, result: { tools: [] } }]);
});

test('preserves negotiated protocol and optional session headers', async () => {
  let calls = 0;
  const bridge = createBridge({ apiKey: key, emit: () => {}, fetchImpl: async (_url, init) => {
    calls++;
    if (calls === 1) {
      assert.equal(init.headers['MCP-Protocol-Version'], '2025-06-18');
      const response = json({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } });
      response.headers.set('mcp-session-id', 'fixture-session');
      return response;
    }
    assert.equal(init.headers['Mcp-Session-Id'], 'fixture-session');
    assert.equal(init.headers['MCP-Protocol-Version'], '2025-06-18');
    return json({ jsonrpc: '2.0', id: 2, result: { tools: [] } });
  } });
  await bridge.handle(request(1, 'initialize', { protocolVersion: '2025-06-18' }));
  await bridge.handle(request(2, 'tools/list'));
});

test('forwards tool schemas, annotations and tool results without rewriting provenance', async () => {
  const card = JSON.parse(readFileSync(new URL('../metadata/server-card.json', import.meta.url)));
  const responses = [{ jsonrpc: '2.0', id: 2, result: { tools: card.tools } },
    { jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'fixture company' }], structuredContent: { source: 'fixture registry', source_timestamp: '2026-01-01', modelled: false } } }];
  const out = [];
  const bridge = createBridge({ apiKey: key, emit: x => out.push(x), fetchImpl: async (_url, init) => json(responses.find(r => r.id === JSON.parse(init.body).id)) });
  await bridge.handle(request(2, 'tools/list'));
  await bridge.handle(request(3, 'tools/call', { name: 'get_entity', arguments: { entity_id: '123' } }));
  assert.deepEqual(out, responses);
  assert.equal(out[0].result.tools.length, 6);
  assert.ok(out[0].result.tools.every(t => t.annotations.readOnlyHint));
});

test('handles streamed messages split across chunks and CRLF boundaries', async () => {
  const event = { jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } };
  const result = { jsonrpc: '2.0', id: 4, result: { tools: [] } };
  const body = `: keepalive\r\n\r\ndata: ${JSON.stringify(event)}\r\n\r\ndata: ${JSON.stringify(result)}\r\n\r\n`;
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 7)); c.enqueue(bytes.slice(7, 31)); c.enqueue(bytes.slice(31)); c.close(); } });
  const out = [];
  const bridge = createBridge({ apiKey: key, emit: x => out.push(x), fetchImpl: async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }) });
  await bridge.handle(request(4, 'tools/list'));
  assert.deepEqual(out, [event, result]);
});

test('acknowledges notifications without writing a JSON-RPC response', async () => {
  const out = [];
  const bridge = createBridge({ apiKey: key, emit: x => out.push(x), fetchImpl: async () => new Response(null, { status: 202 }) });
  await bridge.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.deepEqual(out, []);
});

test('authentication errors do not leak credentials or remote error bodies', async () => {
  const out = [];
  const bridge = createBridge({ apiKey: key, emit: x => out.push(x), fetchImpl: async () => new Response(key, { status: 401 }) });
  await bridge.handle(request(5, 'tools/list'));
  assert.equal(out[0].error.code, -32000);
  assert.ok(!JSON.stringify(out).includes(key));
});

test('reports a missing streamed response and transport failures', async () => {
  for (const fetchImpl of [async () => new Response('data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), async () => { throw new Error(key); }]) {
    const out = [];
    await createBridge({ apiKey: key, emit: x => out.push(x), fetchImpl }).handle(request(6, 'tools/list'));
    assert.equal(out.at(-1).error.code, -32000);
    assert.ok(!JSON.stringify(out).includes(key));
  }
});

test('stdio preserves request IDs and diagnoses malformed JSON', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let received = '';
  output.on('data', chunk => { received += chunk; });
  const bridge = startStdioBridge({ input, output, apiKey: key, fetchImpl: async (_url, init) => {
    const message = JSON.parse(init.body);
    return json({ jsonrpc: '2.0', id: message.id, result: { tools: [] } });
  } });
  input.end('{bad}\n' + JSON.stringify(request('client-id', 'tools/list')) + '\n');
  await bridge.done;
  const messages = received.trim().split('\n').map(s => JSON.parse(s));
  assert.equal(messages[0].error.code, -32700);
  assert.equal(messages[1].id, 'client-id');
});

test('CLI fails clearly with a missing key without emitting protocol chatter', () => {
  const env = { ...process.env };
  delete env.ZEPHIRA_API_KEY;
  const result = spawnSync(process.execPath, ['bin/zephira-mcp.mjs'], { encoding: 'utf8', env });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /ZEPHIRA_API_KEY/);
});
