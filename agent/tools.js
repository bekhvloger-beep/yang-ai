// tools.js — built-in agent tools: files, search, shell, document/image creation & extraction. Pure Node.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { createPdf, createDocx, createXlsx, createPng, extractText, classifyFile } from './formats.js';
import { generateImage } from './imagegen.js';

const READ_LIMIT = 40000; // chars per read_file
const OUT_LIMIT = 12000; // chars for command output / tool results

function truncate(s, limit = OUT_LIMIT) {
  if (typeof s !== 'string') s = String(s);
  return s.length > limit ? s.slice(0, limit) + `\n...[kesildi, jami ${s.length} belgi]` : s;
}

export const TOOL_SPECS = [
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and folders in a directory (relative to the workspace unless absolute).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path. "." means workspace root.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file. Returns up to ~40k characters, truncated with a notice if longer.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          offset: { type: 'integer', description: 'Optional 1-based line to start from.' },
          limit: { type: 'integer', description: 'Optional max lines to read.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file with the given content. Parent directories are created automatically.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace an exact unique substring in a file. old_string must match exactly once, otherwise an error is returned.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search file contents in the workspace for a text or regex pattern. Skips node_modules, .git, dist, build, __pycache__ and binary files.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          sub_path: { type: 'string', description: 'Optional subdirectory to search in.' },
          is_regex: { type: 'boolean', description: 'Treat pattern as a regular expression. Default false.' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the workspace (cmd.exe on Windows). Use for builds, package managers, tests, git. Timeout 120s.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          cwd: { type: 'string', description: 'Optional working directory relative to workspace.' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'extract_file',
      description: 'Extract readable text from a document: PDF, DOCX, XLSX, CSV, JSON and plain text formats. Use this for formats read_file cannot parse.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_document',
      description: 'Create a real document file: PDF (.pdf), Word (.docx), Excel (.xlsx) or CSV (.csv). For pdf/docx pass "paragraphs" (array of text blocks); for xlsx pass "sheets" [{name, rows:[[cell,...],...]}]; for csv pass "rows".',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target file path, extension decides format (.pdf, .docx, .xlsx, .csv)' },
          title: { type: 'string', description: 'Optional document title (pdf/docx)' },
          paragraphs: { type: 'array', items: { type: 'string' }, description: 'Text blocks for pdf/docx' },
          sheets: {
            type: 'array',
            description: 'For xlsx: list of sheets',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                rows: { type: 'array', items: { type: 'array', items: {} } },
              },
            },
          },
          rows: { type: 'array', items: { type: 'array', items: {} }, description: 'For csv: rows of cells' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_image',
      description: 'Create a PNG image (charts, diagrams, mockups) with draw operations. Ops: {op:"fill",color}, {op:"rect",x,y,w,h,color,fill}, {op:"line",x1,y1,x2,y2,color,thick}, {op:"circle",cx,cy,r,color,fill}, {op:"polygon",points:[[x,y],...],color,fill}, {op:"text",x,y,text,color,scale} (uppercase latin+digits only). Colors: "#rrggbb".',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          width: { type: 'integer' },
          height: { type: 'integer' },
          background: { type: 'string', description: 'Background color, default white' },
          ops: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                op: { type: 'string', enum: ['fill', 'rect', 'line', 'circle', 'polygon', 'text'] },
                color: { type: 'string' },
                x: { type: 'integer' }, y: { type: 'integer' }, w: { type: 'integer' }, h: { type: 'integer' },
                x1: { type: 'integer' }, y1: { type: 'integer' }, x2: { type: 'integer' }, y2: { type: 'integer' },
                cx: { type: 'integer' }, cy: { type: 'integer' }, r: { type: 'integer' },
                points: { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
                text: { type: 'string' }, scale: { type: 'integer' },
                thick: { type: 'integer' }, fill: { type: 'boolean' },
              },
            },
          },
        },
        required: ['path', 'width', 'height', 'ops'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: 'Generate a real AI image from a text prompt (photo/illustration quality). Use for artistic images, logos, illustrations. For precise charts/diagrams prefer create_image.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed English image prompt works best' },
          path: { type: 'string', description: 'Target file path (.png/.jpg)' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the internet (DuckDuckGo, Wikipedia fallback) and get titles, URLs and snippets. Use when the answer needs current facts, prices, news, docs or links.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (any language).' },
          max_results: { type: 'integer', description: 'How many results (1-8, default 5).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Open a web page and return its readable text (HTML is stripped). Use after web_search to read a specific result.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full http(s) URL.' },
          max_chars: { type: 'integer', description: 'Max characters to return (500-20000, default 6000).' },
        },
        required: ['url'],
      },
    },
  },
];

// ---------- internet (qidiruv + sahifani o'qish) ----------
// Agent internetdan ma'lumot olayotganda UI qidiruv oynasini ko'rsatadi (kichik brauzer).
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 YANGAI/4.0';
const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&hellip;': '…', '&mdash;': '—', '&ndash;': '–' };

function decodeEntities(s) {
  return String(s)
    .replace(/&(nbsp|amp|lt|gt|quot|#39|#x27|hellip|mdash|ndash);/g, (m) => ENTITIES[m] || m)
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}

// HTML → o'qiladigan matn (skript/uslub/teglar olib tashlanadi).
function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/td)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeUrl(u) {
  try {
    let s = decodeEntities(u).trim();
    // DuckDuckGo protokol-nisbiy havola beradi (//duckduckgo.com/l/?uddg=...) — sxema qo'shamiz.
    if (s.startsWith('//')) s = 'https:' + s;
    const url = new URL(s);
    // Natija havolalari /l/?uddg=<encoded> orqali keladi — asl manzilga qaytaramiz.
    if (/duckduckgo\.com$/i.test(url.hostname) && url.pathname === '/l/' && url.searchParams.get('uddg')) {
      return url.searchParams.get('uddg');
    }
    return url.href;
  } catch {
    return String(u);
  }
}

function parseDdgResults(html, max) {
  const out = [];
  const titles = [...String(html).matchAll(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...String(html).matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
  for (let i = 0; i < titles.length && out.length < max; i++) {
    const url = normalizeUrl(titles[i][1]);
    if (!/^https?:/i.test(url)) continue;
    out.push({
      title: htmlToText(titles[i][2]) || url,
      url,
      snippet: snippets[i] ? htmlToText(snippets[i][1]) : '',
    });
  }
  return out;
}

// Zaxira qidiruv: Wikipedia (ochiq API, kalitsiz) — DDG bloklangan/parse bo'lmagan holatda.
async function wikiSearch(query, max) {
  for (const lang of ['uz', 'en']) {
    try {
      const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${max}&format=json&utf8=1&origin=*`;
      const res = await fetch(url, { headers: { 'user-agent': WEB_UA }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const j = await res.json();
      const hits = (j && j.query && j.query.search) || [];
      const out = hits.map((h) => ({
        title: h.title,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(h.title).replace(/ /g, '_'))}`,
        snippet: htmlToText(h.snippet || ''),
      }));
      if (out.length) return out;
    } catch {}
  }
  return [];
}

// run_command dan keyin workspace'da yangi paydo bo'lgan/o'zgargan fayllarni topadi
// (mtime bo'yicha) — python natijasini UI'da darhol ko'rsatish uchun.
async function findRecentFiles(root, sinceMs, limit = 8) {
  const out = [];
  const walk = async (dir, depth) => {
    if (out.length >= limit || depth > 3) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        await walk(full, depth + 1);
      } else {
        if (e.name.startsWith('.')) continue;
        try {
          const st = await fsp.stat(full);
          if (st.mtimeMs >= sinceMs) out.push(path.relative(root, full).replace(/\\/g, '/'));
        } catch {}
      }
    }
  };
  await walk(root, 0);
  return out;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv', '.next', 'out']);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.7z', '.rar', '.gz', '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.db', '.sqlite', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.mp4', '.avi', '.mov', '.class', '.jar', '.wasm']);

export function createToolContext({ workspace, config, registerChild }) {
  // Tool bajarilgandan keyin UI ko'rsatadigan qo'shimcha ma'lumot (yaratilgan fayllar).
  let recentFiles = [];
  const resolveInWorkspace = (p) => {
    if (!p || p === '.' || p === './') return workspace;
    return path.isAbsolute(p) ? path.normalize(p) : path.normalize(path.join(workspace, p));
  };

  async function listDir(args) {
    const dir = resolveInWorkspace(args.path);
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    if (!entries.length) return '(bo‘sh papka)';
    const lines = [];
    for (const e of entries.slice(0, 500)) {
      if (e.isDirectory()) lines.push(`[DIR]  ${e.name}/`);
      else {
        let size = '';
        try {
          const st = await fsp.stat(path.join(dir, e.name));
          size = ` (${st.size} B)`;
        } catch {}
        lines.push(`[FILE] ${e.name}${size}`);
      }
    }
    return lines.join('\n');
  }

  async function readFile(args) {
    const file = resolveInWorkspace(args.path);
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat) throw new Error('Fayl topilmadi: ' + args.path);
    if (stat.isDirectory()) throw new Error('Bu papka, fayl emas: ' + args.path);
    const ext = path.extname(file).toLowerCase();
    if (['.pdf', '.docx', '.xlsx'].includes(ext)) throw new Error(`${ext} fayl read_file bilan o‘qilmaydi — extract_file tool’idan foydalaning.`);
    if (BINARY_EXT.has(ext)) throw new Error('Binary fayl matn sifatida o‘qilmaydi: ' + args.path);
    const data = await fsp.readFile(file, 'utf8');
    let text = data;
    let startLine = 1;
    if (args.offset || args.limit) {
      const all = text.split('\n');
      const off = Math.max(1, args.offset || 1);
      startLine = off;
      const lim = args.limit || all.length;
      text = all.slice(off - 1, off - 1 + lim).join('\n');
    }
    if (text.length > READ_LIMIT) text = text.slice(0, READ_LIMIT) + `\n...[kesildi — fayl ${data.length} belgi, read_file offset/limit bilan davom eting]`;
    const numbered = text.split('\n').map((l, i) => `${String(startLine + i).padStart(5)}\t${l}`).join('\n');
    return numbered || '(bo‘sh fayl)';
  }

  async function writeFile(args) {
    if (typeof args.content !== 'string') throw new Error('content matn bo‘lishi kerak');
    const file = resolveInWorkspace(args.path);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, args.content, 'utf8');
    return `Yozildi: ${args.path} (${args.content.length} belgi)`;
  }

  async function editFile(args) {
    const file = resolveInWorkspace(args.path);
    const original = await fsp.readFile(file, 'utf8');
    const oldStr = args.old_string;
    const count = original.split(oldStr).length - 1;
    if (count === 0) throw new Error('old_string faylda topilmadi. Aniq matnni (katakchalar bilan) ko‘chirib qo‘ying.');
    if (count > 1) throw new Error(`old_string faylda ${count} marta uchradi — noyob bo‘lishi shart. Kontekst qo‘shib noyob qiling.`);
    const updated = original.replace(oldStr, args.new_string);
    await fsp.writeFile(file, updated, 'utf8');
    return `Tahrirlandi: ${args.path} (+${args.new_string.length - oldStr.length} belgi)`;
  }

  async function searchFiles(args) {
    const root = resolveInWorkspace(args.sub_path || '.');
    let regex;
    try {
      regex = args.is_regex ? new RegExp(args.pattern, 'i') : new RegExp(args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    } catch (e) {
      throw new Error('Noto‘g‘ri regex: ' + e.message);
    }
    const results = [];
    let skipped = 0;
    const walk = async (dir, depth) => {
      if (results.length >= 60 || depth > 12) return;
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (results.length >= 60) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
          await walk(full, depth + 1);
        } else {
          if (BINARY_EXT.has(path.extname(e.name).toLowerCase())) {
            skipped++;
            continue;
          }
          if (e.name.startsWith('.')) continue;
          let content;
          try {
            const st = await fsp.stat(full);
            if (st.size > 2 * 1024 * 1024) {
              skipped++;
              continue;
            }
            content = await fsp.readFile(full, 'utf8');
          } catch {
            continue;
          }
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${path.relative(workspace, full)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
              if (results.length >= 60) return;
            }
          }
        }
      }
    };
    await walk(root, 0);
    if (!results.length) return `Topilmadi. (Binary/katta fayllar o‘tkazib yuborildi: ${skipped})`;
    return results.join('\n') + (results.length >= 60 ? '\n...[natijalar 60 tagacha chegaralandi]' : '');
  }

  function runCommand(args) {
    const cwd = resolveInWorkspace(args.cwd || '.');
    // Buyruqdan oldingi vaqt — shu vaqtdan keyin o'zgargan fayllarni "natija" sifatida ko'rsatamiz.
    const startedAt = Date.now() - 60;
    return new Promise((resolve, reject) => {
      const child = exec(args.command, { cwd, timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0' } }, async (err, stdout, stderr) => {
        let out = '';
        if (stdout) out += stdout;
        if (stderr) out += (out ? '\n--- stderr ---\n' : '') + stderr;
        if (err) {
          const code = err.code != null ? ` (exit code ${err.code})` : '';
          const killed = err.killed ? ' — timeout bilan o‘ldirildi' : '';
          out += `\n[command failed${code}${killed}]`;
        }
        // Skript yangi fayl yaratgan bo'lishi mumkin — UI ularni ochib ko'rsatadi.
        try {
          recentFiles = await findRecentFiles(workspace, startedAt);
        } catch {
          recentFiles = [];
        }
        if (recentFiles.length) out += `\n[yangi/o‘zgargan fayllar: ${recentFiles.slice(0, 12).join(', ')}]`;
        const output = truncate(out) || '(natija bo‘sh)';
        if (err) {
          // Non-zero exit kodini muvaffaqiyatli tool natijasi sifatida belgilamaslik
          // kerak: modelga xato diagnostikasi qaytadi va AgentEngine tool.ok=false
          // chiqaradi. Shunda coder tuzatib, run_command'ni yana chaqirishi mumkin.
          reject(new Error(output));
          return;
        }
        resolve(output);
      });
      if (registerChild) registerChild(child);
    });
  }

  async function webSearch(args) {
    const q = String(args.query || '').trim();
    if (!q) throw new Error('query kerak');
    const max = Math.min(Math.max(Number(args.max_results) || 5, 1), 8);
    let results = [];
    let via = 'DuckDuckGo';
    try {
      const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), {
        headers: { 'user-agent': WEB_UA, accept: 'text/html', 'accept-language': 'uz,en;q=0.8,ru;q=0.6' },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) results = parseDdgResults(await res.text(), max);
    } catch {}
    if (!results.length) {
      via = 'Wikipedia';
      results = await wikiSearch(q, max);
    }
    if (!results.length) return `🔎 "${q}" — natija topilmadi (internet yoki qidiruv xizmati javob bermadi).`;
    const lines = results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}${r.snippet ? `\n   ${r.snippet.slice(0, 240)}` : ''}`);
    return `🔎 "${q}" — ${results.length} natija (${via}):\n${lines.join('\n')}`;
  }

  async function fetchUrl(args) {
    const target = String(args.url || '').trim();
    if (!/^https?:\/\//i.test(target)) throw new Error('url to‘liq http(s):// manzil bo‘lishi kerak');
    const limit = Math.min(Math.max(Number(args.max_chars) || 6000, 500), 20000);
    const res = await fetch(target, {
      headers: { 'user-agent': WEB_UA, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`Sahifa ochilmadi (HTTP ${res.status})`);
    const ct = res.headers.get('content-type') || '';
    const raw = await res.text();
    let text = /html|xml/i.test(ct) ? htmlToText(raw) : String(raw);
    const title = htmlToText((String(raw).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    if (text.length > limit) text = text.slice(0, limit) + `\n...[qisqartirildi, jami ${text.length} belgi]`;
    return `📄 ${title || '(sarlavhasiz sahifa)'}\n🔗 ${target}\n---\n${text || '(matn topilmadi — sahifa JS bilan yuklanadi)'}`;
  }

  async function extractFile(args) {
    const file = resolveInWorkspace(args.path);
    const buf = await fsp.readFile(file);
    const ext = path.extname(file);
    const kind = classifyFile(ext);
    if (kind === 'image') return `Bu rasm fayli (${ext}). Rasmni ko‘rish uchun foydalanuvchi uni chatga biriktirishi kerak — agentning o‘zi fayldan rasmni o‘qiy olmaydi.`;
    if (kind === 'binary' || kind === 'doc-legacy' || kind === 'xls-legacy') throw new Error(`Bu format qo‘llanmaydi: ${ext} (doc/xls eski formatlar — avval zamonaviy formatga aylantiring)`);
    let text = extractText(ext, buf);
    if (text.length > READ_LIMIT) text = text.slice(0, READ_LIMIT) + `\n...[kesildi, jami ${text.length} belgi]`;
    return text || '(matn topilmadi)';
  }

  async function createDocument(args) {
    const file = resolveInWorkspace(args.path);
    const ext = path.extname(file).toLowerCase();
    await fsp.mkdir(path.dirname(file), { recursive: true });
    if (ext === '.pdf') {
      const paras = (args.paragraphs || []).map((p) => String(p));
      if (!paras.length && args.title) paras.push('');
      await fsp.writeFile(file, createPdf({ title: args.title, paragraphs: paras }));
      return `PDF yaratildi: ${args.path} (${paras.length} bo‘lim)`;
    }
    if (ext === '.docx') {
      await fsp.writeFile(file, createDocx({ title: args.title, paragraphs: (args.paragraphs || []).map(String) }));
      return `DOCX yaratildi: ${args.path}`;
    }
    if (ext === '.xlsx') {
      const sheets = (args.sheets || [{ name: 'Sheet1', rows: args.rows || [] }]).map((s, i) => ({ name: s.name || `Sheet${i + 1}`, rows: s.rows || [] }));
      if (!sheets.length) throw new Error('xlsx uchun sheets kerak');
      await fsp.writeFile(file, createXlsx({ sheets }));
      return `XLSX yaratildi: ${args.path} (${sheets.length} varaq)`;
    }
    if (ext === '.csv') {
      const rows = args.rows || args.sheets?.[0]?.rows || [];
      const esc = (v) => {
        const s = String(v ?? '');
        return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const csv = rows.map((r) => (r || []).map(esc).join(',')).join('\r\n');
      await fsp.writeFile(file, '\ufeff' + csv, 'utf8');
      return `CSV yaratildi: ${args.path} (${rows.length} qator)`;
    }
    throw new Error(`Qo‘llanmaydigan hujjat formati: ${ext} (faqat .pdf, .docx, .xlsx, .csv)`);
  }

  async function createImage(args) {
    const file = resolveInWorkspace(args.path);
    const width = Math.min(Math.max(args.width || 512, 16), 4096);
    const height = Math.min(Math.max(args.height || 512, 16), 4096);
    const png = createPng({ width, height, background: args.background || '#ffffff', ops: args.ops || [] });
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, png);
    return `PNG yaratildi: ${args.path} (${width}x${height}, ${png.length} B)`;
  }

  async function aiGenerateImage(args) {
    if (!args.prompt) throw new Error('prompt kerak');
    const file = resolveInWorkspace(args.path || `image_${Date.now()}.png`);
    const img = await generateImage({ prompt: args.prompt, config: config || {}, registerChildSignal: null });
    const ext = (img.mime || 'image/png').includes('jpeg') ? '.jpg' : (img.mime || '').includes('webp') ? '.webp' : '.png';
    const finalPath = /\.[a-z0-9]+$/i.test(file) ? file : file + ext;
    await fsp.mkdir(path.dirname(finalPath), { recursive: true });
    await fsp.writeFile(finalPath, img.buffer);
    return `Rasm yaratildi: ${path.relative(workspace, finalPath) || finalPath} (${img.buffer.length} B, ${img.mime}) — ${img.via}`;
  }

  return {
    resolveInWorkspace,
    // Tool tugagandan keyin chaqiriladi — yangi fayllar ro'yxatini bir marta qaytaradi.
    takeCreatedFiles: () => {
      const r = recentFiles.slice();
      recentFiles = [];
      return r;
    },
    execute: async (name, args) => {
    switch (name) {
      case 'list_dir': return await listDir(args);
      case 'read_file': return await readFile(args);
      case 'write_file': return await writeFile(args);
      case 'edit_file': return await editFile(args);
      case 'search_files': return await searchFiles(args);
      case 'run_command': return await runCommand(args);
      case 'extract_file': return await extractFile(args);
      case 'create_document': return await createDocument(args);
      case 'create_image': return await createImage(args);
      case 'generate_image': return await aiGenerateImage(args);
      case 'web_search': return await webSearch(args);
      case 'fetch_url': return await fetchUrl(args);
      default: throw new Error(`Noma'lum tool: ${name}`);
    }
  } };
}

export const TOOLS_NEEDING_APPROVAL = new Set(['run_command']);
