// formats.js — zero-dependency document/image toolkit.
// Writers: PNG (with 3x5 bitmap font), PDF, DOCX, XLSX, ICO, ZIP.
// Readers/extractors: PDF text, DOCX text, XLSX TSV, plain text.
import zlib from 'node:zlib';

/* ================= CRC32 ================= */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ================= ZIP ================= */
export function zipCreate(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dosTime = 0, dosDate = 0x5921; // fixed valid date
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const useDeflate = !e.store && data.length > 40;
    const comp = useDeflate ? zlib.deflateRawSync(data, { level: 6 }) : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const b of centrals) centralSize += b.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

export function zipRead(buf) {
  // find EOCD
  let eocd = -1;
  const start = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP: EOCD topilmadi');
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('ZIP: central dir buzilgan');
    const method = buf.readUInt16LE(ptr + 10);
    const csize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    const lnLen = buf.readUInt16LE(localOffset + 26);
    const leLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lnLen + leLen;
    const data = buf.subarray(dataStart, dataStart + csize);
    files[name] = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ================= PNG (write) ================= */
function parseColor(c, fallback = [0, 0, 0]) {
  if (Array.isArray(c)) return [c[0] | 0, c[1] | 0, c[2] | 0];
  if (typeof c === 'string') {
    const m = c.match(/^#?([0-9a-f]{6})$/i);
    if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
    const named = { red: [230, 57, 70], green: [42, 157, 94], blue: [42, 110, 245], yellow: [255, 196, 0], orange: [245, 130, 32], white: [255, 255, 255], black: [15, 17, 23], gray: [128, 134, 150], purple: [140, 90, 240], teal: [53, 195, 154] };
    if (named[c.toLowerCase()]) return named[c.toLowerCase()];
  }
  return fallback;
}

// 3x5 bitmap font (rows of 3 bits), used for text in images.
const FONT3x5 = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001010010',
  '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101110100110101', L: '100100100100111',
  M: '101111111101101', N: '101111111111101', O: '010101101101010', P: '110101110100100',
  Q: '010101101011001', R: '110101110110101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  ' ': '000000000000000', '.': '000000000000010', ',': '000000000010100', ':': '000010000010000',
  '!': '010010010000010', '?': '110001010000010', '-': '000000111000000', '+': '000010111010000',
  '/': '001001010100100', '*': '101010111010101', '(': '010100100100010', ')': '010001001001010',
  '=': '000111000111000', '<': '001010100010001', '>': '100010001010100', '%': '101001010100101',
  '#': '101111101111101', '_': '000000000000111', "'": '010010000000000', '"': '110110000000000',
  '|': '010010010010010', ';': '000010000010100',
};

export function createPng({ width, height, background = '#ffffff', ops = [] }) {
  const img = Buffer.alloc(width * height * 3);
  const bg = parseColor(background, [255, 255, 255]);
  for (let i = 0; i < width * height; i++) {
    img[i * 3] = bg[0]; img[i * 3 + 1] = bg[1]; img[i * 3 + 2] = bg[2];
  }
  const px = (x, y, c) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 3;
    img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2];
  };
  const fillRect = (x, y, w, h, c) => {
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++) for (let xx = Math.round(x); xx < Math.round(x + w); xx++) px(xx, yy, c);
  };
  const strokeRect = (x, y, w, h, c, t = 1) => {
    fillRect(x, y, w, t, c); fillRect(x, y + h - t, w, t, c);
    fillRect(x, y, t, h, c); fillRect(x + w - t, y, t, h, c);
  };
  const drawLine = (x1, y1, x2, y2, c, t = 1) => {
    const dx = x2 - x1, dy = y2 - y1;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 0; i <= steps; i++) {
      const x = x1 + (dx * i) / steps, y = y1 + (dy * i) / steps;
      if (t <= 1) px(x, y, c);
      else fillRect(x - (t - 1) / 2, y - (t - 1) / 2, t, t, c);
    }
  };
  const fillCircle = (cx, cy, r, c) => {
    for (let yy = Math.round(cy - r); yy <= Math.round(cy + r); yy++) {
      for (let xx = Math.round(cx - r); xx <= Math.round(cx + r); xx++) {
        const d = (xx - cx) ** 2 + (yy - cy) ** 2;
        if (d <= r * r) px(xx, yy, c);
      }
    }
  };
  const strokeCircle = (cx, cy, r, c, t = 1) => {
    for (let a = 0; a < 360; a += 0.4) {
      const rad = (a * Math.PI) / 180;
      for (let k = 0; k < t; k++) px(cx + Math.cos(rad) * (r - k), cy + Math.sin(rad) * (r - k), c);
    }
  };
  const fillPolygon = (points, c) => {
    const ys = points.map((p) => p[1]);
    const minY = Math.floor(Math.min(...ys)), maxY = Math.ceil(Math.max(...ys));
    for (let y = minY; y <= maxY; y++) {
      const xs = [];
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % points.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.round(xs[i]); x <= Math.round(xs[i + 1]); x++) px(x, y, c);
    }
  };
  const drawText = (x, y, text, c, scale = 2) => {
    let cx = Math.round(x);
    const cy = Math.round(y);
    for (const ch of String(text).toUpperCase()) {
      const g = FONT3x5[ch];
      if (!g) { cx += 2 * scale; continue; }
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 3; col++) {
          if (g[row * 3 + col] === '1') fillRect(cx + col * scale, cy + row * scale, scale, scale, c);
        }
      }
      cx += 4 * scale;
    }
  };

  for (const op of ops || []) {
    const c = parseColor(op.color, [0, 0, 0]);
    switch ((op.op || '').toLowerCase()) {
      case 'fill': fillRect(0, 0, width, height, c); break;
      case 'rect': op.fill === false ? strokeRect(op.x, op.y, op.w, op.h, c, op.thick || 1) : fillRect(op.x, op.y, op.w, op.h, c); break;
      case 'line': drawLine(op.x1, op.y1, op.x2, op.y2, c, op.thick || 1); break;
      case 'circle': op.fill === false ? strokeCircle(op.cx, op.cy, op.r, c, op.thick || 1) : fillCircle(op.cx, op.cy, op.r, c); break;
      case 'polygon': op.fill === false ? pointsStroke(op.points, c, op.thick || 1) : fillPolygon(op.points, c); break;
      case 'text': drawText(op.x, op.y, op.text, c, op.scale || 2); break;
      default: break;
    }
  }
  function pointsStroke(points, c, t) {
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % points.length];
      drawLine(x1, y1, x2, y2, c, t);
    }
  }

  // encode PNG (RGB, 8-bit)
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    img.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function pngToIco(pngBuf) {
  const head = Buffer.alloc(6 + 16);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  head[6] = 0; head[7] = 0; // 256
  head[8] = 0; head[9] = 0;
  head.writeUInt16LE(1, 10);
  head.writeUInt16LE(32, 12);
  head.writeUInt32LE(pngBuf.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, pngBuf]);
}

/* ================= PDF (write) ================= */
function pdfEscape(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
function toLatin(s) {
  return String(s).replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/…/g, '...').replace(/[^\x00-\xFF]/g, '?');
}
function wrapText(text, maxChars) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      if ((line + ' ' + word).trim().length > maxChars) {
        if (line) out.push(line.trim());
        line = word.length > maxChars ? '' : word;
        if (word.length > maxChars) {
          for (let i = 0; i < word.length; i += maxChars) out.push(word.slice(i, i + maxChars));
        }
      } else line = (line ? line + ' ' : '') + word;
    }
    if (line.trim()) out.push(line.trim());
  }
  return out;
}

export function createPdf({ title, paragraphs = [] }) {
  const pages = [];
  const LINES_PER_PAGE = 46;
  let cur = [];
  const flush = () => { if (cur.length) { pages.push(cur); cur = []; } };
  let first = true;
  for (const para of paragraphs.length ? paragraphs : ['']) {
    const lines = wrapText(toLatin(para), 92);
    for (const l of lines) {
      if (cur.length >= LINES_PER_PAGE) flush();
      cur.push(l);
    }
    cur.push('');
    if (first && title) {
      cur.unshift('@@TITLE@@' + toLatin(title));
      first = false;
    }
  }
  flush();
  if (!pages.length) pages.push(['(bo\u0148sh hujjat)']);

  const contents = pages.map((lines) => {
    let y = 736;
    let s = '';
    for (const l of lines) {
      if (l.startsWith('@@TITLE@@')) {
        s += `BT /F2 16 Tf 56 ${y} Td (${pdfEscape(l.slice(9))}) Tj ET\n`;
        y -= 26;
      } else {
        s += `BT /F1 10.5 Tf 56 ${y} Td (${pdfEscape(l)}) Tj ET\n`;
        y -= 14.5;
      }
    }
    return s;
  });

  const objs = [];
  const addObj = (body) => { objs.push(body); return objs.length; };
  const font1 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const font2 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds = [];
  const contentIds = [];
  for (const c of contents) contentIds.push(addObj(`<< /Length ${Buffer.byteLength(c)} >>\nstream\n${c}endstream`));
  // pages tree added after page objects; reserve ids
  const pagesIdPlaceholder = objs.length + contents.length + 1;
  for (let i = 0; i < contents.length; i++) {
    pageIds.push(addObj(`<< /Type /Page /Parent ${pagesIdPlaceholder} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`));
  }
  const pagesId = addObj(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  if (pagesId !== pagesIdPlaceholder) {
    // re-serialize with correct parent id (rarely differs; keep safe)
  }
  const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/* PDF text extraction (best-effort) */
export function pdfExtractText(buf) {
  const raw = Buffer.from(buf);
  const texts = [];
  const streamRe = /stream\r?\n?/g;
  let m;
  while ((m = streamRe.exec(raw.toString('latin1'))) !== null) {
    const start = m.index + m[0].length;
    const end = raw.toString('latin1').indexOf('endstream', start);
    if (end < 0) break;
    let chunkBuf = raw.subarray(start, end);
    let content;
    try {
      content = zlib.inflateSync(chunkBuf).toString('latin1');
    } catch {
      content = chunkBuf.toString('latin1');
      if (!/Tj|TJ/.test(content)) continue;
    }
    // T* / TD / Td -> line breaks
    content = content.replace(/T\*|TD|Td/g, '\n@LB@\n');
    const parts = [];
    const tokenRe = /\(((?:\\.|[^\\()])*)\)\s*(Tj|TJ)|\@LB\@|\[((?:[^\]])*)\]\s*TJ/g;
    let t;
    while ((t = tokenRe.exec(content)) !== null) {
      if (t[0] === '@LB@') { parts.push('\n'); continue; }
      const str = t[1] !== undefined ? t[1] : t[2];
      if (str !== undefined) {
        parts.push(str.replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }[c] || c))
          .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8))));
      }
    }
    texts.push(parts.join(''));
  }
  return texts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ================= DOCX ================= */
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlDe = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');

export function createDocx({ title, paragraphs = [] }) {
  const paras = [];
  if (title) paras.push({ text: title, heading: true });
  for (const p of paragraphs) paras.push(typeof p === 'string' ? { text: p } : p);
  const body = paras.map((p) => {
    const rpr = p.heading ? '<w:rPr><w:b /><w:sz w:val="30" /></w:rPr>' : '<w:rPr><w:sz w:val="22" /></w:rPr>';
    const lines = String(p.text).split('\n');
    const runs = lines.map((l) => `<w:r>${rpr}<w:t xml:space="preserve">${xmlEsc(l)}</w:t></w:r>`).join('<w:br />');
    return `<w:p>${runs}</w:p>`;
  }).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838" /><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" /></w:sectPr></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Default Extension="xml" ContentType="application/xml" /><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" /></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml" /></Relationships>`;
  return zipCreate([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: documentXml },
  ]);
}

export function docxExtractText(buf) {
  const files = zipRead(buf);
  const doc = files['word/document.xml'];
  if (!doc) throw new Error('DOCX: word/document.xml topilmadi');
  return xmlDe(doc.toString('utf8')
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
}

/* ================= XLSX ================= */
function colName(i) {
  let s = '';
  i += 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

export function createXlsx({ sheets }) {
  const entries = [];
  const sheetTags = sheets.map((s, i) => `<sheet name="${xmlEsc((s.name || `Sheet${i + 1}`).slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}" />`).join('');
  entries.push({ name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Default Extension="xml" ContentType="application/xml" /><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" />${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" />`).join('')}</Types>` });
  entries.push({ name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml" /></Relationships>` });
  entries.push({ name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>` });
  entries.push({ name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml" />`).join('')}</Relationships>` });
  sheets.forEach((sheet, si) => {
    const rowsXml = (sheet.rows || []).map((row, ri) => {
      const cells = (row || []).map((cell, ci) => {
        if (cell == null || cell === '') return '';
        if (typeof cell === 'number' && isFinite(cell)) return `<c r="${colName(ci)}${ri + 1}"><v>${cell}</v></c>`;
        return `<c r="${colName(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cell)}</t></is></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    entries.push({ name: `xl/worksheets/sheet${si + 1}.xml`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>` });
  });
  return zipCreate(entries);
}

export function xlsxExtractText(buf) {
  const files = zipRead(buf);
  const shared = [];
  if (files['xl/sharedStrings.xml']) {
    const sis = files['xl/sharedStrings.xml'].toString('utf8').match(/<si[\s\S]*?<\/si>/g) || [];
    for (const si of sis) shared.push(xmlDe([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('')));
  }
  const sheetNames = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  let wbNames = [];
  if (files['xl/workbook.xml']) {
    wbNames = [...files['xl/workbook.xml'].toString('utf8').matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => xmlDe(m[1]));
  }
  const out = [];
  for (let i = 0; i < sheetNames.length; i++) {
    out.push(`--- ${wbNames[i] || sheetNames[i].replace('xl/worksheets/', '').replace('.xml', '')} ---`);
    const xml = files[sheetNames[i]].toString("utf8");
    const rows = xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
    for (const row of rows) {
      const cells = [...row.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].map((cm) => {
        const t = (cm[1].match(/t="(\w+)"/) || [])[1];
        const inner = cm[2];
        if (t === 's') {
          const v = inner.match(/<v>(\d+)<\/v>/);
          return v ? shared[+v[1]] ?? '' : '';
        }
        if (t === 'inlineStr') {
          return xmlDe([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
        }
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        return v ? v[1] : '';
      });
      out.push(cells.join('\t'));
    }
  }
  return out.join('\n');
}

/* ================= generic extraction ================= */
const TEXT_EXTS = new Set(['.txt', '.md', '.json', '.csv', '.tsv', '.log', '.xml', '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.rb', '.php', '.sh', '.bat', '.ps1', '.sql', '.yml', '.yaml', '.ini', '.cfg', '.toml', '.env', '.svg', '.vue', '.svelte']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

export function classifyFile(ext) {
  ext = ext.toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (ext === '.xlsx' || ext === '.xlsm') return 'xlsx';
  if (ext === '.doc') return 'doc-legacy';
  if (ext === '.xls') return 'xls-legacy';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (TEXT_EXTS.has(ext)) return 'text';
  return 'binary';
}

export function extractText(ext, buf) {
  const kind = classifyFile(ext);
  switch (kind) {
    case 'pdf': return pdfExtractText(buf);
    case 'docx': return docxExtractText(buf);
    case 'xlsx': case 'xlsm': return xlsxExtractText(buf);
    case 'text': return buf.toString('utf8');
    default: throw new Error(`Bu formatdan matn ajratib olinmaydi (${ext})`);
  }
}
