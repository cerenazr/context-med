# cofounder-office

Solopreneur'ün tek kişilik ekibini; **persona-brain**'lerden oluşan, rol-bazlı koordine çalışan, Cerebra substrate üstünde birikim üreten bir sanal ofis ortamına dönüştüren CLI aracı.

## 🎬 Demo

[![cofounder-office demo](https://img.youtube.com/vi/NYA0qAWL6XA/maxresdefault.jpg)](https://youtu.be/NYA0qAWL6XA)

## 🎯 Amaç

Solopreneur'ün en büyük yükü olan **rol değiştirme (context-switching)** maliyetini sıfırlamak.

Üç temel persona üzerinden çalışır:

| Persona | Rol | Kimlik |
|---------|-----|--------|
| `cvo` | Mimar — stratejik vizyon | Büyük resmi görür, yön çizer |
| `pm` | Arabulucu — koordinasyon | Vizyon ile gerçeği uzlaştırır |
| `doer` | İcracı — uygulama | Kodu yazar, işi bitirir |

Her persona kendi `persona.md`, `work.md` ve `correction-log.md` dosyalarından beslenir. Kararlar ve çıktılar `decisions/` ve `artifacts/` klasörlerine yazılır.

---

## 🚀 Kurulum

```bash
# Repoyu klonla
git clone https://github.com/cerenazr/context-med.git
cd context-med/packages/cofounder-office

# Bağımlılıkları yükle
npm install
```

### AI API Key

`cofounder-backend/.env` dosyasına aşağıdakilerden **en az birini** ekle:

```env
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=sk-or-...
```

> Groq ücretsiz key için → [console.groq.com](https://console.groq.com)

---

## 📦 Komutlar

### `roster` — Persona listesi

```bash
npx cofounder-office roster --format json
npx cofounder-office roster --format markdown
```

### `digest` — Haftalık özet üret

```bash
npx cofounder-office digest --output summary.json
npx cofounder-office digest --output summary.json --dry-run
```

### `consult` — Persona ile danış

```bash
npx cofounder-office consult --input meeting-notes.txt --persona cvo
npx cofounder-office consult --input notes.txt --persona pm
```

### `fire` — Persona deaktive et

```bash
npx cofounder-office fire --input doer
```

### `eval` — Çıktı kalitesini değerlendir

```bash
npx cofounder-office eval \
  --input new-output-v2.json \
  --baseline baseline-v1.json \
  --output result.json
```

---

## 🧪 Testler

```bash
npm test
# Test Suites: 2 passed, 2 total
# Tests:       30 passed, 0 failed
```

Testler PR açıldığında CI tarafından otomatik çalışır. Tüm testler geçmeden merge açılmaz.

---

## 📁 Dizin Yapısı

```
packages/cofounder-office/
├── bin/
│   └── cli.js              ← CLI entry point
├── src/
│   ├── commands/           ← roster, digest, consult, fire, eval
│   └── lib/
│       ├── personas.js     ← Persona okuma
│       └── ai.js           ← AI provider
├── brains/
│   └── personas/
│       ├── cvo/
│       ├── pm/
│       └── doer/
└── tests/
    └── cli/
        ├── smoke.test.js
        └── integration.test.js
```
