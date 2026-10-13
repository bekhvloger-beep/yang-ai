// Zero-LLM roundtrip tests for formats.js and the new tools.
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { zipCreate, zipRead, createDocx, docxExtractText, createXlsx, xlsxExtractText, createPdf, pdfExtractText, createPng } from './formats.js';
import { createToolContext } from './tools.js';

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fmt-test-'));

// 1. zip roundtrip
{
  const data = Buffer.from('salom zip dunyo! ' + 'x'.repeat(2000));
  const z = zipCreate([{ name: 'a.txt', data }, { name: 'dir/b.txt', data: Buffer.from('ikkinchi') }]);
  const files = zipRead(z);
  check('zip roundtrip', files['a.txt'].equals(data) && files['dir/b.txt'].toString() === 'ikkinchi');
}

// 2. docx
{
  const buf = createDocx({ title: 'Hisobot 2026', paragraphs: ['Birinchi bo‘lim matni.', 'Ikkinchi bo‘lim:\n- punk A\n- punk B'] });
  await fsp.writeFile(path.join(dir, 't.docx'), buf);
  const text = docxExtractText(buf);
  check('docx create+extract', text.includes('Hisobot 2026') && text.includes('punk B'), text.slice(0, 60).replace(/\n/g, ' '));
}

// 3. xlsx
{
  const buf = createXlsx({ sheets: [{ name: 'Sotuv', rows: [['Mahsulot', 'Narx'], ['Olma', 12000], ['Banan', 8000]] }, { name: 'Xulosa', rows: [['Jami', 20000]] }] });
  await fsp.writeFile(path.join(dir, 't.xlsx'), buf);
  const text = xlsxExtractText(buf);
  check('xlsx create+extract', text.includes('Mahsulot') && text.includes('12000') && text.includes('Xulosa'), text.slice(0, 60).replace(/\n/g, ' '));
}

// 4. pdf
{
  const buf = createPdf({ title: 'Test Hujjat', paragraphs: ['Bu birinchi paragraf. Uzbek lotin harflari: O‘zbekiston.', 'Ikkinchi paragraf — 2026 yil statistikasi: 45% o‘sish.'] });
  await fsp.writeFile(path.join(dir, 't.pdf'), buf);
  const text = pdfExtractText(buf);
  check('pdf create+extract', text.includes('Test Hujjat') && text.includes('statistikasi'), text.slice(0, 60).replace(/\n/g, ' '));
}

// 5. png with font text
{
  const png = createPng({
    width: 400, height: 260, background: '#ffffff',
    ops: [
      { op: 'fill', color: '#0f1117' },
      { op: 'rect', x: 30, y: 170, w: 60, h: 60, color: '#6c8cff' },
      { op: 'circle', cx: 200, cy: 200, r: 30, color: '#35c39a' },
      { op: 'line', x1: 30, y1: 150, x2: 370, y2: 150, color: '#888888', thick: 2 },
      { op: 'text', x: 30, y: 40, text: 'Sales 2026: 45%', color: '#ffffff', scale: 3 },
      { op: 'polygon', points: [[300, 140], [340, 100], [380, 140]], color: '#ffb454', fill: true },
    ],
  });
  await fsp.writeFile(path.join(dir, 't.png'), png);
  const sigOk = png[0] === 0x89 && png.toString('ascii', 1, 4) === 'PNG';
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  check('png create', sigOk && w === 400 && h === 260 && png.length > 500, `${png.length}B`);
}

// 6. via tools context (what the agent uses)
{
  const ctx = createToolContext({ workspace: dir });
  const r1 = await ctx.execute('create_document', { path: 'report.pdf', title: 'Hisobot', paragraphs: ['Assalomu alaykum', 'Ikkinchi qator'] });
  const r2 = await ctx.execute('extract_file', { path: 'report.pdf' });
  check('tools create_document(pdf) + extract_file', r1.includes('PDF') && r2.includes('Assalomu'));
  const r3 = await ctx.execute('create_document', { path: 'jadval.xlsx', sheets: [{ name: 'Sheet1', rows: [['A', 'B'], [1, 2]] }] });
  const r4 = await ctx.execute('extract_file', { path: 'jadval.xlsx' });
  check('tools create_document(xlsx) + extract_file', r3.includes('XLSX') && r4.includes('A'));
  const r5 = await ctx.execute('create_document', { path: 'hujjat.docx', title: 'Word Hujjat', paragraphs: ['Salom DOCX'] });
  const r6 = await ctx.execute('extract_file', { path: 'hujjat.docx' });
  check('tools create_document(docx) + extract_file', r5.includes('DOCX') && r6.includes('Salom DOCX'));
  const r7 = await ctx.execute('create_document', { path: 'data.csv', rows: [['ism', 'yosh'], ['Ali', 25]] });
  const csv = await fsp.readFile(path.join(dir, 'data.csv'), 'utf8');
  check('tools create_document(csv)', r7.includes('CSV') && csv.includes('ism,yosh') && csv.includes('Ali,25'));
  const r8 = await ctx.execute('create_image', { path: 'chart.png', width: 320, height: 200, background: '#ffffff', ops: [{ op: 'rect', x: 20, y: 100, w: 40, h: 80, color: '#6c8cff' }, { op: 'text', x: 20, y: 20, text: 'CHART', color: '#111111', scale: 3 }] });
  const pngBuf = await fsp.readFile(path.join(dir, 'chart.png'));
  check('tools create_image(png)', r8.includes('PNG') && pngBuf[0] === 0x89);
}

console.log(failed ? `\n=== FORMATS: ${failed} FAILED ===` : '\n=== FORMATS: ALL PASS ===');
process.exit(failed ? 1 : 0);
