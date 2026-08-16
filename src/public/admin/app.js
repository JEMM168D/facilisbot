// Yunque Bots Administrative Dashboard Client
let currentConfig = null;
let activeConversationId = null;
let allLeads = [];
let allConversations = [];

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  loadOverview();
  loadConfig();
  setupWidgetSnippet();
});

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
    const res = await fetch('/api/overview');
    const data = await res.json();

    document.getElementById('sidebarBotName').textContent = data.bot?.name || 'Yunque Bot';
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
  } catch (err) {
    console.error('Error cargando overview:', err);
  }
}

function setChannelBadge(elemId, isEnabled) {
  const el = document.getElementById(elemId);
  if (!el) return;
  if (isEnabled) {
    el.className = 'badge badge-active';
    el.textContent = 'Conectado';
  } else {
    el.className = 'badge';
    el.style.background = 'rgba(255,255,255,0.05)';
    el.style.color = 'var(--text-dim)';
    el.textContent = 'Desconectado';
  }
}

// ================= 2. INBOX =================
async function loadConversations() {
  try {
    const res = await fetch('/api/conversations');
    const data = await res.json();
    allConversations = data.conversations || [];
    renderThreadList(allConversations);

    if (allConversations.length > 0 && !activeConversationId) {
      selectConversation(allConversations[0].id);
    }
  } catch (err) {
    console.error('Error cargando conversaciones:', err);
  }
}

function renderThreadList(list) {
  const container = document.getElementById('threadList');
  if (list.length === 0) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-dim);">No hay conversaciones aún.</div>';
    return;
  }

  container.innerHTML = list.map(c => {
    const channelIcon = c.channel === 'whatsapp' ? '💬' : c.channel === 'telegram' ? '✈️' : c.channel === 'instagram' ? '📸' : '🌐';
    const isEscalated = c.status === 'escalated';
    const badgeHtml = isEscalated ? '<span class="badge badge-escalated">Humano</span>' : '';

    return `
      <div class="thread-item ${c.id === activeConversationId ? 'active' : ''}" onclick="selectConversation('${c.id}')">
        <div class="thread-header">
          <span class="thread-user">${channelIcon} ${escapeHtml(c.userName || 'Usuario')}</span>
          <span class="thread-time">${formatTime(c.updatedAt)}</span>
        </div>
        <div class="thread-preview">${escapeHtml(c.lastMessage || 'Conversación iniciada')}</div>
        <div style="margin-top: 4px;">${badgeHtml}</div>
      </div>
    `;
  }).join('');
}

async function selectConversation(id) {
  activeConversationId = id;
  renderThreadList(allConversations);

  try {
    const res = await fetch(`/api/conversations/${id}/messages`);
    const data = await res.json();
    const conv = data.conversation;
    const messages = data.messages || [];

    document.getElementById('activeChatUser').textContent = `${conv.userName || 'Usuario'} (ID: ${conv.userId})`;
    document.getElementById('activeChatChannel').textContent = `Canal: ${conv.channel.toUpperCase()} · Estado: ${conv.status.toUpperCase()}`;
    document.getElementById('activeChatActions').style.display = 'flex';

    const btnEscalate = document.getElementById('btnToggleEscalate');
    btnEscalate.textContent = conv.status === 'escalated' ? 'Marcar como Resuelto' : 'Transferir a Humano';
    btnEscalate.className = conv.status === 'escalated' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';

    const msgContainer = document.getElementById('chatMessages');
    if (messages.length === 0) {
      msgContainer.innerHTML = '<div style="margin: auto; color: var(--text-dim);">Sin mensajes registrados.</div>';
      return;
    }

    msgContainer.innerHTML = messages.map(m => {
      if (m.role === 'tool') {
        return `<div class="msg-tool">⚡ Herramienta: ${escapeHtml(m.content)}</div>`;
      }
      const bubbleClass = m.role === 'user' ? 'msg-user' : 'msg-bot';
      const senderLabel = m.role === 'user' ? '👤 Cliente' : '🤖 Asistente';
      return `
        <div class="msg-bubble ${bubbleClass}">
          <div style="font-size: 11px; opacity: 0.6; margin-bottom: 4px;">${senderLabel} · ${formatTime(m.createdAt)}</div>
          <div>${escapeHtml(m.content)}</div>
        </div>
      `;
    }).join('');

    msgContainer.scrollTop = msgContainer.scrollHeight;
  } catch (err) {
    console.error('Error seleccionando conversacion:', err);
  }
}

async function sendManualReply() {
  if (!activeConversationId) return;
  const input = document.getElementById('manualReplyInput');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  try {
    await fetch(`/api/conversations/${activeConversationId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    selectConversation(activeConversationId);
    showToast('Respuesta enviada');
  } catch (err) {
    console.error('Error enviando respuesta:', err);
  }
}

async function toggleConversationEscalation() {
  if (!activeConversationId) return;
  const conv = allConversations.find(c => c.id === activeConversationId);
  const nextStatus = conv?.status === 'escalated' ? 'active' : 'escalated';

  try {
    await fetch(`/api/conversations/${activeConversationId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus })
    });
    loadConversations();
    selectConversation(activeConversationId);
    showToast(`Conversación marcada como ${nextStatus}`);
  } catch (err) {
    console.error('Error cambiando estado:', err);
  }
}

// ================= 3. LEADS CRM =================
async function loadLeads() {
  try {
    const res = await fetch('/api/leads');
    const data = await res.json();
    allLeads = data.leads || [];
    renderLeadsTable(allLeads);
  } catch (err) {
    console.error('Error cargando leads:', err);
  }
}

function renderLeadsTable(list) {
  const tbody = document.getElementById('leadsTableBody');
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 30px;">No se encontraron prospectos registrados.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(l => {
    const badgeClass = `badge-${l.status || 'nuevo'}`;
    return `
      <tr>
        <td><strong>${escapeHtml(l.name || 'Sin nombre')}</strong></td>
        <td><a href="https://wa.me/${(l.phone || '').replace(/[^0-9]/g, '')}" target="_blank" style="color: var(--accent-green); font-family: var(--font-mono);">${escapeHtml(l.phone || '-')}</a></td>
        <td>${escapeHtml(l.email || '-')}</td>
        <td style="max-width: 220px;">${escapeHtml(l.interest || '-')}</td>
        <td><span class="badge" style="background: rgba(255,255,255,0.06);">${escapeHtml(l.channel || 'web')}</span></td>
        <td>
          <select onchange="updateLeadStatus('${l.id}', this.value)" class="form-control" style="padding: 4px 8px; font-size: 12px; width: auto;">
            <option value="nuevo" ${l.status === 'nuevo' ? 'selected' : ''}>Nuevo</option>
            <option value="calificado" ${l.status === 'calificado' ? 'selected' : ''}>Calificado</option>
            <option value="seguimiento" ${l.status === 'seguimiento' ? 'selected' : ''}>Seguimiento</option>
            <option value="cerrado" ${l.status === 'cerrado' ? 'selected' : ''}>Cerrado</option>
          </select>
        </td>
        <td style="font-size: 12px; color: var(--text-dim);">${formatDate(l.createdAt)}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="promptLeadNotes('${l.id}')">Notas</button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterLeads() {
  const q = (document.getElementById('leadsSearchInput').value || '').toLowerCase();
  const status = document.getElementById('leadsStatusFilter').value;

  let filtered = allLeads;
  if (status) filtered = filtered.filter(l => l.status === status);
  if (q) {
    filtered = filtered.filter(l =>
      (l.name && l.name.toLowerCase().includes(q)) ||
      (l.phone && l.phone.includes(q)) ||
      (l.email && l.email.toLowerCase().includes(q)) ||
      (l.interest && l.interest.toLowerCase().includes(q))
    );
  }
  renderLeadsTable(filtered);
}

async function updateLeadStatus(id, newStatus) {
  try {
    await fetch(`/api/leads/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    showToast('Estado del lead actualizado');
  } catch (err) {
    console.error('Error actualizando lead:', err);
  }
}

async function promptLeadNotes(id) {
  const lead = allLeads.find(l => l.id === id);
  const notes = prompt('Notas del prospecto:', lead?.notes || '');
  if (notes !== null) {
    await fetch(`/api/leads/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes })
    });
    loadLeads();
    showToast('Notas guardadas');
  }
}

// ================= 4. KNOWLEDGE BASE =================
async function loadKbFiles() {
  try {
    const res = await fetch('/api/kb');
    const data = await res.json();
    const list = data.documents || [];

    const container = document.getElementById('kbFilesList');
    if (list.length === 0) {
      container.innerHTML = '<div style="color: var(--text-dim); font-size: 13px;">No hay archivos creados.</div>';
      return;
    }

    container.innerHTML = list.map(d => `
      <div style="padding: 8px 10px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02);" onclick="openKbFile('${d.filename}')">
        <span style="font-size: 13px; color: var(--text-main);">📄 ${d.filename}</span>
        <span style="font-size: 11px; color: var(--text-dim);">${d.size} B</span>
      </div>
    `).join('');

    if (list.length > 0 && !document.getElementById('kbCurrentFilename').value) {
      openKbFile(list[0].filename);
    }
  } catch (err) {
    console.error('Error cargando archivos KB:', err);
  }
}

async function openKbFile(filename) {
  try {
    const res = await fetch(`/api/kb/${encodeURIComponent(filename)}`);
    const data = await res.json();
    document.getElementById('kbCurrentFilename').value = data.filename;
    document.getElementById('kbEditorContent').value = data.content;
  } catch (err) {
    console.error('Error abriendo archivo KB:', err);
  }
}

function createNewKbFile() {
  const filename = prompt('Nombre del nuevo archivo (ej. politicas.md, servicios.md):', 'nuevo-documento.md');
  if (filename) {
    document.getElementById('kbCurrentFilename').value = filename;
    document.getElementById('kbEditorContent').value = `# ${filename.replace(/\.[^/.]+$/, '')}\n\nEscribe aquí la información oficial para el bot...`;
  }
}

async function saveCurrentKbFile() {
  const filename = document.getElementById('kbCurrentFilename').value.trim();
  const content = document.getElementById('kbEditorContent').value;
  if (!filename) return alert('Ingresa un nombre de archivo');

  try {
    await fetch('/api/kb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content })
    });
    loadKbFiles();
    showToast(`Archivo ${filename} guardado exitosamente`);
  } catch (err) {
    console.error('Error guardando KB:', err);
  }
}

async function deleteCurrentKbFile() {
  const filename = document.getElementById('kbCurrentFilename').value.trim();
  if (!filename) return;
  if (!confirm(`¿Estás seguro de eliminar ${filename}?`)) return;

  try {
    await fetch(`/api/kb/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    document.getElementById('kbCurrentFilename').value = '';
    document.getElementById('kbEditorContent').value = '';
    loadKbFiles();
    showToast('Archivo eliminado');
  } catch (err) {
    console.error('Error eliminando KB:', err);
  }
}

async function testKbSearch() {
  const q = document.getElementById('kbSearchTestInput').value.trim();
  if (!q) return;

  try {
    const res = await fetch('/api/test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: q })
    });
    const data = await res.json();
    document.getElementById('kbSearchResults').innerHTML = `
      <strong>Respuesta simulada del Bot:</strong><br>${escapeHtml(data.reply)}
    `;
  } catch (err) {
    console.error('Error probando búsqueda:', err);
  }
}

// ================= 5. CONNECTIONS =================
function setupWidgetSnippet() {
  const origin = window.location.origin;
  document.getElementById('waWebhookUrl').value = `${origin}/webhook/whatsapp`;

  const snippet = `<!-- Yunque Web Chat Widget -->\n<script src="${origin}/widget/widget.js" data-bot-id="default" async></script>`;
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

  input.value = '';
  const msgContainer = document.getElementById('simMessages');

  // Add user bubble
  msgContainer.innerHTML += `
    <div class="msg-bubble msg-user">
      <div style="font-size: 11px; opacity: 0.6; margin-bottom: 4px;">👤 Tú (Prueba)</div>
      <div>${escapeHtml(text)}</div>
    </div>
  `;
  msgContainer.scrollTop = msgContainer.scrollHeight;

  try {
    const res = await fetch('/api/test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    const data = await res.json();

    // Add bot bubble
    msgContainer.innerHTML += `
      <div class="msg-bubble msg-bot">
        <div style="font-size: 11px; opacity: 0.6; margin-bottom: 4px;">🤖 Asistente</div>
        <div>${escapeHtml(data.reply)}</div>
      </div>
    `;
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
      Chat reiniciado. Escribe cualquier mensaje para probar el asistente.
    </div>
  `;
}

// ================= 7. SETTINGS =================
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
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
    document.getElementById('cfgBizPayments').value = currentConfig.business?.paymentMethods || '';

    // Channel values
    document.getElementById('waVerifyToken').value = currentConfig.channels?.whatsapp?.verifyToken || '';
    document.getElementById('waPhoneId').value = currentConfig.channels?.whatsapp?.phoneNumberId || '';
    document.getElementById('tgBotToken').value = currentConfig.channels?.telegram?.botToken || '';
  } catch (err) {
    console.error('Error cargando configuración:', err);
  }
}

async function saveAllSettings() {
  const updated = {
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
      email: document.getElementById('cfgBizEmail').value,
      paymentMethods: document.getElementById('cfgBizPayments').value
    },
    llm: {
      ...currentConfig.llm,
      provider: document.getElementById('cfgLlmProvider').value,
      model: document.getElementById('cfgLlmModel').value,
      systemPromptBonus: document.getElementById('cfgSystemPromptBonus').value
    }
  };

  const apiKey = document.getElementById('cfgLlmApiKey').value.trim();
  if (apiKey) {
    const provider = updated.llm.provider;
    if (provider === 'gemini') updated.llm.geminiApiKey = apiKey;
    if (provider === 'anthropic') updated.llm.anthropicApiKey = apiKey;
    if (provider === 'openai') updated.llm.openaiApiKey = apiKey;
    if (provider === 'grok') updated.llm.grokApiKey = apiKey;
  }

  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });
    currentConfig = updated;
    loadOverview();
    showToast('Toda la configuración ha sido guardada exitosamente');
  } catch (err) {
    console.error('Error guardando configuración:', err);
  }
}

async function updateConfigSection(section, data) {
  const payload = { [section]: { ...currentConfig[section], ...data } };
  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  currentConfig = { ...currentConfig, ...payload };
}

// ================= UTILITIES =================
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
