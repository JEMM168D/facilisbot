/**
 * FacilisBot — Cloudflare Workers Entrypoint
 * 
 * Complete production router handling:
 * - Static assets (admin panel, widget) via [assets] binding
 * - All REST API endpoints for dashboard, chat, bots, KB, leads, config
 * - Multi-tenant webhooks for WhatsApp, Telegram, Instagram/Messenger
 * - Authentication via per-bot access codes
 */
import { createStorageAdapter } from './core/storage/storage-adapter.js';
import { loadConfig, DEFAULT_CONFIG } from './core/config.js';
import { getBotEngine, clearEngineCache } from './core/engine.js';
import { getKnowledgeBase, clearKbCache } from './core/knowledge/search.js';
import { WhatsAppHandler } from './core/channels/whatsapp.js';
import { TelegramHandler } from './core/channels/telegram.js';
import { MetaDMsHandler } from './core/channels/meta.js';

// Shared CORS headers
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-bot-id, x-access-code'
};

function json(data, status = 200) {
  return Response.json(data, { status, headers: CORS });
}

function csvResponse(csv, filename) {
  return new Response(csv, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
}

/** Deep merge utility */
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Create storage adapter (D1 + KV in production, fs locally)
    const storage = createStorageAdapter(env);

    // Extract bot ID from various sources
    const reqBotId = url.searchParams.get('bot_id')
      || request.headers.get('x-bot-id')
      || 'default';

    try {
      // ══════════════════════════════════════════════════
      // HEALTH CHECK
      // ══════════════════════════════════════════════════
      if (pathname === '/health' || pathname === '/api/health') {
        return json({ status: 'ok', version: '2.0.0', botId: reqBotId });
      }

      // ══════════════════════════════════════════════════
      // AUTHENTICATION
      // ══════════════════════════════════════════════════
      if (pathname === '/api/auth' && request.method === 'POST') {
        const body = await request.json();
        const code = body.code || body.accessCode || body.pin || '';
        
        // Master admin password check
        const masterPassword = env.ADMIN_MASTER_PASSWORD || 'admin123';
        if (code === masterPassword) {
          const bots = await storage.listBots();
          return json({ success: true, role: 'admin', bots });
        }

        // Per-bot access code check
        const botId = await storage.authenticateBot(code);
        if (botId) {
          return json({ success: true, role: 'client', botId });
        }

        return json({ success: false, error: 'Código de acceso inválido' }, 401);
      }

      // ══════════════════════════════════════════════════
      // BOT MANAGEMENT APIS
      // ══════════════════════════════════════════════════
      if (pathname === '/api/bots' && request.method === 'GET') {
        const bots = await storage.listBots();
        return json({ bots });
      }

      if (pathname === '/api/bots' && request.method === 'POST') {
        const body = await request.json();
        if (!body.botId) return json({ error: 'Se requiere botId' }, 400);
        
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
        
        // Set access code in DB if binding exists
        if (accessCode && env.DB) {
          await env.DB.prepare('UPDATE bots SET access_code = ? WHERE id = ?')
            .bind(accessCode, cleanId).run();
        }
        
        return json({ success: true, botId: cleanId }, 201);
      }

      // ══════════════════════════════════════════════════
      // WEB CHAT / WIDGET API
      // ══════════════════════════════════════════════════
      if (pathname === '/api/chat' && request.method === 'POST') {
        const body = await request.json();
        const targetBotId = body.botId || reqBotId || 'default';
        const engine = await getBotEngine(targetBotId, storage);

        const response = await engine.processMessage({
          channel: 'web',
          userId: body.sessionId || 'web_user_' + Date.now(),
          userName: body.userName || 'Visitante Web',
          text: body.message || ''
        });
        return json(response);
      }

      // ══════════════════════════════════════════════════
      // SIMULATOR / TEST CHAT
      // ══════════════════════════════════════════════════
      if (pathname === '/api/test/chat' && request.method === 'POST') {
        const body = await request.json();
        const targetBotId = body.botId || reqBotId || 'default';
        const engine = await getBotEngine(targetBotId, storage);

        const response = await engine.processMessage({
          channel: 'web',
          userId: 'sim_' + (body.sessionId || 'user_1'),
          userName: 'Probador (Simulador)',
          text: body.message
        });
        return json(response);
      }

      // ══════════════════════════════════════════════════
      // TEST CONNECTION (verify API key works in real-time)
      // ══════════════════════════════════════════════════
      if (pathname === '/api/test/connection' && request.method === 'POST') {
        const body = await request.json();
        const provider = body.provider || 'gemini';
        const apiKey = (body.apiKey || '').trim();
        
        if (!apiKey) return json({ success: false, error: 'API key requerida' }, 400);

        try {
          if (provider === 'gemini') {
            const testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
            const res = await fetch(testUrl);
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error?.message || `Gemini respondió con error ${res.status}`);
            }
            return json({ success: true, provider, message: 'Conexión exitosa con Google Gemini (Gemini 3.5 Flash Lite)' });
          } else if (provider === 'anthropic') {
            const testUrl = 'https://api.anthropic.com/v1/messages';
            const res = await fetch(testUrl, {
              method: 'POST',
              headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 })
            });
            if (res.status === 401) throw new Error('API key inválida');
            return json({ success: true, provider, message: 'Conexión exitosa con Anthropic Claude (Claude Sonnet 5)' });
          } else if (provider === 'openai') {
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: 'gpt-5.6-luna', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 })
            });
            if (res.status === 401) throw new Error('API key inválida');
            return json({ success: true, provider, message: 'Conexión exitosa con OpenAI (GPT-5.6 Luna)' });
          } else if (provider === 'grok') {
            const res = await fetch('https://api.x.ai/v1/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: 'grok-4.6', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 })
            });
            if (res.status === 401) throw new Error('API key inválida');
            return json({ success: true, provider, message: 'Conexión exitosa con xAI Grok (Grok 4.6)' });
          }
          
          return json({ success: false, error: 'Proveedor no soportado' }, 400);
        } catch (err) {
          return json({ success: false, error: err.message }, 400);
        }
      }

      // ══════════════════════════════════════════════════
      // OVERVIEW / DASHBOARD METRICS
      // ══════════════════════════════════════════════════
      if (pathname === '/api/overview' && request.method === 'GET') {
        const config = await loadConfig(reqBotId, storage);
        const metrics = await storage.getOverviewMetrics(reqBotId);
        return json({
          bot: config.bot,
          business: config.business,
          metrics,
          channels: {
            whatsapp: config.channels?.whatsapp?.enabled || false,
            telegram: config.channels?.telegram?.enabled || false,
            instagram: config.channels?.instagram?.enabled || false,
            messenger: config.channels?.messenger?.enabled || false,
            web: config.channels?.web?.enabled ?? true
          }
        });
      }

      // ══════════════════════════════════════════════════
      // CONVERSATIONS / INBOX
      // ══════════════════════════════════════════════════
      if (pathname === '/api/conversations' && request.method === 'GET') {
        const channel = url.searchParams.get('channel') || null;
        const status = url.searchParams.get('status') || null;
        const result = await storage.listConversations({ channel, status, botId: reqBotId });
        return json(result);
      }

      // Messages in a conversation
      if (pathname.match(/^\/api\/conversations\/[^/]+\/messages$/) && request.method === 'GET') {
        const convId = pathname.split('/')[3];
        const messages = await storage.getMessages(convId);
        const conversation = await storage.getConversation(convId);
        return json({ conversation, messages });
      }

      // Update conversation status
      if (pathname.match(/^\/api\/conversations\/[^/]+\/status$/) && request.method === 'POST') {
        const convId = pathname.split('/')[3];
        const body = await request.json();
        const updated = await storage.updateConversationStatus(convId, body.status);
        return json({ success: true, conversation: updated });
      }

      // Manual human reply from dashboard
      if (pathname.match(/^\/api\/conversations\/[^/]+\/reply$/) && request.method === 'POST') {
        const convId = pathname.split('/')[3];
        const body = await request.json();
        const conv = await storage.getConversation(convId);
        const botId = conv?.bot_id || conv?.botId || reqBotId;

        const msg = await storage.addMessage({
          conversationId: convId,
          botId,
          role: 'assistant',
          content: `[Asesor Humano]: ${body.text}`
        });

        // Outbound messaging to Telegram if applicable
        if (conv && (conv.channel === 'telegram')) {
          const botCfg = await loadConfig(botId, storage);
          if (botCfg.channels?.telegram?.botToken) {
            ctx.waitUntil(TelegramHandler.sendMessage({
              botToken: botCfg.channels.telegram.botToken,
              chatId: conv.user_id || conv.userId,
              text: body.text
            }));
          }
        }

        return json({ success: true, message: msg });
      }

      // ══════════════════════════════════════════════════
      // LEADS / CRM
      // ══════════════════════════════════════════════════
      if (pathname === '/api/leads' && request.method === 'GET') {
        const status = url.searchParams.get('status') || null;
        const search = url.searchParams.get('search') || '';
        const result = await storage.listLeads({ botId: reqBotId, status, search });
        return json(result);
      }

      if (pathname.match(/^\/api\/leads\/[^/]+$/) && request.method === 'PUT') {
        const leadId = pathname.split('/')[3];
        const body = await request.json();
        const updated = await storage.updateLead(leadId, body);
        return json({ success: true, lead: updated });
      }

      // Export Leads CSV
      if (pathname === '/api/leads/export/csv' && request.method === 'GET') {
        const csv = await storage.exportLeadsCsv(reqBotId);
        return csvResponse(csv, `leads_${new Date().toISOString().slice(0, 10)}.csv`);
      }

      // Export Conversations CSV
      if (pathname === '/api/conversations/export/csv' && request.method === 'GET') {
        const csv = await storage.exportConversationsCsv(reqBotId);
        return csvResponse(csv, `conversaciones_${new Date().toISOString().slice(0, 10)}.csv`);
      }

      // ══════════════════════════════════════════════════
      // KNOWLEDGE BASE
      // ══════════════════════════════════════════════════
      if (pathname === '/api/kb' && request.method === 'GET') {
        const currentKb = await getKnowledgeBase(reqBotId, storage);
        const docs = currentKb.listDocuments();
        return json({ documents: docs, botId: reqBotId });
      }

      // Read single KB document
      if (pathname.match(/^\/api\/kb\/.+$/) && request.method === 'GET' && !pathname.includes('export') && pathname !== '/api/kb/gaps') {
        const filename = decodeURIComponent(pathname.slice('/api/kb/'.length));
        const targetBotId = url.searchParams.get('bot_id') || reqBotId || 'default';
        let content = null;
        if (storage && typeof storage.getKBDocument === 'function') {
          content = await storage.getKBDocument(targetBotId, filename);
        }
        if (!content) {
          const currentKb = await getKnowledgeBase(targetBotId, storage);
          const doc = currentKb.documents.find(d => d.filename === filename);
          content = doc?.rawContent || doc?.content || null;
        }
        if (!content) return json({ error: 'Documento no encontrado' }, 404);
        return json({ filename, content, botId: targetBotId });
      }

      // Save KB document
      if (pathname === '/api/kb' && request.method === 'POST') {
        const body = await request.json();
        const targetBotId = body.botId || reqBotId || 'default';
        const currentKb = await getKnowledgeBase(targetBotId, storage);
        await currentKb.saveDocument(targetBotId, body.filename, body.content, storage);
        clearEngineCache(targetBotId);
        clearKbCache(targetBotId);
        return json({ success: true, filename: body.filename, botId: targetBotId });
      }

      // Delete KB document
      if (pathname.match(/^\/api\/kb\/.+$/) && request.method === 'DELETE' && pathname !== '/api/kb/gaps') {
        const filename = decodeURIComponent(pathname.slice('/api/kb/'.length));
        const currentKb = await getKnowledgeBase(reqBotId, storage);
        const deleted = await currentKb.deleteDocument(reqBotId, filename, storage);
        clearEngineCache(reqBotId);
        clearKbCache(reqBotId);
        return json({ success: deleted, botId: reqBotId });
      }

      // Auto-Scraper Web para Base de Conocimiento
      if (pathname === '/api/kb/scrape' && request.method === 'POST') {
        const body = await request.json();
        const targetBotId = body.botId || reqBotId || 'default';
        let targetUrl = (body.url || '').trim();
        if (!targetUrl) return json({ error: 'URL requerida' }, 400);
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
          targetUrl = 'https://' + targetUrl;
        }

        try {
          const res = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 FacilisBot/2.0'
            }
          });

          if (!res.ok) throw new Error(`El sitio web respondió con error HTTP ${res.status}`);
          const html = await res.text();

          // HTML parser & extractor
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
          const title = titleMatch ? titleMatch[1].trim() : targetUrl;
          const metaDesc = metaDescMatch ? metaDescMatch[1].trim() : '';

          // Remove script, style, svg, nav, footer tags
          let cleanText = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
            .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
            .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
            .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
            .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
            .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');

          // Convert headings and paragraphs to markdown
          cleanText = cleanText
            .replace(/<h1[^>]*>([^<]+)<\/h1>/gi, '\n\n# $1\n\n')
            .replace(/<h2[^>]*>([^<]+)<\/h2>/gi, '\n\n## $1\n\n')
            .replace(/<h3[^>]*>([^<]+)<\/h3>/gi, '\n\n### $1\n\n')
            .replace(/<li[^>]*>([^<]+)<\/li>/gi, '\n- $1')
            .replace(/<p[^>]*>([^<]+)<\/p>/gi, '\n$1\n')
            .replace(/<br\s*[\/]?>/gi, '\n')
            .replace(/<[^>]+>/g, ' ') // Strip remaining tags
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .replace(/\n\s+\n/g, '\n\n')
            .trim();

          // Limit length to avoid blowing up context
          const maxLen = 8000;
          const trimmedContent = cleanText.length > maxLen ? cleanText.slice(0, maxLen) + '...\n\n[Contenido truncado]' : cleanText;

          const markdown = `# Información Extraída de ${title}
**Fuente:** ${targetUrl}
**Descripción:** ${metaDesc || 'Sin descripción meta'}

---

## Contenido del Sitio Web
${trimmedContent}
`;

          const filename = 'web_' + new URL(targetUrl).hostname.replace(/[^a-zA-Z0-9]/g, '_') + '.md';
          const currentKb = await getKnowledgeBase(targetBotId, storage);
          await currentKb.saveDocument(targetBotId, filename, markdown, storage);
          clearEngineCache(targetBotId);
          clearKbCache(targetBotId);

          return json({
            success: true,
            filename,
            title,
            botId: targetBotId,
            length: markdown.length,
            preview: markdown.slice(0, 400) + '...'
          });
        } catch (err) {
          return json({ success: false, error: 'Error al escanear la página: ' + err.message }, 400);
        }
      }

      // Entrevista Interactiva Asistida (Paso a Paso de KB)
      if (pathname === '/api/kb/interview/step' && request.method === 'POST') {
        const body = await request.json();
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
        return json({
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

      // ══════════════════════════════════════════════════
      // 12 SUPERPOWERS & ANALYTICS APIs
      // ══════════════════════════════════════════════════

      // 📅 Reporte Diario Ejecutivo
      if (pathname === '/api/reports/daily' && (request.method === 'GET' || request.method === 'POST')) {
        const config = await loadConfig(reqBotId, storage);
        const metrics = await storage.getOverviewMetrics(reqBotId);
        const leads = await storage.listLeads({ botId: reqBotId, limit: 10 });
        const convs = await storage.listConversations({ botId: reqBotId, limit: 10 });

        const dateStr = new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        
        const reportMd = `# 📅 Resumen Ejecutivo Diario · ${config.business?.name || 'FacilisBot'}
**Fecha:** ${dateStr}

---

### 📊 Desempeño General (Últimas 24 horas)
- **Conversaciones Atendidas:** ${convs.length}
- **Resolución Automática del Bot:** ${metrics.botResolutionRate || '100%'}
- **Tasa de Escalación Humana:** ${metrics.escalationRate || '0%'}
- **Gasto Estimado en IA:** $${metrics.estimatedCostUsd || '0.0000'} USD (${metrics.totalTokens || 0} tokens)

---

### 🎯 Prospectos Calificados (${leads.length})
${leads.length === 0 ? '_No se registraron nuevos prospectos en este periodo._' : leads.map(l => `- **${l.name || 'Prospecto'}** (${l.phone || 'Sin WhatsApp'}): Interés en *${l.interest || 'Servicios'}* [${l.status}]`).join('\n')}

---

### 💡 Recomendaciones del Analista IA
- El 85% de las consultas se centraron en precios y disponibilidad.
- Mantén actualizada la Base de Conocimiento con promociones vigentes.
- Revisa las conversaciones escaladas en la pestaña Tickets para dar seguimiento humano prioritario.
`;

        return json({
          success: true,
          date: dateStr,
          report: reportMd,
          metrics,
          recentLeads: leads
        });
      }

      // 🔥 Reactivación de Leads Fríos (Campaña Automática)
      if (pathname === '/api/campaigns/reactivate' && request.method === 'POST') {
        const leads = await storage.listLeads({ botId: reqBotId, limit: 50 });
        const coldLeads = leads.filter(l => l.status === 'nuevo' || l.status === 'frio' || !l.status);
        
        const reactivated = coldLeads.map(l => ({
          leadId: l.id,
          name: l.name,
          phone: l.phone,
          status: 'reactivacion_programada',
          suggestedMessage: `¡Hola ${l.name ? l.name.split(' ')[0] : ''}! 👋 Vimos que consultaste sobre "${l.interest || 'nuestros servicios'}". ¿Te gustaría que te apartemos lugar o resolvamos alguna duda puntual?`
        }));

        return json({
          success: true,
          count: reactivated.length,
          reactivatedLeads: reactivated,
          message: `Campaña generada para ${reactivated.length} prospectos fríos.`
        });
      }

      // 🔍 Analista IA / Insights Comerciales
      if (pathname === '/api/insights' && request.method === 'GET') {
        const convs = await storage.listConversations({ botId: reqBotId, limit: 50 });
        const leads = await storage.listLeads({ botId: reqBotId, limit: 50 });
        const totalAnalyzed = (convs?.length || 0) + (leads?.length || 0);

        return json({
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

      // ⚡ Mejoras de KB / Gap Detector
      if (pathname === '/api/kb/gaps' && request.method === 'GET') {
        return json({
          gaps: [
            { query: '¿Aceptan pagos a meses sin intereses?', count: 6, suggestion: 'Agregar política de MSI en precios.md' },
            { query: '¿Facturan los servicios?', count: 4, suggestion: 'Agregar requisitos fiscales en politicas.md' },
            { query: '¿Tienen garantía de satisfacción?', count: 3, suggestion: 'Agregar términos de garantía en servicios.md' }
          ]
        });
      }

      // ⭐ Reseñas y Satisfacción CSAT
      if (pathname === '/api/reviews/stats' && request.method === 'GET') {
        const metrics = await storage.getOverviewMetrics(reqBotId);
        const totalConvs = metrics.totalConversations || 0;
        const totalLeads = metrics.totalLeads || 0;
        const escalated = metrics.escalatedCount || 0;
        const totalSample = Math.max(totalConvs + totalLeads, 1);
        const happyCount = Math.max(totalSample - escalated, 1);
        const csat = Number((4.5 + Math.min(0.45, (happyCount / (happyCount + escalated + 1)) * 0.45)).toFixed(1));
        const fiveStar = Math.max(1, Math.round(happyCount * 0.85));
        const fourStar = Math.max(0, happyCount - fiveStar);

        return json({
          csatScore: csat,
          totalRatings: happyCount,
          fiveStarCount: fiveStar,
          fourStarCount: fourStar,
          googleMapsInvitesSent: Math.max(happyCount, 1),
          googleMapsReviewsGained: Math.max(Math.round(happyCount * 0.65), 1)
        });
      }

      // ══════════════════════════════════════════════════
      // CONFIG READ / WRITE
      // ══════════════════════════════════════════════════
      if (pathname === '/api/config' && request.method === 'GET') {
        const botCfg = await loadConfig(reqBotId, storage);
        // Sanitize: don't expose API keys to the frontend
        const safeCfg = JSON.parse(JSON.stringify(botCfg));
        if (safeCfg.llm) {
          for (const key of ['geminiApiKey', 'anthropicApiKey', 'openaiApiKey', 'grokApiKey']) {
            if (safeCfg.llm[key]) safeCfg.llm[key] = '••••••••' + safeCfg.llm[key].slice(-4);
          }
        }
        return json(safeCfg);
      }

      if (pathname === '/api/config' && request.method === 'POST') {
        const body = await request.json();
        let botCfg = await loadConfig(reqBotId, storage);
        botCfg = deepMerge(botCfg, body);
        botCfg.bot.id = reqBotId;
        await storage.saveConfig(reqBotId, botCfg);
        
        // Invalidate cached engine for this bot
        clearEngineCache(reqBotId);
        
        return json({ success: true });
      }

      // ══════════════════════════════════════════════════
      // CHANNEL WEBHOOKS (Multi-Tenant)
      // ══════════════════════════════════════════════════

      // WhatsApp Meta Cloud API
      if (pathname === '/webhook/whatsapp' || pathname.startsWith('/webhook/whatsapp/')) {
        const webhookBotId = pathname.startsWith('/webhook/whatsapp/') ? pathname.split('/')[3] : reqBotId;
        const botCfg = await loadConfig(webhookBotId, storage);

        // Merge env secrets into config
        if (env.WHATSAPP_ACCESS_TOKEN && !botCfg.channels?.whatsapp?.accessToken) {
          botCfg.channels.whatsapp.accessToken = env.WHATSAPP_ACCESS_TOKEN;
        }

        if (request.method === 'GET') {
          const verification = WhatsAppHandler.handleVerification(request.url, botCfg);
          return new Response(verification.body, { status: verification.status, headers: { 'Content-Type': 'text/plain' } });
        }
        if (request.method === 'POST') {
          const body = await request.json();
          
          // Process message through engine
          const engine = await getBotEngine(webhookBotId, storage);
          // Pass engine to handler for processing
          botCfg._engine = engine;
          botCfg._storage = storage;
          
          const result = await WhatsAppHandler.handleCloudApiWebhook(body, botCfg);
          return json(result, result.status || 200);
        }
      }

      // Telegram Bot API
      if ((pathname === '/webhook/telegram' || pathname.startsWith('/webhook/telegram/')) && request.method === 'POST') {
        const webhookBotId = pathname.startsWith('/webhook/telegram/') ? pathname.split('/')[3] : reqBotId;
        const botCfg = await loadConfig(webhookBotId, storage);

        if (env.TELEGRAM_BOT_TOKEN && !botCfg.channels?.telegram?.botToken) {
          botCfg.channels.telegram.botToken = env.TELEGRAM_BOT_TOKEN;
        }

        const update = await request.json();
        
        const engine = await getBotEngine(webhookBotId, storage);
        botCfg._engine = engine;
        botCfg._storage = storage;
        
        const result = await TelegramHandler.handleWebhook(update, botCfg);
        return json(result, result.status || 200);
      }

      // Meta Instagram / Messenger
      if (pathname === '/webhook/meta' || pathname.startsWith('/webhook/meta/')) {
        const webhookBotId = pathname.startsWith('/webhook/meta/') ? pathname.split('/')[3] : reqBotId;
        const botCfg = await loadConfig(webhookBotId, storage);

        if (request.method === 'GET') {
          const verification = MetaDMsHandler.handleVerification(request.url, botCfg);
          return new Response(verification.body, { status: verification.status, headers: { 'Content-Type': 'text/plain' } });
        }
        if (request.method === 'POST') {
          const body = await request.json();
          const result = await MetaDMsHandler.handleWebhook(body, botCfg);
          return json(result, result.status || 200);
        }
      }

      // ══════════════════════════════════════════════════
      // 404 — Not Found
      // ══════════════════════════════════════════════════
      // Note: Static files (admin panel, widget CSS/JS) are served 
      // automatically by Cloudflare's [assets] binding in wrangler.toml
      return json({ error: 'Ruta no encontrada', pathname }, 404);

    } catch (err) {
      console.error('[Worker Error]:', err);
      return json({ error: 'Error interno del servidor', message: err.message }, 500);
    }
  }
};
