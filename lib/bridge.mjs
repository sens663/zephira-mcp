import { createInterface } from 'node:readline';

export const ENDPOINT = 'https://dashboard.zephira.ai/api/mcp';

export function createBridge({ apiKey, emit, fetchImpl = fetch, timeoutMs = 60000 }) {
  let protocolVersion;
  let sessionId;
  const pending = new Map();
  const hasId = message => Object.hasOwn(message, 'id');
  const error = (id, code, message) => emit({ jsonrpc: '2.0', id, error: { code, message } });

  async function handle(message) {
    if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      error(message?.id ?? null, -32600, 'Invalid JSON-RPC request');
      return;
    }
    if (message.method === 'notifications/cancelled') {
      pending.get(message.params?.requestId)?.abort();
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (hasId(message)) pending.set(message.id, controller);
    const version = message.method === 'initialize' ? message.params?.protocolVersion : protocolVersion;
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(version ? { 'MCP-Protocol-Version': version } : {}),
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {})
    };
    let replied = false;
    const forward = response => {
      if (!response || response.jsonrpc !== '2.0') throw new Error('Invalid remote response');
      if (message.method === 'initialize' && response.id === message.id && response.result?.protocolVersion) {
        protocolVersion = response.result.protocolVersion;
      }
      if (hasId(message) && response.id === message.id && (Object.hasOwn(response, 'result') || Object.hasOwn(response, 'error'))) {
        replied = true;
      }
      emit(response);
    };
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST', headers, body: JSON.stringify(message),
        redirect: 'error', signal: controller.signal
      });
      if (!response.ok) {
        if (hasId(message)) {
          const text = response.status === 401 || response.status === 403
            ? 'Zephira authentication failed. Check your dashboard MCP key and scopes.'
            : `Zephira returned HTTP ${response.status}.`;
          error(message.id, -32000, text);
        }
        return;
      }
      sessionId = response.headers.get('mcp-session-id') ?? sessionId;
      if (response.status === 202 || response.status === 204) {
        if (hasId(message)) error(message.id, -32000, 'Zephira returned no response for a request.');
        return;
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          while (!replied) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            let boundary;
            while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
              const event = buffer.slice(0, boundary.index);
              buffer = buffer.slice(boundary.index + boundary[0].length);
              const data = event.split(/\r?\n/).filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).replace(/^ /, '')).join('\n');
              if (data) forward(JSON.parse(data));
              if (replied) break;
            }
            if (done) break;
          }
          if (hasId(message) && !replied) throw new Error('Missing remote response');
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } else {
        forward(await response.json());
        if (hasId(message) && !replied) throw new Error('Missing remote response');
      }
    } catch {
      if (hasId(message) && !replied) error(message.id, -32000,
        controller.signal.aborted ? 'Zephira request cancelled or timed out.' : 'Unable to complete the Zephira MCP request.');
    } finally {
      clearTimeout(timer);
      if (hasId(message)) pending.delete(message.id);
    }
  }
  return { handle, close: () => { for (const controller of pending.values()) controller.abort(); } };
}

export function startStdioBridge({ input, output, apiKey, fetchImpl, timeoutMs }) {
  const write = message => output.write(`${JSON.stringify(message)}\n`);
  const bridge = createBridge({ apiKey, emit: write, fetchImpl, timeoutMs });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const jobs = new Set();
  let finished;
  const done = new Promise(resolve => { finished = resolve; });
  lines.on('line', line => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); }
    catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }); return; }
    const job = bridge.handle(message);
    jobs.add(job);
    job.finally(() => jobs.delete(job));
  });
  lines.on('close', () => { Promise.allSettled([...jobs]).then(finished); });
  input.on('error', () => bridge.close());
  return { done, close: () => { bridge.close(); lines.close(); } };
}
