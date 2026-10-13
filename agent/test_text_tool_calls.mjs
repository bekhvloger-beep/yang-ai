import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentEngine } from './engine.js';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'yang-text-tool-call-'));
const originalFetch = globalThis.fetch;
let requestCount = 0;
const config = {
  provider: 'mock',
  model: 'mock-model',
  keys: { mock: 'test-key' },
  customProviders: [{
    id: 'mock',
    name: 'Mock OpenAI-compatible endpoint',
    base: 'http://mock.invalid/v1',
    models: ['mock-model'],
    key: 'test-key',
  }],
  autoApprove: true,
  providerHealth: {},
  disabledProviders: [],
  pinMode: true,
  translate: { enabled: false },
};

try {
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'http://mock.invalid/v1/chat/completions');
    requestCount++;
    const content = requestCount === 1
      ? `write_file(${JSON.stringify({ path: 'tool-result.txt', content: 'TEXT_TOOL_OK (with "quotes" and )' })})\\nI wrote the requested file.`
      : 'Completed.';
    const payload = `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
    return new Response(payload, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };

  const engine = new AgentEngine({ config, workspace, maxSteps: 4 });
  const events = [];
  engine.on('event', (event) => events.push(event));
  const result = await engine.run({ events: [], userText: 'Create tool-result.txt with TEXT_TOOL_OK.' });

  assert.equal(await fs.readFile(path.join(workspace, 'tool-result.txt'), 'utf8'), 'TEXT_TOOL_OK (with "quotes" and )');
  assert.equal(events.filter((event) => event.type === 'tool' && event.tool === 'write_file' && event.ok).length, 1);
  assert.equal(requestCount, 2, 'engine should call the model again after returning the tool result');
  assert.equal(result.content, 'Completed.');
  console.log('PASS: JSON and parenthesized tool calls in assistant text are executed and results are returned');
} finally {
  globalThis.fetch = originalFetch;
  await fs.rm(workspace, { recursive: true, force: true });
}
