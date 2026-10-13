// Headless E2E test of the agent engine: real LLM + real tools + real workspace.
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { AgentEngine } from './engine.js';
import { createToolContext } from './tools.js';
import { importKeysFromEnv } from './config.js';

const root = path.resolve(import.meta.dirname, '..');
const { keys } = await importKeysFromEnv([path.join(root, '.env'), path.join(root, 'ChatDev-main', '.env')]);
console.log('Imported providers:', Object.keys(keys).join(', ') || 'NONE');
if (!keys.openrouter) {
  console.log('FATAL: openrouter key topilmadi');
  process.exit(1);
}

const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-test-'));
console.log('Workspace:', workspace);

// --- 1. Direct tool tests (no LLM) ---
const ctx = createToolContext({ workspace });
await ctx.execute('write_file', { path: 'a.txt', content: 'salom dunyo\nikkinchi qator' });
const read = await ctx.execute('read_file', { path: 'a.txt' });
console.log('read_file ok:', read.includes('ikkinchi'));
await ctx.execute('edit_file', { path: 'a.txt', old_string: 'salom', new_string: 'HELLO' });
const after = await ctx.execute('read_file', { path: 'a.txt' });
console.log('edit_file ok:', after.includes('HELLO'));
const dir = await ctx.execute('list_dir', { path: '.' });
console.log('list_dir ok:', dir.includes('a.txt'));
const sr = await ctx.execute('search_files', { pattern: 'HELLO' });
console.log('search_files ok:', sr.includes('a.txt:1'));
const dup = await ctx.execute('write_file', { path: 'b.txt', content: 'HELLO once\nHELLO twice' });
const editDup = await ctx.execute('edit_file', { path: 'b.txt', old_string: 'HELLO', new_string: 'X' }).catch((e) => 'ERR:' + e.message.slice(0, 40));
console.log('edit_file uniqueness guard:', String(editDup).startsWith('ERR:') ? 'OK' : 'FAIL — expected error');
await ctx.execute('run_command', { command: 'echo cmd-test-123' }).then((r) => console.log('run_command ok:', r.includes('cmd-test-123')));

// --- 2. Full agentic run with the real model ---
const engine = new AgentEngine({
  config: { provider: 'groq', model: 'openai/gpt-oss-120b', keys, autoApprove: true, customBaseUrl: '' },
  workspace,
});
if (!keys.groq) {
  console.log('FATAL: groq key topilmadi');
  process.exit(1);
}
engine.on('approval', (a) => a.respond(true)); // headless: auto-approve
const evts = [];
engine.on('event', (e) => {
  evts.push(e);
  if (e.type === 'tool') console.log(`  [tool] ${e.tool} -> ${String(e.result).slice(0, 80).replace(/\n/g, ' ')}`);
  if (e.type === 'error') console.log('  [error]', e.message);
});

console.log('--- agentic run start ---');
let final;
try {
  final = await engine.run({
    events: [],
    userText:
      'Vazifa: calculator.py faylini yarat — u 2 ta son argumentini qabul qilib ularning yig‘indisini chop etadi. So‘ng uni python bilan (2 va 3 argumentlari bilan) ishga tushirib natijasini tekshir. Agar xato bo‘lsa tuzat. Hammasi to‘g‘ri bo‘lsa javob oxirida "VAZIFA_TAYYOR" so‘zini yoz.',
  });
} catch (e) {
  console.log('RUN FAILED:', e.message);
  process.exit(1);
}
console.log('--- agentic run end ---');
console.log('Final content (first 300):', final.content.slice(0, 300).replace(/\n/g, ' '));

const py = await fsp.readFile(path.join(workspace, 'calculator.py'), 'utf8').catch(() => null);
console.log('calculator.py exists:', !!py);
const runEvents = evts.filter((e) => e.type === 'tool' && e.tool === 'run_command');
console.log('run_command events:', runEvents.length);
console.log('final says done:', final.content.includes('VAZIFA_TAYYOR'));
const ok = py && runEvents.length > 0 && final.content.includes('VAZIFA_TAYYOR');
console.log(ok ? '\n=== ENGINE TEST: PASS ===' : '\n=== ENGINE TEST: CHECK ABOVE ===');

// --- 3. Multi-turn: history replay ---
try {
  const followup = await engine.run({
    events: [
      { type: 'user', text: 'Vazifa: calculator.py faylini yarat — u 2 ta son argumentini qabul qilib ularning yig‘indisini chop etadi.' },
      ...evts.filter((e) => e.type !== 'stream').map((e) => (e.type === 'assistant' ? { ...e } : { ...e })),
    ],
    userText: 'Endi ayirish funksiyasini ham qo‘shing (sub komandasi) va qayta test qiling.',
  });
  console.log('Follow-up turn ok:', followup.content.slice(0, 120).replace(/\n/g, ' '));
} catch (e) {
  console.log('Follow-up failed:', e.message);
  process.exit(1);
}
console.log('\n=== ALL ENGINE TESTS DONE ===');
