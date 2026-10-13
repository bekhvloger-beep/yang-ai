// Test Cohere + SambaNova keys: models, chat, tool calling.
const COHERE = (process.argv[2] || '').trim();
const SAMBA = (process.argv[3] || '').trim();

async function listModels(base, key) {
  const res = await fetch(base + '/models', { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000) });
  const t = await res.text();
  if (!res.ok) return `HTTP ${res.status}: ${t.slice(0, 120)}`;
  try {
    const j = JSON.parse(t);
    return (j.data || []).map((m) => m.id);
  } catch {
    return t.slice(0, 200);
  }
}

async function chat(base, key, model, withTools) {
  const body = { model, messages: [{ role: 'user', content: withTools ? 'What is 2+2? Use the calc tool to answer.' : 'Reply with exactly: OK' }], max_tokens: 4000 };
  if (withTools) {
    body.tools = [{ type: 'function', function: { name: 'calc', description: 'Calculate an expression', parameters: { type: 'object', properties: { expr: { type: 'string' } }, required: ['expr'] } } }];
    body.tool_choice = 'auto';
  }
  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const t = await res.text();
  if (!res.ok) return `HTTP ${res.status}: ${t.slice(0, 140)}`;
  const msg = JSON.parse(t).choices?.[0]?.message || {};
  const tc = msg.tool_calls?.[0];
  return withTools ? (tc ? `TOOL OK: ${tc.function.name}(${String(tc.function.arguments).slice(0, 50)})` : `no tool: ${String(msg.content).slice(0, 60)}`) : `chat OK: ${String(msg.content).slice(0, 40)}`;
}

if (COHERE) {
  console.log('=== COHERE (api.cohere.ai/compatibility/v1) ===');
  const base = 'https://api.cohere.ai/compatibility/v1';
  const models = await listModels(base, COHERE);
  console.log('models:', Array.isArray(models) ? models.join(', ').slice(0, 500) : models);
  const pick = Array.isArray(models) && models.length ? models.find((m) => /command-a|command-r-plus|command/i.test(m)) || models[0] : null;
  if (pick) {
    console.log('chat:', await chat(base, COHERE, pick, false));
    console.log('tools:', await chat(base, COHERE, pick, true));
  }
}

if (SAMBA) {
  console.log('\n=== SAMBANOVA (api.sambanova.ai/v1) ===');
  const base = 'https://api.sambanova.ai/v1';
  const models = await listModels(base, SAMBA);
  console.log('models:', Array.isArray(models) ? models.join(', ').slice(0, 500) : models);
  if (Array.isArray(models) && models.length) {
    const pick = models.find((m) => /Llama-4|Qwen3|gpt-oss/i.test(m) && !/vision|vl/i.test(m)) || models.find((m) => !/embed|vision|guard|vl/i.test(m)) || models[0];
    console.log('tanlangan:', pick);
    console.log('chat:', await chat(base, SAMBA, pick, false));
    console.log('tools:', await chat(base, SAMBA, pick, true));
  }
}
