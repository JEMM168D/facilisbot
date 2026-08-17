/**
 * FacilisBot — Web Chat Widget v2.0 (Real-time & Multi-Tenant)
 */
(function () {
  const currentScript = document.currentScript || document.querySelector('script[src*="widget.js"]');
  const serverOrigin = currentScript ? new URL(currentScript.src).origin : window.location.origin;
  const botId = currentScript ? (currentScript.getAttribute('data-bot-id') || currentScript.dataset.botId || 'default') : 'default';

  // Inject CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `${serverOrigin}/widget/widget.css`;
  document.head.appendChild(link);

  // Generate or retrieve persistent Session ID
  let sessionId = localStorage.getItem('facilisbot_widget_session_' + botId);
  if (!sessionId) {
    sessionId = 'web_' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem('facilisbot_widget_session_' + botId, sessionId);
  }

  let savedUserName = localStorage.getItem('facilisbot_widget_username_' + botId) || 'Visitante Web';

  // Create Container
  const container = document.createElement('div');
  container.id = 'yunque-widget-container';
  container.innerHTML = `
    <button id="yunque-widget-button" aria-label="Abrir chat de atención">💬</button>
    <div id="yunque-widget-window">
      <div class="yunque-chat-header">
        <div>
          <h4 id="yunque-widget-title">Atención en Línea</h4>
          <p id="yunque-widget-status">En línea 24/7</p>
        </div>
        <button class="yunque-close-btn" id="yunque-close-btn" aria-label="Cerrar chat">✕</button>
      </div>
      <div class="yunque-chat-body" id="yunque-chat-body">
        <div class="yunque-msg yunque-msg-bot" id="yunque-welcome-msg">
          ¡Hola! 👋 ¿En qué te podemos ayudar hoy?
        </div>
        <div class="yunque-typing" id="yunque-typing" style="display:none;">
          <span class="yunque-dot"></span>
          <span class="yunque-dot"></span>
          <span class="yunque-dot"></span>
        </div>
      </div>
      <div class="yunque-chat-footer">
        <input type="text" class="yunque-chat-input" id="yunque-input" placeholder="Escribe un mensaje..." autocomplete="off">
        <button class="yunque-send-btn" id="yunque-send-btn" aria-label="Enviar">➤</button>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  const btn = document.getElementById('yunque-widget-button');
  const win = document.getElementById('yunque-widget-window');
  const closeBtn = document.getElementById('yunque-close-btn');
  const input = document.getElementById('yunque-input');
  const sendBtn = document.getElementById('yunque-send-btn');
  const body = document.getElementById('yunque-chat-body');
  const typing = document.getElementById('yunque-typing');

  // Load chat history from localStorage
  const historyKey = 'facilisbot_widget_history_' + botId;
  const savedHistory = JSON.parse(localStorage.getItem(historyKey) || '[]');
  savedHistory.forEach(m => {
    const msgEl = document.createElement('div');
    msgEl.className = `yunque-msg ${m.role === 'user' ? 'yunque-msg-user' : 'yunque-msg-bot'}`;
    msgEl.textContent = m.text;
    body.insertBefore(msgEl, typing);
  });
  if (savedHistory.length > 0) body.scrollTop = body.scrollHeight;

  function appendToHistory(role, text) {
    savedHistory.push({ role, text, time: Date.now() });
    if (savedHistory.length > 30) savedHistory.shift();
    try { localStorage.setItem(historyKey, JSON.stringify(savedHistory)); } catch(e) {}
  }

  // Toggle open
  btn.addEventListener('click', () => {
    win.classList.toggle('open');
    if (win.classList.contains('open')) input.focus();
  });

  closeBtn.addEventListener('click', () => {
    win.classList.remove('open');
  });

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    input.value = '';

    // Check if user mentions name
    const nameMatch = text.match(/(?:me llamo|mi nombre es|soy)\s+([A-Za-zÀ-ÿ\s]{2,30}?)(?:,|\.|\s+mi|\s+y|\s+cel|\s+tel|\s+correo|\s+whats|$)/i);
    if (nameMatch && nameMatch[1].trim().length > 1) {
      savedUserName = nameMatch[1].trim();
      localStorage.setItem('facilisbot_widget_username_' + botId, savedUserName);
    }

    // Add user bubble
    const userMsg = document.createElement('div');
    userMsg.className = 'yunque-msg yunque-msg-user';
    userMsg.textContent = text;
    body.insertBefore(userMsg, typing);
    body.scrollTop = body.scrollHeight;
    appendToHistory('user', text);

    // Show typing
    typing.style.display = 'flex';
    body.scrollTop = body.scrollHeight;

    try {
      const res = await fetch(`${serverOrigin}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId,
          botId,
          userName: savedUserName
        })
      });
      const data = await res.json();

      typing.style.display = 'none';

      // Add bot bubble
      const botMsg = document.createElement('div');
      botMsg.className = 'yunque-msg yunque-msg-bot';
      botMsg.textContent = data.reply || 'Gracias por tu mensaje.';
      body.insertBefore(botMsg, typing);
      body.scrollTop = body.scrollHeight;
      appendToHistory('assistant', data.reply || 'Gracias por tu mensaje.');
    } catch (err) {
      typing.style.display = 'none';
      const errMsg = document.createElement('div');
      errMsg.className = 'yunque-msg yunque-msg-bot';
      errMsg.textContent = 'Hubo un error de conexión. Por favor intenta de nuevo en un momento.';
      body.insertBefore(errMsg, typing);
    }
  }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendMessage();
    });

    // Live background sync for incoming human and bot replies
    let widgetSyncInterval = null;
    async function syncWidgetMessages() {
      try {
        const res = await fetch(`${serverOrigin}/api/chat/messages?sessionId=${encodeURIComponent(sessionId)}&botId=${encodeURIComponent(botId)}`);
        const data = await res.json();
        const serverMessages = data.messages || [];

        if (serverMessages.length > 0 && serverMessages.length > savedHistory.length) {
          // Re-render chat body with fresh messages
          body.querySelectorAll('.yunque-msg:not(#yunque-welcome-msg)').forEach(el => el.remove());
          savedHistory.length = 0;

          serverMessages.forEach(m => {
            const isUser = m.role === 'user';
            const msgEl = document.createElement('div');
            msgEl.className = `yunque-msg ${isUser ? 'yunque-msg-user' : 'yunque-msg-bot'}`;
            msgEl.textContent = m.content;
            body.insertBefore(msgEl, typing);
            savedHistory.push({ role: m.role, text: m.content, time: m.created_at || Date.now() });
          });

          body.scrollTop = body.scrollHeight;
          try { localStorage.setItem(historyKey, JSON.stringify(savedHistory)); } catch(e) {}
        }
      } catch (e) {}
    }

    // Start sync when widget opens
    btn.addEventListener('click', () => {
      if (win.classList.contains('open')) {
        syncWidgetMessages();
        if (!widgetSyncInterval) widgetSyncInterval = setInterval(syncWidgetMessages, 2500);
      } else {
        if (widgetSyncInterval) { clearInterval(widgetSyncInterval); widgetSyncInterval = null; }
      }
    });

    // Initial sync
    syncWidgetMessages();
    widgetSyncInterval = setInterval(syncWidgetMessages, 3000);
  })();
