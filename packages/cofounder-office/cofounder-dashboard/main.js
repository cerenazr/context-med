import { io } from 'socket.io-client';

const socket = io('http://localhost:4000');

// ─── DOM refs ──────────────────────────────────────────────────────────────────
const chatContainer  = document.getElementById('chat-messages');
const scratchpad     = document.getElementById('scratch-content');
const input          = document.getElementById('chat-input');
const sendBtn        = document.getElementById('send-btn');
const statusChip     = document.getElementById('connection-status');
const cerebraChip    = document.getElementById('cerebra-indicator');
const pageTitleEl    = document.querySelector('.page-title');
const slashHints     = document.getElementById('slash-hints');
const auditContent   = document.getElementById('audit-content');
const auditRiskBar   = document.getElementById('audit-risk-bar');
const riskPct        = document.getElementById('risk-pct');
const riskFill       = document.getElementById('risk-fill');
const inputStatusBar = document.getElementById('input-status-bar');
const inputStatusTxt = document.getElementById('input-status-text');

// Specialized Workspace Refs
const tabBtns        = document.querySelectorAll('.tab-btn');
const tabPanes       = document.querySelectorAll('.tab-pane');
const icraciTerminal = document.getElementById('icraci-terminal');
const pmBoardBacklog = document.getElementById('board-backlog');

// ─── State ─────────────────────────────────────────────────────────────────────
let activeChannel = '#strateji';
const channelMessages    = { '#strateji': [], '#operasyon': [], '#genel': [] };
const processingChannels = new Set();
const unreadCounts       = { '#strateji': 0, '#operasyon': 0, '#genel': 0 };
const currentFlow        = { participants: new Set(), typing: null, done: new Set() };
const streamingBubbles   = {};   // role → { div, textEl, rawText, channel }

// Correction modal state
let correctionTarget = { role: null, text: null };

// ─── Kanal & ajan konfigürasyonu ──────────────────────────────────────────────
const CHANNEL_CONFIG = {
  '#strateji': { members: ['mimar','arabulucu'], placeholder:'Mimar ve PM\'e strateji sorun...', desc:'Vizyon, roadmap ve üst düzey kararlar.' },
  '#operasyon': { members: ['arabulucu','icraci'], placeholder:'PM ve İcracı\'ya teknik ilerleme sorun...', desc:'Günlük görevler, teknik ilerleme ve uygulama.' },
  '#genel':     { members: ['mimar','arabulucu','icraci'], placeholder:'Tüm ekibe mesaj yazın...', desc:'Ekip geneli duyurular.' },
};
const AGENT_PRIMARY_CHANNEL = { mimar:'#strateji', arabulucu:'#genel', icraci:'#operasyon' };
const AGENT_NAMES = { mimar:'Mimar (CVO)', arabulucu:'Arabulucu (PM)', icraci:'İcracı (Doer)', user:'Siz', system:'Sistem' };

const AGENT_ACTIVITIES = {
  mimar:     { typing:['Strateji notu yazıyor...','Vizyon direktifi...','Roadmap güncelliyor...'], working:['Power BI...','Notion OKR...','Pitch deck...'], idle:['Çevrimiçi','Tableau\'da...','Roadmap inceliyor...'] },
  arabulucu: { typing:['Jira\'da ticket...','PRD yazıyor...','Toplantı notu...'], working:['Linear sprint...','Miro workshop...','Loom kaydı...'], idle:['Çevrimiçi','Slack\'te...','Backlog görüyor...'] },
  icraci:    { typing:['Kod yazıyor...','Terminal\'de...','Debug yapıyor...'], working:['VS Code...','GitHub PR...','Docker build...'], idle:['Çevrimiçi','GitHub\'da...','Test çalıştırıyor...'] },
};

function randomActivity(role, status) {
  const list = AGENT_ACTIVITIES[role]?.[status] || ['...'];
  return list[Math.floor(Math.random() * list.length)];
}

function timestamp() {
  return new Date().toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit' });
}

// ─── Markdown render ──────────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (window.marked) {
    try {
      return window.marked.parse(text || '', { breaks: true, gfm: true });
    } catch { /* fall through */ }
  }
  return (text || '').replace(/\n/g, '<br>');
}

// ─── Agent card ───────────────────────────────────────────────────────────────
function updateAgentCard(role, status, activityOverride) {
  const card = document.querySelector(`.agent-card[data-role="${role}"]`);
  if (!card) return;
  card.classList.remove('typing','working','idle','away');
  card.classList.add(status);
  const dot = card.querySelector('.agent-status-dot');
  if (dot) dot.className = `agent-status-dot status-${status}`;
  const actEl = card.querySelector('.agent-activity');
  if (actEl) actEl.textContent = activityOverride || randomActivity(role, status);
}

function updateAgentMembership(channel) {
  const members = CHANNEL_CONFIG[channel]?.members || [];
  ['mimar','arabulucu','icraci'].forEach(role => {
    const card = document.querySelector(`.agent-card[data-role="${role}"]`);
    if (!card) return;
    if (members.includes(role)) {
      card.classList.remove('away');
      updateAgentCard(role, 'idle');
    } else {
      card.classList.remove('typing','working');
      card.classList.add('away');
      const actEl = card.querySelector('.agent-activity');
      if (actEl) actEl.textContent = `${AGENT_PRIMARY_CHANNEL[role]} kanalında`;
    }
  });
}

// ─── Flow indicator ───────────────────────────────────────────────────────────
function updateFlowIndicator() {
  const el = document.getElementById('flow-indicator');
  if (!el) return;
  const hasFlow = currentFlow.participants.size > 0;
  el.style.display = hasFlow ? 'block' : 'none';
  if (!hasFlow) return;
  const stepsEl = el.querySelector('.flow-steps');
  if (!stepsEl) return;
  stepsEl.innerHTML = '';
  const order = ['mimar','arabulucu','icraci'].filter(r => currentFlow.participants.has(r));
  order.forEach((role, idx) => {
    const step = document.createElement('div');
    step.className = 'flow-step';
    step.dataset.role = role;
    step.textContent = { mimar:'M', arabulucu:'A', icraci:'İ' }[role] || '?';
    if (currentFlow.done.has(role))   step.classList.add('done');
    if (currentFlow.typing === role)  step.classList.add('typing');
    if (!currentFlow.done.has(role) && currentFlow.typing !== role) step.classList.add('waiting');
    stepsEl.appendChild(step);
    if (idx < order.length - 1) {
      const arr = document.createElement('div');
      arr.className = 'flow-arrow'; arr.textContent = '→';
      stepsEl.appendChild(arr);
    }
  });
}

function resetFlow() {
  currentFlow.participants.clear();
  currentFlow.done.clear();
  currentFlow.typing = null;
  updateFlowIndicator();
}

// ─── Typing indicator ─────────────────────────────────────────────────────────
function showTypingIndicator(role) {
  if (document.getElementById(`typing-${role}`)) return;
  const div = document.createElement('div');
  div.id = `typing-${role}`;
  div.className = `message ${role} typing-message`;
  div.innerHTML = `<div class="message-meta"><span class="agent-dot agent-dot--${role}"></span><span>${AGENT_NAMES[role]}</span></div><div class="typing-indicator"><span></span><span></span><span></span></div>`;
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function removeTypingIndicator(role) { document.getElementById(`typing-${role}`)?.remove(); }
function removeAllTypingIndicators() { ['mimar','arabulucu','icraci'].forEach(removeTypingIndicator); }

// ─── Correction modal ─────────────────────────────────────────────────────────
function openCorrectionModal(role, text) {
  correctionTarget = { role, text };
  const modal = document.getElementById('correction-modal');
  const roleLabel = document.getElementById('modal-role-label');
  const original  = document.getElementById('modal-original');
  const corrInput = document.getElementById('correction-input');
  if (!modal) return;
  roleLabel.textContent = `${AGENT_NAMES[role]} için düzeltme`;
  original.textContent  = `"${(text || '').substring(0, 120)}..."`;
  corrInput.value = '';
  modal.style.display = 'flex';
  corrInput.focus();
}

function closeCorrectionModal() {
  const modal = document.getElementById('correction-modal');
  if (modal) modal.style.display = 'none';
  correctionTarget = { role: null, text: null };
}

document.getElementById('correction-cancel')?.addEventListener('click', closeCorrectionModal);
document.getElementById('correction-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'correction-modal') closeCorrectionModal();
});
document.getElementById('correction-submit')?.addEventListener('click', () => {
  const feedback = document.getElementById('correction-input')?.value?.trim();
  if (!feedback || !correctionTarget.role) return;
  socket.emit('correction_feedback', {
    role: correctionTarget.role,
    feedback,
    originalResponse: correctionTarget.text,
  });
  closeCorrectionModal();
});

// ─── Mesaj render ─────────────────────────────────────────────────────────────
function buildMessageEl(msg) {
  const isUser = msg.role === 'user';
  const dot    = (!isUser && msg.role !== 'system') ? `<span class="agent-dot agent-dot--${msg.role}"></span>` : '';
  const badge  = msg.proactive
    ? `<span class="proactive-badge">${msg.type === 'standup' ? '📅 Standup' : msg.crossChannel ? `🔀 ${msg.fromChannel}` : '💬 Proaktif'}</span>` : '';
  const prov   = msg.provenance?.length
    ? `<div class="provenance"><span class="prov-icon">⚡</span>${msg.provenance.join(' · ')}</div>` : '';
  const warn   = msg.expertiseWarning
    ? `<div class="expertise-warning">⚠️ ${msg.expertiseWarning}</div>` : '';
  const feedbackBtn = (!isUser && msg.role !== 'system')
    ? `<button class="feedback-btn" title="Düzelt">↩</button>` : '';

  const div = document.createElement('div');
  div.className = `message ${msg.role}${msg.proactive ? ' proactive' : ''}`;
  div.innerHTML = `
    <div class="message-meta">
      ${dot}
      <span class="agent-name">${AGENT_NAMES[msg.role] || msg.name || msg.role}</span>
      ${badge}
      <span class="msg-time">${msg.ts || timestamp()}</span>
      ${feedbackBtn}
    </div>
    <div class="message-text">${renderMarkdown(msg.text || '')}</div>
    ${prov}${warn}`;

  div.querySelector('.feedback-btn')?.addEventListener('click', () => {
    openCorrectionModal(msg.role, msg.text);
  });
  return div;
}

function renderMessage(msg, store = true) {
  if (store && channelMessages[activeChannel]) {
    channelMessages[activeChannel].push({ ...msg, ts: msg.ts || timestamp() });
    saveState();
  }
  removeTypingIndicator(msg.role);
  const div = buildMessageEl(msg);
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  if (msg.note && scratchpad) {
    const noteDiv = document.createElement('div');
    noteDiv.className = 'scratch-item new-note';
    noteDiv.innerText = msg.note;
    scratchpad.prepend(noteDiv);
    setTimeout(() => noteDiv.classList.remove('new-note'), 900);
  }
}

// ─── Streaming bubble yönetimi ────────────────────────────────────────────────
function getOrCreateStreamBubble(role, channel) {
  if (streamingBubbles[role]) return streamingBubbles[role];

  removeTypingIndicator(role);

  const div     = document.createElement('div');
  div.className = `message ${role} streaming`;
  div.innerHTML = `
    <div class="message-meta">
      <span class="agent-dot agent-dot--${role}"></span>
      <span class="agent-name">${AGENT_NAMES[role]}</span>
      <span class="msg-time">${timestamp()}</span>
    </div>
    <div class="message-text stream-text"></div>
    <span class="stream-cursor">▌</span>`;

  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  const entry = { div, textEl: div.querySelector('.message-text'), rawText: '', channel, ts: timestamp() };
  streamingBubbles[role] = entry;
  return entry;
}

// ─── Reality Audit güncelle ───────────────────────────────────────────────────
function updateAuditPanel(audit) {
  if (!auditContent || !audit) return;
  auditContent.innerHTML = '';

  const visionEl = document.createElement('div');
  visionEl.className = 'audit-item';
  visionEl.innerHTML = `
    <div class="audit-field">Vizyon</div>
    <div class="audit-value">${audit.vision || '-'}</div>
    <div class="audit-reality">${audit.reality || '-'}</div>`;
  auditContent.appendChild(visionEl);

  if (audit.gaps?.length) {
    const gapsEl = document.createElement('div');
    gapsEl.className = 'audit-item';
    gapsEl.innerHTML = `<div class="audit-field">Riskler</div>` +
      audit.gaps.map(g => `<div class="audit-gap">• ${g}</div>`).join('');
    auditContent.appendChild(gapsEl);
  }

  if (auditRiskBar && riskPct && riskFill) {
    const pct = Math.max(0, Math.min(100, audit.riskPercent || 0));
    auditRiskBar.style.display = 'block';
    riskPct.textContent = pct;
    riskFill.style.width = `${pct}%`;
    riskFill.style.background = pct > 70 ? '#ef4444' : pct > 40 ? '#f59e0b' : '#22c55e';
  }
}

// ─── Unread & cross-channel ───────────────────────────────────────────────────
function incrementUnread(channel) {
  if (channel === activeChannel) return;
  unreadCounts[channel] = (unreadCounts[channel] || 0) + 1;
  renderUnreadBadge(channel);
}

function clearUnread(channel) {
  unreadCounts[channel] = 0;
  renderUnreadBadge(channel);
}

function renderUnreadBadge(channel) {
  const navItem = document.querySelector(`.nav-item[data-channel="${channel}"]`);
  if (!navItem) return;
  let badge = navItem.querySelector('.unread-badge');
  const count = unreadCounts[channel] || 0;
  if (count > 0) {
    if (!badge) { badge = document.createElement('span'); badge.className = 'unread-badge'; navItem.appendChild(badge); }
    badge.textContent = count;
    navItem.classList.add('has-activity');
  } else { badge?.remove(); navItem.classList.remove('has-activity'); }
}

function showCrossChannelToast(msg, targetChannel) {
  document.getElementById('cross-toast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'cross-toast';
  toast.className = 'cross-channel-toast';
  toast.innerHTML = `<span class="agent-dot agent-dot--${msg.role}" style="flex-shrink:0"></span><span><strong>${AGENT_NAMES[msg.role]}</strong> ${targetChannel} kanalına yazdı</span><button class="toast-go" data-channel="${targetChannel}">${targetChannel} →</button>`;
  document.getElementById('app').appendChild(toast);
  toast.querySelector('.toast-go')?.addEventListener('click', () => { switchChannel(targetChannel); toast.remove(); });
  setTimeout(() => toast?.remove(), 5000);
}

// ─── Input status bar ─────────────────────────────────────────────────────────
function setInputStatus(text) {
  if (!inputStatusBar || !inputStatusTxt) return;
  if (text) {
    inputStatusTxt.textContent = text;
    inputStatusBar.style.display = 'flex';
  } else {
    inputStatusBar.style.display = 'none';
    inputStatusTxt.textContent = '';
  }
}

// ─── Processing state ─────────────────────────────────────────────────────────
function setChannelProcessing(channel, state) {
  if (state) processingChannels.add(channel); else processingChannels.delete(channel);
  const locked = processingChannels.has(activeChannel);
  if (input) input.disabled = locked;
  if (sendBtn) sendBtn.disabled = locked;
  if (!locked) setInputStatus(null);
}

// ─── State persistence (sessionStorage) ──────────────────────────────────────
function saveState() {
  try {
    sessionStorage.setItem('cf_messages', JSON.stringify(channelMessages));
    sessionStorage.setItem('cf_channel', activeChannel);
  } catch { /* storage unavailable */ }
}

function loadState() {
  try {
    const msgs = sessionStorage.getItem('cf_messages');
    const ch   = sessionStorage.getItem('cf_channel');
    if (msgs) {
      const parsed = JSON.parse(msgs);
      Object.keys(channelMessages).forEach(k => { if (parsed[k]) channelMessages[k] = parsed[k]; });
    }
    if (ch && channelMessages[ch] !== undefined) activeChannel = ch;
  } catch { /* ignore */ }
}

// ─── Kanal değiştir ───────────────────────────────────────────────────────────
function switchChannel(channel) {
  activeChannel = channel;
  clearUnread(channel);
  document.querySelectorAll('.nav-item[data-channel]').forEach(el => el.classList.toggle('active', el.dataset.channel === channel));
  if (pageTitleEl) pageTitleEl.innerHTML = `<span style="opacity:0.5">/</span> ${channel}`;
  if (input) input.placeholder = CHANNEL_CONFIG[channel]?.placeholder || 'Mesaj yazın...';
  const locked = processingChannels.has(channel);
  if (input) input.disabled = locked;
  if (sendBtn) sendBtn.disabled = locked;
  updateAgentMembership(channel);

  chatContainer.innerHTML = '';
  const msgs = channelMessages[channel] || [];
  if (!msgs.length) {
    const cfg = CHANNEL_CONFIG[channel] || {};
    chatContainer.innerHTML = `<div class="welcome-message"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg><div class="welcome-title">${channel}</div><div class="welcome-sub">${cfg.desc || ''}</div></div>`;
  } else {
    msgs.forEach(msg => renderMessage(msg, false));
  }
}

// ─── Slash commands ───────────────────────────────────────────────────────────
const SLASH_COMMANDS = ['/standup', '/audit', '/queue', '/roster', '/save', '/history', '/evolve'];

function handleSlashCommand(text) {
  const parts = text.trim().split(' ');
  const cmd   = parts[0].slice(1);
  socket.emit('slash_command', { cmd, args: parts.slice(1), channel: activeChannel });
  setChannelProcessing(activeChannel, true);
}

input?.addEventListener('input', () => {
  if (!slashHints) return;
  const val = input.value;
  if (val.startsWith('/') && val.length <= 10) {
    slashHints.style.display = 'flex';
    document.querySelectorAll('.slash-hint').forEach(el => {
      el.style.display = el.dataset.cmd.startsWith(val) ? 'inline-flex' : 'none';
    });
  } else {
    slashHints.style.display = 'none';
  }
});

document.querySelectorAll('.slash-hint').forEach(el => {
  el.addEventListener('click', () => {
    if (input) input.value = el.dataset.cmd + ' ';
    slashHints.style.display = 'none';
    input?.focus();
  });
});

// ─── Socket events ────────────────────────────────────────────────────────────
socket.on('connect', () => {
  if (statusChip) { statusChip.textContent = 'Bağlı'; statusChip.className = 'status-chip status-connected'; }
});
socket.on('disconnect', () => {
  if (statusChip) { statusChip.textContent = 'Bağlantı Kesildi'; statusChip.className = 'status-chip status-disconnected'; }
  removeAllTypingIndicators(); processingChannels.clear(); resetFlow(); setChannelProcessing(activeChannel, false);
});
socket.on('connect_error', () => {
  if (statusChip) { statusChip.textContent = 'Bağlanamıyor'; statusChip.className = 'status-chip status-disconnected'; }
  removeAllTypingIndicators(); processingChannels.clear(); resetFlow(); setChannelProcessing(activeChannel, false);
});

// Typing start (backend'den)
socket.on('typing_start', ({ role, channel: ch }) => {
  const target = ch || activeChannel;
  currentFlow.participants.add(role);
  currentFlow.typing = role;
  updateFlowIndicator();
  updateAgentCard(role, 'typing');
  if (target === activeChannel) {
    showTypingIndicator(role);
    setInputStatus(`${AGENT_NAMES[role]} yanıt yazıyor…`);
  }
});

// Streaming chunk
socket.on('agent_stream', ({ role, channel: ch, chunk }) => {
  const target = ch || activeChannel;
  if (target !== activeChannel) return; // arka plan kanalı sessiz stream

  const bubble = getOrCreateStreamBubble(role, target);
  bubble.rawText += chunk;
  if (bubble.textEl) {
    bubble.textEl.innerHTML = renderMarkdown(bubble.rawText);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
});

// Stream bitti — artık mesajlar agent_message ile geldi, burası sadece flow/card günceller
socket.on('agent_stream_end', ({ role, channel: ch }) => {
  // Eğer hâlâ açık bir streaming bubble varsa (eski mesajlar) kapat
  const bubble = streamingBubbles[role];
  if (bubble) {
    bubble.div.classList.remove('streaming');
    bubble.div.querySelector('.stream-cursor')?.remove();
    delete streamingBubbles[role];
  }

  removeTypingIndicator(role);
  currentFlow.done.add(role);
  if (currentFlow.typing === role) currentFlow.typing = null;
  updateFlowIndicator();
  updateAgentCard(role, 'working');
  setTimeout(() => updateAgentCard(role, 'idle'), 3500);
});

// Tüm agent mesajları buradan geçer (hem konuşma hem proaktif)
socket.on('agent_message', (msg) => {
  const target = msg.channel || activeChannel;
  
  // 1. Chat Render (Aktif kanalda ise)
  if (target === activeChannel) {
    renderMessage(msg);
    if (!msg.proactive && !msg.crossChannel && ['mimar','arabulucu','icraci'].includes(msg.role)) {
      currentFlow.participants.add(msg.role);
      updateFlowIndicator();
    }
  } else {
    if (channelMessages[target]) channelMessages[target].push({ ...msg, ts: timestamp() });
    incrementUnread(target);
    if (msg.crossChannel || msg.proactive) showCrossChannelToast(msg, target);
  }

  // 2. Specialized Workspace Dağıtımı
  // İcracı -> Terminal
  if (msg.role === 'icraci') {
    appendToTerminal(msg.text, 'agent');
  }

  // Board'a görev ekle (Arabulucu veya İcracı [TASK] kullanırsa)
  const taskRegex = /\[TASK\]/i;
  if (taskRegex.test(msg.text)) {
    console.log("Task detected in message:", msg.text);
    const taskText = msg.text.replace(taskRegex, '').trim();
    if (taskText) addTaskToBoard(taskText);
  }

  // Çalışma Önizlemesi (Note alanı)
  if (msg.note && scratchpad) {
    const noteDiv = document.createElement('div');
    noteDiv.className = 'scratch-item new-note';
    noteDiv.innerText = msg.note;
    scratchpad.prepend(noteDiv);
    setTimeout(() => noteDiv.classList.remove('new-note'), 900);
  }
});

// Konuşma bitti
socket.on('conversation_end', ({ channel: ch } = {}) => {
  const target = ch || activeChannel;
  setChannelProcessing(target, false);
  if (target === activeChannel) { removeAllTypingIndicators(); resetFlow(); }
});

// Reality Audit güncelle
socket.on('reality_audit_update', (audit) => {
  updateAuditPanel(audit);
  // Kullanıcının dikkatini çek
  const card = document.getElementById('audit-card');
  if (card) {
    card.classList.remove('just-updated');
    void card.offsetWidth; // reflow — animasyonu sıfırla
    card.classList.add('just-updated');
    setTimeout(() => card.classList.remove('just-updated'), 2000);
  }
});

// Correction kaydedildi
socket.on('correction_saved', ({ role }) => {
  const card = document.querySelector(`.agent-card[data-role="${role}"]`);
  if (card) {
    const act = card.querySelector('.agent-activity');
    if (act) { act.textContent = 'Kalibrasyon kaydedildi ✓'; setTimeout(() => updateAgentCard(role, 'idle'), 2000); }
  }
});

// İcracı artifact kaydedildi
socket.on('artifact_saved', ({ filename }) => {
  if (scratchpad) {
    const item = document.createElement('div');
    item.className = 'scratch-item new-note';
    item.innerHTML = `📎 <strong>Artifact:</strong> ${filename}`;
    scratchpad.prepend(item);
    setTimeout(() => item.classList.remove('new-note'), 900);
  }
});

// Cerebra writeback bildirimi
socket.on('cerebra_saved', ({ files }) => {
  if (cerebraChip && files > 0) {
    cerebraChip.style.display = 'inline-flex';
    setTimeout(() => { cerebraChip.style.display = 'none'; }, 3000);
  }
});

// ─── HITL Checkpoint ─────────────────────────────────────────────────────────
socket.on('hitl_checkpoint', ({ riskPercent, vision, gaps }) => {
  const modal    = document.getElementById('hitl-modal');
  const badge    = document.getElementById('hitl-risk-badge');
  const pctEl    = document.getElementById('hitl-risk-pct');
  const visionEl = document.getElementById('hitl-vision');
  const gapsEl   = document.getElementById('hitl-gaps');
  if (!modal) return;

  pctEl.textContent   = riskPercent;
  visionEl.textContent = `Vizyon: ${vision || '—'}`;
  gapsEl.innerHTML    = (gaps || []).map(g => `<div class="hitl-gap-item">• ${g}</div>`).join('');
  badge.className     = `hitl-risk-badge ${riskPercent >= 85 ? 'hitl-critical' : 'hitl-high'}`;
  modal.style.display = 'flex';
});

document.getElementById('hitl-approve')?.addEventListener('click', () => {
  document.getElementById('hitl-modal').style.display = 'none';
  socket.emit('hitl_response', { approved: true });
});
document.getElementById('hitl-reject')?.addEventListener('click', () => {
  document.getElementById('hitl-modal').style.display = 'none';
  socket.emit('hitl_response', { approved: false });
});

// ─── Persona Evolution Modal ──────────────────────────────────────────────────
const PERSONA_LABELS = { mimar: '🏛️ Mimar (CVO)', arabulucu: '📋 Arabulucu (PM)', icraci: '⚙️ İcracı (Doer)' };
const TRACK_LABELS   = { conversations: 'Konuşma Kalıpları', decisions: 'Karar Heuristikleri' };

function showEvolutionModal(drafts) {
  const modal     = document.getElementById('evolution-modal');
  const container = document.getElementById('evolution-drafts-container');
  if (!modal || !container) return;

  container.innerHTML = '';
  for (const { role, dir, drafts: trackDrafts } of drafts) {
    const personaDiv = document.createElement('div');
    personaDiv.className = 'evolution-persona';
    personaDiv.innerHTML = `<div class="evolution-persona-name">${PERSONA_LABELS[role] || role}</div>`;

    for (const [track, content] of Object.entries(trackDrafts)) {
      const checkId  = `evo-${role}-${track}`;
      const trackDiv = document.createElement('div');
      trackDiv.className = 'evolution-track';
      trackDiv.innerHTML = `
        <label class="evolution-track-header" for="${checkId}">
          <input type="checkbox" id="${checkId}" data-role="${role}" data-dir="${dir}" data-track="${track}" checked>
          <span class="evolution-track-label">${TRACK_LABELS[track] || track}</span>
        </label>
        <div class="evolution-content">${content}</div>`;
      personaDiv.appendChild(trackDiv);
    }
    container.appendChild(personaDiv);
  }

  modal._drafts = drafts;
  modal.style.display = 'flex';
}

document.getElementById('evolution-approve')?.addEventListener('click', () => {
  const modal = document.getElementById('evolution-modal');
  const rawDrafts = modal?._drafts || [];

  const approved = rawDrafts
    .map(({ role, dir, drafts: trackDrafts }) => ({
      role, dir, drafts: trackDrafts,
      approvedTracks: Object.keys(trackDrafts).filter(track => {
        return document.getElementById(`evo-${role}-${track}`)?.checked;
      }),
    }))
    .filter(d => d.approvedTracks.length > 0);

  modal.style.display = 'none';
  socket.emit('evolution_approved', { drafts: approved });
});

document.getElementById('evolution-reject')?.addEventListener('click', () => {
  const modal = document.getElementById('evolution-modal');
  if (modal) modal.style.display = 'none';
});

socket.on('evolution_start', ({ message }) => {
  setInputStatus(message || 'Evolution hazırlanıyor…');
});

socket.on('evolution_draft', ({ drafts, skip, reason }) => {
  setInputStatus(null);
  if (skip) {
    renderMessage({
      role: 'arabulucu', name: AGENT_NAMES.arabulucu,
      text: `🧠 Evolution: ${reason}`, proactive: true, ts: timestamp(),
    });
    return;
  }
  showEvolutionModal(drafts);
});

socket.on('evolution_saved', ({ updated, error }) => {
  if (!scratchpad) return;
  const item = document.createElement('div');
  item.className = 'scratch-item new-note';
  item.innerHTML = error
    ? `⚠️ Evolution kayıt hatası: ${error}`
    : `🧠 <strong>Persona Evolution:</strong> ${updated.length} dosya güncellendi (${updated.join(', ')})`;
  scratchpad.prepend(item);
  setTimeout(() => item.classList.remove('new-note'), 900);
});

// ─── Mesaj gönder ─────────────────────────────────────────────────────────────
function sendMessage() {
  const text = input?.value?.trim();
  if (processingChannels.has(activeChannel) || !text) return;
  if (slashHints) slashHints.style.display = 'none';

  if (text.startsWith('/')) {
    handleSlashCommand(text);
  } else {
    renderMessage({ role:'user', name:'Siz', text });
    socket.emit('user_message', { message: text, channel: activeChannel });
    setChannelProcessing(activeChannel, true);
    resetFlow();
  }
  if (input) input.value = '';
}

input?.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
sendBtn?.addEventListener('click', sendMessage);
document.querySelectorAll('.nav-item[data-channel]').forEach(el => el.addEventListener('click', () => switchChannel(el.dataset.channel)));

// ─── Başlangıç ────────────────────────────────────────────────────────────────
loadState();
switchChannel(activeChannel);
// ─── Tab Switching Logic ──────────────────────────────────────────────────────
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const targetTab = btn.getAttribute('data-tab');
    
    // Update buttons
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Update panes
    tabPanes.forEach(p => p.classList.remove('active'));
    const targetPane = document.getElementById(`tab-${targetTab}`);
    if (targetPane) targetPane.classList.add('active');
  });
});

// ─── Terminal & Board Helpers ────────────────────────────────────────────────
function appendToTerminal(text, type = 'system') {
  if (!icraciTerminal) return;
  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  const time = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  line.innerHTML = `<span style="opacity:0.5">[${time}]</span> ${text}`;
  icraciTerminal.appendChild(line);
  icraciTerminal.scrollTop = icraciTerminal.scrollHeight;
}

function addTaskToBoard(text, column = 'backlog') {
  const columnEl = document.getElementById(`board-${column}`);
  if (!columnEl) {
    console.error(`Board column not found: board-${column}`);
    return;
  }
  
  // Eğer sütun içinde özel bir görev alanı (column-tasks) varsa oraya ekle
  const container = columnEl.classList.contains('column-tasks') ? columnEl : columnEl.querySelector('.column-tasks') || columnEl;
  
  console.log(`Adding task to ${column}: ${text}`);
  const cardId = 'task-' + Math.random().toString(36).substr(2, 9);
  const card = document.createElement('div');
  card.className = 'task-card';
  card.id = cardId;
  card.innerHTML = `
    <div class="task-icon">📋</div>
    <div class="task-content">
      <div class="task-text">${text}</div>
      <div class="task-meta">Yükleniyor...</div>
    </div>
  `;
  container.prepend(card);

  // Auto-Tick Mantığı: 120 saniye (2 dk) sonra tamamla
  if (column === 'backlog') {
    setTimeout(() => {
      const doneContainer = document.getElementById('board-done');
      const currentCard = document.getElementById(cardId);
      if (currentCard && doneContainer) {
        currentCard.querySelector('.task-icon').textContent = '✅';
        currentCard.querySelector('.task-meta').textContent = 'Tamamlandı';
        doneContainer.prepend(currentCard);
        
        // İcracı terminaline de bilgi ver
        appendToTerminal(`Görev tamamlandı: ${text}`, 'system');
      }
    }, 120000); // 120000 ms = 2 dk
  }
}
