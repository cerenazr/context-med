# Task: cofounder-office CLI Implementasyonu

## Hedef

`packages/cofounder-office/` altında 31 CLI testi yazılı ama implementasyon yok.  
Görev: testlerin **tamamını** yeşile çıkaracak CLI'ı yazmak.

## Başlamadan önce

```bash
cd packages/cofounder-office
npm install
npm test
# → Tests: 29 failed, 2 passed, 31 total
# Görevin bitti olduğunda → Tests: 31 passed, 0 failed
```

## Yazılacak dosyalar

```
packages/cofounder-office/
├── bin/
│   └── cli.js                  ← #!/usr/bin/env node — CLI entry point
└── src/
    ├── commands/
    │   ├── roster.js
    │   ├── digest.js
    │   ├── consult.js
    │   ├── fire.js
    │   └── eval.js
    └── lib/
        ├── personas.js          ← brains/personas/ okuma
        └── ai.js                ← AI provider (Groq / Gemini / OpenRouter)
```

Paket zaten `package.json` ile kurulu. `commander` ve AI kütüphaneleri `node_modules/` içinde.

## Komutlar ve beklenen davranış

### `roster`

```bash
cofounder-office roster --format json
```

- `--format` → `json` | `markdown` | `text` (default: `json`)
- `--format` geçersiz değer → exit 1, stderr'de geçerli formatları belirt
- JSON çıktısı: `[{ id, name, role, status, lastActiveAt }]` — tam 3 persona (`cvo`, `pm`, `doer`)
- `status` değeri: `"active"` veya `"inactive"` — tüm alanlar dolu ve doğru tipte olmalı
- `--format markdown` → stdout'ta `# ` ile başlayan bir başlık ve `- **` formatında liste

### `digest`

```bash
cofounder-office digest --output summary.json --format json
```

- `--output` **zorunlu** → eksikse exit 1, stderr'de `--output` / `required` / `missing` geçmeli
- `--format` → `json` | `yaml` | `markdown` (default: `json`)
- `--config <path>` → YAML config dosyası okur, geçersizse exit 1
- `--dry-run` → dosya yazılmaz, stdout'ta `Active Personas: N` (N rakam) formatında plan basar
- Başarıda: `--output` dosyasını yazar
- JSON çıktısı şunları içermeli:
  - `personas` → array
  - `timestamp` → geçerli ISO 8601 string (`2026-01-01T00:00:00...` formatı)

### `consult`

```bash
cofounder-office consult --input meeting-notes.txt --persona cvo
```

- `--input` **zorunlu** → eksikse exit 1, stderr'de `--input` / `required` / `missing` geçmeli
- `--persona` → `cvo` | `pm` | `doer` | `mimar` | `arabulucu` | `icraci`
  - Geçersiz persona → exit 1, stderr'de persona adını / `not found` belirt
  - Belirtilmezse default persona kullan (cvo önerilir)
- Dosya yoksa → exit 1, stderr'de `not found` / `no such` / `cannot` geçmeli
- Başarıda → stdout'a en az **50 karakter** uzunlukta yanıt yaz
- AI provider: `cofounder-backend/.env` içindeki `GROQ_API_KEY`, `GEMINI_API_KEY` veya `OPENROUTER_API_KEY`

### `fire`

```bash
cofounder-office fire --input pm
```

- `--input` **zorunlu** → eksikse exit 1, stderr'de `--input` / `required` / `missing` geçmeli
- Geçerli persona ID: `cvo`, `pm`, `doer` (veya rol adları: `mimar`, `arabulucu`, `icraci`)
- Başarıda → exit 0, persona `status`'unu `"inactive"` olarak kaydet
- Kayıt yeri: `brains/personas/<dir>/status.json` → `{ "status": "inactive", "firedAt": "<ISO>" }`
- `roster`'dan sonra fire edilen persona `status: "inactive"` göstermeli (state tutarlılığı)

### `eval`

```bash
cofounder-office eval --input new-output-v2.json --baseline baseline-v1.json --output result.json
```

- `--input` ve `--baseline` **zorunlu** → eksikse exit 1, ilgili flag adı stderr'de geçmeli
- Baseline dosyası yoksa → exit 1, stderr'de `not found` / `baseline` geçmeli
- Input JSON parse edilemezse veya baseline ile schema uyumsuzsa → **exit 2**, stderr'de `invalid` / `schema` / `validation` geçmeli
- `--output` verilirse → sonucu JSON dosyasına yaz
- Çıktı JSON şunları içermeli:
  - `eval_score` veya `score` → **0–100 arasında sayı**
- Başarılı eval → exit 0

## Exit code kuralları

| Kod | Anlam |
|-----|-------|
| `0` | Başarı |
| `1` | Genel hata (dosya yok, persona yok, eksik zorunlu flag) |
| `2` | Validasyon / schema hatası |

## Persona dosya yapısı

```
brains/personas/
├── cvo/          → Mimar (CVO)
│   ├── persona.md
│   ├── work.md
│   ├── correction-log.md
│   └── tracks/
├── pm/           → Arabulucu (PM)
│   └── ...
└── doer/         → İcracı (Doer)
    └── ...
```

## AI entegrasyonu

`cofounder-backend/.env` dosyasındaki ilk bulunan key kullanılır:

```
GROQ_API_KEY        → https://api.groq.com/openai/v1  (model: llama-3.3-70b-versatile)
GEMINI_API_KEY      → Gemini 2.0 Flash
OPENROUTER_API_KEY  → https://openrouter.ai/api/v1
```

> **Not:** `dotenv` paketinin stdout'a log yazmasına dikkat et — stdout'a sadece komut çıktısı gitmeli, log değil.

## PR Akışı

Çalışmalarını bir branch'te yap, PR aç. CI otomatik testleri çalıştırır ve PR'a skor yazar.  
**Tüm 31 test geçmeden merge açılmaz.**

## Tamamlanma kriteri

```bash
cd packages/cofounder-office
npm test

# Beklenen:
# Test Suites: 2 passed, 2 total
# Tests:       31 passed, 0 failed
```
