// FacilisBot Administrative Dashboard Client (Multi-Tenant)
let currentConfig = null;
let activeConversationId = null;
let currentBotId = 'default';
let allLeads = [];
let allConversations = [];

// ================= AUTH / LOGIN =================
let userRole = 'client'; // 'admin' or 'client'

async function attemptLogin() {
  const code = document.getElementById('loginAccessCode').value.trim();
  if (!code) return;
  
  const errorEl = document.getElementById('loginError');
  errorEl.style.display = 'none';
  
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    
    if (data.success) {
      sessionStorage.setItem('facilisbot_access_code', code);
      userRole = data.role;
      
      if (data.role === 'admin') {
        // Admin sees all bots
        currentBotId = 'default';
      } else {
        // Client sees only their bot
        currentBotId = data.botId || 'default';
        // Hide bot switcher for clients
        const switcher = document.getElementById('botSwitcher');
        if (switcher) switcher.parentElement.style.display = 'none';
      }
      
      document.getElementById('loginOverlay').style.display = 'none';
      document.getElementById('appContainer').style.display = '';
      loadBotsList();
      loadOverview();
      loadConfig();
      setupWidgetSnippet();
    } else {
      errorEl.textContent = data.error || 'Código de acceso inválido';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    errorEl.textContent = 'Error de conexión con el servidor';
    errorEl.style.display = 'block';
  }
}

function logout() {
  sessionStorage.removeItem('facilisbot_access_code');
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('appContainer').style.display = 'none';
  document.getElementById('loginAccessCode').value = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  
  // Check for existing session
  const savedCode = sessionStorage.getItem('facilisbot_access_code');
  if (savedCode) {
    document.getElementById('loginAccessCode').value = savedCode;
    await attemptLogin();
  }
});

// ================= BOT SWITCHER =================
async function loadBotsList() {
  try {
    const res = await fetch('/api/bots');
    const data = await res.json();
    const switcher = document.getElementById('botSwitcher');
    if (!switcher) return;

    switcher.innerHTML = '';
    (data.bots || []).forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = `${b.name} (${b.id})`;
      if (b.id === currentBotId) opt.selected = true;
      switcher.appendChild(opt);
    });
  } catch (err) {
    console.error('Error cargando lista de bots:', err);
  }
}

function switchActiveBot(botId) {
  currentBotId = botId;
  loadOverview();
  loadConfig();
  loadKbFiles();
  setupWidgetSnippet();
  clearSimulatorChat();
  showToast(`Cambiado a bot: ${botId}`);
}

// ================= NAVIGATION =================
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(i => i.classList.remove('active'));
      document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));

      item.classList.add('active');
      const tab = item.getAttribute('data-tab');
      const targetView = document.getElementById(`view-${tab}`);
      if (targetView) targetView.classList.add('active');

      // Lazy load tab data
      if (tab === 'overview') loadOverview();
      if (tab === 'inbox') loadConversations();
      if (tab === 'leads') loadLeads();
      if (tab === 'kb') loadKbFiles();
      if (tab === 'settings') loadConfig();
    });
  });
}

// ================= 1. OVERVIEW =================
async function loadOverview() {
  try {
    const res = await fetch(`/api/overview?bot_id=${encodeURIComponent(currentBotId)}`);
    const data = await res.json();

    document.getElementById('sidebarBotName').textContent = data.bot?.name || 'FacilisBot';
    document.getElementById('sidebarNiche').textContent = data.bot?.niche || 'starter';

    const m = data.metrics || {};
    document.getElementById('kpiTotalConvs').textContent = m.totalConversations ?? 0;
    document.getElementById('kpiConvs24h').textContent = `+${m.conversations24h ?? 0} en las últimas 24h`;
    document.getElementById('kpiMsgs24h').textContent = m.messages24h ?? 0;
    document.getElementById('kpiTotalLeads').textContent = m.totalLeads ?? 0;
    document.getElementById('kpiResolutionRate').textContent = m.botResolutionRate || '100%';
    document.getElementById('kpiEscalatedCount').textContent = `${m.escalatedCount ?? 0} transferencias humanas (${m.escalationRate || '0%'})`;
    document.getElementById('kpiCostUsd').textContent = `$${m.estimatedCostUsd || '0.0000'}`;
    document.getElementById('kpiTotalTokens').textContent = `${(m.totalTokens || 0).toLocaleString()} tokens procesados`;

    // Channel badges
    const ch = data.channels || {};
    setChannelBadge('badgeStatusWhatsApp', ch.whatsapp);
    setChannelBadge('badgeStatusTelegram', ch.telegram);
    setChannelBadge('badgeStatusInstagram', ch.instagram);
    setChannelBadge('badgeStatusWeb', ch.web);
  } catch (err) {
    console.error('Error cargando métricas:', err);
  }
}

function setChannelBadge(elemId, isActive) {
  const el = document.getElementById(elemId);
  if (!el) return;
  if (isActive) {
    el.textContent = 'ACTIVO';
    el.className = 'badge badge-green';
  } else {
    el.textContent = 'INACTIVO';
    el.className = 'badge badge-gray';
  }
}

// ================= 2. INBOX =================
async function loadConversations() {
  try {
    const channel = document.getElementById('filterChannel')?.value || '';
    const status = document.getElementById('filterStatus')?.value || '';
    const url = `/api/conversations?channel=${encodeURIComponent(channel)}&status=${encodeURIComponent(status)}&bot_id=${encodeURIComponent(currentBotId)}`;

    const res = await fetch(url);
    allConversations = await res.json();

    const listEl = document.getElementById('conversationsList');
    listEl.innerHTML = '';

    if (allConversations.length === 0) {
      listEl.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-muted);">No hay conversaciones registradas</div>`;
      return;
    }

    allConversations.forEach(c => {
      const item = document.createElement('div');
      item.className = `conv-item ${c.id === activeConversationId ? 'active' : ''}`;
      item.onclick = () => selectConversation(c.id);

      const channelEmoji = c.channel === 'whatsapp' ? '💬' : c.channel === 'telegram' ? '✈️' : '🌐';
      const timeStr = new Date(c.updatedAt || c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      item.innerHTML = `
        <div class="conv-item-header">
          <span class="conv-item-user">${channelEmoji} ${escapeHtml(c.userName || c.userId)}</span>
          <span class="conv-item-time">${timeStr}</span>
        </div>
        <div class="conv-item-preview">${escapeHtml(c.lastMessage?.content || 'Sin mensajes')}</div>
      `;
      listEl.appendChild(item);
    });

    if (activeConversationId) {
      selectConversation(activeConversationId);
    } else if (allConversations[0]) {
      selectConversation(allConversations[0].id);
    }
  } catch (err) {
    console.error('Error cargando conversaciones:', err);
  }
}

async function selectConversation(convId) {
  activeConversationId = convId;
  document.querySelectorAll('.conv-item').forEach(i => i.classList.remove('active'));

  try {
    const res = await fetch(`/api/conversations/${convId}/messages`);
    const data = await res.json();
    const { conversation, messages } = data;

    document.getElementById('activeChatUser').textContent = conversation.userName || conversation.userId;
    document.getElementById('activeChatMeta').textContent = `Canal: ${conversation.channel.toUpperCase()} · ID: ${conversation.id}`;

    const msgContainer = document.getElementById('chatMessagesBody');
    msgContainer.innerHTML = '';

    messages.forEach(m => {
      const bubble = document.createElement('div');
      bubble.className = `msg-bubble ${m.role === 'user' ? 'msg-user' : 'msg-bot'}`;
      bubble.innerHTML = `
        <div>${escapeHtml(m.content)}</div>
        <div class="msg-time">${new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      `;
      msgContainer.appendChild(bubble);
    });

    msgContainer.scrollTop = msgContainer.scrollHeight;
  } catch (err) {
    console.error('Error seleccionando conversación:', err);
  }
}

async function sendHumanReply() {
  const input = document.getElementById('humanReplyInput');
  const text = input.value.trim();
  if (!text || !activeConversationId) return;

  try {
    await fetch(`/api/conversations/${activeConversationId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    input.value = '';
    selectConversation(activeConversationId);
    showToast('Mensaje enviado como asesor humano');
  } catch (err) {
    console.error('Error enviando mensaje humano:', err);
  }
}

// ================= 3. LEADS CRM =================
async function loadLeads() {
  try {
    const status = document.getElementById('filterLeadStatus')?.value || '';
    const search = document.getElementById('searchLeadsInput')?.value || '';
    const url = `/api/leads?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}&bot_id=${encodeURIComponent(currentBotId)}`;

    const res = await fetch(url);
    allLeads = await res.json();

    const tbody = document.getElementById('leadsTableBody');
    tbody.innerHTML = '';

    if (allLeads.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No se encontraron prospectos</td></tr>`;
      return;
    }

    allLeads.forEach(l => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(l.name || 'Sin nombre')}</strong></td>
        <td>${escapeHtml(l.phone || '-')}</td>
        <td>${escapeHtml(l.email || '-')}</td>
        <td>${escapeHtml(l.interest || 'Interés general')}</td>
        <td>
          <span class="badge ${l.status === 'calificado' ? 'badge-green' : l.status === 'cerrado' ? 'badge-gold' : 'badge-gray'}">
            ${escapeHtml(l.status)}
          </span>
        </td>
        <td>${new Date(l.createdAt).toLocaleDateString()}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="exportLeadContact('${l.id}')">Exportar</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando leads:', err);
  }
}

function exportLeads(format) {
  if (format === 'csv') {
    window.open('/api/leads/export/csv', '_blank');
  } else {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(allLeads, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute('href', dataStr);
    dl.setAttribute('download', `leads_${new Date().toISOString().slice(0, 10)}.json`);
    dl.click();
  }
}

// ================= 4. KNOWLEDGE BASE =================
async function loadKbFiles() {
  try {
    const res = await fetch(`/api/kb?bot_id=${encodeURIComponent(currentBotId)}`);
    const data = await res.json();
    const listEl = document.getElementById('kbFilesList');
    listEl.innerHTML = '';

    if (!data.documents || data.documents.length === 0) {
      listEl.innerHTML = `<div style="padding: 16px; color: var(--text-muted); font-size: 13px;">No hay archivos en la Base de Conocimiento</div>`;
      return;
    }

    data.documents.forEach((d, idx) => {
      const item = document.createElement('div');
      item.className = 'kb-file-item';
      item.onclick = () => openKbDocument(d.filename);
      item.innerHTML = `
        <span>📄 <strong>${escapeHtml(d.filename)}</strong></span>
        <span style="color: var(--text-muted); font-size: 12px;">${(d.size / 1024).toFixed(1)} KB · ${d.chunksCount} fragmentos</span>
      `;
      listEl.appendChild(item);
      if (idx === 0) openKbDocument(d.filename);
    });
  } catch (err) {
    console.error('Error cargando archivos KB:', err);
  }
}

async function openKbDocument(filename) {
  try {
    const res = await fetch(`/api/kb/${encodeURIComponent(filename)}?bot_id=${encodeURIComponent(currentBotId)}`);
    const data = await res.json();
    document.getElementById('kbCurrentFileName').textContent = data.filename;
    document.getElementById('kbEditor').value = data.content;
  } catch (err) {
    console.error('Error abriendo documento KB:', err);
  }
}

async function saveKbDocument() {
  const filename = document.getElementById('kbCurrentFileName').textContent;
  const content = document.getElementById('kbEditor').value;
  if (!filename || filename === 'Selecciona un archivo...') return;

  try {
    await fetch(`/api/kb?bot_id=${encodeURIComponent(currentBotId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content })
    });
    showToast(`Archivo ${filename} guardado e indexado`);
    loadKbFiles();
  } catch (err) {
    console.error('Error guardando documento KB:', err);
  }
}

// ================= 5. CONNECTIONS =================
function setupWidgetSnippet() {
  const origin = window.location.origin;
  document.getElementById('waWebhookUrl').value = `${origin}/webhook/whatsapp/${currentBotId}`;

  const snippet = `<!-- FacilisBot Web Chat Widget -->\n<script src="${origin}/widget/widget.js" data-bot-id="${currentBotId}" async></script>`;
  document.getElementById('widgetSnippet').value = snippet;
}

function copyWidgetSnippet() {
  const snippet = document.getElementById('widgetSnippet').value;
  navigator.clipboard.writeText(snippet);
  showToast('Código del widget copiado al portapapeles');
}

async function saveWhatsAppChannel() {
  const verifyToken = document.getElementById('waVerifyToken').value;
  const phoneNumberId = document.getElementById('waPhoneId').value;
  const accessToken = document.getElementById('waAccessToken').value;

  await updateConfigSection('channels', {
    whatsapp: {
      enabled: !!(phoneNumberId && accessToken),
      verifyToken,
      phoneNumberId,
      accessToken
    }
  });
  showToast('Conexión de WhatsApp guardada');
}

async function saveTelegramChannel() {
  const botToken = document.getElementById('tgBotToken').value;
  const mode = document.getElementById('tgMode').value;

  await updateConfigSection('channels', {
    telegram: {
      enabled: !!botToken,
      botToken,
      polling: mode === 'polling'
    }
  });
  showToast('Conexión de Telegram guardada');
}

// ================= 6. SIMULATOR =================
async function sendSimMessage() {
  const input = document.getElementById('simInput');
  const text = input.value.trim();
  if (!text) return;

  const msgContainer = document.getElementById('simMessages');

  // Append user message
  const userBubble = document.createElement('div');
  userBubble.className = 'msg-bubble msg-user';
  userBubble.textContent = text;
  msgContainer.appendChild(userBubble);
  input.value = '';
  msgContainer.scrollTop = msgContainer.scrollHeight;

  try {
    const res = await fetch('/api/test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, botId: currentBotId })
    });
    const data = await res.json();

    // Append bot response
    const botBubble = document.createElement('div');
    botBubble.className = 'msg-bubble msg-bot';
    botBubble.innerHTML = `
      <div>${escapeHtml(data.reply)}</div>
      ${data.tools ? `<div class="msg-tool-pill">⚡ Herramientas: ${data.tools.map(t => t.name).join(', ')}</div>` : ''}
    `;
    msgContainer.appendChild(botBubble);
    msgContainer.scrollTop = msgContainer.scrollHeight;

    // Update inspector
    document.getElementById('simProviderTag').textContent = data.provider || 'gemini';
    document.getElementById('simModelTag').textContent = data.model || 'gemini-3.5-flash-lite';
    document.getElementById('simTokensTag').textContent = `${data.tokensUsed || 0} tokens`;
    document.getElementById('simToolInspector').textContent = data.tools
      ? JSON.stringify(data.tools, null, 2)
      : '[Ninguna herramienta disparada en este turno]';
  } catch (err) {
    console.error('Error en simulador:', err);
  }
}

function clearSimulatorChat() {
  document.getElementById('simMessages').innerHTML = `
    <div class="msg-bubble msg-bot">
      ¡Hola! Soy tu asistente en modo simulador para el bot: <strong>${escapeHtml(currentBotId)}</strong>. Escríbeme cualquier pregunta como si fueras un cliente para probar cómo respondo y cómo capturo prospectos.
    </div>
  `;
}

// ================= 7. SETTINGS =================
async function loadConfig() {
  try {
    const res = await fetch(`/api/config?bot_id=${encodeURIComponent(currentBotId)}`);
    currentConfig = await res.json();

    // Bot settings
    document.getElementById('cfgBotName').value = currentConfig.bot?.name || '';
    document.getElementById('cfgBotNiche').value = currentConfig.bot?.niche || 'starter';
    document.getElementById('cfgLlmProvider').value = currentConfig.llm?.provider || 'gemini';
    document.getElementById('cfgLlmModel').value = currentConfig.llm?.model || '';
    document.getElementById('cfgBotPersonality').value = currentConfig.bot?.personality || '';
    document.getElementById('cfgSystemPromptBonus').value = currentConfig.llm?.systemPromptBonus || '';

    // Business settings
    document.getElementById('cfgBizName').value = currentConfig.business?.name || '';
    document.getElementById('cfgBizServices').value = currentConfig.business?.services || '';
    document.getElementById('cfgBizHours').value = currentConfig.business?.hours || '';
    document.getElementById('cfgBizLocation').value = currentConfig.business?.location || '';
    document.getElementById('cfgBizPhone').value = currentConfig.business?.phone || '';
    document.getElementById('cfgBizEmail').value = currentConfig.business?.email || '';

    // Channel values
    document.getElementById('waPhoneId').value = currentConfig.channels?.whatsapp?.phoneNumberId || '';
    document.getElementById('waAccessToken').value = currentConfig.channels?.whatsapp?.accessToken || '';
    document.getElementById('waVerifyToken').value = currentConfig.channels?.whatsapp?.verifyToken || 'yunque_verify_token_123';
    document.getElementById('tgBotToken').value = currentConfig.channels?.telegram?.botToken || '';
  } catch (err) {
    console.error('Error cargando configuración:', err);
  }
}

async function saveAllConfig() {
  const newConfig = {
    bot: {
      ...currentConfig.bot,
      name: document.getElementById('cfgBotName').value,
      niche: document.getElementById('cfgBotNiche').value,
      personality: document.getElementById('cfgBotPersonality').value
    },
    business: {
      ...currentConfig.business,
      name: document.getElementById('cfgBizName').value,
      services: document.getElementById('cfgBizServices').value,
      hours: document.getElementById('cfgBizHours').value,
      location: document.getElementById('cfgBizLocation').value,
      phone: document.getElementById('cfgBizPhone').value,
      email: document.getElementById('cfgBizEmail').value
    },
    llm: {
      ...currentConfig.llm,
      provider: document.getElementById('cfgLlmProvider').value,
      model: document.getElementById('cfgLlmModel').value,
      systemPromptBonus: document.getElementById('cfgSystemPromptBonus').value
    }
  };

  const apiKeyInput = document.getElementById('cfgLlmApiKey').value.trim();
  if (apiKeyInput) {
    const prov = newConfig.llm.provider;
    if (prov === 'gemini') newConfig.llm.geminiApiKey = apiKeyInput;
    if (prov === 'anthropic') newConfig.llm.anthropicApiKey = apiKeyInput;
    if (prov === 'openai') newConfig.llm.openaiApiKey = apiKeyInput;
    if (prov === 'grok') newConfig.llm.grokApiKey = apiKeyInput;
  }

  try {
    await fetch(`/api/config?bot_id=${encodeURIComponent(currentBotId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    });
    showToast('Configuración guardada exitosamente');
    loadOverview();
    loadBotsList();
  } catch (err) {
    console.error('Error guardando configuración:', err);
  }
}

async function updateConfigSection(section, data) {
  try {
    await fetch(`/api/config?bot_id=${encodeURIComponent(currentBotId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [section]: { ...currentConfig[section], ...data } })
    });
    loadOverview();
  } catch (err) {
    console.error('Error actualizando sección:', err);
  }
}

// ================= HELPERS =================
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function testApiConnection() {
  const provider = document.getElementById('cfgLlmProvider').value;
  const apiKey = document.getElementById('cfgLlmApiKey').value.trim();
  const resultEl = document.getElementById('apiKeyTestResult');
  const btn = document.getElementById('btnTestConnection');
  
  if (!apiKey) {
    resultEl.textContent = '⚠️ Ingresa una API key primero';
    resultEl.style.color = '#ffaa00';
    return;
  }
  
  btn.disabled = true;
  btn.textContent = '⏳ Probando...';
  resultEl.textContent = '';
  
  try {
    const res = await fetch('/api/test/connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey })
    });
    const data = await res.json();
    
    if (data.success) {
      resultEl.textContent = '✅ ' + data.message;
      resultEl.style.color = '#00cc66';
    } else {
      resultEl.textContent = '❌ ' + (data.error || 'Error de conexión');
      resultEl.style.color = '#ff4444';
    }
  } catch (err) {
    resultEl.textContent = '❌ Error de red';
    resultEl.style.color = '#ff4444';
  } finally {
    btn.disabled = false;
    btn.textContent = '🔌 Probar Conexión';
  }
}
