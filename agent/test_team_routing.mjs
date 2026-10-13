import assert from 'node:assert/strict';
import { TeamRunner, auditRequestedArtifacts } from './team.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AgentEngine } from './engine.js';

function runner() {
  return new TeamRunner({ config: { pinMode: true, provider: 'mock', model: 'mock-model', keys: {}, customProviders: [{ id: 'mock', name: 'Mock', base: 'http://mock.invalid/v1', models: ['mock-model'], key: 'test' }], translate: { enabled: false } }, workspace: process.cwd() });
}

for (const task of ['Create hello.py file and run it.', 'Fayl yarat: hello.py ichiga Salom deb yoz.', 'hello.py faylini yaratib yoz.']) {
  const instance = runner();
  instance.planChainCall = async () => 'not valid planner JSON';
  const agents = await instance.plan(task, [], new AbortController().signal);
  assert.equal(agents.length, 1, `single-file direct route expected for: ${task}`);
  assert.equal(agents[0].name, 'Coder');
}

for (const task of ['Create multiple files for a small app.', 'Ikkita fayl yarat: bir.py va ikki.py']) {
  const instance = runner();
  instance.planChainCall = async () => 'not valid planner JSON';
  const agents = await instance.plan(task, [], new AbortController().signal);
  assert.equal(agents.length, 2, `multi-artifact task must keep team route for: ${task}`);
}

const auditWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'team-artifact-audit-'));
try {
  const auditTask = 'Create double.py and verify.py, then run verify.py';
  assert.deepEqual(auditRequestedArtifacts(auditTask, auditWorkspace), [
    { path: 'double.py', exists: false, contained: true },
    { path: 'verify.py', exists: false, contained: true },
  ], 'audit reports requested files missing before creation');
  await fs.writeFile(path.join(auditWorkspace, 'double.py'), 'def twice(n): return n*2\n');
  assert.deepEqual(auditRequestedArtifacts(auditTask, auditWorkspace), [
    { path: 'double.py', exists: true, contained: true },
    { path: 'verify.py', exists: false, contained: true },
  ], 'audit distinguishes created and missing files');
  const outside = path.join(os.tmpdir(), `outside-${Date.now()}.py`);
  try {
    await fs.writeFile(outside, 'print(1)\\n');
    assert.deepEqual(auditRequestedArtifacts(`Create ${outside} and verify.py`, auditWorkspace), [
      { path: 'verify.py', exists: false, contained: true },
    ], 'absolute paths outside the team workspace are never treated as deliverables');
  } finally {
    await fs.rm(outside, { force: true });
  }
} finally {
  await fs.rm(auditWorkspace, { recursive: true, force: true });
}

const collaborationTask = 'Two agents work in parallel on module.py and test_module.py';
const plannerOnlyOne = runner();
plannerOnlyOne.planChainCall = async () => JSON.stringify({ agents: [{ name: 'Coder', task: 'module.py faylini yarat', specialty: 'coding' }] });
const planned = await plannerOnlyOne.plan(collaborationTask, [], new AbortController().signal);
assert.equal(planned.length, 2, 'explicitly named files must be split even when the planner returns one agent');
assert.match(planned[0].task, /module\.py/);
assert.match(planned[1].task, /test_module\.py/);
assert.ok(planned.every((agent) => agent.specialty === 'coding'));

const duplicateFileTask = 'Create src/module.py and src/test_module.py; also mention src/module.py again.'
const duplicatePlan = runner();
duplicatePlan.planChainCall = async () => 'not valid planner JSON';
const uniqueTargets = await duplicatePlan.plan(duplicateFileTask, [], new AbortController().signal);
assert.equal(uniqueTargets.length, 2, 'duplicate mentions of a named artifact should not create duplicate agents');
assert.match(uniqueTargets[0].task, /src\/module\.py/);
assert.match(uniqueTargets[1].task, /src\/test_module\.py/);

const runEvents = [];  const executionRunner = runner();
  executionRunner.toolTimeline = [];
  executionRunner.planChainCall = plannerOnlyOne.planChainCall;
executionRunner.pickAssignment = () => null;
const startedAgents = [];
executionRunner.runAgent = async ({ name }) => {
  startedAgents.push(name);
  return `${name} done`;
};
executionRunner.on('event', (event) => runEvents.push(event));
const savedLeadRun = AgentEngine.prototype.run;
AgentEngine.prototype.run = async function () { return { content: 'Two files completed.' }; };
try {
  await executionRunner.run({ task: collaborationTask });
} finally {
  AgentEngine.prototype.run = savedLeadRun;
}
assert.deepEqual(startedAgents.slice(0, 2), ['File-1', 'File-2'], 'each explicit file gets a real coder agent in TeamRunner execution');
assert.ok(runEvents.some((event) => event.type === 'team_plan' && event.agents.length === 2));
assert.ok(runEvents.some((event) => event.type === 'team_done'));

const artifactWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'team-artifact-summary-'));
try {
  const artifactTask = 'Create double.py and verify.py, then run verify.py';
  const artifactRunner = runner();
  artifactRunner.toolTimeline = [];
  artifactRunner.workspace = artifactWorkspace;
  artifactRunner.planChainCall = async () => JSON.stringify({ agents: [{ name: 'Coder', specialty: 'coding', task: 'Create files' }] });
  artifactRunner.pickAssignment = () => null;
  let steps = 0;
  artifactRunner.runAgent = async ({ name }) => {
    if (name === 'File-1') {
      await fs.writeFile(path.join(artifactWorkspace, 'double.py'), 'def twice(n): return n*2\n');
      return 'double.py created';
    }
    if (name === 'Reviewer') return 'REVIEW_OK';
    if (name === 'Fixer') steps++;
    return 'completed';
  };
  artifactRunner.commandResults = [];
  const artifactEvents = [];
  artifactRunner.on('event', (event) => artifactEvents.push(event));
  const answer = await artifactRunner.run({ task: artifactTask });
  assert.match(answer.content, /double\.py/);
  assert.match(answer.content, /verify\.py/);
  assert.match(answer.content, /tasdiqlanmadi/);
  assert.ok(artifactEvents.some((event) => event.type === 'team_done' && event.complete === false));
  assert.ok(steps > 0, 'missing files and missing requested execution trigger a repair attempt');
  assert.ok(artifactEvents.some((event) => event.type === 'agent_begin' && event.name === 'Reviewer'), 'reviewer runs the deferred final verification after the coder agents');
} finally {
  await fs.rm(artifactWorkspace, { recursive: true, force: true });
}

const completeWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'team-artifact-complete-'));
try {
  const completeTask = 'Create double.py and verify.py, then run verify.py';
  const completeRunner = runner();
  completeRunner.toolTimeline = [];
  completeRunner.workspace = completeWorkspace;
  completeRunner.planChainCall = async () => JSON.stringify({ agents: [{ name: 'Coder', specialty: 'coding', task: 'Create files' }] });
  completeRunner.pickAssignment = () => null;
  completeRunner.runAgent = async ({ name }) => {
    if (name === 'File-1') {
      await fs.writeFile(path.join(completeWorkspace, 'double.py'), 'def twice(n): return n*2\n');
      return 'double.py created';
    }
    if (name === 'File-2') {
      await fs.writeFile(path.join(completeWorkspace, 'verify.py'), 'from double import twice\nassert twice(2)==4\nassert twice(0)==0\nprint("PASS")\n');
      return 'verify.py created';
    }
    if (name === 'Reviewer') {
      const execution = spawnSync('python', ['verify.py'], { cwd: completeWorkspace, encoding: 'utf8', timeout: 5000, windowsHide: true });
      const doubleWrite = { tool: 'write_file', args: { path: 'double.py' }, ok: true };
      const verifyWrite = { tool: 'write_file', args: { path: 'verify.py' }, ok: true };
      const runEvent = { tool: 'run_command', args: { command: 'python verify.py' }, ok: execution.status === 0, result: execution.stdout, denied: false, repeat: false };
      completeRunner.toolTimeline.push(doubleWrite, verifyWrite, runEvent);
      runEvent.timelineIndex = completeRunner.toolTimeline.length - 1;
      runEvent.toolTimeline = completeRunner.toolTimeline;
      completeRunner.commandResults.push(runEvent);
      assert.equal(execution.status, 0, execution.stderr || 'verify.py did not pass');
      return 'REVIEW_OK';
    }
    throw new Error(`Unexpected agent ${name}`);
  };
  const completeEvents = [];
  completeRunner.on('event', (event) => completeEvents.push(event));
  const completed = await completeRunner.run({ task: completeTask });
  assert.match(completed.content, /So‘ralgan fayllar mavjud va tekshirildi/);
  assert.match(completed.content, /python verify\.py/);
  assert.match(completed.content, /PASS/);
  assert.ok(completeEvents.some((event) => event.type === 'team_done' && event.complete === true));
  assert.deepEqual((await fs.readdir(completeWorkspace)).filter((file) => file.endsWith('.py')).sort(), ['double.py', 'verify.py']);
} finally {
  await fs.rm(completeWorkspace, { recursive: true, force: true });
}

const researchTask = 'Find current official documentation for the latest Python release.';
const events = [];
const researchRunner = runner();
researchRunner.planChainCall = async () => JSON.stringify({ agents: [{ name: 'Researcher', role: 'tadqiqotchi', specialty: 'research', task: researchTask }] });
researchRunner.pickAssignment = () => null;
researchRunner.runAgent = async () => 'Documentation found.';
const originalRun = AgentEngine.prototype.run;
AgentEngine.prototype.run = async function () { return { content: 'Final answer.' }; };
researchRunner.on('event', (event) => events.push(event));
try {
  await researchRunner.run({ task: researchTask });
} finally {
  AgentEngine.prototype.run = originalRun;
}
assert.ok(events.some((event) => event.type === 'agent_begin' && event.name === 'Reviewer'), 'research route must get a separate review/lead pass rather than early-returning the raw researcher result');
assert.ok(events.some((event) => event.type === 'team_done'));
console.log('PASS: single-file tasks route directly, explicit named files fan out into separate agents, and research avoids the shortcut');
