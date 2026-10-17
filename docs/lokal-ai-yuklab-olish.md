# Lokal AI: yuklab olish qotishi va rasm generatsiyasi (5.6.0 dan keyingi tuzatishlar)

Bu hujjat foydalanuvchi shikoyati bo‘yicha o‘tkazilgan tekshiruv va tuzatishlarni yozadi:
«lokal AI yuklab olinyaptimi? 30 daqiqadan beri 75,2% da qotib turibdi» va «rasm yaratish
Gemini emas, yuklab olingan lokal AI bilan ishlashi kerak — API larni rasm yaratishdan
uzib tashla».

## 1. Nima bo‘lgan edi (o‘lchandi)

| Fakt | Ma’lumot |
|---|---|
| DreamShaper 8 fayli diskda | `%APPDATA%\yang-ai\models\sd\models\DreamShaper_8_pruned.safetensors` — **2 132 625 894 bayt**, katalogdagi hajm bilan aynan bir xil, mtime 20:26 |
| Oyna ko‘rsatgan holat | **72,5%**, «Bekor» tugmasi, 30 daqiqa o‘zgarmagan |
| Rasm dvigateli | **o‘rnatilmagan** — shuning uchun rasm umuman yaratilmagan («sd-cli.exe topilmadi») |

Ya’ni **fayl yuklanib bo‘lgan**, lekin oyna buni ko‘rsatmagan: progress faqat 900 ms poll
bilan yangilanardi (`modelsCatalog()`), yadro esa hodisani faqat IDE oynasiga yuborardi.
Bitta uzilish/xato bo‘lsa ekran eski holatda qotib qolardi. Ustiga-ustak yuklab olish
xatosi qatorda umuman ko‘rinmasdi — foydalanuvchi nima bo‘lganini bilmasdi.

Bundan tashqari ikkita haqiqiy xavf bor edi:

1. **Jim uzilish:** CDN socketni yopmasa `pipeline` abadiy osilib qolardi (timeout yo‘q).
2. **Yo‘qotish:** xatoda `.part` fayl **o‘chirilardi** — 1,5 GB yuklangan qism yo‘q bo‘lardi.

## 2. Tuzatishlar

| Nima | Qanday |
|---|---|
| Progress jonli | `ide/ide_models.js` → `onModelProgress()` obunachilari; `main.js` ularni asosiy oynaga `yide:model-progress` bilan yuboradi; `renderer/app.js` qatorni darhol yangilaydi (poll zaxira bo‘lib qoldi) |
| Jim qotish | Har bir chunk vaqtini kuzatuvchi watchdog: **60 s** (kamida 15 s) ma’lumot kelmasa — aniq xato: «yuklab olish 60 s davomida to‘xtab qoldi — qayta urinib ko‘ring (N MB saqlandi, davom etadi)» |
| Davom ettirish | `.part` xatoda **saqlanadi**; qayta urinishda `Range: bytes=N-` yuboriladi, javob 206 bo‘lsa fayl oxiriga yoziladi (`flags: 'a'`). Server Range’ni qo‘llamasa — boshidan |
| Hajm tekshiruvi | `Content-Range: bytes a-b/TOTAL` dan **faylning to‘liq hajmi** olinadi (ilgari resume qismi ustiga qo‘shilib, soxta «hajm mos emas» xatosi chiqardi) |
| Xato ko‘rinadi | Qatorda qizil matn + «Qayta urinish» tugmasi (`mdl-err`) |
| Rasm faqat lokal | `agent/imagegen.js` dan Gemini/OpenAI/OpenRouter/Vercel zanjiri **butunlay olib tashlandi**; dvigatel/model bo‘lmasa aniq xato va menejerni ochish (`needsEngine`) |
| Studio matni | «Sifat (razmer) 1080/2K/4K» → «qadam soni 20/30/45 · o‘lcham 512×512» (SD1.5 shu o‘lchamda o‘rgatilgan) |

Rasm generatsiyasi endi **internetga umuman chiqmaydi**: kalitlar configda bo‘lsa ham
ishlatilmaydi (sinovda tekshirildi — 1-band).

## 3. Sinovlar (o‘lchangan)

| Sinov | Natija |
|---|---|
| `npm run test:ide` — kontrakt (yangi 3 tekshiruv bilan) | **75/75 PASS** |
| `npm run test:ai:download` — haqiqiy ilova: yuklash → o‘rnatish → o‘chirish → qayta o‘rnatish | **6/6 PASS** (progress 0 → 100%, `extracting`, 17 MB dvigatel) |
| `node scripts/test_download_stall.mjs` — mahalliy server 1 MB dan keyin jim qotadi | **4/4 PASS**: 15 s da aniq xato, `.part` 1024 KB saqlanadi, qayta urinish `bytes=1048576-` bilan davom etadi, fayl to‘liq 3 MB |
| `YANG_DEV=1 npm run test:ai:manager` — asosiy oyna UI | **12/12 PASS**, JS xatosi yo‘q |
| Lokal rasm (bulut kalitlari bilan ham) | dvigatelsiz: «Rasm faqat LOKAL AI bilan yaratiladi…»; dvigatel bilan: 256×256 PNG, 6–10 s (RX 580, Vulkan) |
| Har bir rasm modeli: yuklash → rasm → o‘chirish | `reports/image_models_e2e.log` (`scripts/test_image_models_e2e.mjs`) — quyida |

### Har bir model (o‘lchandi, 256×256 · 4 qadam)

| Model | Yuklash | Rasm | O‘chirish |
|---|---|---|---|
| Stable Diffusion 1.5 (2,1 GB) | **616 s** | **17,2 s** (Vulkan) | fayl yo‘q |
| DreamShaper 8 (2,1 GB) | **616 s** | **7,5 s** (Vulkan) | fayl yo‘q |
| SD-Turbo (5,2 GB) | **1510 s** | bosim ostida **OOM**, keyin bo‘sh VRAM bilan **33,9 s**; CPU dvigatel bilan **46,1 s** | fayl yo‘q |

SD-Turbo birinchi urinishda **4 GB video kartada** xotira yetmadi (`ErrorOutOfDeviceMemory` —
VAE decode, boshqa dasturlar ham VRAM band qilgan payt). Shundan keyin: (1) `agent/local_sd.js`
da **CPU zaxira** qo‘shildi — Vulkan OOM bersa va CPU dvigatel o‘rnatilgan bo‘lsa, rasm CPU da
qayta uriniladi (`YANG_SD_BACKEND=cpu` bilan majburan sinash ham mumkin); (2) katalogda
`min.vramGb` 3 → **4**, tavsiya 6 → **8**; (3) bo‘sh VRAM bilan o‘sha model **33,9 s** da rasm
berdi — ya’ni muammo modelda emas, xotira bandligida.

### O‘rnatilgan 5.6.0 nusxasi

O‘rnatilgan ilovaga rasm dvigateli (Vulkan, 85 MB) qo‘yildi va u yerda tekshirildi:
`imageStatus` → `available: true`, `imageGenerate` → **17,6 s**, 47 935 baytli PNG,
`via: Lokal · stable-diffusion.cpp (vulkan) · DreamShaper_8_pruned.safetensors`.
Ya’ni foydalanuvchi oynasidagi «Rasm yaratish» endi shu kompyuterda, API siz ishlaydi.

## 4. Disk haqida muhim

Shu kompyuterda `C:` da **~1,2 GB** bo‘sh qolgan (2,1 GB model + 85 MB dvigatel undan
katta). Katta modellarni **boshqa diskka** olish mumkin:

```bash
set YANG_MODELS_DIR=D:\yang-ai-models
```

Ilova o‘sha papkani o‘zi yaratadi; katalog o‘zgarmaydi (barcha `subdir` lar shu ildiz
ostida ochiladi). Rasm modellari: SD1.5 **2,1 GB**, DreamShaper 8 **2,1 GB**,
SD-Turbo **5,2 GB** (5,2 GB bo‘sh joy kerak — `C:` da sig‘maydi).

## 5. Cheklovlar

- SD-Turbo (5,2 GB) shu mashinada `C:` ga sig‘maydi; `D:` da joy yetarli (o‘lchandi:
  1510 s ≈ 25 daqiqa). SD-Turbo `fp32` va 4 GB VRAM uchun chegarada — boshqa dasturlar
  ochiq bo‘lsa Vulkan OOM beradi; CPU zaxira sekin (46 s / 256×256).
- Yuklab olish tezligi CDN ga bog‘liq (o‘lchandi: 3,0–4,0 MB/s).
- Rasm sifati SD1.5 darajasida: 512×512, 20–45 qadam. 1024×1024 va undan katta o‘lcham
  bu modelda sifatni buzadi, shuning uchun studiya ataylab 512 da qoladi.
- CPU zaxira yo‘li alohida sinaldi (`YANG_SD_BACKEND=cpu` → 46,1 s), lekin **OOM → CPU**
avtomatik o‘tish real OOM paytida emas, balki kod yo‘li va CPU yurishi bilan tasdiqlandi:
OOM holatini takrorlash uchun VRAM ni sun’iy to‘ldirish kerak.
- `scripts/test_image_models_e2e.mjs` ning o‘sha yurishida 2 ta yolg‘on FAIL bor: (a) 3-tekshiruv
  model yuklanishidan OLDIN `available` ni kutgan (tartib xatosi — skriptda tuzatildi);
  (b) SD-Turbo OOM. Shuning uchun jurnalda **10/12**, lekin haqiqiy mahsulot xatosi — bittasi
  (OOM), u ham yuqoridagi choralar bilan yopildi.
- 5,2 GB modelni qayta yuklamaslik uchun o‘chirilgan SD-Turbo Savatdan tiklandi
  (`Shell.Application` → `undelete`) — bu sinov artefakti, mahsulot kodi emas.
