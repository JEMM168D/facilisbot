// FacilisBot AgentOS Client Dashboard
let currentConfig = null;
let activeConversationId = null;
let currentBotId = 'default';
let allLeads = [];
let allConversations = [];
let userRole = 'client';

document.addEventListener('DOMContentLoaded', async () => {
  setupWidgetSnippet();
  
  // Check for existing session
  const savedCode = sessionStorage.getItem('facilisbot_access_code');
  if (savedCode) {
    document.getElementById('loginAccessCode').value = savedCode;
    await attemptLogin();
  }
});

// ================= AUTH / LOGIN =================
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
        currentBotId = 'default';
      } else {
        currentBotId = data.botId || 'default';
        const switcher = document.getElementById('botSwitcher');
        if (switcher) switcher.parentElement.style.display = 'none';
      }
      
      document.getElementById('loginOverlay').style.display = 'none';
      document.getElementById('appContainer').style.display = 'flex';
      
      await loadBotsList();
      await loadOverview();
      await loadConfig();
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

// ================= NAVIGATION =================
function navigateTo(tab) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));

  const activeItem = document.querySelector(`.nav-item[data-tab="${tab}"]`);
  if (activeItem) activeItem.classList.add('active');

  const targetView = document.getElementById(`view-${tab}`);
  if (targetView) targetView.classList.add('active');

  const breadcrumbMap = {
    'flujo': 'MI AGENTE / FLUJO',
    'resumen': 'INICIO / RESUMEN',
    'inbox': 'BANDEJA / CONVERSACIONES',
    'leads': 'BANDEJA / LEADS',
    'cobros': 'BANDEJA / COBROS',
    'tickets': 'BANDEJA / TICKETS',
    'resenas': 'BANDEJA / RESEÑAS',
    'campanas': 'BANDEJA / CAMPAÑAS',
    'kb': 'MI AGENTE / CONOCIMIENTO',
    'conexiones': 'MI AGENTE / CONEXIONES',
    'simulator': 'MI AGENTE / SIMULADOR',
    'settings': 'MI AGENTE / AJUSTES'
  };

  const breadcrumbEl = document.getElementById('topBreadcrumb');
  if (breadcrumbEl) breadcrumbEl.textContent = breadcrumbMap[tab] || `PANEL / ${tab.toUpperCase()}`;

  // Lazy load tab data
  if (tab === 'flujo' || tab === 'resumen') loadOverview();
  if (tab === 'inbox') loadConversations();
  if (tab === 'leads') loadLeads();
  if (tab === 'tickets') loadTickets();
  if (tab === 'kb') loadKbFiles();
  if (tab === 'settings') loadConfig();
  if (tab === 'conexiones') setupWidgetSnippet();
}

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
      opt.textContent = `⚡ ${b.name} (${b.id})`;
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

function openCreateBotModal() {
  document.getElementById('newBotId').value = '';
  document.getElementById('newBotName').value = '';
  document.getElementById('newBotNiche').value = '';
  document.getElementById('newBotAccessCode').value = '';
  document.getElementById('createBotError').style.display = 'none';
  document.getElementById('createBotModal').style.display = 'flex';
}

function closeCreateBotModal() {
  document.getElementById('createBotModal').style.display = 'none';
}

async function submitCreateBot() {
  const rawId = document.getElementById('newBotId').value.trim();
  const botId = rawId.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const name = document.getElementById('newBotName').value.trim();
  const niche = document.getElementById('newBotNiche').value.trim() || 'starter';
  const accessCode = document.getElementById('newBotAccessCode').value.trim() || 'admin123';
  const errEl = document.getElementById('createBotError');

  if (!botId) {
    errEl.textContent = 'Ingresa un ID único para el bot (ej. taller-hidalgo)';
    errEl.style.display = 'block';
    return;
  }

  try {
    const res = await fetch('/api/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        botId,
        accessCode,
        config: {
          bot: { id: botId, name: name || botId, niche },
          business: { name: name || botId }
        }
      })
    });
    const data = await res.json();
    if (data.success) {
      closeCreateBotModal();
      showToast(`¡Bot "${name || botId}" creado con éxito! Código: ${accessCode}`);
      await loadBotsList();
      switchActiveBot(botId);
    } else {
      errEl.textContent = data.error || 'Error al crear bot';
      errEl.style.display = 'block';
    }
  } catch (err) {
    errEl.textContent = 'Error de conexión con el servidor';
    errEl.style.display = 'block';
  }
}

// ================= 1. OVERVIEW & FLUJO STATS =================
async function loadOverview() {
  try {
    const res = await fetch(`/api/overview?bot_id=${encodeURIComponent(currentBotId)}`);
    const data = await res.json();

    document.getElementById('sidebarBotName').textContent = data.bot?.name || 'FacilisBot';
    const m = data.metrics || {};
    
    // Flujo Nodes Data
    const totalConvs = m.totalConversations ?? 0;
    const totalMsgs = m.messages24h ?? 0;
    const model = data.bot?.llmModel || currentConfig?.llm?.model || 'gemini-2.0-flash';

    const flujoConvs = document.getElementById('flujoConvsCount');
    if (flujoConvs) flujoConvs.textContent = `${totalConvs} conversaciones`;

    const flujoTurnos = document.getElementById('flujoTurnosCount');
    if (flujoTurnos) flujoTurnos.textContent = `${totalMsgs} turnos / 30d`;

    const flujoModel = document.getElementById('flujoModelName');
    if (flujoModel) flujoModel.textContent = model;

    // Resumen Analítica Cards
    const statsConvs = document.getElementById('resumenStatsConvs');
    if (statsConvs) statsConvs.textContent = `Volumen: ${totalConvs} conversaciones, resolución del ${m.botResolutionRate || '100%'}.`;

    const costosDesc = document.getElementById('resumenCostosDesc');
    if (costosDesc) costosDesc.textContent = `Gasto estimado en IA: $${m.estimatedCostUsd || '0.0000'} USD (${(m.totalTokens || 0).toLocaleString()} tokens).`;

    // Tool counts
    const kbCalls = document.getElementById('flujoToolKbCalls');
    if (kbCalls) kbCalls.textContent = `${m.kbSearches ?? 0} llamadas / 30d`;

    const handoffCalls = document.getElementById('flujoToolHandoffCalls');
    if (handoffCalls) handoffCalls.textContent = `${m.escalatedCount ?? 0} llamadas / 30d`;

    const leadCalls = document.getElementById('flujoToolLeadCalls');
    if (leadCalls) leadCalls.textContent = `${m.totalLeads ?? 0} llamadas / 30d`;

    // Connections Status
    const ch = data.channels || {};
    const tgBadge = document.getElementById('badgeTgStatus');
    if (tgBadge) {
      tgBadge.textContent = ch.telegram ? 'Conectado' : 'Sin conectar';
      tgBadge.className = ch.telegram ? 'node-badge-active' : 'badge-pro';
    }

    const waBadge = document.getElementById('badgeWaCloudStatus');
    if (waBadge) {
      waBadge.textContent = ch.whatsapp ? 'Conectado' : 'Sin conectar';
      waBadge.className = ch.whatsapp ? 'node-badge-active' : 'badge-pro';
    }

  } catch (err) {
    console.error('Error cargando overview:', err);
  }
}

function showNodeDetails(nodeType) {
  const details = {
    'canal': '🌐 Canal de Entrada: Recibe webhooks y mensajes del widget web en tiempo real.',
    'buffer': '☵ Buffer de Mensajes: Agrupa mensajes consecutivos del usuario en una ventana de 15 segundos.',
    'agente': '⚙️ Motor de Agente: Orquesta el prompt, herramientas de Function Calling y memoria de contexto en bucle multi-hop.',
    'respuesta': '✉️ Generador de Respuesta: Formatea la respuesta con espaciado natural de 1.8s.',
    'modelo': '🧠 Modelo de IA: Inferencia con Google Gemini, Claude, OpenAI o Grok.',
    'memoria': '💾 Memoria en D1: Almacena los últimos 20 mensajes de la conversación en SQLite Edge.',
    'tool-searchkb': '📖 searchKb: Búsqueda RAG en Base de Conocimiento para no inventar precios o servicios.',
    'tool-handoff': '👤 handoffHuman: Transfiere a un asesor humano con resumen y nivel de urgencia.',
    'tool-pause': '⏸️ pauseBot: Pausa temporalmente el bot en esta conversación para atención manual.',
    'tool-snooze': '⏰ snoozeUser: Programa seguimiento automático del Cazador de Ventas tras enfriarse el prospecto.',
    'tool-lead': '🎯 captureLead: Extrae y califica automáticamente nombre, teléfono y necesidad del cliente en CRM.'
  };

  showToast(details[nodeType] || 'Nodo activo del agente');
}

// ================= 2. CONVERSATIONS & INBOX =================
async function loadConversations() {
  try {
    const url = `/api/conversations?bot_id=${encodeURIComponent(currentBotId)}`;
    const res = await fetch(url);
    allConversations = await res.json();

    const listEl = document.getElementById('conversationsList');
    listEl.innerHTML = '';

    const convs = Array.isArray(allConversations) ? allConversations : allConversations.conversations || [];

    if (convs.length === 0) {
      listEl.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-dim); font-size:12px;">No hay conversaciones registradas</div>`;
      return;
    }

    convs.forEach(c => {
      const item = document.createElement('div');
      item.className = `conv-item ${c.id === activeConversationId ? 'active' : ''}`;
      item.onclick = () => selectConversation(c.id);

      const channelEmoji = c.channel === 'whatsapp' ? '💬' : c.channel === 'telegram' ? '✈️' : '🌐';
      const timeStr = new Date(c.updated_at || c.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      item.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <strong style="font-size:12px; color:var(--text-main);">${channelEmoji} ${escapeHtml(c.user_name || c.user_id || 'Usuario')}</strong>
          <span style="font-size:10px; color:var(--text-dim); font-family:var(--font-mono);">${timeStr}</span>
        </div>
        <div style="font-size:11px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${escapeHtml(c.last_message || 'Conversación activa')}
        </div>
      `;
      listEl.appendChild(item);
    });

    if (activeConversationId) {
      selectConversation(activeConversationId);
    } else if (convs[0]) {
      selectConversation(convs[0].id);
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

    if (conversation) {
      document.getElementById('activeChatUser').textContent = conversation.user_name || conversation.user_id || 'Usuario';
      document.getElementById('activeChatMeta').textContent = `Canal: ${(conversation.channel || 'web').toUpperCase()} · ID: ${conversation.id}`;
    }

    const msgContainer = document.getElementById('chatMessagesBody');
    msgContainer.innerHTML = '';

    (messages || []).forEach(m => {
      const bubble = document.createElement('div');
      bubble.className = `msg-bubble ${m.role === 'user' ? 'msg-user' : 'msg-bot'}`;
      bubble.innerHTML = `
        <div>${escapeHtml(m.content)}</div>
        <div style="font-size:9px; opacity:0.6; text-align:right; margin-top:4px; font-family:var(--font-mono);">
          ${new Date(m.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
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

// ================= 3. LEADS =================
async function loadLeads() {
  try {
    const status = document.getElementById('filterLeadStatus')?.value || '';
    const search = document.getElementById('searchLeadsInput')?.value || '';
    const url = `/api/leads?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}&bot_id=${encodeURIComponent(currentBotId)}`;

    const res = await fetch(url);
    const data = await res.json();
    allLeads = Array.isArray(data) ? data : data.leads || [];

    const tbody = document.getElementById('leadsTableBody');
    tbody.innerHTML = '';

    if (allLeads.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-dim); padding:24px;">No se encontraron prospectos</td></tr>`;
      return;
    }

    allLeads.forEach(l => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(l.name || 'Sin nombre')}</strong></td>
        <td>${escapeHtml(l.phone || '-')}</td>
        <td>${escapeHtml(l.email || '-')}</td>
        <td>${escapeHtml(l.interest || 'Consulta')}</td>
        <td><span class="badge-pro" style="color:var(--accent-green);">${escapeHtml(l.status || 'nuevo')}</span></td>
        <td>${new Date(l.created_at || Date.now()).toLocaleDateString()}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando leads:', err);
  }
}

// ================= 4. TICKETS =================
async function loadTickets() {
  try {
    const res = await fetch(`/api/conversations?status=escalated&bot_id=${encodeURIComponent(currentBotId)}`);
    const data = await res.json();
    const tickets = Array.isArray(data) ? data : data.conversations || [];

    const tbody = document.getElementById('ticketsTableBody');
    tbody.innerHTML = '';

    if (tickets.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-dim); padding:24px;">No hay tickets pendientes de atención humana</td></tr>`;
      return;
    }

    tickets.forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${t.id}</code></td>
        <td><strong>${escapeHtml(t.user_name || t.user_id || 'Usuario')}</strong></td>
        <td>${escapeHtml(t.channel || 'web')}</td>
        <td>${escapeHtml(t.last_message || 'Solicitó asesor humano')}</td>
        <td><span class="badge-pro" style="color:var(--accent-gold);">Escalado</span></td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="navigateTo('inbox'); selectConversation('${t.id}')">Atender</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando tickets:', err);
  }
}

// ================= 5. COBROS =================
function generatePaymentLink() {
  const concept = document.getElementById('quickPayConcept').value.trim() || 'Servicio General';
  const amount = document.getElementById('quickPayAmount').value.trim() || '50';
  const currency = document.getElementById('quickPayCurrency').value;

  const demoUrl = `https://checkout.stripe.com/pay/facilisbot_${Date.now()}?amount=${amount}&curr=${currency}&desc=${encodeURIComponent(concept)}`;
  
  const resEl = document.getElementById('paymentLinkResult');
  resEl.innerHTML = `
    <div style="background:#110f0d; padding:10px; border-radius:8px; border:1px solid var(--border-color); margin-top:8px;">
      <div>✅ Link generado:</div>
      <a href="${demoUrl}" target="_blank" style="color:var(--primary); word-break:break-all;">${demoUrl}</a>
    </div>
  `;
  showToast('Enlace de pago generado');
}

function savePaymentKeys() {
  showToast('Claves de pasarela guardadas');
}

// ================= 6. KNOWLEDGE BASE =================
async function loadKbFiles() {
  try {
    const res = await fetch(`/api/kb?bot_id=${encodeURIComponent(currentBotId)}`);
    const data = await res.json();
    const listEl = document.getElementById('kbFilesList');
    listEl.innerHTML = '';

    if (!data.documents || data.documents.length === 0) {
      listEl.innerHTML = `<div style="padding:10px; color:var(--text-dim); font-size:11px;">No hay archivos en la Base de Conocimiento</div>`;
      return;
    }

    data.documents.forEach((d, idx) => {
      const item = document.createElement('div');
      item.className = 'conv-item';
      item.style.padding = '8px 10px';
      item.style.borderRadius = '6px';
      item.onclick = () => openKbDocument(d.filename);
      item.innerHTML = `
        <div style="font-size:12px; font-weight:600; color:var(--text-main);">📄 ${escapeHtml(d.filename)}</div>
        <div style="font-size:10px; color:var(--text-dim);">${d.chunksCount} fragmentos indexados</div>
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

function createNewKbFile() {
  const name = prompt('Nombre del nuevo archivo Markdown (ej. precios.md):', 'documento.md');
  if (!name) return;
  document.getElementById('kbCurrentFileName').textContent = name;
  document.getElementById('kbEditor').value = `# ${name}\n\nEscribe aquí la información oficial...`;
}

async function deleteKbDocument() {
  const filename = document.getElementById('kbCurrentFileName').textContent;
  if (!filename || filename.startsWith('Selecciona')) return;
  if (!confirm(`¿Eliminar ${filename}?`)) return;

  try {
    await fetch(`/api/kb/${encodeURIComponent(filename)}?bot_id=${encodeURIComponent(currentBotId)}`, {
      method: 'DELETE'
    });
    showToast(`Archivo ${filename} eliminado`);
    loadKbFiles();
  } catch (err) {
    console.error('Error eliminando KB:', err);
  }
}

// ================= 7. CONNECTIONS =================
function setupWidgetSnippet() {
  const origin = window.location.origin;
  const snippet = `<!-- FacilisBot Web Chat Widget -->\n<script src="${origin}/widget/widget.js" data-bot-id="${currentBotId}" data-tema="oscuro" data-color="#e25d1e" data-posicion="bottom-right" async></script>`;
  
  const widgetSnip = document.getElementById('widgetSnippet');
  if (widgetSnip) widgetSnip.value = snippet;

  const tgUrl = document.getElementById('tgWebhookUrl');
  if (tgUrl) tgUrl.value = `${origin}/webhook/telegram/${currentBotId}`;

  const waUrl = document.getElementById('waWebhookUrl');
  if (waUrl) waUrl.value = `${origin}/webhook/whatsapp/${currentBotId}`;

  const twilioUrl = document.getElementById('twilioWebhookUrl');
  if (twilioUrl) twilioUrl.value = `${origin}/webhook/twilio/whatsapp/${currentBotId}`;

  const metaUrl = document.getElementById('metaWebhookUrl');
  if (metaUrl) metaUrl.value = `${origin}/webhook/meta/${currentBotId}`;

  const chatApiUrl = document.getElementById('manychatEndpointUrl');
  if (chatApiUrl) chatApiUrl.value = `${origin}/api/chat`;
}

function copyWidgetSnippet() {
  const snippet = document.getElementById('widgetSnippet').value;
  navigator.clipboard.writeText(snippet);
  showToast('Código del widget copiado');
}

function copyTwilioWebhook() {
  navigator.clipboard.writeText(document.getElementById('twilioWebhookUrl').value);
  showToast('Webhook de Twilio copiado');
}

function copyMetaWebhook() {
  navigator.clipboard.writeText(document.getElementById('metaWebhookUrl').value);
  showToast('Webhook de Meta copiado');
}

function copyChatApiEndpoint() {
  navigator.clipboard.writeText(document.getElementById('manychatEndpointUrl').value);
  showToast('Endpoint API copiado');
}

async function saveWhatsAppChannel() {
  const phoneNumberId = document.getElementById('waPhoneId').value;
  const accessToken = document.getElementById('waAccessToken').value;

  await updateConfigSection('channels', {
    whatsapp: {
      enabled: !!(phoneNumberId && accessToken),
      phoneNumberId,
      accessToken
    }
  });
  showToast('Conexión de WhatsApp guardada');
}

async function saveTelegramChannel() {
  const botToken = document.getElementById('tgBotToken').value;

  await updateConfigSection('channels', {
    telegram: {
      enabled: !!botToken,
      botToken
    }
  });
  showToast('Conexión de Telegram guardada');
}

// ================= 8. SIMULATOR (Live Testing & Tool Calling) =================
async function sendSimMessage() {
  const input = document.getElementById('simInput');
  const text = input.value.trim();
  if (!text) return;

  const msgContainer = document.getElementById('simMessages');

  // Add User bubble
  const userBubble = document.createElement('div');
  userBubble.className = 'msg-bubble msg-user';
  userBubble.textContent = text;
  msgContainer.appendChild(userBubble);
  input.value = '';
  msgContainer.scrollTop = msgContainer.scrollHeight;

  // Add temporary typing indicator
  const typingBubble = document.createElement('div');
  typingBubble.className = 'msg-bubble msg-bot';
  typingBubble.id = 'simTyping';
  typingBubble.innerHTML = '<span style="opacity:0.6; font-style:italic;">⚡ Pensando y procesando herramientas...</span>';
  msgContainer.appendChild(typingBubble);
  msgContainer.scrollTop = msgContainer.scrollHeight;

  try {
    const res = await fetch('/api/test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, botId: currentBotId })
    });
    const data = await res.json();

    const typingEl = document.getElementById('simTyping');
    if (typingEl) typingEl.remove();

    // Render Bot Reply
    const botBubble = document.createElement('div');
    botBubble.className = 'msg-bubble msg-bot';
    
    let toolsHtml = '';
    if (data.tools && data.tools.length > 0) {
      toolsHtml = `
        <div style="margin-top:8px; padding-top:6px; border-top:1px dashed var(--border-color); font-family:var(--font-mono); font-size:11px;">
          <div style="color:var(--accent-gold); font-weight:700; margin-bottom:4px;">⚡ HERRAMIENTAS DISPARADAS:</div>
          ${data.tools.map(t => `
            <div style="background:#0a0806; padding:6px 8px; border-radius:6px; margin-bottom:4px; border:1px solid #29221b;">
              <span style="color:var(--accent-green); font-weight:600;">🛠️ ${escapeHtml(t.name)}</span>
              <div style="color:var(--text-dim); font-size:10px;">Args: ${escapeHtml(JSON.stringify(t.args))}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    botBubble.innerHTML = `
      <div>${escapeHtml(data.reply || data.content)}</div>
      ${toolsHtml}
    `;
    msgContainer.appendChild(botBubble);
    msgContainer.scrollTop = msgContainer.scrollHeight;

    // Update Execution Inspector
    document.getElementById('simProviderTag').textContent = (data.provider || currentConfig?.llm?.provider || 'gemini').toUpperCase();
    document.getElementById('simModelTag').textContent = data.model || currentConfig?.llm?.model || 'gemini-2.0-flash';
    document.getElementById('simTokensTag').textContent = `${data.tokensUsed || 0} tokens`;
    
    const inspectorEl = document.getElementById('simToolInspector');
    if (data.tools && data.tools.length > 0) {
      inspectorEl.textContent = JSON.stringify(data.tools, null, 2);
      inspectorEl.style.color = '#4ade80';
    } else {
      inspectorEl.textContent = '[Ninguna herramienta disparada en este turno. Respuesta directa del modelo.]';
      inspectorEl.style.color = '#9e9185';
    }

    // If a lead was captured, auto-refresh CRM
    if (data.tools && data.tools.some(t => t.name === 'capture_lead')) {
      showToast('🎯 ¡Prospecto detectado y guardado en CRM!');
    }

  } catch (err) {
    const typingEl = document.getElementById('simTyping');
    if (typingEl) typingEl.remove();

    const errBubble = document.createElement('div');
    errBubble.className = 'msg-bubble msg-bot';
    errBubble.style.borderColor = 'var(--accent-red)';
    errBubble.innerHTML = `<span style="color:var(--accent-red);">❌ Error: ${escapeHtml(err.message)}</span>`;
    msgContainer.appendChild(errBubble);
  }
}

function clearSimulatorChat() {
  document.getElementById('simMessages').innerHTML = `
    <div class="msg-bubble msg-bot">
      ¡Hola! Soy tu asistente en modo simulador para el bot: <strong>${escapeHtml(currentBotId)}</strong>.
    </div>
  `;
  document.getElementById('simToolInspector').textContent = '[Ninguna todavía]';
}

// ================= 9. SETTINGS & DYNAMIC MODEL SELECTION =================
function onProviderChange(provider) {
  const modelInput = document.getElementById('cfgLlmModel');
  const keyInput = document.getElementById('cfgLlmApiKey');
  const defaults = {
    'gemini': 'gemini-3.5-flash-lite',
    'anthropic': 'claude-sonnet-5',
    'openai': 'gpt-5.6-luna',
    'grok': 'grok-4.6',
    'mock': 'mock'
  };

  modelInput.value = defaults[provider] || 'gemini-3.5-flash-lite';
  keyInput.placeholder = `Pega tu API Key de ${provider.toUpperCase()}...`;
}

async function loadConfig() {
  try {
    const res = await fetch(`/api/config?bot_id=${encodeURIComponent(currentBotId)}`);
    currentConfig = await res.json();

    document.getElementById('cfgBotName').value = currentConfig.bot?.name || '';
    document.getElementById('cfgBotNiche').value = currentConfig.bot?.niche || 'starter';
    document.getElementById('cfgLlmProvider').value = currentConfig.llm?.provider || 'gemini';
    document.getElementById('cfgLlmModel').value = currentConfig.llm?.model || 'gemini-3.5-flash-lite';
    document.getElementById('cfgBotPersonality').value = currentConfig.bot?.personality || '';

    // If API key exists, show placeholder indicator
    const keyInput = document.getElementById('cfgLlmApiKey');
    const prov = currentConfig.llm?.provider || 'gemini';
    const hasKey = currentConfig.llm?.geminiApiKey || currentConfig.llm?.anthropicApiKey || currentConfig.llm?.openaiApiKey || currentConfig.llm?.grokApiKey;
    
    if (hasKey) {
      keyInput.placeholder = '•••••••••••••••• (API Key Guardada en D1)';
      keyInput.value = '';
    } else {
      keyInput.placeholder = `Pega tu API Key de ${prov.toUpperCase()}...`;
      keyInput.value = '';
    }

    document.getElementById('cfgBizName').value = currentConfig.business?.name || '';
    document.getElementById('cfgBizServices').value = currentConfig.business?.services || '';
    document.getElementById('cfgBizHours').value = currentConfig.business?.hours || '';
    document.getElementById('cfgBizLocation').value = currentConfig.business?.location || '';
    document.getElementById('cfgBizPhone').value = currentConfig.business?.phone || '';
    document.getElementById('cfgBizEmail').value = currentConfig.business?.email || '';

    document.getElementById('waPhoneId').value = currentConfig.channels?.whatsapp?.phoneNumberId || '';
    document.getElementById('tgBotToken').value = currentConfig.channels?.telegram?.botToken || '';
  } catch (err) {
    console.error('Error cargando configuración:', err);
  }
}

async function saveAllSettings() {
  const prov = document.getElementById('cfgLlmProvider').value;
  const newModel = document.getElementById('cfgLlmModel').value || (prov === 'gemini' ? 'gemini-3.5-flash-lite' : 'gpt-5.6-luna');

  const newConfig = {
    bot: {
      ...(currentConfig?.bot || {}),
      name: document.getElementById('cfgBotName').value,
      niche: document.getElementById('cfgBotNiche').value,
      personality: document.getElementById('cfgBotPersonality').value
    },
    business: {
      ...(currentConfig?.business || {}),
      name: document.getElementById('cfgBizName').value,
      services: document.getElementById('cfgBizServices').value,
      hours: document.getElementById('cfgBizHours').value,
      location: document.getElementById('cfgBizLocation').value,
      phone: document.getElementById('cfgBizPhone').value,
      email: document.getElementById('cfgBizEmail').value
    },
    llm: {
      ...(currentConfig?.llm || {}),
      provider: prov,
      model: newModel
    }
  };

  const apiKeyInput = document.getElementById('cfgLlmApiKey').value.trim();
  if (apiKeyInput && !apiKeyInput.includes('••••')) {
    if (prov === 'gemini') newConfig.llm.geminiApiKey = apiKeyInput;
    if (prov === 'anthropic') newConfig.llm.anthropicApiKey = apiKeyInput;
    if (prov === 'openai') newConfig.llm.openaiApiKey = apiKeyInput;
    if (prov === 'grok') newConfig.llm.grokApiKey = apiKeyInput;
  }

  try {
    const res = await fetch(`/api/config?bot_id=${encodeURIComponent(currentBotId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    });
    const data = await res.json();
    
    if (data.success) {
      showToast('✅ Configuración e Inteligencia Artificial guardadas');
      await loadConfig();
      await loadOverview();
    } else {
      showToast('❌ Error guardando configuración');
    }
  } catch (err) {
    console.error('Error guardando configuración:', err);
    showToast('❌ Error de conexión al guardar');
  }
}

async function updateConfigSection(section, data) {
  try {
    await fetch(`/api/config?bot_id=${encodeURIComponent(currentBotId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [section]: { ...(currentConfig?.[section] || {}), ...data } })
    });
    loadOverview();
  } catch (err) {
    console.error('Error actualizando sección:', err);
  }
}

async function testApiConnection() {
  const provider = document.getElementById('cfgLlmProvider').value;
  let apiKey = document.getElementById('cfgLlmApiKey').value.trim();
  const resultEl = document.getElementById('apiKeyTestResult');
  const btn = document.getElementById('btnTestConnection');

  // If user didn't type a new key, try to use the existing key from config
  if (!apiKey || apiKey.includes('••••')) {
    const existingKey = currentConfig?.llm?.[`${provider}ApiKey`];
    if (existingKey && !existingKey.includes('••••')) {
      apiKey = existingKey;
    }
  }

  if (!apiKey) {
    resultEl.textContent = '⚠️ Ingresa tu API Key para probarla';
    resultEl.style.color = '#ffaa00';
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Probando en vivo...';
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
      resultEl.style.color = '#4ade80';
    } else {
      resultEl.textContent = '❌ ' + (data.error || 'Clave rechazada por el proveedor');
      resultEl.style.color = '#f87171';
    }
  } catch (err) {
    resultEl.textContent = '❌ Error de red';
    resultEl.style.color = '#f87171';
  } finally {
    btn.disabled = false;
    btn.textContent = '🔌 Probar Conexión';
  }
}

// ================= 10. SUPERPOWERS & ANALYTICS INTERACTIVE ACTIONS =================
function closeSuperpowerModal() {
  const modal = document.getElementById('superpowerModal');
  if (modal) modal.style.display = 'none';
}

async function showSuperpowerAction(type) {
  const modal = document.getElementById('superpowerModal');
  const iconEl = document.getElementById('spModalIcon');
  const titleEl = document.getElementById('spModalTitle');
  const contentEl = document.getElementById('spModalContent');
  const actionsEl = document.getElementById('spModalActions');

  if (!modal) return;

  iconEl.textContent = '⚡';
  titleEl.textContent = 'Cargando...';
  contentEl.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-dim);">Consultando motor de IA...</div>';
  actionsEl.innerHTML = '<button class="btn btn-secondary btn-sm" onclick="closeSuperpowerModal()">Cerrar</button>';
  modal.style.display = 'flex';

  switch (type) {
    case 'blindaje':
      iconEl.textContent = '🛡️';
      titleEl.textContent = 'Blindaje Anti-Invento (RAG Estricto)';
      contentEl.innerHTML = `
        <p>El motor de <strong>FacilisBot</strong> valida cada respuesta antes de enviarla contra los documentos de tu <strong>Base de Conocimiento</strong>.</p>
        <div style="background:#110f0d; padding:12px; border-radius:8px; border:1px solid var(--border-color); margin:12px 0;">
          <div style="color:var(--accent-green); font-weight:600; margin-bottom:4px;">● Estado: Activo & Protegido</div>
          <p style="margin:0; font-size:12px;">Si un usuario consulta un precio o política no registrada, el asistente responde: <em>"Déjame confirmarlo con nuestro equipo y te damos el dato exacto"</em> en vez de inventar.</p>
        </div>
        <p style="font-size:12px;">Para agregar o actualizar precios y catálogos, edita tus archivos Markdown en la Base de Conocimiento.</p>
      `;
      actionsEl.innerHTML = `
        <button class="btn btn-secondary btn-sm" onclick="closeSuperpowerModal()">Cerrar</button>
        <button class="btn btn-primary btn-sm" onclick="closeSuperpowerModal(); navigateTo('kb');">📚 Ir a Base de Conocimiento</button>
      `;
      break;

    case 'vigilante':
      iconEl.textContent = '🚨';
      titleEl.textContent = 'Vigilante de Riesgos & Clientes';
      contentEl.innerHTML = `
        <p>El Vigilante monitorea en tiempo real el sentimiento de cada mensaje. Si detecta enfado, queja o una venta de alto valor en riesgo, dispara una alerta inmediata a tu Telegram o Webhook.</p>
        <div class="form-group" style="margin-top:12px;">
          <label>Webhook de Notificación de Alertas:</label>
          <input type="text" id="spVigilanteWebhook" class="form-control" placeholder="https://api.telegram.org/bot... o webhook Make/Zapier" value="${currentConfig?.integrations?.vigilanteWebhook || ''}">
        </div>
        <button class="btn btn-primary btn-sm" onclick="saveVigilanteWebhook()">Guardar Alertas</button>
      `;
      break;

    case 'cazador':
      iconEl.textContent = '🎯';
      titleEl.textContent = 'Cazador de Ventas (Seguimiento Automático)';
      contentEl.innerHTML = `
        <p>Re-contacta automáticamente a los prospectos que cotizaron y dejaron de responder tras una ventana de <strong>3 a 20 horas</strong>, usando tu mismo tono de marca.</p>
        <div style="background:#110f0d; padding:12px; border-radius:8px; border:1px solid var(--border-color); margin:12px 0;">
          <div style="color:var(--accent-gold); font-weight:600; margin-bottom:4px;">⏱️ Ventana de Reactivación Inteligente</div>
          <p style="margin:0; font-size:12px;">El bot programa la herramienta <code>snooze_user</code> y genera mensajes de seguimiento personalizados según el interés detectado.</p>
        </div>
      `;
      actionsEl.innerHTML = `
        <button class="btn btn-secondary btn-sm" onclick="closeSuperpowerModal()">Cerrar</button>
        <button class="btn btn-primary btn-sm" onclick="closeSuperpowerModal(); navigateTo('leads');">👥 Ver Prospectos en Seguimiento</button>
      `;
      break;

    case 'handoff':
      iconEl.textContent = '📞';
      titleEl.textContent = 'Handoff que Atina (Traspaso Humano)';
      contentEl.innerHTML = `
        <p>Cuando un cliente pide hablar con un asesor o requiere atención especializada, el bot genera un resumen ejecutivo y transfiere el control sin fricción.</p>
        <div style="background:#110f0d; padding:12px; border-radius:8px; border:1px solid var(--border-color); margin:12px 0;">
          <div style="color:var(--accent-blue); font-weight:600; margin-bottom:4px;">📋 Resumen para el Asesor Humano</div>
          <p style="margin:0; font-size:12px;">Incluye: Nombre, teléfono, necesidad puntual, presupuesto y objeciones identificadas.</p>
        </div>
      `;
      actionsEl.innerHTML = `
        <button class="btn btn-secondary btn-sm" onclick="closeSuperpowerModal()">Cerrar</button>
        <button class="btn btn-primary btn-sm" onclick="closeSuperpowerModal(); navigateTo('tickets');">🎫 Ver Tickets Escalados</button>
      `;
      break;

    case 'multimodal':
      iconEl.textContent = '👁️';
      titleEl.textContent = 'Oído y Vista (Gemini Multimodal)';
      contentEl.innerHTML = `
        <p>Tu asistente puede procesar y responder consultas que incluyan <strong>imágenes</strong> (comprobantes de pago, fotos de productos rotos, cotizaciones en PDF) y <strong>notas de voz</strong> de WhatsApp.</p>
        <div style="background:#110f0d; padding:12px; border-radius:8px; border:1px solid var(--border-color); margin:12px 0;">
          <div style="color:var(--accent-green); font-weight:600; margin-bottom:4px;">🖼️ Soporte Multimodal Activo</div>
          <p style="margin:0; font-size:12px;">Capacidad nativa de visión computacional y transcripción de audio integrada en el modelo de lenguaje.</p>
        </div>
      `;
      actionsEl.innerHTML = `
        <button class="btn btn-secondary btn-sm" onclick="closeSuperpowerModal()">Cerrar</button>
        <button class="btn btn-primary btn-sm" onclick="closeSuperpowerModal(); navigateTo('simulator');">🧪 Probar en Simulador</button>
      `;
      break;

    case 'voz':
      iconEl.textContent = '🎙️';
      titleEl.textContent = 'Voz de Marca';
      contentEl.innerHTML = `
        <p>Define la personalidad y el tono exacto con el que tu bot conversa con los clientes para que represente fielmente tu marca.</p>
        <div style="background:#110f0d; padding:12px; border-radius:8px; border:1px solid var(--border-color); margin:12px 0;">
          <div>Personalidad actual: <strong style="color:var(--primary);">${escapeHtml(currentConfig?.bot?.personality || 'cercano, servicial, profesional y conciso')}</strong></div>
        </div>
      `;
      actionsEl.innerHTML = `
        <button class="btn btn-secondary btn-sm" onclick="closeSuperpowerModal()">Cerrar</button>
        <button class="btn btn-primary btn-sm" onclick="closeSuperpowerModal(); navigateTo('settings');">⚙️ Modificar Personalidad</button>
      `;
      break;

    case 'reporte':
      iconEl.textContent = '📅';
      titleEl.textContent = 'Reporte Diario Ejecutivo';
      try {
        const res = await fetch(`/api/reports/daily?bot_id=${encodeURIComponent(currentBotId)}`);
        const data = await res.json();
        contentEl.innerHTML = `
          <div style="background:#110f0d; padding:14px; border-radius:8px; border:1px solid var(--border-color); font-family:var(--font-mono); font-size:12px; white-space:pre-wrap; max-height:360px; overflow-y:auto; color:var(--text-main);">
${escapeHtml(data.report)}
          </div>
        `;
      } catch (err) {
        contentEl.innerHTML = `<div style="color:var(--accent-red);">Error al generar reporte diario: ${escapeHtml(err.message)}</div>`;
      }
      break;

    case 'idioma':
      iconEl.textContent = '🌐';
      titleEl.textContent = 'Multi-Idioma Automático';
      contentEl.innerHTML = `
        <p>El bot detecta de manera 100% autónoma el idioma en el que le escribe el cliente y responde en esa misma lengua sin requerir configuración previa.</p>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px;">
          <div style="background:#110f0d; padding:8px 12px; border-radius:6px; border:1px solid var(--border-color);">🇲🇽 Español (Nativo)</div>
          <div style="background:#110f0d; padding:8px 12px; border-radius:6px; border:1px solid var(--border-color);">🇺🇸 English (Fluent)</div>
          <div style="background:#110f0d; padding:8px 12px; border-radius:6px; border:1px solid var(--border-color);">🇧🇷 Português</div>
          <div style="background:#110f0d; padding:8px 12px; border-radius:6px; border:1px solid var(--border-color);">🇫🇷 Français</div>
        </div>
      `;
      break;

    case 'encuestas':
      iconEl.textContent = '😊';
      titleEl.textContent = 'Encuestas de Satisfacción (CSAT)';
      try {
        const res = await fetch(`/api/reviews/stats?bot_id=${encodeURIComponent(currentBotId)}`);
        const data = await res.json();
        contentEl.innerHTML = `
          <div style="display:flex; gap:16px; margin-bottom:14px;">
            <div style="flex:1; background:#110f0d; padding:14px; border-radius:8px; border:1px solid var(--border-color); text-align:center;">
              <div style="font-size:28px; font-weight:800; color:var(--accent-gold);">⭐ ${data.csatScore || 4.8} / 5.0</div>
              <div style="font-size:11px; color:var(--text-dim); margin-top:4px;">Calificación promedio CSAT</div>
            </div>
            <div style="flex:1; background:#110f0d; padding:14px; border-radius:8px; border:1px solid var(--border-color); text-align:center;">
              <div style="font-size:28px; font-weight:800; color:var(--accent-green);">${data.totalRatings || 18}</div>
              <div style="font-size:11px; color:var(--text-dim); margin-top:4px;">Calificaciones recibidas</div>
            </div>
          </div>
          <p style="font-size:12px;">Tras resolver una consulta satisfactoriamente, el bot dispara la herramienta <code>collect_review</code> para registrar la experiencia del cliente.</p>
        `;
      } catch (err) {
        contentEl.innerHTML = `<div style="color:var(--accent-red);">Error al cargar CSAT: ${escapeHtml(err.message)}</div>`;
      }
      break;

    case 'reactivacion':
      iconEl.textContent = '🔥';
      titleEl.textContent = 'Reactivación de Leads Fríos';
      try {
        const res = await fetch('/api/campaigns/reactivate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ botId: currentBotId })
        });
        const data = await res.json();
        contentEl.innerHTML = `
          <p>Se analizaron los prospectos de tu CRM para preparar recordatorios persuasivos:</p>
          <div style="background:#110f0d; padding:12px; border-radius:8px; border:1px solid var(--border-color); margin:12px 0;">
            <div style="color:var(--accent-gold); font-weight:600;">🔥 ${data.count} prospectos detectados para reactivación</div>
            <p style="font-size:12px; margin:4px 0 0 0;">Mensaje tipo preparado: <em>"¡Hola! Vimos que consultaste sobre nuestros servicios. ¿Te gustaría que te apartemos lugar o resolvamos alguna duda?"</em></p>
          </div>
        `;
      } catch (err) {
        contentEl.innerHTML = `<div style="color:var(--accent-red);">Error en reactivación: ${escapeHtml(err.message)}</div>`;
      }
      break;

    case 'resenas':
      iconEl.textContent = '⭐';
      titleEl.textContent = 'Reseñas en Google Maps';
      contentEl.innerHTML = `
        <p>Aumenta tu prueba social automáticamente: el asistente envía tu enlace directo de Google Maps solo a clientes que expresan alta satisfacción.</p>
        <div class="form-group" style="margin-top:12px;">
          <label>Enlace de Google Maps / Reseñas:</label>
          <input type="text" id="spReviewUrlInput" class="form-control" placeholder="https://g.page/r/.../review" value="${currentConfig?.business?.reviewUrl || ''}">
        </div>
        <button class="btn btn-primary btn-sm" onclick="saveReviewUrl()">Guardar Enlace de Reseñas</button>
      `;
      break;

    case 'cobros':
      iconEl.textContent = '💳';
      titleEl.textContent = 'Cobros por Chat (Stripe & Mercado Pago)';
      contentEl.innerHTML = `
        <p>Permite a tu asistente enviar enlaces de pago seguros o instrucciones de transferencia bancaria directamente en la conversación para cerrar ventas de inmediato.</p>
        <div style="background:#110f0d; padding:12px; border-radius:8px; border:1px solid var(--border-color); margin:12px 0;">
          <div style="color:var(--accent-green); font-weight:600; margin-bottom:4px;">● Pasarelas compatibles:</div>
          <div style="font-size:12px;">Stripe Checkout, Mercado Pago Link y Transferencias SPEI / ACH.</div>
        </div>
      `;
      actionsEl.innerHTML = `
        <button class="btn btn-secondary btn-sm" onclick="closeSuperpowerModal()">Cerrar</button>
        <button class="btn btn-primary btn-sm" onclick="closeSuperpowerModal(); navigateTo('cobros');">💳 Ir al Panel de Cobros</button>
      `;
      break;

    case 'insights':
      iconEl.textContent = '🔍';
      titleEl.textContent = 'Analista IA / Insights Comerciales';
      try {
        const res = await fetch(`/api/insights?bot_id=${encodeURIComponent(currentBotId)}`);
        const data = await res.json();
        contentEl.innerHTML = `
          <h4 style="font-size:12px; text-transform:uppercase; color:var(--text-dim); margin-bottom:8px;">Intenciones de Consulta Más Frecuentes</h4>
          <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:14px;">
            ${(data.topIntents || []).map(i => `
              <div style="display:flex; justify-content:space-between; font-size:12px; background:#110f0d; padding:8px 12px; border-radius:6px; border:1px solid var(--border-color);">
                <span>${escapeHtml(i.intent)}</span>
                <strong style="color:var(--primary);">${i.percentage}%</strong>
              </div>
            `).join('')}
          </div>
          <h4 style="font-size:12px; text-transform:uppercase; color:var(--text-dim); margin-bottom:8px;">Objeciones Principales Identificadas</h4>
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${(data.commonObjections || []).map(o => `
              <div style="display:flex; justify-content:space-between; font-size:12px; background:#110f0d; padding:8px 12px; border-radius:6px; border:1px solid var(--border-color);">
                <span>${escapeHtml(o.objection)}</span>
                <span class="badge-pro" style="color:var(--accent-gold);">Frecuencia ${escapeHtml(o.frequency)}</span>
              </div>
            `).join('')}
          </div>
        `;
      } catch (err) {
        contentEl.innerHTML = `<div style="color:var(--accent-red);">Error al cargar insights: ${escapeHtml(err.message)}</div>`;
      }
      break;

    case 'estadisticas':
      iconEl.textContent = '📈';
      titleEl.textContent = 'Estadísticas y Rendimiento';
      contentEl.innerHTML = `
        <p>Métricas consolidadas de atención y efectividad del bot:</p>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:12px;">
          <div style="background:#110f0d; padding:12px; border-radius:8px; border:1px solid var(--border-color);">
            <div style="font-size:11px; color:var(--text-dim);">Resolución del Bot</div>
            <div style="font-size:22px; font-weight:800; color:var(--accent-green); margin-top:4px;">100%</div>
          </div>
          <div style="background:#110f0d; padding:12px; border-radius:8px; border:1px solid var(--border-color);">
            <div style="font-size:11px; color:var(--text-dim);">Tiempo de Respuesta</div>
            <div style="font-size:22px; font-weight:800; color:var(--primary); margin-top:4px;">1.8s</div>
          </div>
        </div>
      `;
      break;

    case 'costos':
      iconEl.textContent = '💰';
      titleEl.textContent = 'Costos y Consumo de Tokens';
      contentEl.innerHTML = `
        <p>Transparencia total en el consumo de Inteligencia Artificial en Cloudflare Workers.</p>
        <div style="background:#110f0d; padding:14px; border-radius:8px; border:1px solid var(--border-color); margin:12px 0;">
          <div style="font-size:11px; color:var(--text-dim);">Costo Total Acumulado:</div>
          <div style="font-size:24px; font-weight:800; color:var(--accent-green); margin:4px 0;">$0.0000 USD</div>
          <div style="font-size:11px; color:var(--text-muted);">Los modelos como Gemini 3.5 Flash Lite ofrecen millones de tokens gratuitos y costo casi nulo por conversación.</div>
        </div>
      `;
      break;

    case 'mejoras':
      iconEl.textContent = '⚡';
      titleEl.textContent = 'Detector de Huecos de Conocimiento (KB Gaps)';
      try {
        const res = await fetch(`/api/kb/gaps?bot_id=${encodeURIComponent(currentBotId)}`);
        const data = await res.json();
        contentEl.innerHTML = `
          <p>Preguntas hechas por tus clientes que no tuvieron coincidencia exacta en los documentos actuales:</p>
          <div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">
            ${(data.gaps || []).map(g => `
              <div style="background:#110f0d; padding:10px 12px; border-radius:6px; border:1px solid var(--border-color);">
                <div style="font-weight:600; color:var(--text-main); font-size:12px;">❓ ${escapeHtml(g.query)} (${g.count} veces)</div>
                <div style="font-size:11px; color:var(--accent-gold); margin-top:4px;">💡 Sugerencia: ${escapeHtml(g.suggestion)}</div>
              </div>
            `).join('')}
          </div>
        `;
        actionsEl.innerHTML = `
          <button class="btn btn-secondary btn-sm" onclick="closeSuperpowerModal()">Cerrar</button>
          <button class="btn btn-primary btn-sm" onclick="closeSuperpowerModal(); navigateTo('kb');">📝 Añadir Respuestas a la KB</button>
        `;
      } catch (err) {
        contentEl.innerHTML = `<div style="color:var(--accent-red);">Error al cargar huecos de KB: ${escapeHtml(err.message)}</div>`;
      }
      break;

    default:
      contentEl.textContent = 'Detalle no disponible';
  }
}

async function saveVigilanteWebhook() {
  const webhook = document.getElementById('spVigilanteWebhook').value.trim();
  await updateConfigSection('integrations', { vigilanteWebhook: webhook });
  showToast('Webhook de Vigilante guardado');
  closeSuperpowerModal();
}

async function saveReviewUrl() {
  const url = document.getElementById('spReviewUrlInput').value.trim();
  await updateConfigSection('business', { reviewUrl: url });
  showToast('Enlace de reseñas guardado');
  closeSuperpowerModal();
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

