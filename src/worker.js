/**
 * Cloudflare Workers Entrypoint Adapter for Yunque Bots (Forja OS)
 * Handles Edge routing, Webhooks, RAG Search, and Multi-LLM inference.
 */
import { BotEngine } from './core/engine.js';
import { loadConfig } from './core/config.js';
import { db } from './core/storage/db.js';
import { kb } from './core/knowledge/search.js';
import { WhatsAppHandler } from './core/channels/whatsapp.js';
import { TelegramHandler } from './core/channels/telegram.js';
import { MetaDMsHandler } from './core/channels/meta.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Merge Cloudflare env vars into config
    const config = loadConfig();
    if (env.GEMINI_API_KEY) config.llm.geminiApiKey = env.GEMINI_API_KEY;
    if (env.ANTHROPIC_API_KEY) config.llm.anthropicApiKey = env.ANTHROPIC_API_KEY;
    if (env.OPENAI_API_KEY) config.llm.openaiApiKey = env.OPENAI_API_KEY;
    if (env.GROK_API_KEY) config.llm.grokApiKey = env.GROK_API_KEY;
    if (env.WHATSAPP_ACCESS_TOKEN) config.channels.whatsapp.accessToken = env.WHATSAPP_ACCESS_TOKEN;
    if (env.TELEGRAM_BOT_TOKEN) config.channels.telegram.botToken = env.TELEGRAM_BOT_TOKEN;

    const botEngine = new BotEngine(config);

    // CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // 1. Health check
      if (pathname === '/health' || pathname === '/api/health') {
        return Response.json({ status: 'ok', bot: config.bot?.name, version: '1.0.0' }, { headers: corsHeaders });
      }

      // 2. Chat API for Web Widget
      if (pathname === '/api/chat' && request.method === 'POST') {
        const body = await request.json();
        const response = await botEngine.processMessage({
          channel: 'web',
          userId: body.sessionId || 'web_user_' + Date.now(),
          userName: body.userName || 'Visitante Web',
          text: body.message || ''
        });
        return Response.json(response, { headers: corsHeaders });
      }

      // 3. Webhooks: WhatsApp Cloud API
      if (pathname === '/webhook/whatsapp') {
        if (request.method === 'GET') {
          const verification = WhatsAppHandler.handleVerification(request.url, config);
          return new Response(verification.body, { status: verification.status, headers: { 'Content-Type': 'text/plain' } });
        }
        if (request.method === 'POST') {
          const body = await request.json();
          const result = await WhatsAppHandler.handleCloudApiWebhook(body, config);
          return Response.json(result, { status: result.status });
        }
      }

      // 4. Webhooks: Telegram
      if (pathname === '/webhook/telegram' && request.method === 'POST') {
        const update = await request.json();
        const result = await TelegramHandler.handleWebhook(update, config);
        return Response.json(result, { status: result.status });
      }

      // 5. Webhooks: Meta DMs (Instagram / Messenger)
      if (pathname === '/webhook/meta') {
        if (request.method === 'GET') {
          const verification = MetaDMsHandler.handleVerification(request.url, config);
          return new Response(verification.body, { status: verification.status, headers: { 'Content-Type': 'text/plain' } });
        }
        if (request.method === 'POST') {
          const body = await request.json();
          const result = await MetaDMsHandler.handleWebhook(body, config);
          return Response.json(result, { status: result.status });
        }
      }

      // 6. Admin Overview API
      if (pathname === '/api/overview' && request.method === 'GET') {
        const metrics = db.getOverviewMetrics();
        return Response.json({
          bot: config.bot,
          business: config.business,
          metrics,
          channels: {
            web: config.channels.web.enabled,
            whatsapp: config.channels.whatsapp.enabled,
            telegram: config.channels.telegram.enabled,
            instagram: config.channels.instagram.enabled
          }
        }, { headers: corsHeaders });
      }

      // 404
      return Response.json({ error: 'Ruta no encontrada' }, { status: 404, headers: corsHeaders });
    } catch (err) {
      return Response.json({ error: 'Error procesando solicitud', details: err.message }, { status: 500, headers: corsHeaders });
    }
  }
};
