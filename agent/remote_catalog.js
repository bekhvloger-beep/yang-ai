// remote_catalog.js — admin panel (YANG Admin Desk) tahrirlagan lokal AI katalogi.
//
// Muammo: katalog (`local-ai/catalog.json`) ilova PAKETI ichida keladi, ya'ni model
// tavsifini, yulduzini yoki yuklab olish havolasini o'zgartirish uchun yangi reliz
// chiqarish kerak edi. Endi admin GitHub'dagi `local-ai/catalog.json` ni tahrirlaydi,
// ilova ishga tushganda o'sha faylni tortadi va paketdagi katalog USTIGA qo'yadi:
//   · tavsif (notes), yulduzlar (strength/level), minimal RAM/disk/VRAM yangilanadi;
//   · yangi model QO'SHILADI (ro'yxatda ko'rinadi va yuklab olinadi);
//   · model olib tashlanishi mumkin emas — paketdagi yozuv qoladi (ilova bilan kelgan
//     nusxa baribir o'rnatilgan bo'lishi mumkin), shuning uchun admin faqat tahrirlaydi.
//
// Bu modul HOLATNI saqlaydi (singleton): `main.js` bir marta `setRemoteCatalog()`
// chaqiradi, `ide/ide_models.js` esa `mergeCatalog()` orqali o'qiydi.
let remote = null;

/** GitHub'dan olingan katalogni o'rnatadi. Noto'g'ri shakl (items yo'q) — rad etiladi. */
export function setRemoteCatalog(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.items)) return false;
  remote = json;
  return true;
}

export function getRemoteCatalog() {
  return remote;
}

export function clearRemoteCatalog() {
  remote = null;
}

// Admin tahrirlashi mumkin bo'lgan maydonlar. `id` va `file` — kalit/identifikator,
// ularni ham yangilash mumkin, lekin `id` bo'yicha bog'lash uchun `id` o'zgarmasligi
// tavsiya etiladi (Admin Desk'da `id` faqat o'qish uchun).
const EDITABLE_FIELDS = [
  'name', 'kind', 'file', 'bytes', 'url', 'backend', 'subdir', 'extract', 'extractTo',
  'min', 'recommend', 'strength', 'level', 'langs', 'notes', 'image', 'measured', 'bundled',
];

/**
 * Paketdagi katalogni admin nusxasi bilan birlashtiradi.
 * @param {{items?: Array}} local  paketdagi (yoki o'lchov qo'llangan) katalog
 * @returns {{items: Array, remote?: boolean}}  birlashgan katalog (yangi obyekt)
 */
export function mergeCatalog(local) {
  const base = local && typeof local === 'object' ? local : { items: [] };
  if (!Array.isArray(base.items)) base.items = [];
  if (!remote) return base;

  const byId = new Set(base.items.map((x) => x && x.id));
  const items = base.items.map((item) => {
    const r = remote.items.find((x) => x && x.id === item.id);
    if (!r) return item;
    const merged = { ...item };
    for (const f of EDITABLE_FIELDS) if (r[f] !== undefined) merged[f] = r[f];
    return merged;
  });

  // Faqat admin nusxasida bor (yangi qo'shilgan) modellar ham ro'yxatga kiradi.
  for (const r of remote.items) {
    if (!r || !r.id || byId.has(r.id)) continue;
    if (!r.name || !r.file) continue;          // yaroqsiz yozuv o'tkazib yuboriladi
    items.push(r);
    byId.add(r.id);
  }

  return {
    ...base,
    items,
    levels: remote.levels || base.levels,
    updated: remote.updated || base.updated,
    remote: true,
  };
}
