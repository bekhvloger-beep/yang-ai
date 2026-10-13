// config.js — settings store + .env key import. Pure Node.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export function parseEnvText(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  }
  // DeepSeek key is sometimes pasted as loose text (no KEY= form).
  if (!out.DEEPSEEK_API_KEY) {
    const m = raw.match(/\bsk-(?!or-)[0-9a-f]{16,}\b/);
    if (m) out.DEEPSEEK_API_KEY = m[0];
  }
  // A stray GEMINI key pasted without the KEY= form.
  if (!out.GEMINI_API_KEY) {
    const m = raw.match(/\b(AIza[0-9A-Za-z_-]{30,})\b/);
    if (m) out.GEMINI_API_KEY = m[0];
  }
  // Vercel AI Gateway key (vck_...) pasted as loose text.
  if (!out.VERCEL_API_KEY) {
    const m = raw.match(/\b(vck_[A-Za-z0-9]{20,})\b/);
    if (m) out.VERCEL_API_KEY = m[0];
  }
  // Cohere key (cohere_...) pasted as loose text.
  if (!out.COHERE_API_KEY) {
    const m = raw.match(/\b(cohere_[A-Za-z0-9]{20,})\b/);
    if (m) out.COHERE_API_KEY = m[0];
  }
  return out;
}

const KEY_ENV_MAP = {
  openrouter: ['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  groq: ['GROQ_API_KEY'],
  cerebras: ['CEREBRAS_API_KEY', 'CEREBRAS_KEY'],
  huggingface: ['HF_TOKEN', 'HUGGINGFACE_API_KEY', 'HUGGING_FACE_HUB_TOKEN'],
  together: ['TOGETHER_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  vercel: ['VERCEL_API_KEY'],
  cohere: ['COHERE_API_KEY'],
  sambanova: ['SAMBANOVA_API_KEY'],
  custom: ['CUSTOM_API_KEY'],
};

// Scan candidate .env files and collect whatever keys are found.
export async function importKeysFromEnv(candidates) {
  const found = {};
  const sources = [];
  for (const file of candidates) {
    try {
      const raw = await fsp.readFile(file, 'utf8');
      const parsed = parseEnvText(raw);
      let touched = false;
      for (const [provider, names] of Object.entries(KEY_ENV_MAP)) {
        if (found[provider]) continue;
        for (const n of names) {
          if (parsed[n]) {
            found[provider] = parsed[n];
            touched = true;
            sources.push(`${path.basename(file)} → ${provider}`);
            break;
          }
        }
      }
      if (!touched && parsed.CUSTOM_API_KEY) found.custom = parsed.CUSTOM_API_KEY;
    } catch {
      // file missing/unreadable — skip silently
    }
  }
  return { keys: found, sources };
}

export const DEFAULT_CONFIG = {
  // Kalitsiz nol-sozlama: avval lokal AI (exe ichida), u ishlamasa Kilo gateway, oxirida Pollinations.
  provider: 'localmini',
  model: 'qwen3-instruct',
  keys: {},
  customProviders: [],
  autoApprove: false,
  customBaseUrl: '',
  providerHealth: {},
  pinMode: false, // "Faqat shu modelni ishlatish" — OFF default (eski konfiglarda yo'q = OFF)
  // Balansi/kaliti o'lik provayderlar rotatsiyadan tashqarida.
  disabledProviders: ['deepseek', 'vercel', 'sambanova'],
  // Lokal NLLB tarjimon (translator/server.py). enabled=false bo'lsa tarjimasiz.
  translate: { enabled: true, url: 'http://127.0.0.1:8788', target: 'uzn_Latn' },
};

export async function loadConfig(userDataDir) {
  const file = path.join(userDataDir, 'config.json');
  let cfg = {};
  try {
    cfg = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {}
  const merged = { ...DEFAULT_CONFIG, ...cfg, keys: { ...(cfg.keys || {}) } };
  return { config: merged, file };
}

export async function saveConfig(userDataDir, config) {
  const file = path.join(userDataDir, 'config.json');
  await fsp.mkdir(userDataDir, { recursive: true });
  await fsp.writeFile(file, JSON.stringify(config, null, 2), 'utf8');
  return file;
}

// Chats: one JSON file per chat in userData/chats.
export async function listChats(userDataDir) {
  const dir = path.join(userDataDir, 'chats');
  await fsp.mkdir(dir, { recursive: true });
  const files = await fsp.readdir(dir);
  const chats = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'));
      chats.push({ id: j.id, title: j.title || 'Yangi chat', createdAt: j.createdAt, updatedAt: j.updatedAt, workspace: j.workspace });
    } catch {}
  }
  chats.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return chats;
}

export async function loadChat(userDataDir, id) {
  const file = path.join(userDataDir, 'chats', `${id}.json`);
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

export async function saveChat(userDataDir, chat) {
  const dir = path.join(userDataDir, 'chats');
  await fsp.mkdir(dir, { recursive: true });
  chat.updatedAt = Date.now();
  await fsp.writeFile(path.join(dir, `${chat.id}.json`), JSON.stringify(chat, null, 2), 'utf8');
  return chat;
}

export async function deleteChat(userDataDir, id) {
  await fsp.rm(path.join(userDataDir, 'chats', `${id}.json`), { force: true });
}

export function isProbablyEnvRaw(s) {
  return fs.existsSync(s);
}
