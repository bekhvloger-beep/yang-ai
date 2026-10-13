import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { TeamRunner } from './team.js';

const base = process.env.YANG_TEAM_BASE || 'http://127.0.0.1:11434/v1';
const model = process.env.YANG_TEAM_MODEL || 'qwen2.5-coder:7b';
const timeoutMs = Number(process.env.YANG_TEAM_TIMEOUT_MS || 300000);
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'yang-team-ollama-'));
const startedAt = Date.now();
const config = {
  provider: 'ollamaTeam', model, keys: { ollamaTeam: 'local' },
  customProviders: [{ id: 'ollamaTeam', name: 'Ollama local coding model', base, models: [model], key: 'local' }],
  autoApprove: false, providerHealth: {}, disabledProviders: [], pinMode: true,
  translate: { enabled: false },
};
const runner = new TeamRunner({ config, workspace });
const events = [];
runner.on('event', (event) => events.push(event));

const astValidator = String.raw`
import ast,pathlib,sys
p=pathlib.Path(sys.argv[1]); tree=ast.parse(p.read_text(encoding='utf-8'))
allowed={ast.Module,ast.FunctionDef,ast.arguments,ast.arg,ast.Return,ast.BinOp,ast.Mult,ast.Add,ast.FloorDiv,ast.Name,ast.Load,ast.Store,ast.Constant,ast.Expr,ast.Call,ast.Assert,ast.Compare,ast.Eq}
for node in ast.walk(tree):
 if type(node) not in allowed: raise SystemExit('blocked syntax: '+type(node).__name__)
 if isinstance(node,ast.FunctionDef) and node.name!='sum_to_n': raise SystemExit('unexpected function')
 if isinstance(node,ast.Call) and (not isinstance(node.func,ast.Name) or node.func.id not in {'sum_to_n','print','range','sum'}): raise SystemExit('blocked call')
 if isinstance(node,ast.Name) and isinstance(node.ctx,ast.Load) and node.id not in {'sum_to_n','print','n','range','sum'}: raise SystemExit('blocked name: '+node.id)
if not any(isinstance(node,ast.FunctionDef) and node.name=='sum_to_n' for node in ast.walk(tree)): raise SystemExit('sum_to_n missing')
if sum(isinstance(node,ast.Assert) for node in ast.walk(tree))<2: raise SystemExit('two assertions required')
print('SAFE_ARITHMETIC_AST')
`;

let timeout;
try {
  const modelsResponse = await fetch(base.replace(/\/v1\/?$/, '/api/tags'), { signal: AbortSignal.timeout(5000) });
  assert.equal(modelsResponse.status, 200, `Ollama is not reachable at ${base}`);
  const tags = await modelsResponse.json();
  assert.ok((tags.models || []).some((item) => item.name === model), `model not installed: ${model}`);

  runner.on('approval', (request) => {
    try {
      assert.equal(request.tool, 'run_command');
      const command = String(request.args.command).replace(/\\/g, '/').replace(/["']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      assert.ok(['python sum_to_n.py', 'python3 sum_to_n.py', 'py sum_to_n.py'].includes(command), `command not allowlisted: ${command}`);
      assert.equal(path.resolve(workspace, request.args.cwd || '.'), workspace, 'execution must stay inside its isolated workspace');
      const checked = spawnSync('python', ['-c', astValidator, path.join(workspace, 'sum_to_n.py')], { encoding: 'utf8', timeout: 5000, windowsHide: true });
      assert.equal(checked.status, 0, checked.stderr || checked.stdout || 'AST validation failed');
      request.respond(true);
    } catch (error) {
      console.error(`DENIED ${request.args.command}: ${error.message}`);
      request.respond(false);
    }
  });

  const run = runner.run({ task: 'Create a file sum_to_n.py. It must define sum_to_n(n) to calculate the sum from 1 through n, assert sum_to_n(10)==55 and sum_to_n(1)==1, and print both results. Execute it with run_command; fix any error and run it again.' });
  const timedOut = new Promise((_, reject) => {
    timeout = setTimeout(() => { runner.abort(); reject(new Error(`timeout after ${timeoutMs}ms`)); }, timeoutMs);
  });
  const result = await Promise.race([run, timedOut]);
  clearTimeout(timeout);

  const plan = events.find((event) => event.type === 'team_plan');
  const source = await fs.readFile(path.join(workspace, 'sum_to_n.py'), 'utf8');
  const files = (await fs.readdir(workspace)).sort();
  const executions = events.filter((event) => event.type === 'tool' && event.tool === 'run_command');
  assert.equal(plan?.agents?.length, 1, 'single-file task should use the direct single-coder team route');
  assert.deepEqual(files, ['sum_to_n.py'], 'workspace should contain only the requested artifact');
  assert.match(source, /def\s+sum_to_n\s*\(/);
  assert.ok(executions.length >= 1, 'generated code was executed');
  assert.ok(executions.some((event) => event.ok && /55/.test(event.result) && /1/.test(event.result)), 'execution must pass and print expected answers 55 and 1');
  assert.ok(events.some((event) => event.type === 'team_done'), 'team completion must be emitted');
  console.log(JSON.stringify({ pass: true, model, elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)), files, executions: executions.map((event) => ({ ok: event.ok, ms: event.ms, output: event.result })), final: result.content }, null, 2));
} catch (error) {
  clearTimeout(timeout);
  console.error(`FAIL: ${error.stack || error}`);
  console.error(`Workspace preserved for diagnosis: ${workspace}`);
  process.exitCode = 1;
}
