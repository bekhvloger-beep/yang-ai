# YANG AI interfeysi — buzilish sababi va tuzatish

Sana: 2026-10-13 · Fayllar: `renderer/style.css`, `renderer/index.html`, `renderer/app.js`

## 1. Nega interfeys buzilgan edi (o‘lchangan sabab)

`renderer/style.css` da v5 bloki qo‘shilganda `#mainSplit` konteyneriga
`flex-direction: column` yozilmagan edi:

```css
/* XATO (avval) */
#mainSplit { display: flex; flex: 1; min-height: 0; }
#mainSplit > footer#composer { width: 100%; }   /* bu “yamoq” edi */
```

`#mainSplit` ichida topbar, chat va composer ketma-ket turadi — yo‘nalish
ko‘rsatilmagani uchun ular **yonma-yon ustunlarga** aylandi. Natijada:

| Element | Buzilgan holat (o‘lchov) | To‘g‘ri holat |
|---|---|---|
| `#sidebar` | `x = -532` (ekrandan chiqib ketgan) | `x = 0`, `w = 244` |
| `#topbar` | `w = 625`, `h = 835` (butun balandlik) | `w = 1180`, `h = 53` |
| `#composer` | o‘ng tomonda ustun bo‘lib qolgan | pastda, `w = 1180` |
| `#dock` | chat ustiga tushib qolgan | chat ichida o‘ngda, `w = 322` |
| Gorizontal toshish | `overflowX = 532 px` | `overflowX = 0` |

Tuzatish:

```css
#mainSplit { flex: 1; min-height: 0; display: flex; flex-direction: column; }
#mainSplit > footer#composer { flex: none; }
body { display: flex; }                      /* #app + #idePanel yonma-yon */
#app { display: flex; flex: 1; min-width: 0; height: 100vh; }
```

`body { display: flex }` ham qo‘shildi: `#idePanel` `#app` dan keyin oddiy oqimda
qolib, 100vh balandlikda ekrandan pastga chiqib ketardi (🖥 tugmasi panelni ochsa
ham ko‘rinmasdi).

## 2. “Yoshbolacha” ko‘rinish — nima o‘zgardi

| Muammo | Yechim |
|---|---|
| 250+ joyda rangli emoji (🤝 🤖 🎨 📁 ⚡ …) — har platformada har xil chiziladi | Interfeys qobig‘i **monoxrom SVG ikonalar**ga o‘tdi (`<svg class="ico"><use href="#i-…">`), sprite `renderer/index.html` ichida (26 belgi). app.js dagi matn belgilari olib tashlandi |
| Tugma/chip o‘lchamlari har xil edi | `#topbar`, `.chip`, `.icon-btn`, `.mode-btn`, `.bb-chip` — bir xil balandlik va 8px radius |
| Og‘ir gradientlar va “porlab” turgan tugmalar | Tekis yuzalar: `#topbar`/`.dock` — `var(--bg-2)`, `.input-wrap` — `var(--panel)`, `.btn-primary` — tekis aksent |
| Sekin mikro-sarlavhalar | `.dock-title` — katta harfli, `letter-spacing: .9px` |
| Modal ustidan banner chiqib qolardi | `.modal { z-index: 80 }` (banner 60) |
| `vision` yorlig‘i provayder nomiga yopishib qolardi | `.vision-mark` — ramka + `margin-left: 6px` |
| Bo‘sh javob o‘rnida `(javob bo‘sh)` / bo‘sh tugmalar | `javob kutilmadi` (xira), tugmalarga SVG ikona |

Mantiq (app.js) tegilmadi: `✓ ✖ ✕ ⚠ … ⚙` — funksional belgilar o‘z joyida qoldi
(`dockAgentState` ular bilan solishtiradi), model javobini o‘qiydigan regexlar ham.

## 3. Dalillar

| Tekshiruv | Buyruq | Natija |
|---|---|---|
| Buzilgan holat (o‘lchov + skrinshot) | `node scripts/ui_shot.mjs --out reports/ui/before.png` | `mainSplitDir=row`, `overflowX=532` |
| Tuzatilgandan keyin | `node scripts/ui_shot.mjs --dev --out reports/ui/after-fix.png` | `mainSplitDir=column`, `overflowX=0`, 35 SVG ikona, 5 tab |
| Funksional regressiya (modal, pin saqlash, qayta ishga tushish) | `YANG_APP_EXE=x YANG_CDP_PORT=9341 node scripts/ui_pin_test.mjs` | **5/5 PASS** |
| JS sintaksisi / CSS qavslar | `node --check renderer/app.js` | OK · qavslar balansi 0 |

Skrinshotlar: `reports/ui/before.png` (buzilgan), `reports/ui/after-layout.png`,
`reports/ui/after.png`, `reports/ui/after-settings.png`, `reports/ui/after-fix.png`.

## 4. Yo‘l-yo‘lakay tuzatilgan asbob xatolari

- `scripts/ui_pin_test.mjs`: Windows'da `npx.cmd` ni shell'siz spawn qilib bo‘lmaydi
  (Node 20+ `EINVAL`) → endi `electron` paketining exe yo‘li ishlatiladi; CDP porti
  band bo‘lsa bo‘sh port tanlanadi; WebSocket/HTTP so‘rovlarga chegara qo‘yildi
  (o‘lik socket sababli test sababsiz osilib qolardi).
- `scripts/ui_shot.mjs` (yangi): CDP orqali skrinshot + layout o‘lchovlari —
  vizual regressiyalarni raqam bilan tekshirish uchun.
