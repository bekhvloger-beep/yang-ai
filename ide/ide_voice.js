// ide_voice.js — lokal ovozli buyruqlar uchun IPC qatlami (IDE main jarayoni).
//
// Nima uchun alohida modul: ovoz mantiqi (`agent/local_voice.js`) oddiy Node da ishlaydi
// (whisper.cpp ikkilik fayli + rubaistt modeli), lekin IDE unga faqat IPC orqali murojaat
// qiladi. Bu yerda faqat: (1) model/ikkilik papkalarini ilovaning haqiqiy joylariga
// sozlash, (2) mikrofon buferini qabul qilib matnga aylantirish, (3) matnni ALLOWLIST
// bo‘yicha buyruqqa aylantirish. Hech qanday matn shell buyrug‘i sifatida bajarilmaydi —
// tanilgan buyruq ID si qaytariladi, amalni renderer mavjud tugmalar orqali bajaradi.
import path from 'node:path';
import { ipcMain } from 'electron';
import { configureVoice, voiceStatus, transcribeBuffer, parseCommand, COMMANDS } from '../agent/local_voice.js';

const CH = 'yide';
// WAV chegarasi: 16 kHz mono 16-bit ≈ 32 KB/s; 2 daqiqa ≈ 3,8 MB. Base64 ~33% qo‘shadi.
const MAX_WAV_BYTES = 12 * 1024 * 1024;
let ipcRegistered = false;

/**
 * @param {{ dirs?: string[] }} opts  model/ikkilik qidiriladigan papkalar (ilova joylari).
 */
export function registerVoiceIpc({ dirs = [] } = {}) {
  configureVoice({ dirs });
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle(`${CH}:voice-status`, () => {
    const st = voiceStatus();
    return { ...st, commands: COMMANDS.map((c) => ({ id: c.id, label: c.label, needsArg: c.needsArg })) };
  });

  // Renderer 16 kHz mono WAV ni base64 qilib yuboradi (Web Audio — brauzerda ishlaydi).
  ipcMain.handle(`${CH}:voice-transcribe`, async (_e, { wavBase64 } = {}) => {
    const b64 = String(wavBase64 || '');
    if (!b64) return { error: 'ovoz yuborilmadi' };
    let buf;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch {
      return { error: 'ovoz ma’lumoti o‘qilmadi (base64 xato)' };
    }
    if (!buf.length) return { error: 'ovoz buferi bo‘sh' };
    if (buf.length > MAX_WAV_BYTES) {
      return { error: `ovoz juda katta (${Math.round(buf.length / 1048576)} MB) — qisqaroq gapiring` };
    }
    return transcribeBuffer(buf);   // { ok, text, seconds } yoki { error }
  });

  // Matn → buyruq. FAQAT allowlist; tanilmagan matn `{ ok: false, reason }` bo‘lib qaytadi.
  ipcMain.handle(`${CH}:voice-command`, (_e, { text } = {}) => {
    const parsed = parseCommand(String(text || ''));
    if (!parsed) return { ok: false, reason: 'bu buyruq ro‘yxatda yo‘q — hech narsa bajarilmadi' };
    return { ok: true, command: { id: parsed.command, label: parsed.label, arg: parsed.arg || '', missingArg: !!parsed.missingArg } };
  });
}

/**
 * Model va ikkilik fayl qidiriladigan papkalar (ide_models bilan bir xil ildizlar).
 * Tartib = ustuvorlik: foydalanuvchi yuklagani avval, ilova bilan kelgani keyin.
 */
export function voiceModelDirs({ userModelsDir, bundledModelsDir }) {
  return [
    path.join(userModelsDir(), 'voice'),
    path.join(bundledModelsDir(), 'voice'),
    path.join(bundledModelsDir(), 'lc'),
  ];
}
