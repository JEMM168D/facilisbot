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
import { getBotEngine } from './core/engine.js';
import { getKnowledgeBase } from './core/knowledge/search.js';
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
        const code = body.code || body.accessCode || '';
        
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
        if (body.accessCode) config._accessCode = body.accessCode;
        
        await storage.createBot(cleanId, config);
        
        // Set access code if provided
        if (body.accessCode && env.DB) {
          await env.DB.prepare('UPDATE bots SET access_code = ? WHERE id = ?')
            .bind(body.accessCode, cleanId).run();
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
      // TEST CONNECTION (verify API key works)
      // ══════════════════════════════════════════════════
      if (pathname === '/api/test/connection' && request.method === 'POST') {
        const body = await request.json();
        const provider = body.provider || 'gemini';
        const apiKey = body.apiKey || '';
        
        if (!apiKey) return json({ success: false, error: 'API key requerida' }, 400);

        try {
          let testUrl = '';
          let testHeaders = {};
          let testBody = '';

          if (provider === 'gemini') {
            testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
            const res = await fetch(testUrl);
            if (!res.ok) throw new Error(`Gemini respondió ${res.status}`);
            return json({ success: true, provider, message: 'Conexión exitosa con Google Gemini' });
          } else if (provider === 'anthropic') {
            testUrl = 'https://api.anthropic.com/v1/messages';
            const res = await fetch(testUrl, {
              method: 'POST',
              headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'test' }], max_tokens: 5 })
            });
            if (res.status === 401) throw new Error('API key inválida');
            return json({ success: true, provider, message: 'Conexión exitosa con Anthropic Claude' });
          } else if (provider === 'openai') {
            const res = await fetch('https://api.openai.com/v1/models', {
              headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            if (!res.ok) throw new Error(`OpenAI respondió ${res.status}`);
            return json({ success: true, provider, message: 'Conexión exitosa con OpenAI' });
          } else if (provider === 'grok') {
            const res = await fetch('https://api.x.ai/v1/models', {
              headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            if (!res.ok) throw new Error(`Grok respondió ${res.status}`);
            return json({ success: true, provider, message: 'Conexión exitosa con xAI Grok' });
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
        return json({ documents: docs });
      }

      // Read single KB document
      if (pathname.match(/^\/api\/kb\/.+$/) && request.method === 'GET' && !pathname.includes('export')) {
        const filename = decodeURIComponent(pathname.slice('/api/kb/'.length));
        const currentKb = await getKnowledgeBase(reqBotId, storage);
        const doc = currentKb.documents.find(d => d.filename === filename);
        if (!doc) return json({ error: 'Documento no encontrado' }, 404);
        return json({ filename: doc.filename, content: doc.rawContent });
      }

      // Save KB document
      if (pathname === '/api/kb' && request.method === 'POST') {
        const body = await request.json();
        const currentKb = await getKnowledgeBase(reqBotId, storage);
        await currentKb.saveDocument(reqBotId, body.filename, body.content, storage);
        return json({ success: true, filename: body.filename });
      }

      // Delete KB document
      if (pathname.match(/^\/api\/kb\/.+$/) && request.method === 'DELETE') {
        const filename = decodeURIComponent(pathname.slice('/api/kb/'.length));
        const currentKb = await getKnowledgeBase(reqBotId, storage);
        const deleted = await currentKb.deleteDocument(reqBotId, filename, storage);
        return json({ success: deleted });
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
        const engineRegistry = globalThis.__facilisbot_engines;
        if (engineRegistry) engineRegistry.delete(reqBotId);
        
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
