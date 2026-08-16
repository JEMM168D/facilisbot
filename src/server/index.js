import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig, saveConfig, listBots, createBotInstance } from '../core/config.js';
import { db } from '../core/storage/db.js';
import { getKnowledgeBase, kb as defaultKb } from '../core/knowledge/search.js';
import { getBotEngine, botEngine as defaultBotEngine } from '../core/engine.js';
import { WhatsAppHandler } from '../core/channels/whatsapp.js';
import { TelegramHandler } from '../core/channels/telegram.js';
import { MetaDMsHandler } from '../core/channels/meta.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/**
 * Main Web Server & API Router (Multi-Tenant)
 */
export function createServer(customConfig = null) {
  let config = customConfig || loadConfig();

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-bot-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const reqBotId = url.searchParams.get('bot_id') || req.headers['x-bot-id'] || 'default';

    try {
      // ----------------------------------------------------
      // 1. PUBLIC ASSETS & WIDGET (Static files FIRST)
      // ----------------------------------------------------
      if (pathname === '/admin/style.css' || pathname === '/style.css') {
        return serveStaticFile(res, path.join(PUBLIC_DIR, 'admin', 'style.css'), 'text/css');
      }

      if (pathname === '/admin/app.js' || pathname === '/app.js') {
        return serveStaticFile(res, path.join(PUBLIC_DIR, 'admin', 'app.js'), 'application/javascript');
      }

      if (pathname === '/widget/widget.js' || pathname === '/widget.js') {
        return serveStaticFile(res, path.join(PUBLIC_DIR, 'widget', 'widget.js'), 'application/javascript');
      }

      if (pathname === '/widget/widget.css' || pathname === '/widget.css') {
        return serveStaticFile(res, path.join(PUBLIC_DIR, 'widget', 'widget.css'), 'text/css');
      }

      if (pathname === '/' || pathname === '/admin' || pathname === '/admin/' || pathname.startsWith('/admin')) {
        return serveStaticFile(res, path.join(PUBLIC_DIR, 'admin', 'index.html'), 'text/html');
      }

      // ----------------------------------------------------
      // 2. CHANNEL WEBHOOKS (Supports /webhook/whatsapp and /webhook/whatsapp/:bot_id)
      // ----------------------------------------------------
      // WhatsApp Meta Cloud API
      if (pathname === '/webhook/whatsapp' || pathname.startsWith('/webhook/whatsapp/')) {
        const webhookBotId = pathname.startsWith('/webhook/whatsapp/') ? pathname.split('/')[3] : reqBotId;
        const botCfg = loadConfig(webhookBotId);

        if (req.method === 'GET') {
          const verification = WhatsAppHandler.handleVerification(req.url, botCfg);
          res.writeHead(verification.status, { 'Content-Type': 'text/plain' });
          res.end(verification.body);
          return;
        }
        if (req.method === 'POST') {
          const body = await parseJsonBody(req);
          const result = await WhatsAppHandler.handleCloudApiWebhook(body, botCfg);
          return sendJson(res, result.status, result);
        }
      }

      // WhatsApp Twilio
      if ((pathname === '/webhook/twilio/whatsapp' || pathname.startsWith('/webhook/twilio/whatsapp/')) && req.method === 'POST') {
        const webhookBotId = pathname.startsWith('/webhook/twilio/whatsapp/') ? pathname.split('/')[4] : reqBotId;
        const botCfg = loadConfig(webhookBotId);
        const bodyText = await parseTextBody(req);
        const params = new URLSearchParams(bodyText);
        const formData = Object.fromEntries(params.entries());
        const result = await WhatsAppHandler.handleTwilioWebhook(formData, botCfg);
        res.writeHead(result.status, result.headers);
        res.end(result.body);
        return;
      }

      // Telegram Bot API
      if ((pathname === '/webhook/telegram' || pathname.startsWith('/webhook/telegram/')) && req.method === 'POST') {
        const webhookBotId = pathname.startsWith('/webhook/telegram/') ? pathname.split('/')[3] : reqBotId;
        const botCfg = loadConfig(webhookBotId);
        const update = await parseJsonBody(req);
        const result = await TelegramHandler.handleWebhook(update, botCfg);
        return sendJson(res, result.status, result);
      }

      // Meta Instagram / Messenger
      if (pathname === '/webhook/meta' || pathname.startsWith('/webhook/meta/')) {
        const webhookBotId = pathname.startsWith('/webhook/meta/') ? pathname.split('/')[3] : reqBotId;
        const botCfg = loadConfig(webhookBotId);
        if (req.method === 'GET') {
          const verification = MetaDMsHandler.handleVerification(req.url, botCfg);
          res.writeHead(verification.status, { 'Content-Type': 'text/plain' });
          res.end(verification.body);
          return;
        }
        if (req.method === 'POST') {
          const body = await parseJsonBody(req);
          const result = await MetaDMsHandler.handleWebhook(body, botCfg);
          return sendJson(res, result.status, result);
        }
      }

      // ----------------------------------------------------
      // 3. WEB CHAT / WIDGET API (Multi-Tenant)
      // ----------------------------------------------------
      if (pathname === '/api/chat' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const targetBotId = body.botId || reqBotId || 'default';
        const { message, sessionId, userName } = body;

        const engine = getBotEngine(targetBotId);
        const response = await engine.processMessage({
          channel: 'web',
          userId: sessionId || 'web_user_' + Date.now(),
          userName: userName || 'Visitante Web',
          text: message
        });

        return sendJson(res, 200, response);
      }

      // ----------------------------------------------------
      // 4. MULTI-TENANT BOT MANAGEMENT APIs
      // ----------------------------------------------------
      // List all bots
      if (pathname === '/api/bots' && req.method === 'GET') {
        const bots = listBots();
        return sendJson(res, 200, { bots });
      }

      // Create new bot instance
      if (pathname === '/api/bots' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.botId) {
          return sendJson(res, 400, { error: 'Se requiere botId' });
        }
        const created = createBotInstance(body.botId, body.config || {});
        return sendJson(res, 201, { success: true, bot: created });
      }

      // ----------------------------------------------------
      // 5. ADMIN DASHBOARD REST APIs (Bot-Aware)
      // ----------------------------------------------------
      // Overview & KPIs
      if (pathname === '/api/overview' && req.method === 'GET') {
        const botCfg = loadConfig(reqBotId);
        const metrics = db.getOverviewMetrics();
        return sendJson(res, 200, {
          bot: botCfg.bot,
          business: botCfg.business,
          metrics,
          channels: {
            whatsapp: botCfg.channels.whatsapp.enabled,
            telegram: botCfg.channels.telegram.enabled,
            instagram: botCfg.channels.instagram.enabled,
            messenger: botCfg.channels.messenger.enabled,
            web: botCfg.channels.web.enabled
          }
        });
      }

      // Conversations List
      if (pathname === '/api/conversations' && req.method === 'GET') {
        const channel = url.searchParams.get('channel') || null;
        const status = url.searchParams.get('status') || null;
        const result = db.listConversations({ channel, status });
        return sendJson(res, 200, result);
      }

      // Messages in a conversation
      if (pathname.startsWith('/api/conversations/') && pathname.endsWith('/messages') && req.method === 'GET') {
        const convId = pathname.split('/')[3];
        const messages = db.getMessages(convId);
        const conversation = db.getConversation(convId);
        return sendJson(res, 200, { conversation, messages });
      }

      // Update conversation status
      if (pathname.startsWith('/api/conversations/') && pathname.endsWith('/status') && req.method === 'POST') {
        const convId = pathname.split('/')[3];
        const body = await parseJsonBody(req);
        const updated = db.updateConversationStatus(convId, body.status);
        return sendJson(res, 200, { success: true, conversation: updated });
      }

      // Manual human reply from dashboard
      if (pathname.startsWith('/api/conversations/') && pathname.endsWith('/reply') && req.method === 'POST') {
        const convId = pathname.split('/')[3];
        const body = await parseJsonBody(req);
        const msg = db.addMessage({
          conversationId: convId,
          role: 'assistant',
          content: `[Asesor Humano]: ${body.text}`
        });

        // Outbound messaging
        const conv = db.getConversation(convId);
        const botCfg = loadConfig(conv?.botId || reqBotId);
        if (conv?.channel === 'telegram' && botCfg.channels.telegram.botToken) {
          await TelegramHandler.sendMessage({
            botToken: botCfg.channels.telegram.botToken,
            chatId: conv.userId,
            text: body.text
          });
        }

        return sendJson(res, 200, { success: true, message: msg });
      }

      // Leads List
      if (pathname === '/api/leads' && req.method === 'GET') {
        const status = url.searchParams.get('status') || null;
        const search = url.searchParams.get('search') || '';
        const result = db.listLeads({ status, search });
        return sendJson(res, 200, result);
      }

      // Update Lead
      if (pathname.startsWith('/api/leads/') && req.method === 'PUT') {
        const leadId = pathname.split('/')[3];
        const body = await parseJsonBody(req);
        const updated = db.updateLead(leadId, body);
        return sendJson(res, 200, { success: true, lead: updated });
      }

      // Export Leads CSV
      if (pathname === '/api/leads/export/csv' && req.method === 'GET') {
        const csv = db.exportLeadsCsv();
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="leads_${new Date().toISOString().slice(0, 10)}.csv"`
        });
        res.end(csv);
        return;
      }

      // Export Conversations CSV
      if (pathname === '/api/conversations/export/csv' && req.method === 'GET') {
        const csv = db.exportConversationsCsv();
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="conversaciones_${new Date().toISOString().slice(0, 10)}.csv"`
        });
        res.end(csv);
        return;
      }

      // Knowledge Base Documents List
      if (pathname === '/api/kb' && req.method === 'GET') {
        const currentKb = getKnowledgeBase(reqBotId);
        const docs = currentKb.listDocuments();
        return sendJson(res, 200, { documents: docs });
      }

      // Read single KB document
      if (pathname.startsWith('/api/kb/') && req.method === 'GET') {
        const currentKb = getKnowledgeBase(reqBotId);
        const filename = decodeURIComponent(pathname.slice('/api/kb/'.length));
        const doc = currentKb.documents.find(d => d.filename === filename);
        if (!doc) return sendJson(res, 404, { error: 'Documento no encontrado' });
        return sendJson(res, 200, { filename: doc.filename, content: doc.rawContent });
      }

      // Save KB Document
      if (pathname === '/api/kb' && req.method === 'POST') {
        const currentKb = getKnowledgeBase(reqBotId);
        const body = await parseJsonBody(req);
        const result = currentKb.saveDocument(body.filename, body.content);
        return sendJson(res, 200, result);
      }

      // Delete KB Document
      if (pathname.startsWith('/api/kb/') && req.method === 'DELETE') {
        const currentKb = getKnowledgeBase(reqBotId);
        const filename = decodeURIComponent(pathname.slice('/api/kb/'.length));
        const deleted = currentKb.deleteDocument(filename);
        return sendJson(res, 200, { success: deleted });
      }

      // Config read & write
      if (pathname === '/api/config' && req.method === 'GET') {
        const botCfg = loadConfig(reqBotId);
        return sendJson(res, 200, botCfg);
      }

      if (pathname === '/api/config' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        let botCfg = loadConfig(reqBotId);
        botCfg = Object.assign(botCfg, body);
        saveConfig(botCfg, null, reqBotId);
        getBotEngine(reqBotId).updateConfig(botCfg);
        return sendJson(res, 200, { success: true, config: botCfg });
      }

      // Playground / Test Chat Endpoint
      if (pathname === '/api/test/chat' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const targetBotId = body.botId || reqBotId || 'default';
        const engine = getBotEngine(targetBotId);
        const response = await engine.processMessage({
          channel: 'web',
          userId: 'sim_' + (body.sessionId || 'user_1'),
          userName: 'Probador (Simulador)',
          text: body.message
        });
        return sendJson(res, 200, response);
      }

      // 404
      sendJson(res, 404, { error: 'Ruta no encontrada', pathname });

    } catch (err) {
      console.error('[Server Error]:', err);
      sendJson(res, 500, { error: 'Error interno del servidor', message: err.message });
    }
  });

  return {
    server,
    start: (port = 3000) => {
      const listenPort = port || config.server?.port || 3000;

      const tryListen = (p) => {
        server.once('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            console.log(`\x1b[38;5;208m[Aviso]\x1b[0m El puerto ${p} ya está ocupado. Intentando automáticamente en el puerto ${p + 1}...`);
            setTimeout(() => tryListen(p + 1), 200);
          } else {
            console.error('[Server Error]:', err);
          }
        });

        server.listen(p, () => {
          console.log(`\n=================================================`);
          console.log(`🚀 FacilisBot Server corriendo en:`);
          console.log(`👉 Panel de Administración: \x1b[36mhttp://localhost:${p}/admin\x1b[0m`);
          console.log(`👉 Widget de Prueba Web:   \x1b[36mhttp://localhost:${p}/\x1b[0m`);
          console.log(`👉 Webhook WhatsApp:       \x1b[36mhttp://localhost:${p}/webhook/whatsapp\x1b[0m`);
          console.log(`👉 Webhook Telegram:       \x1b[36mhttp://localhost:${p}/webhook/telegram\x1b[0m`);
          console.log(`=================================================\n`);
        });
      };

      tryListen(listenPort);

      // Start Telegram polling if configured
      if (config.channels?.telegram?.enabled && config.channels?.telegram?.botToken) {
        TelegramHandler.startPolling(config);
      }

      return server;
    }
  };
}

function serveStaticFile(res, filePath, contentType) {
  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function parseTextBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
