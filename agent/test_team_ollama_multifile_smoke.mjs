import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { TeamRunner } from './team.js';

const base = process.env.YANG_TEAM_BASE || 'http://127.0.0.1:11434/v1';
const model = process.env.YANG_TEAM_MODEL || 'qwen2.5-coder:7b';
const timeoutMs = Number(process.env.YANG_TEAM_TIMEOUT_MS || 240000);
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'yang-team-multifile-'));
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
import ast,pathlib
specs={
 'double.py': {'FunctionDef','arguments','arg','Return','BinOp','Mult','Name','Load','Constant'},
 'test_double.py': {'ImportFrom','alias','Expr','Assert','Call','Name','Load','Constant','Compare','Eq'},
}
for filename, allowed in specs.items():
 tree=ast.parse(pathlib.Path(filename).read_text(encoding='utf-8'))
 for node in ast.walk(tree):
  if type(node).__name__ not in allowed|{'Module'}: raise SystemExit('blocked syntax in '+filename+': '+type(node).__name__)
  if isinstance(node,ast.ImportFrom) and (node.module!='double' or any(a.name!='twice' for a in node.names)): raise SystemExit('blocked import')
  if isinstance(node,ast.Call) and (not isinstance(node.func,ast.Name) or node.func.id not in {'twice','print'}): raise SystemExit('blocked call')
 if filename=='double.py' and not any(isinstance(n,ast.FunctionDef) and n.name=='twice' for n in ast.walk(tree)): raise SystemExit('twice missing')
 if filename=='test_double.py' and not any(isinstance(n,ast.Assert) for n in ast.walk(tree)): raise SystemExit('assert missing')
print('SAFE_TWO_FILE_AST')
`;

let timeout;
try {
  const response = await fetch(base.replace(/\/v1\/?$/, '/api/tags'), { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, `Ollama is not reachable at ${base}`);
  const tags = await response.json();
  assert.ok((tags.models || []).some((item) => item.name === model), `model not installed: ${model}`);

  runner.on('approval', (request) => {
    try {
      assert.equal(request.tool, 'run_command');
      const command = String(request.args.command).replace(/\\/g, '/').replace(/["']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      assert.ok(['python test_double.py', 'python3 test_double.py', 'py test_double.py'].includes(command), `command not allowlisted: ${command}`);
      assert.equal(path.resolve(workspace, request.args.cwd || '.'), workspace, 'execution must stay inside its isolated workspace');
      const checked = spawnSync('python', ['-c', astValidator], { cwd: workspace, encoding: 'utf8', timeout: 5000, windowsHide: true });
      assert.equal(checked.status, 0, checked.stderr || checked.stdout || 'AST validation failed');
      request.respond(true);
    } catch (error) {
      console.error(`DENIED ${request.args.command}: ${error.message}`);
      request.respond(false);
    }
  });

  const task = 'Two agents work in parallel. Create exactly two files: double.py must define twice(n) and return n multiplied by 2. test_double.py must import twice from double, assert twice(2)==4 and twice(0)==0, and print PASS. Each agent must work only on its assigned file. Execute python test_double.py; fix any error and rerun it.';
  const run = runner.run({ task });
  const timedOut = new Promise((_, reject) => {
    timeout = setTimeout(() => { runner.abort(); reject(new Error(`timeout after ${timeoutMs}ms`)); }, timeoutMs);
  });
  const result = await Promise.race([run, timedOut]);
  clearTimeout(timeout);

  const plan = events.find((event) => event.type === 'team_plan');
  const audit = events.findLast((event) => event.type === 'team_audit')?.artifacts || [];
  const files = (await fs.readdir(workspace)).sort();
  const executions = events.filter((event) => event.type === 'tool' && event.tool === 'run_command');
  assert.equal(plan?.agents?.length, 2, 'explicitly named files should produce two coder agents');
  assert.ok(audit.some((file) => file.path === 'double.py' && file.exists), 'audit must confirm double.py exists');
  assert.ok(audit.some((file) => file.path === 'test_double.py' && file.exists), 'audit must confirm test_double.py exists');
  assert.ok(executions.some((event) => event.ok && /PASS/.test(event.result)), 'generated two-file program must pass when executed');
  assert.ok(events.some((event) => event.type === 'team_done' && event.complete), 'team can only report complete after final artifact and command audit passes');
  console.log(JSON.stringify({ pass: true, model, elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)), files, agents: plan.agents.map((agent) => agent.name), executions: executions.map((event) => ({ ok: event.ok, ms: event.ms, output: event.result })), final: result.content }, null, 2));
} catch (error) {
  clearTimeout(timeout);
  console.error(`FAIL: ${error.stack || error}`);
  console.error(`Workspace preserved for diagnosis: ${workspace}`);
  console.error(`Events: ${JSON.stringify(events.filter(({ type }) => ['team_plan', 'team_audit', 'agent_begin', 'agent_end', 'tool', 'team_done'].includes(type)).map(({ type, name, tool, ok, summary, agents, artifacts }) => ({ type, name, tool, ok, agents: agents?.map((agent) => agent.name), artifacts, summary: summary?.slice(0, 120) })))}`);
  process.exitCode = 1;
}
