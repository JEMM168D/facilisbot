/**
 * FacilisBot — Web Chat Widget
 */
(function () {
  const currentScript = document.currentScript || document.querySelector('script[src*="widget.js"]');
  const serverOrigin = currentScript ? new URL(currentScript.src).origin : window.location.origin;

  // Inject CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `${serverOrigin}/widget/widget.css`;
  document.head.appendChild(link);

  // Generate or retrieve persistent Session ID
  let sessionId = localStorage.getItem('yunque_widget_session');
  if (!sessionId) {
    sessionId = 'web_' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem('yunque_widget_session', sessionId);
  }

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
        <div class="yunque-typing" id="yunque-typing">
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

    // Add user bubble
    const userMsg = document.createElement('div');
    userMsg.className = 'yunque-msg yunque-msg-user';
    userMsg.textContent = text;
    body.insertBefore(userMsg, typing);
    body.scrollTop = body.scrollHeight;

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
          userName: 'Visitante Web'
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
})();
