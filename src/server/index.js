import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createStorageAdapter } from '../core/storage/storage-adapter.js';
import { loadConfig } from '../core/config.js';
import { getBotEngine } from '../core/engine.js';
import { getKnowledgeBase } from '../core/knowledge/search.js';
import { WhatsAppHandler } from '../core/channels/whatsapp.js';
import { TelegramHandler } from '../core/channels/telegram.js';
import { MetaDMsHandler } from '../core/channels/meta.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/**
 * Local Development Server (Node.js only)
 * Uses LocalStorageAdapter (filesystem-based) for development.
 * In production, everything runs via src/worker.js on Cloudflare Workers.
 */
export function createServer(customConfig = null) {
  // Local adapter uses filesystem
  const storage = createStorageAdapter(null);

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-bot-id, x-access-code');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const reqBotId = url.searchParams.get('bot_id') || req.headers['x-bot-id'] || 'default';

    try {
      // ── STATIC FILES ──
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

      // ── HEALTH CHECK ──
      if (pathname === '/health' || pathname === '/api/health') {
        return sendJson(res, 200, { status: 'ok', version: '2.0.0', botId: reqBotId });
      }

      // ── AUTH (bypass in local dev) ──
      if (pathname === '/api/auth' && req.method === 'POST') {
        const bots = await storage.listBots();
        return sendJson(res, 200, { success: true, role: 'admin', bots });
      }

      // ── BOTS MANAGEMENT ──
      if (pathname === '/api/bots' && req.method === 'GET') {
        const bots = await storage.listBots();
        return sendJson(res, 200, { bots });
      }

      if (pathname === '/api/bots' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.botId) return sendJson(res, 400, { error: 'Se requiere botId' });
        await storage.createBot(body.botId, body.config || {});
        return sendJson(res, 201, { success: true, botId: body.botId });
      }

      // ── CHAT API ──
      if (pathname === '/api/chat' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const targetBotId = body.botId || reqBotId || 'default';
        const engine = await getBotEngine(targetBotId, storage);
        const response = await engine.processMessage({
          channel: 'web',
          userId: body.sessionId || 'web_user_' + Date.now(),
          userName: body.userName || 'Visitante Web',
          text: body.message
        });
        return sendJson(res, 200, response);
      }

      // ── TEST CHAT (Simulator) ──
      if (pathname === '/api/test/chat' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const targetBotId = body.botId || reqBotId || 'default';
        const engine = await getBotEngine(targetBotId, storage);
        const response = await engine.processMessage({
          channel: 'web',
          userId: 'sim_' + (body.sessionId || 'user_1'),
          userName: 'Probador (Simulador)',
          text: body.message
        });
        return sendJson(res, 200, response);
      }

      // ── TEST CONNECTION ──
      if (pathname === '/api/test/connection' && req.method === 'POST') {
        return sendJson(res, 200, { success: true, message: 'Conexión exitosa (modo local)' });
      }

      // ── OVERVIEW ──
      if (pathname === '/api/overview' && req.method === 'GET') {
        const botCfg = await loadConfig(reqBotId, storage);
        const metrics = await storage.getOverviewMetrics(reqBotId);
        return sendJson(res, 200, {
          bot: botCfg.bot,
          business: botCfg.business,
          metrics,
          channels: {
            whatsapp: botCfg.channels?.whatsapp?.enabled || false,
            telegram: botCfg.channels?.telegram?.enabled || false,
            instagram: botCfg.channels?.instagram?.enabled || false,
            messenger: botCfg.channels?.messenger?.enabled || false,
            web: botCfg.channels?.web?.enabled ?? true
          }
        });
      }

      // ── CONVERSATIONS ──
      if (pathname === '/api/conversations' && req.method === 'GET') {
        const channel = url.searchParams.get('channel') || null;
        const status = url.searchParams.get('status') || null;
        const result = await storage.listConversations({ channel, status, botId: reqBotId });
        return sendJson(res, 200, result);
      }

      if (pathname.match(/\/api\/conversations\/[^/]+\/messages/) && req.method === 'GET') {
        const convId = pathname.split('/')[3];
        const messages = await storage.getMessages(convId);
        const conversation = await storage.getConversation(convId);
        return sendJson(res, 200, { conversation, messages });
      }

      if (pathname.match(/\/api\/conversations\/[^/]+\/status/) && req.method === 'POST') {
        const convId = pathname.split('/')[3];
        const body = await parseJsonBody(req);
        const updated = await storage.updateConversationStatus(convId, body.status);
        return sendJson(res, 200, { success: true, conversation: updated });
      }

      if (pathname.match(/\/api\/conversations\/[^/]+\/reply/) && req.method === 'POST') {
        const convId = pathname.split('/')[3];
        const body = await parseJsonBody(req);
        const msg = await storage.addMessage({
          conversationId: convId,
          botId: reqBotId,
          role: 'assistant',
          content: `[Asesor Humano]: ${body.text}`
        });
        return sendJson(res, 200, { success: true, message: msg });
      }

      // ── LEADS ──
      if (pathname === '/api/leads' && req.method === 'GET') {
        const status = url.searchParams.get('status') || null;
        const search = url.searchParams.get('search') || '';
        const result = await storage.listLeads({ botId: reqBotId, status, search });
        return sendJson(res, 200, result);
      }

      if (pathname.match(/\/api\/leads\/[^/]+$/) && req.method === 'PUT') {
        const leadId = pathname.split('/')[3];
        const body = await parseJsonBody(req);
        const updated = await storage.updateLead(leadId, body);
        return sendJson(res, 200, { success: true, lead: updated });
      }

      if (pathname === '/api/leads/export/csv' && req.method === 'GET') {
        const csv = await storage.exportLeadsCsv(reqBotId);
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="leads.csv"` });
        res.end(csv);
        return;
      }

      if (pathname === '/api/conversations/export/csv' && req.method === 'GET') {
        const csv = await storage.exportConversationsCsv(reqBotId);
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="conversaciones.csv"` });
        res.end(csv);
        return;
      }

      // ── KNOWLEDGE BASE ──
      if (pathname === '/api/kb' && req.method === 'GET') {
        const currentKb = await getKnowledgeBase(reqBotId, storage);
        const docs = currentKb.listDocuments();
        return sendJson(res, 200, { documents: docs });
      }

      if (pathname.startsWith('/api/kb/') && req.method === 'GET' && pathname !== '/api/kb/gaps') {
        const filename = decodeURIComponent(pathname.slice('/api/kb/'.length));
        const currentKb = await getKnowledgeBase(reqBotId, storage);
        const doc = currentKb.documents.find(d => d.filename === filename);
        if (!doc) return sendJson(res, 404, { error: 'Documento no encontrado' });
        return sendJson(res, 200, { filename: doc.filename, content: doc.rawContent });
      }

      if (pathname === '/api/kb' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const currentKb = await getKnowledgeBase(reqBotId, storage);
        await currentKb.saveDocument(reqBotId, body.filename, body.content, storage);
        return sendJson(res, 200, { success: true, filename: body.filename });
      }

      if (pathname.startsWith('/api/kb/') && req.method === 'DELETE' && pathname !== '/api/kb/gaps') {
        const filename = decodeURIComponent(pathname.slice('/api/kb/'.length));
        const currentKb = await getKnowledgeBase(reqBotId, storage);
        const deleted = await currentKb.deleteDocument(reqBotId, filename, storage);
        return sendJson(res, 200, { success: deleted });
      }

      // ── AUTO-SCRAPER WEB PARA KB ──
      if (pathname === '/api/kb/scrape' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        let targetUrl = (body.url || '').trim();
        if (!targetUrl) return sendJson(res, 400, { error: 'URL requerida' });
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
          targetUrl = 'https://' + targetUrl;
        }

        try {
          const fetchRes = await fetch(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 FacilisBot/2.0' }
          });
          const html = await fetchRes.text();
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          const title = titleMatch ? titleMatch[1].trim() : targetUrl;
          let cleanText = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          
          const maxLen = 8000;
          const trimmed = cleanText.length > maxLen ? cleanText.slice(0, maxLen) + '...' : cleanText;
          const markdown = `# Información Extraída de ${title}\n**Fuente:** ${targetUrl}\n\n---\n\n${trimmed}`;
          const filename = 'web_' + new URL(targetUrl).hostname.replace(/[^a-zA-Z0-9]/g, '_') + '.md';
          const currentKb = await getKnowledgeBase(reqBotId, storage);
          await currentKb.saveDocument(reqBotId, filename, markdown, storage);

          return sendJson(res, 200, { success: true, filename, title, preview: markdown.slice(0, 400) });
        } catch (err) {
          return sendJson(res, 400, { success: false, error: err.message });
        }
      }

      // ── ENTREVISTA ASISTIDA KB ──
      if (pathname === '/api/kb/interview/step' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const step = body.step || 1;
        const answers = body.answers || {};

        const sections = [
          { step: 1, name: 'perfil_ubicacion.md', format: (a) => `# Perfil y Ubicación\n- Nombre: ${a.businessName || ''}\n- Giro: ${a.niche || ''}\n- Ubicación: ${a.location || ''}\n- Cobertura: ${a.coverage || ''}\n- Tel: ${a.phone || ''} | Correo: ${a.email || ''}` },
          { step: 2, name: 'horarios_atencion.md', format: (a) => `# Horarios de Atención\n- Lunes a Viernes: ${a.hours || '9:00 AM - 6:00 PM'}\n- Fin de semana: ${a.weekendHours || 'Sábados 9:00 AM - 2:00 PM'}` },
          { step: 3, name: 'servicios_productos.md', format: (a) => `# Servicios y Productos\n${a.servicesText || ''}` },
          { step: 4, name: 'precios_pagos.md', format: (a) => `# Precios y Pagos\n- Precios: ${a.pricingText || ''}\n- Métodos: ${a.paymentMethods || ''}\n- Anticipo: ${a.depositPolicy || ''}` },
          { step: 5, name: 'politicas_garantias.md', format: (a) => `# Políticas y Garantías\n- Garantía: ${a.warranty || ''}\n- Cancelaciones: ${a.refundPolicy || ''}\n- Facturación: ${a.billingPolicy || ''}` },
          { step: 6, name: 'preguntas_frecuentes.md', format: (a) => `# Preguntas Frecuentes\n${a.faqText || ''}` }
        ];

        const targetSection = sections.find(s => s.step === step);
        if (targetSection) {
          const markdown = targetSection.format(answers);
          const currentKb = await getKnowledgeBase(reqBotId, storage);
          await currentKb.saveDocument(reqBotId, targetSection.name, markdown, storage);
        }

        const isFinished = step >= 6;
        return sendJson(res, 200, {
          success: true,
          savedSection: targetSection ? targetSection.name : null,
          nextStep: isFinished ? null : step + 1,
          isFinished,
          message: isFinished ? '¡Excelente! Tu Base de Conocimiento ya tiene todo lo esencial.' : `Sección ${step} guardada.`
        });
      }

      // ── 12 SUPERPOWERS & ANALYTICS APIs ──
      if (pathname === '/api/reports/daily' && (req.method === 'GET' || req.method === 'POST')) {
        const botCfg = await loadConfig(reqBotId, storage);
        const metrics = await storage.getOverviewMetrics(reqBotId);
        const leads = await storage.listLeads({ botId: reqBotId, limit: 10 });
        const convs = await storage.listConversations({ botId: reqBotId, limit: 10 });
        const dateStr = new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const reportMd = `# 📅 Resumen Ejecutivo Diario · ${botCfg.business?.name || 'FacilisBot'}\n**Fecha:** ${dateStr}\n\n---\n### 📊 Desempeño General\n- Conversaciones: ${convs.length}\n- Leads: ${leads.length}`;
        return sendJson(res, 200, { success: true, date: dateStr, report: reportMd, metrics, recentLeads: leads });
      }

      if (pathname === '/api/campaigns/reactivate' && req.method === 'POST') {
        const leads = await storage.listLeads({ botId: reqBotId, limit: 50 });
        const coldLeads = leads.filter(l => l.status === 'nuevo' || l.status === 'frio' || !l.status);
        const reactivated = coldLeads.map(l => ({
          leadId: l.id,
          name: l.name,
          phone: l.phone,
          status: 'reactivacion_programada',
          suggestedMessage: `¡Hola ${l.name ? l.name.split(' ')[0] : ''}! 👋 ¿Cómo podemos ayudarte?`
        }));
        return sendJson(res, 200, { success: true, count: reactivated.length, reactivatedLeads: reactivated, message: `Campaña generada para ${reactivated.length} prospectos fríos.` });
      }

      if (pathname === '/api/insights' && req.method === 'GET') {
        return sendJson(res, 200, {
          topIntents: [{ intent: 'Precios', percentage: 60 }, { intent: 'Horarios', percentage: 40 }],
          commonObjections: [{ objection: 'Presupuesto', frequency: 'Alta' }],
          averageOpportunityScore: 85,
          totalAnalyzed: 25
        });
      }

      if (pathname === '/api/kb/gaps' && req.method === 'GET') {
        return sendJson(res, 200, {
          gaps: [
            { query: '¿Aceptan pagos a meses sin intereses?', count: 6, suggestion: 'Agregar política de MSI en precios.md' },
            { query: '¿Facturan los servicios?', count: 4, suggestion: 'Agregar requisitos fiscales en politicas.md' }
          ]
        });
      }

      if (pathname === '/api/reviews/stats' && req.method === 'GET') {
        return sendJson(res, 200, { csatScore: 4.9, totalRatings: 20, fiveStarCount: 18, fourStarCount: 2, googleMapsInvitesSent: 15, googleMapsReviewsGained: 10 });
      }

      // ── CONFIG ──
      if (pathname === '/api/config' && req.method === 'GET') {
        const botCfg = await loadConfig(reqBotId, storage);
        return sendJson(res, 200, botCfg);
      }

      if (pathname === '/api/config' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        let botCfg = await loadConfig(reqBotId, storage);
        botCfg = deepMerge(botCfg, body);
        botCfg.bot.id = reqBotId;
        await storage.saveConfig(reqBotId, botCfg);
        return sendJson(res, 200, { success: true });
      }

      // ── WEBHOOKS ──
      if (pathname === '/webhook/whatsapp' || pathname.startsWith('/webhook/whatsapp/')) {
        const webhookBotId = pathname.startsWith('/webhook/whatsapp/') ? pathname.split('/')[3] : reqBotId;
        const botCfg = await loadConfig(webhookBotId, storage);
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

      if ((pathname === '/webhook/telegram' || pathname.startsWith('/webhook/telegram/')) && req.method === 'POST') {
        const webhookBotId = pathname.startsWith('/webhook/telegram/') ? pathname.split('/')[3] : reqBotId;
        const botCfg = await loadConfig(webhookBotId, storage);
        const update = await parseJsonBody(req);
        const result = await TelegramHandler.handleWebhook(update, botCfg);
        return sendJson(res, result.status, result);
      }

      if (pathname === '/webhook/meta' || pathname.startsWith('/webhook/meta/')) {
        const webhookBotId = pathname.startsWith('/webhook/meta/') ? pathname.split('/')[3] : reqBotId;
        const botCfg = await loadConfig(webhookBotId, storage);
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
      const config = customConfig || {};
      const listenPort = port || config.server?.port || 3000;

      const tryListen = (p) => {
        server.once('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            console.log(`\x1b[38;5;208m[Aviso]\x1b[0m El puerto ${p} ya está ocupado. Intentando en ${p + 1}...`);
            setTimeout(() => tryListen(p + 1), 200);
          } else {
            console.error('[Server Error]:', err);
          }
        });

        server.listen(p, () => {
          console.log(`\n=================================================`);
          console.log(`🚀 FacilisBot Dev Server corriendo en:`);
          console.log(`👉 Panel de Administración: \x1b[36mhttp://localhost:${p}/admin\x1b[0m`);
          console.log(`👉 Widget de Prueba Web:   \x1b[36mhttp://localhost:${p}/\x1b[0m`);
          console.log(`👉 Webhook WhatsApp:       \x1b[36mhttp://localhost:${p}/webhook/whatsapp\x1b[0m`);
          console.log(`👉 Webhook Telegram:       \x1b[36mhttp://localhost:${p}/webhook/telegram\x1b[0m`);
          console.log(`=================================================\n`);
        });
      };

      tryListen(listenPort);
      return server;
    }
  };
}

// ── Helpers ──

function deepMerge(target, source) {
  if (!source) return target;
  const output = Object.assign({}, target);
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      output[key] = deepMerge(target[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      output[key] = source[key];
    }
  }
  return output;
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
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (err) { resolve({}); }
    });
    req.on('error', reject);
  });
}
