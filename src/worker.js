/**
 * Cloudflare Workers Entrypoint Adapter for FacilisBot
 * Handles Edge routing, Webhooks, Multi-tenant bots, RAG Search, and Multi-LLM inference.
 */
import { getBotEngine, BotEngine } from './core/engine.js';
import { loadConfig } from './core/config.js';
import { db } from './core/storage/db.js';
import { WhatsAppHandler } from './core/channels/whatsapp.js';
import { TelegramHandler } from './core/channels/telegram.js';
import { MetaDMsHandler } from './core/channels/meta.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const reqBotId = url.searchParams.get('bot_id') || request.headers.get('x-bot-id') || 'default';

    // Merge Cloudflare env vars into config
    const config = loadConfig(reqBotId);
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-bot-id'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // 1. Health check
      if (pathname === '/health' || pathname === '/api/health') {
        return Response.json({
          status: 'ok',
          bot: config.bot?.name,
          botId: reqBotId,
          version: '1.0.0'
        }, { headers: corsHeaders });
      }

      // 2. Chat API for Web Widget (Multi-Tenant)
      if (pathname === '/api/chat' && request.method === 'POST') {
        const body = await request.json();
        const targetBotId = body.botId || reqBotId || 'default';
        const engine = getBotEngine(targetBotId);

        const response = await engine.processMessage({
          channel: 'web',
          userId: body.sessionId || 'web_user_' + Date.now(),
          userName: body.userName || 'Visitante Web',
          text: body.message || ''
        });
        return Response.json(response, { headers: corsHeaders });
      }

      // 3. Webhooks: WhatsApp Cloud API
      if (pathname === '/webhook/whatsapp' || pathname.startsWith('/webhook/whatsapp/')) {
        const webhookBotId = pathname.startsWith('/webhook/whatsapp/') ? pathname.split('/')[3] : reqBotId;
        const botCfg = loadConfig(webhookBotId);
        if (env.GEMINI_API_KEY) botCfg.llm.geminiApiKey = env.GEMINI_API_KEY;

        if (request.method === 'GET') {
          const verification = WhatsAppHandler.handleVerification(request.url, botCfg);
          return new Response(verification.body, { status: verification.status, headers: { 'Content-Type': 'text/plain' } });
        }
        if (request.method === 'POST') {
          const body = await request.json();
          const result = await WhatsAppHandler.handleCloudApiWebhook(body, botCfg);
          return Response.json(result, { status: result.status, headers: corsHeaders });
        }
      }

      // 4. Webhooks: Telegram
      if ((pathname === '/webhook/telegram' || pathname.startsWith('/webhook/telegram/')) && request.method === 'POST') {
        const webhookBotId = pathname.startsWith('/webhook/telegram/') ? pathname.split('/')[3] : reqBotId;
        const botCfg = loadConfig(webhookBotId);
        const update = await request.json();
        const result = await TelegramHandler.handleWebhook(update, botCfg);
        return Response.json(result, { status: result.status, headers: corsHeaders });
      }

      // 5. Overview Metrics
      if (pathname === '/api/overview') {
        const metrics = db.getOverviewMetrics();
        return Response.json({
          bot: config.bot,
          business: config.business,
          metrics
        }, { headers: corsHeaders });
      }

      return Response.json({ error: 'Ruta no encontrada', pathname }, { status: 404, headers: corsHeaders });

    } catch (err) {
      return Response.json({ error: 'Worker error', message: err.message }, { status: 500, headers: corsHeaders });
    }
  }
};
