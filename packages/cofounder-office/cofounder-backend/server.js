require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

// ─── AI Sağlayıcıları Hazırla ───────────────────────────────────────────────
const providers = {
  groq: null,
  gemini: null,
  openrouter: null
};

if (process.env.GROQ_API_KEY) {
  console.log('Groq Provider initialized');
  providers.groq = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
}

if (process.env.GEMINI_API_KEY) {
  console.log('Gemini Provider initialized');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  // Gemini 2.0 (Experimental) - 404 hatalarını aşmak için
  providers.gemini = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
}

if (process.env.OPENROUTER_API_KEY) {
  console.log('OpenRouter Provider initialized');
  providers.openrouter = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'http://localhost:3000', // Opsiyonel
      'X-Title': 'Cofounder Office',
    }
  });
}

// ─── Dizin yapısı ─────────────────────────────────────────────────────────────
const PERSONA_DIR    = path.join(__dirname, '..', 'brains', 'personas');
const DECISIONS_DIR  = path.join(__dirname, '..', 'brains', 'cofounder-office', 'decisions');
const BACKLOG_DIR    = path.join(__dirname, '..', 'brains', 'cofounder-office', 'backlog');
const EXEC_LOGS_DIR  = path.join(__dirname, '..', 'brains', 'cofounder-office', 'execution_logs');
const ARTIFACTS_DIR  = path.join(__dirname, '..', 'brains', 'cofounder-office', 'artifacts');

[DECISIONS_DIR, BACKLOG_DIR, EXEC_LOGS_DIR, ARTIFACTS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// role (mimar/arabulucu/icraci) → klasör adı (cvo/pm/doer)
const ROLE_TO_DIR = { mimar: 'cvo', arabulucu: 'pm', icraci: 'doer' };
const ROLE_NAMES  = { mimar: 'Mimar (CVO)', arabulucu: 'Arabulucu (PM)', icraci: 'İcracı (Doer)' };

// ─── Persona yükleyici (6-track distilasyon dahil) ───────────────────────────
const TRACKS = ['works', 'conversations', 'expression', 'decisions', 'external', 'timeline'];

function getPersonaFull(role) {
  const dir = ROLE_TO_DIR[role] || role;
  const personaBase = path.join(PERSONA_DIR, dir);

  const read = (file) => {
    try { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : ''; }
    catch { return ''; }
  };

  const persona     = read(path.join(personaBase, 'persona.md'));
  const work        = read(path.join(personaBase, 'work.md'));
  const corrections = read(path.join(personaBase, 'correction-log.md'));

  // 6-track distilasyon
  const trackDir = path.join(personaBase, 'tracks');
  const trackTexts = TRACKS
    .map(t => read(path.join(trackDir, `${t}.md`)))
    .filter(Boolean)
    .join('\n\n---\n\n');

  let base = [persona, work, trackTexts].filter(Boolean).join('\n\n---\n\n')
    || `You are ${role}.`;

  if (corrections) {
    base += `\n\n---\n\n## Kullanıcı Düzeltmeleri (Öncelikli — bunu dikkate alarak konuş):\n${corrections}`;
  }

  const cerebraMemory = readCerebraMemory();
  if (cerebraMemory) base += `\n\n---\n\n## Cerebra Bellek (Son Ofis Kararları — bağlam için, tekrar etme):\n${cerebraMemory}`;

  return base;
}

// ─── Cerebra Read — geçmiş kararları bağlama çek (30s TTL cache) ─────────────
let _cerebraCache = { value: '', ts: 0 };

function readCerebraMemory() {
  const now = Date.now();
  if (now - _cerebraCache.ts < 30_000) return _cerebraCache.value;
  try {
    if (!fs.existsSync(DECISIONS_DIR)) return (_cerebraCache = { value: '', ts: now }).value;
    const files = fs.readdirSync(DECISIONS_DIR).filter(f => f.endsWith('.md')).sort().slice(-3);
    if (!files.length) return (_cerebraCache = { value: '', ts: now }).value;
    const value = files.map(f => {
      const content = fs.readFileSync(path.join(DECISIONS_DIR, f), 'utf8');
      const match = content.match(/## Mimar Kararı\n([\s\S]+?)(?=\n\n##|$)/);
      return (match ? match[1].trim() : content).substring(0, 150);
    }).filter(Boolean).join('\n\n');
    _cerebraCache = { value, ts: now };
    return value;
  } catch { return ''; }
}

// ─── AI — streaming (opsiyonel soket yayını ile) ─────────────────────────────
// ─── AI — streaming (Otomatik Fallback dahil) ──────────────────────────────
async function streamAIResponse(socket, role, channel, prompt, doStream = true) {
  let fullText = '';

  // 1. Önce Groq Dene
  if (providers.groq) {
    try {
      const stream = await providers.groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.3-70b-versatile',
        stream: true,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) { 
          fullText += delta; 
          if (doStream && socket) socket.emit('agent_stream', { role, channel, chunk: delta }); 
        }
      }
      return fullText;
    } catch (e) {
      console.warn('Groq Stream Error (Fallback to Gemini):', e.message);
      // Eğer Groq hata verirse (Limit vb) Gemini'ye devam et
    }
  }

  // 2. Fallback: Gemini
  if (providers.gemini) {
    try {
      const result = await providers.gemini.generateContentStream(prompt);
      for await (const chunk of result.stream) {
        const delta = chunk.text();
        if (delta) { 
          fullText += delta; 
          if (doStream && socket) socket.emit('agent_stream', { role, channel, chunk: delta }); 
        }
      }
      return fullText;
    } catch (e) {
      console.error('Gemini Stream Error:', e.message);
    }
  }

  // 3. Fallback: OpenRouter (En son çare)
  if (providers.openrouter) {
    try {
      const stream = await providers.openrouter.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'openrouter/auto', // OpenRouter'ın en uygun (ücretsiz/ucuz) modeli seçmesini sağla
        stream: true,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) { 
          fullText += delta; 
          if (doStream && socket) socket.emit('agent_stream', { role, channel, chunk: delta }); 
        }
      }
      return fullText;
    } catch (e) {
      console.error('OpenRouter Stream Error:', e.message);
    }
  }

  // Eğer hiçbir sağlayıcı çalışmazsa kullanıcıya bilgi ver
  if (socket) socket.emit('agent_message', { 
    role: 'system', 
    name: 'Sistem', 
    text: '⚠️ Üzgünüm, şu an tüm AI servisleri (Groq, Gemini, OpenRouter) erişim sorunu yaşıyor.',
    ts: new Date().toLocaleTimeString()
  });

  throw new Error('No AI provider available');
}

// ─── AI — tek seferde (Otomatik Fallback dahil) ─────────────────────────────
async function getAIResponse(prompt) {
  // 1. Groq
  if (providers.groq) {
    try {
      const res = await providers.groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.3-70b-versatile',
      });
      return res.choices[0].message.content;
    } catch (e) { console.warn('Groq Error:', e.message); }
  }

  // 2. Gemini
  if (providers.gemini) {
    try {
      const result = await providers.gemini.generateContent(prompt);
      return result.response.text();
    } catch (e) { console.warn('Gemini Error:', e.message); }
  }

  // 3. OpenRouter
  if (providers.openrouter) {
    try {
      const res = await providers.openrouter.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'openrouter/auto',
      });
      return res.choices[0].message.content;
    } catch (e) { console.error('OpenRouter Error:', e.message); }
  }

  throw new Error('All AI providers failed');
}

// ─── office.yml parser (js-yaml bağımlılığı olmadan) ─────────────────────────
function loadOfficeYml() {
  const OFFICE_YML = path.join(__dirname, '..', 'brains', 'cofounder-office', 'config', 'office.yml');
  try {
    const raw = fs.readFileSync(OFFICE_YML, 'utf8');

    // channels bölümünü çıkar
    const channelRx = /- name: "([^"]+)"\s+members: \[([^\]]+)\]\s+purpose: "([^"]+)"/g;
    const channels = {};
    for (const m of raw.matchAll(channelRx)) {
      const name    = m[1];
      const members = m[2].split(',').map(s => s.trim());
      const purpose = m[3];
      channels[name] = { members, purpose };
    }

    // hitl_policy risk_class çıkar
    const hitlMatch = raw.match(/risk_class:\s*"?([^"\n]+)"?/);
    const hitlRisk  = hitlMatch?.[1]?.trim() || 'high';

    // writeback_scope çıkar
    const writebackMatch = raw.match(/writeback_scope:([\s\S]*?)(?=\n\w|\n#|$)/);
    const writeback = {};
    if (writebackMatch) {
      for (const wm of writebackMatch[1].matchAll(/(\w+):\s*"([^"]+)"/g)) {
        writeback[wm[1]] = wm[2];
      }
    }

    console.log('office.yml loaded — channels:', Object.keys(channels).join(', '));
    return { channels, hitlRisk, writeback };
  } catch (e) {
    console.warn('office.yml okunamadı, defaults kullanılıyor:', e.message);
    return null;
  }
}

const officeConfig = loadOfficeYml();

// ─── Kanal konfigürasyonu (office.yml → runtime merge) ───────────────────────
const CHANNEL_PROMPT_ADDONS = {
  '#strateji': '\n\nNOT: #strateji kanalındasın. Vizyon, karar ve mimari odaklı yanıt ver.',
  '#operasyon': '\n\nNOT: #operasyon kanalındasın. Kısa, aksiyon-odaklı yanıt ver. Görevleri madde listesi yap.',
  '#genel': '',
};

function buildChannelConfig() {
  const base = {
    '#strateji': { fixed: ['mimar', 'arabulucu'], purpose: 'Vizyon ve strateji' },
    '#operasyon': { fixed: ['arabulucu', 'icraci'], purpose: 'Görev ve uygulama' },
    '#genel':    { fixed: null, purpose: 'Ekip geneli' },
  };

  if (officeConfig?.channels) {
    for (const [name, cfg] of Object.entries(officeConfig.channels)) {
      if (!base[name]) base[name] = {};
      // yml'den gelen members → fixed (null ise genel kanal)
      base[name].fixed   = cfg.members?.length < 3 ? cfg.members : null;
      base[name].purpose = cfg.purpose || base[name].purpose;
    }
  }

  // promptAddon her kanala ekle
  for (const name of Object.keys(base)) {
    base[name].promptAddon = CHANNEL_PROMPT_ADDONS[name] || '';
  }

  return base;
}

const CHANNEL_CONFIG = buildChannelConfig();

// ─── İçerik bazlı routing ─────────────────────────────────────────────────────
function routeByContent(message) {
  const t = String(message || '').toLowerCase();
  
  // 1. TEKNİK ÖNCELİK: Hata, API, Endpoint, Kod vb. (Mimar karışmaz, İcracı ve PM)
  if (/\b(bug|hata|error|crash|kod|code|deploy|api|endpoint|sql|query|python|ruby|rails|docker|server|test|fix|bozuldu|çalışmıyor)\b/.test(t)) {
    return ['icraci', 'arabulucu'];
  }

  // 2. STRATEJİK ÖNCELİK: Vizyon, Pazar, Roadmap (Mimar ve PM)
  if (/vizyon|strateji|roadmap|pivot|yatırım|büyüme|scale|kpi|okr|misyon|business|market|rakip/.test(t)) {
    return ['mimar', 'arabulucu'];
  }

  // 3. İSİM BAZLI TETİKLEME: Mimar/PM/İcracı isimleri geçerse
  if (/\b(mimar|cvo)\b/.test(t)) return ['mimar', 'arabulucu'];
  if (/\b(arabulucu|pm)\b/.test(t)) return ['arabulucu'];
  if (/\b(icrac|doer|yazılımcı)\b/.test(t)) return ['arabulucu', 'icraci'];

  // 4. OPERASYONEL/TAKAVİM: Tarih, deadline vb.
  if (/ne zaman|deadline|süre|sprint|plan|takvim|tarih|bitir|teslim|öncelik|hafta|gündem/.test(t)) {
    return ['arabulucu'];
  }

  // Varsayılan: Herkes
  return ['arabulucu', 'mimar', 'icraci'];
}

// ─── Görev devri tespiti ──────────────────────────────────────────────────────
function detectDelegation(responseText, alreadyResponding) {
  const t = String(responseText || '').toLowerCase();
  const add = [];
  if (!alreadyResponding.includes('mimar')     && /\b(mimar|cvo)\b/.test(t))                add.push('mimar');
  if (!alreadyResponding.includes('arabulucu') && /\b(arabulucu|pm)\b/.test(t))             add.push('arabulucu');
  if (!alreadyResponding.includes('icraci')    && /\b(icracı|icrac|doer|geliştirici)\b/.test(t)) add.push('icraci');
  return add;
}

// ─── Uzmanlık dışı alan ───────────────────────────────────────────────────────
const OUTSIDE_EXPERTISE = {
  cvo:  { keywords: ['kod','debug','figma','css','deploy','docker','sql','zendesk','intercom'],
          warning: 'Mimar bu konuyu tercih etmez — PM veya İcracı daha hızlı halleder.',
          note: '\n\nNOT: Bu konu uzmanlık alanın dışında. Rahat olmadığını belli et.' },
  pm:   { keywords: ['python','ruby','rails','sql','query','bash','docker','migrate','figma','excel'],
          warning: 'PM bu konuda uzman değil — Doer\'a devreder.',
          note: '\n\nNOT: Bu konu uzmanlık alanın dışında. Doer\'a devret.' },
  doer: { keywords: ['react','vue','swift','kotlin','ios','android','kubernetes','k8s','hubspot','mailchimp','kampanya','figma'],
          warning: 'Doer bu konuda rahat değil — araştırma gerekebilir.',
          note: '\n\nNOT: Bu konu uzmanlık alanın dışında. "Abi bu benim saham değil" de.' },
};

function detectExpertise(role, message) {
  const dir = ROLE_TO_DIR[role] || role;
  const cfg = OUTSIDE_EXPERTISE[dir];
  if (!cfg) return {};
  const hit = cfg.keywords.find(k => String(message || '').toLowerCase().includes(k));
  return hit ? { warning: cfg.warning, note: cfg.note } : {};
}

// ─── Persona arası gerilim dinamiği ──────────────────────────────────────────
function buildTensionContext(role, priorResponses) {
  if (!Object.keys(priorResponses).length) return '';
  const lines = [];

  if (role === 'arabulucu') {
    if (priorResponses.mimar) {
      lines.push('Mimar az önce konuştu. Sen onun vizyonunu hem korumak hem gerçeğe çekmek zorundasın. Gerekirse veriyle geri it — ama diplomatik.');
    }
    if (priorResponses.icraci) {
      lines.push('İcracı teknik gerçeği söyledi. Bunu Mimar\'a nasıl çevirirsin?');
    }
  }

  if (role === 'icraci') {
    if (priorResponses.arabulucu) {
      lines.push('PM bir şey bekledi ya da bir deadline koydu. Gerçekçi ol — ama alternatif sun, sadece "olmaz" deme.');
    }
    if (priorResponses.mimar) {
      lines.push('Mimar yüksek beklenti koydu. Teknik gerçeği net söyle, saygılı kal.');
    }
  }

  if (role === 'mimar') {
    if (priorResponses.arabulucu && priorResponses.icraci) {
      lines.push('PM ve İcracı konuştu. Ekibinin ne dediğini gördün. Şimdi yön ver — ama ekibin kapasitesini duyduğunu belli et.');
    } else if (priorResponses.arabulucu) {
      lines.push('PM gerçeği sundu. Tepkin ne? Yön değiştiriyor musun, yoksa ısrarcı mısın?');
    }
  }

  return lines.length ? `\n\n## Ekip Dinamiği ve Tartışma:\n${lines.join('\n')}\n\nNOT: Eğer ekip arkadaşınla (Mimar/PM/İcracı) zıt düşüyorsan çekinme, fikrini savun. Tartışmacı ve sonuç odaklı ol.` : '';
}

// ─── Provenance tagging ───────────────────────────────────────────────────────
function tagProvenance(role, text) {
  const t = (text || '').toLowerCase();
  const tags = [];
  const dir = ROLE_TO_DIR[role] || role;
  if (/scale|büyüme|kpi|okr|vizyon|leverage|north star|first principles/.test(t)) tags.push('Decision Heuristics');
  if (/jira|linear|sprint|backlog|prd|roadmap|milestone/.test(t))                 tags.push('Work Domain');
  if (/gözünüzü seveyim|yandık|halledelim|mimar bey|arkadaşlar|abi o iş/.test(t)) tags.push('Expression DNA');
  const corrPath = path.join(PERSONA_DIR, dir, 'correction-log.md');
  if (fs.existsSync(corrPath) && fs.readFileSync(corrPath, 'utf8').length > 50)   tags.push('Correction-Calibrated');
  return tags.length ? tags : ['Persona Core'];
}

// ─── Reality Audit (dinamik) ──────────────────────────────────────────────────
async function generateRealityAudit(socket, channel, mimarText, doerText) {
  if (!mimarText && !doerText) return null;
  try {
    const prompt = `${getPersonaFull('arabulucu')}\n\nMimar dedi: "${(mimarText || '-').substring(0, 300)}"\nİcracı dedi: "${(doerText || '-').substring(0, 300)}"\n\nSen PM'sin. Shadow Wiki için JSON reality audit yaz:\n{"vision":"Mimar iddiası kısa","reality":"Gerçek durum kısa","riskPercent":0-100,"gaps":["gap1","gap2"]}\nSadece JSON döndür.`;
    const raw = await getAIResponse(prompt);
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) return null;
    const audit = JSON.parse(match[0]);
    socket.emit('reality_audit_update', { ...audit, channel, ts: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) });
    return audit;
  } catch (e) { console.error('Reality audit error:', e); return null; }
}

// ─── Cerebra Writeback ────────────────────────────────────────────────────────
function cerebraWriteback(channel, userMessage, priorResponses) {
  try {
    const now = new Date();
    const slug = now.toISOString().slice(0, 16).replace(/[T:]/g, '-');
    const header = `# ${now.toLocaleString('tr-TR')}\n**Kanal:** ${channel}\n**Kullanıcı:** ${userMessage}\n\n`;

    if (priorResponses.mimar) {
      fs.writeFileSync(
        path.join(DECISIONS_DIR, `${slug}-decision.md`),
        `${header}## Mimar Kararı\n${priorResponses.mimar}\n\n## PM Yorumu\n${priorResponses.arabulucu || '-'}\n`,
        'utf8'
      );
    }
    if (priorResponses.icraci) {
      fs.writeFileSync(
        path.join(EXEC_LOGS_DIR, `${slug}-execution.md`),
        `${header}## İcracı Çıktısı\n${priorResponses.icraci}\n`,
        'utf8'
      );
    }
    if (priorResponses.arabulucu && channel === '#operasyon') {
      fs.writeFileSync(
        path.join(BACKLOG_DIR, `${slug}-backlog.md`),
        `${header}## PM Backlog Notu\n${priorResponses.arabulucu}\n`,
        'utf8'
      );
    }
  } catch (e) { console.error('Cerebra writeback error:', e); }
}

// ─── İcracı Artifact Çıktısı ─────────────────────────────────────────────────
function extractAndSaveArtifact(role, text) {
  if (role !== 'icraci') return null;
  const codeMatch = (text || '').match(/```(\w*)\n?([\s\S]+?)```/);
  if (!codeMatch) return null;
  const lang = codeMatch[1] || 'txt';
  const code = codeMatch[2].trim();
  if (code.length < 20) return null;
  try {
    const slug = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    const filename = `${slug}-artifact.${lang || 'txt'}`;
    fs.writeFileSync(path.join(ARTIFACTS_DIR, filename), code, 'utf8');
    return filename;
  } catch { return null; }
}

// ─── Yardımcılar ──────────────────────────────────────────────────────────────
function buildHistoryContext(history) {
  if (!history?.length) return '';
  return '\n\n## Önceki konuşma bağlamı:\n' + history.slice(-12).map(h => `[${h.role}]: ${h.text}`).join('\n');
}

function buildPriorContext(priors) {
  const entries = Object.entries(priors);
  if (!entries.length) return '';
  const names = { mimar: 'Mimar', arabulucu: 'PM', icraci: 'İcracı' };
  return '\n\n## Ekipten önceki yanıtlar:\n' + entries.map(([r, t]) => `[${names[r]}]: ${t}`).join('\n');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function naturalPause() { return delay(300 + Math.random() * 500); }

// ─── Zaman damgası yardımcısı ────────────────────────────────────────────────
function nowTime() {
  return new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

// ─── Agent turu (rol bazlı strateji) ─────────────────────────────────────────
async function runAgentTurn(socket, role, message, histCtx, priorResponses, channelAddon, channel) {
  const priorCtx   = buildPriorContext(priorResponses);
  const tensionCtx = buildTensionContext(role, priorResponses);
  const { warning, note: expertiseNote } = detectExpertise(role, message);
  const extra = (expertiseNote || '') + (channelAddon || '');
  const persona = getPersonaFull(role);

  // ── Mimar: çok parçalı, klişesiz, kısa mesajlar ──────────────────────────
  if (role === 'mimar') {
    const prompt = `${persona}${histCtx}

Kullanıcı: "${message}"${priorCtx}${tensionCtx}

Mimar (CVO) olarak yanıt ver. KESİN KURALLAR:
- Her mesaj 1-2 kısa cümle. Asla paragraf.
- Birden fazla ayrı mesaj göndermek istersen aralarına sadece "---" koy.
- "Vizyonu kaçırıyorsunuz", "Mindset" gibi klişe ifadeler YASAK.
- Her yanıtta farklı bir açı seç: soru sor / onay ver / görev ver / rakip kıyasla / rakam iste.
- Plaza Türkçesi, sert ve kısa.${extra}`;

    const rawText = await getAIResponse(prompt);
    const parts = rawText.split(/\n?---\n?/).map(p => p.trim()).filter(Boolean);
    priorResponses.mimar = parts.join(' ').substring(0, 300);

    for (let i = 0; i < parts.length; i++) {
      if (i === 0) {
        await naturalPause();
      } else {
        await delay(800 + Math.random() * 1000);
        socket.emit('typing_start', { role: 'mimar', channel });
        await delay(500 + Math.random() * 600);
      }
      socket.emit('agent_message', {
        channel, role: 'mimar', name: ROLE_NAMES.mimar,
        text: parts[i],
        ts: nowTime(),
        provenance: tagProvenance('mimar', parts[i]),
        ...(i === 0 && warning && { expertiseWarning: warning }),
      });
    }

    socket.emit('agent_stream_end', { role: 'mimar', channel, fullText: priorResponses.mimar });
    return priorResponses.mimar;
  }

  // ── PM ve İcracı: sessiz AI çağrısı + cümle cümle ayrı mesaj ─────────────
  const pmAddon = role === 'arabulucu'
    ? '\n\nNOT: PM olarak operasyonel kararlarında bazen [TASK] etiketini kullanmayı unutma. Yanıtının sonuna "Gizli Not: [panik/düşünce notu, tek satır]" ekle.'
    : '';

  const prompt = `${persona}${histCtx}\n\nKullanıcı: "${message}"${priorCtx}${tensionCtx}\n\nRolün: ${ROLE_NAMES[role]}. Türkçe yanıt ver. Maksimum 3 kısa cümle. Uzun paragraf yazma.${extra}${pmAddon}`;

  const fullText = await streamAIResponse(socket, role, channel, prompt, false);
  let cleanText = fullText.trim();
  let pmNote;

  if (role === 'arabulucu' && cleanText.includes('Gizli Not:')) {
    const [pub, priv] = cleanText.split('Gizli Not:');
    cleanText = pub.trim();
    pmNote = priv.trim();
  }

  priorResponses[role] = cleanText.substring(0, 300);

  // İcracı: kod bloğu varsa artifact olarak kaydet
  if (role === 'icraci') {
    const artifactFile = extractAndSaveArtifact(role, fullText);
    if (artifactFile) socket.emit('artifact_saved', { filename: artifactFile, channel });
  }

  // Nokta/ünlem/soru bazlı cümle ayır — boş ya da çok kısa parçaları atla
  const sentences = (cleanText.match(/[^.!?\n]+[.!?]+/g) || [cleanText])
    .map(s => s.trim()).filter(s => s.length > 4);

  for (let i = 0; i < sentences.length; i++) {
    if (i === 0) {
      await naturalPause();
    } else {
      await delay(500 + Math.random() * 700);
      socket.emit('typing_start', { role, channel });
      await delay(300 + Math.random() * 400);
    }
    socket.emit('agent_message', {
      channel, role, name: ROLE_NAMES[role],
      text: sentences[i],
      ts: nowTime(),
      provenance: tagProvenance(role, cleanText),
      ...(i === sentences.length - 1 && pmNote && { note: pmNote }),
      ...(i === 0 && warning && { expertiseWarning: warning }),
    });
  }

  socket.emit('agent_stream_end', { role, channel, fullText: cleanText });
  return cleanText;
}

// ─── Cross-channel relay ──────────────────────────────────────────────────────
function isActionable(text) {
  return /görev|task|yapıl|uygula|implement|sprint|deadline|teslim|başla|bitir|halledelim|ticket|backlog/.test(
    String(text || '').toLowerCase()
  );
}

async function crossChannelRelay(socket, sourceChannel, priorResponses) {
  const allText = Object.values(priorResponses).join(' ');
  const lowerText = allText.toLowerCase();
  
  // ACİLİYET VE ESKALASYON TESPİTİ
  const isUrgent = /acil|urgency|yangın|bozuldu|çalışmıyor|kritik|blocker/.test(lowerText);
  const needsArchitect = /mimar|architect|yapısal|tasarım kararı|onay/.test(lowerText);

  const emit = async (targetChannel, role, promptText) => {
    socket.emit('typing_start', { role, channel: targetChannel });
    try {
      const text = await getAIResponse(promptText);
      await naturalPause();
      socket.emit('agent_message', { channel: targetChannel, role, name: ROLE_NAMES[role], text, proactive: true, crossChannel: true, fromChannel: sourceChannel });
      socket.emit('conversation_end', { channel: targetChannel });
    } catch (e) { console.error('Cross-relay error:', e); }
  };

  // Operasyonda yangın varsa PM bunu Genel'e taşır ve Mimar'ı çağırır
  if (sourceChannel === '#operasyon' && (isUrgent || needsArchitect)) {
    await delay(1500);
    await emit('#genel', 'arabulucu', 
      `${getPersonaFull('arabulucu')}\n\n#operasyon kanalında KRİTİK bir durum var: "${allText.substring(0, 200)}"\n\nMimar'ı etiketleyerek durumu Genel kanalına raporla ve Mimar'dan teknik destek iste.`
    );
    return;
  }

  if (sourceChannel === '#strateji') {
    await delay(2500);
    await emit('#operasyon', 'icraci',
      `${getPersonaFull('icraci')}\n\nStrateji kanalı kararı:\nMimar: ${priorResponses.mimar || '-'}\nPM: ${priorResponses.arabulucu || '-'}\n\n#operasyon'a teknik görev notu yaz. Madde listesi, max 3 madde.`
    );
  } else if (sourceChannel === '#genel' && !isUrgent) {
    await delay(3000);
    await emit('#operasyon', 'arabulucu',
      `${getPersonaFull('arabulucu')}\n\nGenel duyuru: ${allText.substring(0, 300)}\n\n#operasyon'a backlog güncellemesi yaz. Max 2 cümle.`
    );
  }
}

// ─── Task Chaining ────────────────────────────────────────────────────────────
const DECISION_RX = /\b(yapalım|yapın|başlayın|sprint'e|alın|implement|deadline|teslim|karar verdim|aksiyon|go ahead|ship|başlat|bitirin|haydi|hemen)\b/i;

function detectDecision(text) {
  return DECISION_RX.test(String(text || ''));
}

// Bekleyen task chain'leri HITL yanıtı için sakla
const pendingTaskChains = new Map(); // socketId → { priorResponses, channel, userMessage }

// ─── Rate limiter ─────────────────────────────────────────────────────────────
const socketMessageCounts = new Map(); // socketId → { count, resetAt }
const RATE_LIMIT = { max: 8, windowMs: 60_000 };

function checkRateLimit(socketId) {
  const now = Date.now();
  let entry = socketMessageCounts.get(socketId);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT.windowMs };
  }
  entry.count++;
  socketMessageCounts.set(socketId, entry);
  return entry.count <= RATE_LIMIT.max;
}

async function runTaskChain(socket, channel, priorResponses, userMessage) {
  const mimarText = priorResponses.mimar || '';
  if (!mimarText || !detectDecision(mimarText)) return false;

  const targetCh = '#operasyon';

  // PM: ticket oluştur
  await delay(1800 + Math.random() * 800);
  socket.emit('typing_start', { role: 'arabulucu', channel: targetCh });
  const pmPrompt = `${getPersonaFull('arabulucu')}\n\nMimar şu kararı verdi: "${mimarText.substring(0, 250)}"\n\n#operasyon kanalı için kısa sprint ticket yaz. Format: "**[TASK]** [başlık] — [1 cümle açıklama]". Tek satır, Türkçe.`;
  const pmTicket = await getAIResponse(pmPrompt);
  await naturalPause();
  socket.emit('agent_message', {
    channel: targetCh, role: 'arabulucu', name: ROLE_NAMES.arabulucu,
    text: pmTicket, proactive: true, taskChain: true,
    ts: nowTime(),
  });
  socket.emit('conversation_end', { channel: targetCh });

  // İcracı: acknowledge
  await delay(1200 + Math.random() * 800);
  socket.emit('typing_start', { role: 'icraci', channel: targetCh });
  const doerPrompt = `${getPersonaFull('icraci')}\n\nPM şu task'ı verdi: "${pmTicket.substring(0, 200)}"\n\nİcracı olarak görevi al. 1 kısa cümle — soru veya kabul. Türkçe.`;
  const doerAck = await getAIResponse(doerPrompt);
  await naturalPause();
  socket.emit('agent_message', {
    channel: targetCh, role: 'icraci', name: ROLE_NAMES.icraci,
    text: doerAck, proactive: true, taskChain: true,
    ts: nowTime(),
  });
  socket.emit('conversation_end', { channel: targetCh });

  return true;
}

// ─── Persona Evolution Loop (Faz 6) ──────────────────────────────────────────
const EVOLUTION_TRACKS = ['conversations', 'decisions'];

async function generatePersonaEvolutionDraft(role, allMessages) {
  const dir = ROLE_TO_DIR[role] || role;
  const trackDir = path.join(PERSONA_DIR, dir, 'tracks');
  const nameMap = { mimar: 'Mimar', arabulucu: 'PM', icraci: 'İcracı' };
  const myMessages = allMessages.filter(m => m.role === nameMap[role]);
  if (myMessages.length < 2) return null;

  const histSummary = myMessages.slice(-8).map(m => `- ${m.text}`).join('\n');
  const trackLabels = { conversations: 'Konuşma Kalıpları', decisions: 'Karar Heuristikleri' };
  const drafts = {};

  for (const track of EVOLUTION_TRACKS) {
    const trackFile = path.join(trackDir, `${track}.md`);
    const current   = fs.existsSync(trackFile) ? fs.readFileSync(trackFile, 'utf8').trim() : '';
    const prompt    = `Sen ${ROLE_NAMES[role]}'sın. Bu oturumda verdiğin yanıtlara dayanarak kendi ${trackLabels[track]} dosyana eklemek istediğin kalıcı içgörü ya da güncelleme varsa yaz.

Mevcut ${trackLabels[track]} (referans, tekrar etme):
${current.substring(0, 600)}

Bu oturumda söylediklerin:
${histSummary}

KURALLAR:
- Mevcut içeriği KEsinlikle tekrar etme
- Gerçekten yeni veya rafine bir şey yoksa tam olarak şunu yaz: BOŞ
- Mevcut dosyayla aynı stil (madde listesi veya ## başlık)
- Türkçe, 1-3 kısa madde max
- Sadece eklenecek metin — başka açıklama yok

Eklenecek metin:`;
    try {
      const raw = (await getAIResponse(prompt)).trim();
      if (raw && raw.length > 10 && !/^(BOŞ|boş|yok|none|nothing|---|N\/A)$/i.test(raw)) {
        drafts[track] = raw;
      }
    } catch (e) {
      console.warn(`Evolution draft (${role}/${track}):`, e.message);
    }
  }

  return Object.keys(drafts).length ? { role, dir, drafts } : null;
}

async function generateEvolutionDrafts(socket, socketId) {
  const allChannels = sessionHistories.get(socketId);
  if (!allChannels) return;

  const allMessages = Object.values(allChannels).flat();
  if (allMessages.length < 4) {
    socket.emit('evolution_draft', { skip: true, reason: 'Bu oturum evolution için çok kısa.' });
    return;
  }

  socket.emit('evolution_start', { message: 'Persona evolution taslakları hazırlanıyor…' });

  const results = [];
  for (const role of ['mimar', 'arabulucu', 'icraci']) {
    const draft = await generatePersonaEvolutionDraft(role, allMessages);
    if (draft) results.push(draft);
  }

  if (!results.length) {
    socket.emit('evolution_draft', { skip: true, reason: 'Bu oturumdan eklenecek yeni içgörü bulunamadı.' });
    return;
  }

  socket.emit('evolution_draft', { drafts: results });
}

// ─── Session yönetimi ─────────────────────────────────────────────────────────
const sessionHistories   = new Map();
const socketLastActivity = new Map();

function getChannelHistory(socketId, channel) {
  if (!sessionHistories.has(socketId)) sessionHistories.set(socketId, { '#strateji': [], '#operasyon': [], '#genel': [] });
  return sessionHistories.get(socketId)[channel] || [];
}

function appendChannelHistory(socketId, channel, entries) {
  const all = sessionHistories.get(socketId);
  if (!all) return;
  const hist = all[channel] || [];
  hist.push(...entries);
  if (hist.length > 24) hist.splice(0, hist.length - 24);
  all[channel] = hist;
}

// ─── Watchdog ────────────────────────────────────────────────────────────────
const SILENCE_MS = 5 * 60 * 1000;

const EVOLUTION_SUGGEST_MS = 15 * 60 * 1000;
const socketEvolutionSuggested = new Map();

setInterval(() => {
  const now = Date.now();
  io.sockets.sockets.forEach(async (socket) => {
    const last = socketLastActivity.get(socket.id) || 0;
    if (last > 0 && now - last > SILENCE_MS) {
      socketLastActivity.set(socket.id, now);
      try {
        // Evolution öneri: 15dk+ hareketsizlik + yeterli konuşma + henüz önerilmemişse
        const allChannels = sessionHistories.get(socket.id) || {};
        const totalMsgs   = Object.values(allChannels).flat().length;
        const alreadySuggested = socketEvolutionSuggested.get(socket.id) || false;
        if (totalMsgs >= 6 && !alreadySuggested && now - last > EVOLUTION_SUGGEST_MS) {
          socketEvolutionSuggested.set(socket.id, true);
          socket.emit('typing_start', { role: 'arabulucu', channel: '#genel' });
          await naturalPause();
          socket.emit('agent_message', {
            channel: '#genel', role: 'arabulucu', name: ROLE_NAMES.arabulucu,
            text: 'Bir süredir sessiziz. Oturumu kapatmadan önce persona evolution çalıştıralım mı? `/evolve` yazarsan bu oturumdan öğrenilenleri persona dosyalarına kaydedebiliriz.',
            proactive: true, ts: nowTime(),
          });
          socket.emit('conversation_end', { channel: '#genel' });
          return;
        }

        socket.emit('typing_start', { role: 'arabulucu', channel: '#genel' });
        const text = await getAIResponse(`${getPersonaFull('arabulucu')}\n\nEkip sessiz. Kısa Türkçe check-in mesajı yaz. Maks 2 cümle.`);
        await naturalPause();
        socket.emit('agent_message', { channel: '#genel', role: 'arabulucu', name: ROLE_NAMES.arabulucu, text, proactive: true });
        socket.emit('conversation_end', { channel: '#genel' });
      } catch (e) { console.error('Watchdog error:', e); }
    }
  });
}, 30_000);

// ─── Pazartesi standup ────────────────────────────────────────────────────────
setInterval(() => {
  const now = new Date();
  if (now.getDay() !== 1 || now.getHours() !== 9 || now.getMinutes() !== 0) return;
  io.sockets.sockets.forEach(async (socket) => {
    try {
      const jobs = [
        ['#genel',    'mimar',     'Tüm ekibe haftalık vizyon direktifi ver. 2 cümle.'],
        ['#strateji', 'arabulucu', 'Bu haftanın öncelik listesini yaz. Max 3 madde.'],
        ['#operasyon','icraci',    'Bu haftanın teknik görev listesi. Max 3 madde, madde formatı.'],
      ];
      for (const [ch, role, prompt] of jobs) {
        socket.emit('typing_start', { role, channel: ch });
        const text = await getAIResponse(`${getPersonaFull(role)}\n\n${prompt}`);
        await naturalPause();
        socket.emit('agent_message', { channel: ch, role, name: ROLE_NAMES[role], text, proactive: true, type: 'standup' });
        socket.emit('conversation_end', { channel: ch });
        await delay(1500);
      }
    } catch (e) { console.error('Standup error:', e); }
  });
}, 60_000);

// ─── Ana bağlantı ─────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  sessionHistories.set(socket.id, { '#strateji': [], '#operasyon': [], '#genel': [] });
  socketLastActivity.set(socket.id, 0);
  socketEvolutionSuggested.set(socket.id, false);

  // ── Kullanıcı mesajı ──────────────────────────────────────────────────────
  socket.on('user_message', async (payload) => {
    const message = typeof payload === 'string' ? payload : payload?.message;
    const channel = typeof payload === 'string' ? '#genel' : (payload?.channel || '#genel');
    if (!message) return;

    socket._activeChannel = channel;

    if (!checkRateLimit(socket.id)) {
      socket.emit('agent_message', {
        channel, role: 'arabulucu', name: ROLE_NAMES.arabulucu,
        text: 'Çok hızlı mesaj geliyor. Biraz nefes al — ekip yetişiyor.',
        proactive: true, ts: nowTime(),
      });
      socket.emit('conversation_end', { channel });
      return;
    }

    try {
      socketLastActivity.set(socket.id, Date.now());
      const history    = getChannelHistory(socket.id, channel);
      const histCtx    = buildHistoryContext(history);
      const cfg        = CHANNEL_CONFIG[channel] || {};
      const respondents = cfg.fixed ? [...cfg.fixed] : routeByContent(message);

      socket.emit('typing_start', { role: respondents[0], channel });

      // ── Otonom Tartışma Zinciri (Moltbot Mode) ──────────────────────────
      const priorResponses = {};
      const MAX_TURNS = 10; // Bir zincirde max kaç mesaj olabilir?
      let currentRespondents = respondents;
      let turnCount = 0;

      while (currentRespondents.length > 0 && turnCount < MAX_TURNS) {
        const role = currentRespondents.shift();
        turnCount++;

        // Ajanı yazmaya başlat
        socket.emit('typing_start', { role, channel });

        // Ajan sırasını çalıştır
        const text = await runAgentTurn(socket, role, message, histCtx, priorResponses, cfg.promptAddon || '', channel);
        
        // Yeni delegasyonları (isim geçirme) tespit et ve listeye ekle
        const newDelegations = detectDelegation(text, Object.keys(priorResponses));
        if (newDelegations.length > 0) {
          currentRespondents.push(...newDelegations);
        }

        // Eğer PM veya Mimar birini "göreve" çağırmadıysa ama konu hala sıcaksa, 
        // %30 ihtimalle bir "tartışmacı" ajan daha eklensin (otonom akış için)
        if (currentRespondents.length === 0 && turnCount < 4 && Math.random() > 0.7) {
          const others = ['mimar', 'arabulucu', 'icraci'].filter(r => r !== role);
          currentRespondents.push(others[Math.floor(Math.random() * others.length)]);
        }
      }

      // Zincir bittiğinde geçmişe kaydet
      const nameMap = { mimar: 'Mimar', arabulucu: 'PM', icraci: 'İcracı' };
      appendChannelHistory(socket.id, channel, [
        { role: 'Kullanıcı', text: message.substring(0, 300) },
        ...Object.entries(priorResponses).map(([r, t]) => ({ role: nameMap[r], text: t })),
      ]);

      socket.emit('conversation_end', { channel });

      // Reality Audit → HITL gating
      if (priorResponses.mimar || priorResponses.icraci) {
        generateRealityAudit(socket, channel, priorResponses.mimar, priorResponses.icraci)
          .then((audit) => {
            const risk = audit?.riskPercent || 0;
            const hasDecision = detectDecision(priorResponses.mimar || '');

            if (hasDecision) {
              if (risk >= 70) {
                // Riskli — kullanıcıdan onay al
                pendingTaskChains.set(socket.id, { priorResponses: { ...priorResponses }, channel, userMessage: message });
                socket.emit('hitl_checkpoint', { riskPercent: risk, vision: audit.vision, gaps: audit.gaps || [], channel });
              } else {
                // Risk düşük — otomatik task chain
                runTaskChain(socket, channel, priorResponses, message).catch(console.error);
              }
            }
          })
          .catch(console.error);
      } else if (detectDecision(priorResponses.mimar || '')) {
        // Audit yoksa direkt task chain
        runTaskChain(socket, channel, priorResponses, message).catch(console.error);
      }

      // Cerebra Writeback (sync, fast)
      cerebraWriteback(channel, message, priorResponses);

      // Cross-channel relay (strateji dışı kanallar için)
      if (channel !== '#strateji') {
        crossChannelRelay(socket, channel, priorResponses).catch(console.error);
      }

      socket.emit('cerebra_saved', { channel, files: Object.keys(priorResponses).length });

    } catch (error) {
      console.error('AI Error:', error);
      socket.emit('agent_message', {
        channel, role: 'arabulucu', name: ROLE_NAMES.arabulucu,
        text: 'Şu an yanıt alamadım. Birazdan tekrar deneyin.',
        proactive: true, ts: nowTime(),
      });
      socket.emit('conversation_end', { channel });
    }
  });

  // ── HITL Checkpoint yanıtı ────────────────────────────────────────────────
  socket.on('hitl_response', async ({ approved }) => {
    const pending = pendingTaskChains.get(socket.id);
    pendingTaskChains.delete(socket.id);

    if (approved && pending) {
      runTaskChain(socket, pending.channel, pending.priorResponses, pending.userMessage).catch(console.error);
    } else {
      // PM görevi durdurduğunu duyurur
      await delay(600);
      socket.emit('typing_start', { role: 'arabulucu', channel: pending?.channel || '#genel' });
      const haltText = await getAIResponse(`${getPersonaFull('arabulucu')}\n\nKullanıcı yüksek risk nedeniyle görevi durdurdu. Ekibe kısa bilgi ver — scope gözden geçirilecek. 1-2 cümle, Türkçe.`).catch(() => 'Risk yüksek. Bu karar şimdilik donduruldu, scope gözden geçirilecek.');
      await naturalPause();
      socket.emit('agent_message', {
        channel: pending?.channel || '#genel',
        role: 'arabulucu', name: ROLE_NAMES.arabulucu,
        text: haltText, proactive: true, ts: nowTime(),
      });
      socket.emit('conversation_end', { channel: pending?.channel || '#genel' });
    }
  });

  // ── Correction Loop ───────────────────────────────────────────────────────
  socket.on('correction_feedback', ({ role, feedback, originalResponse }) => {
    try {
      const dir  = ROLE_TO_DIR[role] || role;
      const file = path.join(PERSONA_DIR, dir, 'correction-log.md');
      const now  = new Date().toLocaleString('tr-TR');
      const entry = `\n## ${now}\n**Yanıt:** "${String(originalResponse || '').substring(0, 150)}..."\n**Düzeltme:** ${feedback}\n`;
      if (!fs.existsSync(file)) fs.writeFileSync(file, `# Correction Log\n`, 'utf8');
      fs.appendFileSync(file, entry, 'utf8');
      socket.emit('correction_saved', { role });
    } catch (e) { console.error('Correction save error:', e); }
  });

  // ── Slash komutları ───────────────────────────────────────────────────────
  socket.on('slash_command', async ({ cmd, args, channel }) => {
    const ch = channel || '#genel';
    try {
      if (cmd === 'standup') {
        socket.emit('typing_start', { role: 'mimar', channel: ch });
        const text = await getAIResponse(`${getPersonaFull('mimar')}\n\nEkibe kısa standup direktifi ver. 2 cümle, plaza tarzı.`);
        await naturalPause();
        socket.emit('agent_message', { channel: ch, role: 'mimar', name: ROLE_NAMES.mimar, text, proactive: true, type: 'standup' });
        socket.emit('conversation_end', { channel: ch });

      } else if (cmd === 'audit') {
        const hist       = getChannelHistory(socket.id, ch);
        const mimarText  = hist.filter(h => h.role === 'Mimar').slice(-1)[0]?.text;
        const doerText   = hist.filter(h => h.role === 'İcracı').slice(-1)[0]?.text;
        await generateRealityAudit(socket, ch, mimarText, doerText);
        socket.emit('agent_message', { channel: ch, role: 'arabulucu', name: ROLE_NAMES.arabulucu, text: 'Reality Audit güncellendi. Sağ paneli kontrol edin.', proactive: true });
        socket.emit('conversation_end', { channel: ch });

      } else if (cmd === 'roster') {
        const text = '**Ekip Durumu:**\n- 🏛️ Mimar (CVO): #strateji kanalında, vizyon odaklı\n- 📋 Arabulucu (PM): Tüm kanallarda, koordinasyon\n- ⚙️ İcracı (Doer): #operasyon kanalında, icraat';
        socket.emit('agent_message', { channel: ch, role: 'arabulucu', name: ROLE_NAMES.arabulucu, text });
        socket.emit('conversation_end', { channel: ch });

      } else if (cmd === 'save') {
        socket.emit('agent_message', { channel: ch, role: 'arabulucu', name: ROLE_NAMES.arabulucu, text: `Son konuşma Cerebra'ya kaydedildi. decisions/, execution_logs/ ve backlog/ klasörlerine bakabilirsiniz.`, proactive: true });
        socket.emit('conversation_end', { channel: ch });

      } else if (cmd === 'queue') {
        socket.emit('typing_start', { role: 'arabulucu', channel: ch });
        try {
          // Son 5 backlog dosyasını oku
          const files = fs.existsSync(BACKLOG_DIR)
            ? fs.readdirSync(BACKLOG_DIR).filter(f => f.endsWith('.md')).sort().slice(-5)
            : [];
          const backlogContent = files.length
            ? files.map(f => fs.readFileSync(path.join(BACKLOG_DIR, f), 'utf8')).join('\n\n---\n\n').substring(0, 2000)
            : null;

          let queueText;
          if (!backlogContent) {
            queueText = 'Henüz backlog kaydı yok. Strateji kanalında karar alındıkça burası dolacak.';
          } else {
            const qPrompt = `${getPersonaFull('arabulucu')}\n\nAşağıda son backlog kayıtları var:\n${backlogContent}\n\nPM olarak bunları [HIGH] / [NORMAL] / [LOW] öncelik etiketiyle özetle. Madde listesi, max 5 madde. Türkçe.`;
            queueText = await getAIResponse(qPrompt);
          }
          await naturalPause();
          socket.emit('agent_message', {
            channel: ch, role: 'arabulucu', name: ROLE_NAMES.arabulucu,
            text: `**📋 Güncel Backlog Öncelikleri:**\n${queueText}`, proactive: true,
          });
        } catch (e) {
          socket.emit('agent_message', { channel: ch, role: 'arabulucu', name: ROLE_NAMES.arabulucu, text: 'Backlog okunamadı.' });
        }
        socket.emit('conversation_end', { channel: ch });

      } else if (cmd === 'evolve') {
        socket.emit('typing_start', { role: 'arabulucu', channel: ch });
        await naturalPause();
        socket.emit('agent_message', {
          channel: ch, role: 'arabulucu', name: ROLE_NAMES.arabulucu,
          text: 'Oturum analiz ediliyor — her persona için evolution taslakları hazırlanıyor. Biraz bekle.',
          proactive: true, ts: nowTime(),
        });
        socket.emit('conversation_end', { channel: ch });
        generateEvolutionDrafts(socket, socket.id).catch(console.error);

      } else if (cmd === 'history') {
        const targetRole = args?.[0]?.toLowerCase();
        const roleMap = { mimar: 'mimar', arabulucu: 'arabulucu', icraci: 'icraci',
                          cvo: 'mimar', pm: 'arabulucu', doer: 'icraci' };
        const role = roleMap[targetRole] || 'arabulucu';
        const dir  = ROLE_TO_DIR[role] || role;
        const logPath = path.join(PERSONA_DIR, dir, 'correction-log.md');

        if (!fs.existsSync(logPath) || fs.readFileSync(logPath, 'utf8').length < 80) {
          socket.emit('agent_message', { channel: ch, role: 'arabulucu', name: ROLE_NAMES.arabulucu,
            text: `${ROLE_NAMES[role]} için henüz düzeltme kaydı yok. Bir mesajın altındaki ↩ butonunu kullanarak başlayabilirsin.` });
        } else {
          socket.emit('typing_start', { role: 'arabulucu', channel: ch });
          const log = fs.readFileSync(logPath, 'utf8');
          const summaryPrompt = `${getPersonaFull('arabulucu')}\n\nAşağıda ${ROLE_NAMES[role]}'nın correction log'u var:\n\n${log.substring(0, 1500)}\n\nPM olarak bu düzeltmeleri kısa bir özet olarak sun. Madde listesi, max 4 madde. Türkçe.`;
          const summary = await getAIResponse(summaryPrompt);
          await naturalPause();
          socket.emit('agent_message', { channel: ch, role: 'arabulucu', name: ROLE_NAMES.arabulucu,
            text: `**${ROLE_NAMES[role]} Kalibrasyon Özeti:**\n${summary}`, proactive: true });
        }
        socket.emit('conversation_end', { channel: ch });
      }
    } catch (e) { console.error('Slash command error:', e); }
  });

  // ── Evolution Approved ────────────────────────────────────────────────────
  socket.on('evolution_approved', ({ drafts }) => {
    const updated = [];
    try {
      for (const { dir, drafts: trackDrafts, approvedTracks } of drafts) {
        const trackDir = path.join(PERSONA_DIR, dir, 'tracks');
        for (const [track, content] of Object.entries(trackDrafts)) {
          if (approvedTracks && !approvedTracks.includes(track)) continue;
          const trackFile = path.join(trackDir, `${track}.md`);
          const existing  = fs.existsSync(trackFile) ? fs.readFileSync(trackFile, 'utf8') : '';
          const stamp     = new Date().toLocaleString('tr-TR');
          fs.writeFileSync(trackFile, `${existing}\n\n---\n*${stamp} — oturum güncellemesi*\n${content}`, 'utf8');
          updated.push(`${dir}/${track}`);
        }
      }
      _cerebraCache.ts = 0;
      socket.emit('evolution_saved', { updated });
    } catch (e) {
      console.error('Evolution write error:', e);
      socket.emit('evolution_saved', { updated: [], error: e.message });
    }
  });

  socket.on('disconnect', () => {
    sessionHistories.delete(socket.id);
    socketLastActivity.delete(socket.id);
    pendingTaskChains.delete(socket.id);
    socketMessageCounts.delete(socket.id);
    socketEvolutionSuggested.delete(socket.id);
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
