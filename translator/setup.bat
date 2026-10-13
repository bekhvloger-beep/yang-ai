@echo off
rem YANG AI tarjimonni DEV mashinasida bir martalik tayyorlash (end user uchun KERAK EMAS —
rem model va python runtime ilova ichida.bundle qilib keladi):
rem   1) ctranslate2 + tokenizers (ishlash uchun) + transformers (faqat konverter uchun)
rem   2) NLLB modelini int8 ga siqish (model/) + tokenizer.json nusxasi
cd /d "%~dp0"
python -m pip install --quiet "transformers==4.57.1" sentencepiece ctranslate2==4.8.2 tokenizers || goto :err
ct2-transformers-converter --model OvozifyLabs/nllb-200-uz-en-v1 --output_dir model --quantization int8 --force || goto :err
python -c "from huggingface_hub import hf_hub_download; import shutil; shutil.copy(hf_hub_download('OvozifyLabs/nllb-200-uz-en-v1','tokenizer.json'), 'model/tokenizer.json')" || goto :err
echo.
echo TAYYOR! Server: python server.py  (yoki start.bat)
pause
exit /b 0
:err
echo XATOLIK yuz berdi — yuqoridagi xabarni tekshiring.
pause
exit /b 1
