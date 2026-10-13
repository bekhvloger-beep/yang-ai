import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentEngine } from './engine.js';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'yang-repair-loop-'));
const originalFetch = globalThis.fetch;
let requestCount = 0;
const commands = [];
const config = {
  provider: 'mock', model: 'mock-model', keys: { mock: 'test-key' },
  customProviders: [{ id: 'mock', name: 'Mock OpenAI-compatible endpoint', base: 'http://mock.invalid/v1', models: ['mock-model'], key: 'test-key' }],
  autoApprove: true, providerHealth: {}, disabledProviders: [], pinMode: true,
  translate: { enabled: false },
};

function toolResponse(id, name, args) {
  const payload = { choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] };
  return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
function textResponse(content) {
  const payload = { choices: [{ delta: { content }, finish_reason: 'stop' }] };
  return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

try {
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), 'http://mock.invalid/v1/chat/completions');
    const body = JSON.parse(options.body);
    requestCount++;
    if (requestCount === 1) return toolResponse('write_bad', 'write_file', { path: 'sum.py', content: 'print(1 / 0)\n' });
    if (requestCount === 2) return toolResponse('run_bad', 'run_command', { command: 'python sum.py' });
    if (requestCount === 3) {
      const toolResults = body.messages.filter((message) => message.role === 'tool');
      assert.equal(toolResults.length, 2, 'model receives the file-write and failed-run results');
      assert.match(toolResults[1].content, /Traceback|ZeroDivisionError|command failed/i, 'failed command diagnostics reach the model');
      assert.match(body.messages.at(-1).content, /Traceback|ZeroDivisionError|command failed/i);
      return toolResponse('write_fixed', 'write_file', { path: 'sum.py', content: 'print(1 + 1)\n' });
    }
    if (requestCount === 4) {
      const toolResults = body.messages.filter((message) => message.role === 'tool');
      assert.equal(toolResults.length, 3, 'model gets the repaired source write result before rerunning');
      return toolResponse('run_fixed', 'run_command', { command: 'python sum.py' });
    }
    if (requestCount === 5) {
      const toolResults = body.messages.filter((message) => message.role === 'tool');
      assert.equal(toolResults.length, 4, 'model receives the successful rerun result');
      assert.match(toolResults[3].content, /2/, 'successful process output is fed back');
      return textResponse('Repaired and ready.');
    }
    throw new Error(`Unexpected model request #${requestCount}`);
  };

  const engine = new AgentEngine({ config, workspace, maxSteps: 6 });
  const events = [];
  engine.on('event', (event) => {
    events.push(event);
    if (event.type === 'tool_start' && event.tool === 'run_command') commands.push(event.args.command);
  });
  const result = await engine.run({ events: [], userText: 'Write sum.py, run it, fix any error, and run it again.' });

  assert.equal(await fs.readFile(path.join(workspace, 'sum.py'), 'utf8'), 'print(1 + 1)\n');
  const runEvents = events.filter((event) => event.type === 'tool' && event.tool === 'run_command');
  assert.equal(runEvents.length, 2, 'the failing program is run, then the repaired one is rerun');
  assert.equal(runEvents[0].ok, false, 'nonzero process exit is exposed as a failed tool event');
  assert.match(runEvents[0].result, /ZeroDivisionError|command failed/i);
  assert.equal(runEvents[1].ok, true, 'the corrected program succeeds');
  assert.match(runEvents[1].result, /2/);
  assert.deepEqual(commands, ['python sum.py', 'python sum.py']);
  assert.equal(requestCount, 5);
  assert.equal(result.content, 'Repaired and ready.');
  console.log('PASS: failed execution diagnostics return to the model, corrected code is written, rerun succeeds');
} finally {
  globalThis.fetch = originalFetch;
  await fs.rm(workspace, { recursive: true, force: true });
}
