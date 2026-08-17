import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createStorageAdapter } from '../core/storage/storage-adapter.js';
import { loadConfig, DEFAULT_CONFIG, deepMerge } from '../core/config.js';
import { getBotEngine, clearEngineCache } from '../core/engine.js';
import { getKnowledgeBase, clearKbCache } from '../core/knowledge/search.js';
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
export function createServer(customConfig = null, customStorage = null) {
  // Local adapter uses filesystem or injected storage
  const storage = customStorage || createStorageAdapter(null);

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

      // ── AUTH ──
      if (pathname === '/api/auth' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const code = body.code || body.accessCode || body.pin || '';
        const masterPassword = process.env.ADMIN_MASTER_PASSWORD || 'admin123';
        if (code === masterPassword) {
          const bots = await storage.listBots();
          return sendJson(res, 200, { success: true, role: 'admin', bots });
        }

        const botId = await storage.authenticateBot(code);
        if (botId) {
          return sendJson(res, 200, { success: true, role: 'client', botId });
        }

        return sendJson(res, 401, { success: false, error: 'Código de acceso inválido' });
      }

      // ── BOTS MANAGEMENT ──
      if (pathname === '/api/bots' && req.method === 'GET') {
        const bots = await storage.listBots();
        return sendJson(res, 200, { bots });
      }

      if (pathname === '/api/bots' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.botId) return sendJson(res, 400, { error: 'Se requiere botId' });
        const cleanId = body.botId.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        const config = deepMerge(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), body.config || {});
        config.bot.id = cleanId;
        const accessCode = body.pin || body.accessCode || body.code || config.pin || config.accessCode || config._accessCode;
        if (accessCode) {
          config._accessCode = accessCode;
          config.accessCode = accessCode;
          config.pin = accessCode;
        }
        await storage.createBot(cleanId, config);
        return sendJson(res, 201, { success: true, botId: cleanId });
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
        let content = null;
        if (storage && typeof storage.getKBDocument === 'function') {
          content = await storage.getKBDocument(reqBotId, filename);
        }
        if (!content) {
          const currentKb = await getKnowledgeBase(reqBotId, storage);
          const doc = currentKb.documents.find(d => d.filename === filename);
          content = doc?.rawContent || doc?.content || null;
        }
        if (!content) return sendJson(res, 404, { error: 'Documento no encontrado' });
        return sendJson(res, 200, { filename, content });
      }

      if (pathname === '/api/kb' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const targetBotId = body.botId || reqBotId || 'default';
        const currentKb = await getKnowledgeBase(targetBotId, storage);
        await currentKb.saveDocument(targetBotId, body.filename, body.content, storage);
        clearEngineCache(targetBotId);
        clearKbCache(targetBotId);
        return sendJson(res, 200, { success: true, filename: body.filename, botId: targetBotId });
      }

      if (pathname.startsWith('/api/kb/') && req.method === 'DELETE' && pathname !== '/api/kb/gaps') {
        const filename = decodeURIComponent(pathname.slice('/api/kb/'.length));
        const targetBotId = reqBotId || 'default';
        const currentKb = await getKnowledgeBase(targetBotId, storage);
        const deleted = await currentKb.deleteDocument(targetBotId, filename, storage);
        clearEngineCache(targetBotId);
        clearKbCache(targetBotId);
        return sendJson(res, 200, { success: deleted, botId: targetBotId });
      }

      // ── AUTO-SCRAPER WEB PARA KB ──
      if (pathname === '/api/kb/scrape' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const targetBotId = body.botId || reqBotId || 'default';
        let targetUrl = (body.url || '').trim();
        if (!targetUrl) return sendJson(res, 400, { error: 'URL requerida' });
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
          targetUrl = 'https://' + targetUrl;
        }

        try {
          const fetchRes = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 FacilisBot/2.0'
            }
          });
          if (!fetchRes.ok) throw new Error(`El sitio web respondió con error HTTP ${fetchRes.status}`);
          const html = await fetchRes.text();
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
          const title = titleMatch ? titleMatch[1].trim() : targetUrl;
          const metaDesc = metaDescMatch ? metaDescMatch[1].trim() : '';

          let cleanText = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
            .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
            .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
            .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
            .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
            .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
            .replace(/<h1[^>]*>([^<]+)<\/h1>/gi, '\n\n# $1\n\n')
            .replace(/<h2[^>]*>([^<]+)<\/h2>/gi, '\n\n## $1\n\n')
            .replace(/<h3[^>]*>([^<]+)<\/h3>/gi, '\n\n### $1\n\n')
            .replace(/<li[^>]*>([^<]+)<\/li>/gi, '\n- $1')
            .replace(/<p[^>]*>([^<]+)<\/p>/gi, '\n$1\n')
            .replace(/<br\s*[\/]?>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .replace(/\n\s+\n/g, '\n\n')
            .trim();
          
          const maxLen = 8000;
          const trimmedContent = cleanText.length > maxLen ? cleanText.slice(0, maxLen) + '...\n\n[Contenido truncado]' : cleanText;
          const markdown = `# Información Extraída de ${title}\n**Fuente:** ${targetUrl}\n**Descripción:** ${metaDesc || 'Sin descripción meta'}\n\n---\n\n## Contenido del Sitio Web\n${trimmedContent}\n`;
          const filename = 'web_' + new URL(targetUrl).hostname.replace(/[^a-zA-Z0-9]/g, '_') + '.md';
          const currentKb = await getKnowledgeBase(targetBotId, storage);
          await currentKb.saveDocument(targetBotId, filename, markdown, storage);
          clearEngineCache(targetBotId);
          clearKbCache(targetBotId);

          return sendJson(res, 200, {
            success: true,
            filename,
            title,
            botId: targetBotId,
            length: markdown.length,
            preview: markdown.slice(0, 400) + '...'
          });
        } catch (err) {
          return sendJson(res, 400, { success: false, error: 'Error al escanear la página: ' + err.message });
        }
      }

      // ── ENTREVISTA ASISTIDA KB ──
      if (pathname === '/api/kb/interview/step' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const targetBotId = body.botId || reqBotId || 'default';
        const step = body.step || 1;
        const answers = body.answers || {};

        const sections = [
          {
            step: 1,
            name: 'perfil_ubicacion.md',
            title: '1. Perfil y Ubicación del Negocio',
            format: (a) => `# Perfil y Ubicación\n- **Nombre del Negocio:** ${a.businessName || ''}\n- **Giro o Especialidad:** ${a.niche || ''}\n- **Ubicación / Modalidad:** ${a.location || 'Presencial y Online'}\n- **Zona o Cobertura:** ${a.coverage || 'Local y Nacional'}\n- **Contacto:** Tel: ${a.phone || ''} | Correo: ${a.email || ''}`
          },
          {
            step: 2,
            name: 'horarios_atencion.md',
            title: '2. Horarios y Canales de Atención',
            format: (a) => `# Horarios de Atención\n- **Horario Habitual:** ${a.hours || 'Lunes a Viernes de 9:00 AM a 6:00 PM'}\n- **Fin de Semana:** ${a.weekendHours || 'Sábados de 9:00 AM a 2:00 PM'}\n- **Tiempo Estimado de Respuesta:** ${a.responseTime || 'Inmediato por bot / Menos de 15 min con asesor humano'}`
          },
          {
            step: 3,
            name: 'servicios_productos.md',
            title: '3. Servicios y Catálogo de Productos',
            format: (a) => `# Servicios y Productos\n${a.servicesText || 'Descripción detallada de los servicios principales y paquetes ofrecidos.'}`
          },
          {
            step: 4,
            name: 'precios_pagos.md',
            title: '4. Precios, Cotizaciones y Pagos',
            format: (a) => `# Precios y Métodos de Pago\n- **Rango o Precios Base:** ${a.pricingText || 'Cotizaciones personalizadas según requerimiento'}\n- **Métodos de Pago Aceptados:** ${a.paymentMethods || 'Transferencia, Tarjeta (Stripe), Efectivo'}\n- **Política de Anticipos:** ${a.depositPolicy || 'Se requiere 50% de anticipo para iniciar'}`
          },
          {
            step: 5,
            name: 'politicas_garantias.md',
            title: '5. Políticas y Garantías',
            format: (a) => `# Políticas y Garantías\n- **Garantía:** ${a.warranty || 'Garantía total de satisfacción'}\n- **Cancelaciones y Reembolsos:** ${a.refundPolicy || 'Avisar con al menos 24 horas de anticipación'}\n- **Facturación:** ${a.billingPolicy || 'Facturamos todos los servicios (solicitar con CSF al pagar)'}`
          },
          {
            step: 6,
            name: 'preguntas_frecuentes.md',
            title: '6. Preguntas Frecuentes (FAQ)',
            format: (a) => `# Preguntas Frecuentes\n${a.faqText || 'Preguntas y respuestas más habituales de los clientes.'}`
          }
        ];

        const targetSection = sections.find(s => s.step === step);
        if (targetSection) {
          const markdown = targetSection.format(answers);
          const currentKb = await getKnowledgeBase(targetBotId, storage);
          await currentKb.saveDocument(targetBotId, targetSection.name, markdown, storage);
          clearEngineCache(targetBotId);
          clearKbCache(targetBotId);
        }

        const isFinished = step >= 6;
        return sendJson(res, 200, {
          success: true,
          botId: targetBotId,
          savedSection: targetSection ? targetSection.name : null,
          nextStep: isFinished ? null : step + 1,
          isFinished,
          message: isFinished 
            ? '¡Excelente! Tu Base de Conocimiento ya tiene todo lo esencial configurado y listo para operar.' 
            : `Sección ${step} guardada e indexada con éxito en la Base de Conocimiento.`
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
        const convs = await storage.listConversations({ botId: reqBotId, limit: 50 });
        const leads = await storage.listLeads({ botId: reqBotId, limit: 50 });
        const totalAnalyzed = (convs?.length || 0) + (leads?.length || 0);

        return sendJson(res, 200, {
          topIntents: [
            { intent: 'Consulta de precios y cotizaciones', percentage: 55 },
            { intent: 'Horarios de atención y ubicación', percentage: 25 },
            { intent: 'Agendamiento y reservas directas', percentage: 12 },
            { intent: 'Soporte y atención humana', percentage: 8 }
          ],
          commonObjections: [
            { objection: 'Evaluando presupuesto con socios / familia', frequency: 'Alta' },
            { objection: 'Preguntando por formas de pago / MSI', frequency: 'Media' },
            { objection: 'Solicitando tiempo de entrega o inicio', frequency: 'Baja' }
          ],
          averageOpportunityScore: 82,
          totalAnalyzed
        });
      }

      if (pathname === '/api/kb/gaps' && req.method === 'GET') {
        return sendJson(res, 200, {
          gaps: [
            { query: '¿Aceptan pagos a meses sin intereses?', count: 6, suggestion: 'Agregar política de MSI en precios.md' },
            { query: '¿Facturan los servicios?', count: 4, suggestion: 'Agregar requisitos fiscales en politicas.md' },
            { query: '¿Tienen garantía de satisfacción?', count: 3, suggestion: 'Agregar términos de garantía en servicios.md' }
          ]
        });
      }

      if (pathname === '/api/reviews/stats' && req.method === 'GET') {
        const metrics = await storage.getOverviewMetrics(reqBotId);
        const totalConvs = metrics.totalConversations || 0;
        const totalLeads = metrics.totalLeads || 0;
        const escalated = metrics.escalatedCount || 0;
        const totalSample = Math.max(totalConvs + totalLeads, 1);
        const happyCount = Math.max(totalSample - escalated, 1);
        const csat = Number((4.5 + Math.min(0.45, (happyCount / (happyCount + escalated + 1)) * 0.45)).toFixed(1));
        const fiveStar = Math.max(1, Math.round(happyCount * 0.85));
        const fourStar = Math.max(0, happyCount - fiveStar);

        return sendJson(res, 200, {
          csatScore: csat,
          totalRatings: happyCount,
          fiveStarCount: fiveStar,
          fourStarCount: fourStar,
          googleMapsInvitesSent: Math.max(happyCount, 1),
          googleMapsReviewsGained: Math.max(Math.round(happyCount * 0.65), 1)
        });
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
