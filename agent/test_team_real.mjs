// test_team_real.mjs — TeamRunner real API bilan sinov (user config + temp workspace)
// node agent/test_team_real.mjs "vazifa matni"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TeamRunner } from './team.js';

const cfgPath = path.join(process.env.APPDATA, 'yang-ai', 'config.json');
const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
config.disabledProviders = config.disabledProviders || ['deepseek', 'vercel', 'sambanova'];

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'team-test-'));
const runner = new TeamRunner({ config, workspace: ws });

runner.on('event', (e) => {
  if (e.type === 'team_plan') {
    console.log('=== PLAN (parallel:', e.parallel, ') ===');
    for (const a of e.agents) console.log(`  ${a.icon} ${a.name} [${a.specialty}] → ${String(a.task).slice(0, 90)}`);
  } else if (e.type === 'agent_begin') console.log(`▶ BEGIN ${e.name} ${e.model ? '(' + e.model + ')' : ''}`);
  else if (e.type === 'agent_end') console.log(`■ END ${e.name} → ${String(e.summary).slice(0, 150).replace(/\n/g, ' ')}`);
  else if (e.type === 'notice') console.log('ℹ', e.text);
  else if (e.type === 'team_assign') console.log(`  ↳ ${e.agent}: ${e.provider} · ${e.model}`);
  else if (e.type === 'error') console.log('✗ ERROR:', e.message);
});

const task = process.argv[2] || 'GitHub va HuggingFace\'da o\'zbek tili uchun eng yaxshi ochiq kodli STT (nutqdan matn) va TTS (matndan nutq) loyihalarni topib, 3-4 qatorli qisqa ro\'yxat qilib ber. Fayl yaratma, faqat javob yoz.';
console.log('VAZIFA:', task.slice(0, 120));
const t0 = Date.now();
const res = await runner.run({ task });
console.log(`--- RESULT (${((Date.now() - t0) / 1000).toFixed(0)}s) ---`);
console.log(String(res.content).slice(0, 700));
process.exit(0);
