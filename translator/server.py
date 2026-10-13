#!/usr/bin/env python3
# translator/server.py — YANG AI uchun lokal NLLB tarjimon servisi.
# Offline, bepul: o'zbek (lotin) <-> ingliz. Port 8788, faqat 127.0.0.1.
#
# Endpoint'lar:
#   GET  /health    -> {ok, ready, model}
#   POST /translate -> kirish: {text, source?, target?}  chiqish: {translated, detected}
#                      source/target: uzn_Latn | eng_Latn | 'auto'
#
# Tayyorlash (bir martalik): setup.bat — modelni yuklab, int8 ga siqadi.
# Ishga tushirish: python server.py   (yoki start.bat)

import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("NLLB_PORT") or 8788)
ROOT = os.path.dirname(os.path.abspath(__file__))
# Model papkasi: NLLB_MODEL_DIR env bilan almashtiriladi (packaged ilova uchun).
MODEL_DIR = os.environ.get("NLLB_MODEL_DIR") or os.path.join(ROOT, "model")
HF_REPO = "OvozifyLabs/nllb-200-uz-en-v1"  # o'zbekcha ga maxsus kalibrlangan NLLB

LOCK = threading.Lock()
STATE = {"ready": False, "loading": False, "error": None, "translator": None, "tokenizer": None, "model_name": None}

ENG_WORDS = {
    "the", "and", "is", "are", "was", "were", "to", "of", "you", "your", "this", "that", "with", "for", "from",
    "please", "create", "write", "make", "file", "code", "project", "need", "should", "can", "will", "have",
    "read", "check", "run", "build", "test", "update", "change", "fix", "use", "using", "about", "into",
}
UZ_WORDS = {
    "va", "bu", "uchun", "bilan", "kerak", "yozing", "yarating", "qiling", "salom", "rahmat", "shu", "shuning",
    "keyin", "iltimos", "yoki", "lekin", "ham", "emas", "qanday", "nima", "mening", "seni", "bizga",
    "faylni", "loyiha", "kodni", "tekshiring", "tuzating", "javob", "yozing",
}

# Himoyalangan bo'laklar: kod bloklari, inline kod, URL, yo'llar, SMOKE_PASSED kabi belgilar.
FENCE = re.compile(r"```.*?(?:```|$)", re.S)
INLINE = re.compile(r"`[^`\n]+`")
URL = re.compile(r"(?:https?://|www\.)\S+")
PATH = re.compile(r"(?:[A-Za-z]:[/\\])?(?:[\w.-]+[/\\])+[\w.-]+")
EXT = re.compile(r"\b[\w.-]+\.(?:py|js|ts|tsx|jsx|json|html|css|md|txt|pdf|docx|xlsx|csv|png|jpg|jpeg|gif|webp|exe|bat|db|env|yaml|yml|xml|sh|cjs|mjs|ico|lock)\b")
CAPS = re.compile(r"\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b")

PH_OPEN, PH_CLOSE = "[[[", "]]]"
PH_RE = re.compile(re.escape(PH_OPEN) + r"(\d+)" + re.escape(PH_CLOSE))


def detect_lang(text):
    words = re.findall(r"[a-zA-Zʻ‘ʼ']+", text.lower())
    if not words:
        return "eng_Latn"
    eng = sum(1 for w in words if w in ENG_WORDS)
    uz = len(re.findall(r"[ʻ‘ʼўқғҳ]", text)) + sum(1 for w in words if w in UZ_WORDS)
    return "eng_Latn" if eng > uz and eng >= len(words) * 0.05 else "uzn_Latn"


def protect(text):
    parts = []

    def keep(m):
        parts.append(m.group(0))
        return f"{PH_OPEN}{len(parts) - 1}{PH_CLOSE}"

    t = FENCE.sub(keep, text)
    t = INLINE.sub(keep, t)
    t = URL.sub(keep, t)
    t = PATH.sub(keep, t)
    t = EXT.sub(keep, t)
    t = CAPS.sub(keep, t)
    return t, parts


def restore(text, parts):
    return PH_RE.sub(lambda m: parts[int(m.group(1))] if int(m.group(1)) < len(parts) else m.group(0), text)


def load_model():
    if STATE["loading"] or STATE["ready"]:
        return
    STATE["loading"] = True
    try:
        import ctranslate2
        from tokenizers import Tokenizer
        if not os.path.exists(os.path.join(MODEL_DIR, "model.bin")):
            raise RuntimeError(
                f"Model topilmadi: {MODEL_DIR}. "
                "Tarjimon modeli o'rnatilmagan — ilovani to'liq o'rnating yoki setup.bat ni ishga tushiring."
            )
        tok_path = os.path.join(MODEL_DIR, "tokenizer.json")
        tokenizer = Tokenizer.from_file(tok_path)
        tokenizer.no_padding()   # tokenizer.json'da 256 ga pad qilingan — CT2 uchun toza token kerak
        tokenizer.no_truncation()
        # NLLB lug'atida til kodlari o'ziga xos belgilar sifatida mavjud.
        for lang in ("uzn_Latn", "eng_Latn"):
            if tokenizer.token_to_id(lang) is None:
                raise RuntimeError(f"Til kodi lug'atda yo'q: {lang}")
        intra = max(1, (os.cpu_count() or 2) - 1)
        translator = ctranslate2.Translator(MODEL_DIR, device="cpu", inter_threads=1, intra_threads=intra)
        STATE["translator"] = translator
        STATE["tokenizer"] = tokenizer
        STATE["model_name"] = "nllb-200-uz-en (int8)"
        STATE["ready"] = True
        STATE["error"] = None
        print(f"[tarjimon] model yuklandi: {MODEL_DIR}", flush=True)
    except Exception as e:
        STATE["error"] = str(e)
        print(f"[tarjimon] xato: {e}", flush=True)
    finally:
        STATE["loading"] = False


SPECIAL_PIECES = {"<s>", "</s>", "<pad>", "<unk>"}


def nllb_translate(texts, src, tgt):
    tok = STATE["tokenizer"]
    tr = STATE["translator"]
    with LOCK:
        encoded = []
        for t in texts:
            pieces = [p for p in tok.encode(t, add_special_tokens=False).tokens if p not in SPECIAL_PIECES]
            encoded.append([src] + pieces + ["</s>"])
        results = tr.translate_batch(
            encoded,
            target_prefix=[[tgt]] * len(encoded),
            beam_size=2,
            max_batch_size=16,
            max_input_length=512,
            max_decoding_length=512,
        )
        outs = []
        for r in results:
            hyp = r.hypotheses[0] if r.hypotheses else []
            ids = [tok.token_to_id(p) for p in hyp if p not in SPECIAL_PIECES and p not in (src, tgt)]
            ids = [i for i in ids if i is not None]
            out_text = tok.decode(ids, skip_special_tokens=True) if ids else ""
            # Lotin o'zbekcha chiqishda kirill harflar qolmasin (maqsad faqat uzn_Latn uchun).
            outs.append(to_latin_script(out_text) if tgt.startswith("uzn") else out_text)
    return outs


def _has_letters(s, minimum=2):
    letters = sum(1 for c in s if c.isalpha())
    return letters >= minimum and letters / max(1, len(s)) >= 0.4


def _smart_join(pieces):
    """Bo'laklarni birlashtirish; so'z chegaralarida probel yetishmasa qo'shadi."""
    out = ""
    for p in pieces:
        if not p:
            continue
        if out and out[-1] not in " \t\n([{«\"'" and p[0] not in " \t\n).,;:!?]}'»\"":
            out += " "
        out += p
    return out


# NLLB ba'zan lotin o'zbekcha matnga kirill harflar aralashtiradi (masalan "анықlashish"):
# model "uzn_Latn" ni so'rasa ham kirill yozuvga sakrab ketadi. Chiqishni lotinga
# o'giramiz — faqat kirill HARFLAR almashtiriladi, tinish belgilari/sonlar tegilmaydi.
# Tarjima paytida yo'llar/URL/kod tokenlari placeholder bo'ladi, shuning uchun ularga
# tegilmaydi (nllb_translate ichida, restore'dan OLDIN qo'llanadi).
CYR_TO_LAT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "j",
    "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",
    "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "x", "ц": "ts",
    "ч": "ch", "ш": "sh", "щ": "sh", "ъ": "'", "ы": "i", "ь": "", "э": "e", "ю": "yu",
    "я": "ya", "ў": "o'", "қ": "q", "ғ": "g'", "ҳ": "h", "ң": "ng",
}
CYR_TO_LAT_UPPER = {k.upper(): (v[:1].upper() + v[1:]) for k, v in CYR_TO_LAT.items()}
CYR_RE = re.compile("[А-Яа-яЁёЎўҚқҒғҲҳҢң]")


def to_latin_script(text):
    """Kirill harflarni lotin ekvivalentiga o'giradi (faqat kerak bo'lsa)."""
    if not text or not CYR_RE.search(text):
        return text
    return "".join(CYR_TO_LAT.get(c) or CYR_TO_LAT_UPPER.get(c) or c for c in text)


def translate_text(text, source="auto", target="uzn_Latn"):
    if source == "auto":
        source = detect_lang(text)
    if source == target:
        return text, source
    lines = text.split("\n")
    out_lines = list(lines)
    batch = []  # (line_idx, translate_input, protected_line, parts)
    in_fence = False
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith("```"):
            in_fence = not in_fence  # kod bloklari umuman tegilmaydi
            continue
        if in_fence or not _has_letters(s):
            continue
        protected, parts = protect(line)
        if not parts:
            if PH_RE.search(s):
                continue
            batch.append((i, line, line, []))
        else:
            batch.append((i, protected, protected, parts))
    if not batch:
        return text, source

    translated = nllb_translate([b[1] for b in batch], source, target)

    # Placeholder tushib qolgan qatorlarni bo'laklarga bo'lib qayta tarjima qilamiz —
    # yo'llar/URL/kod tokenlari byte-aniq saqlanadi.
    frag_jobs = []  # (batch_idx, frag_key, frag_text)
    for bi, ((li, _, protected, parts), tr) in enumerate(zip(batch, translated)):
        if not parts:
            out_lines[li] = tr if tr.strip() else lines[li]
            continue
        missing = [k for k in range(len(parts)) if f"{PH_OPEN}{k}{PH_CLOSE}" not in tr]
        if not missing:
            out_lines[li] = restore(tr, parts)
            continue
        segs = PH_RE.split(protected)  # [prose, num, prose, num, ..., prose]
        for j, seg in enumerate(segs):
            if j % 2 == 0 and _has_letters(seg):
                frag_jobs.append((bi, j, seg))
    if frag_jobs:
        frag_out = nllb_translate([f[2] for f in frag_jobs], source, target)
        frag_map = {(bi, key): out for (bi, key, _), out in zip(frag_jobs, frag_out)}
        for bi in sorted({f[0] for f in frag_jobs}):
            li, _, protected, parts = batch[bi]
            segs = PH_RE.split(protected)
            pieces = []
            for j, seg in enumerate(segs):
                if j % 2 == 0:
                    tr = frag_map.get((bi, j), "").strip()
                    pieces.append(tr if tr else seg)
                else:
                    pieces.append(parts[int(seg)])
            out_lines[li] = _smart_join(pieces)
    return restore("\n".join(out_lines), []), source


class Handler(BaseHTTPRequestHandler):
    server_version = "YANGTranslator/1.0"

    def log_message(self, fmt, *args):
        pass  # tinch rejim

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/health"):
            self._json(200, {
                "ok": True,
                "ready": STATE["ready"],
                "loading": STATE["loading"],
                "model": STATE["model_name"],
                "error": STATE["error"],
            })
        else:
            self._json(404, {"error": "yo'q"})

    def do_POST(self):
        if not self.path.startswith("/translate"):
            return self._json(404, {"error": "yo'q"})
        if not STATE["ready"]:
            return self._json(503, {"error": STATE["error"] or "model yuklanmoqda, biroz kuting"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(min(n, 4 * 1024 * 1024))
            req = json.loads(raw.decode("utf-8"))
        except Exception as e:
            return self._json(400, {"error": f"bad request: {e}"})
        text = str(req.get("text") or "")
        source = str(req.get("source") or "auto")
        target = str(req.get("target") or "uzn_Latn")
        if not text.strip():
            return self._json(200, {"translated": "", "detected": source})
        if len(text) > 60000:
            text = text[:60000] + "\n...[kesildi]"
        if source not in ("uzn_Latn", "eng_Latn"):
            source = "auto"
        if target not in ("uzn_Latn", "eng_Latn"):
            target = "uzn_Latn"
        try:
            translated, detected = translate_text(text, source, target)
            # Endpoint shartnomasi: uzn_Latn javobida kirill harflar bo'lmaydi.
            if target.startswith("uzn"):
                translated = to_latin_script(translated)
            self._json(200, {"translated": translated, "detected": detected})
        except Exception as e:
            self._json(500, {"error": str(e)})


def main():
    threading.Thread(target=load_model, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[tarjimon] NLLB tarjimon: http://127.0.0.1:{PORT}  (model fonda yuklanmoqda...)", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
