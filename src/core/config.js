// src/core/config.js

/**
 * Default configuration structure for FacilisBot
 */
export const DEFAULT_CONFIG = {
  bot: {
    id: 'default',
    name: 'Asistente Virtual',
    niche: 'starter',
    language: 'es',
    personality: 'cercano, servicial, profesional y conciso',
    greeting: '¡Hola! ¿En qué puedo ayudarte hoy?',
    fallbackMessage: 'Disculpa, no entendí bien. ¿Podrías explicármelo de otra manera?',
    escalationMessage: 'Un momento por favor, voy a transferir tu consulta a un miembro de nuestro equipo para que te atienda personalmente.'
  },
  business: {
    name: 'Mi Empresa',
    industry: 'Servicios',
    description: 'Ofrecemos soluciones personalizadas y atención de primera calidad a todos nuestros clientes.',
    services: 'Consultoría, Atención al cliente, Soporte, Ventas',
    hours: 'Lunes a Viernes de 9:00 AM - 6:00 PM',
    location: 'Atención online y presencial',
    phone: '+1 555-0199',
    email: 'contacto@miempresa.com',
    website: 'https://miempresa.com',
    paymentMethods: 'Efectivo, Tarjeta, Transferencia bancaria, Stripe, Mercado Pago',
    faq: []
  },
  llm: {
    provider: 'gemini', // 'gemini' | 'anthropic' | 'openai' | 'grok' | 'ollama' | 'mock'
    model: 'gemini-3.5-flash-lite',
    temperature: 0.4,
    maxTokens: 1000,
    systemPromptBonus: ''
  },
  channels: {
    whatsapp: {
      enabled: false,
      provider: 'cloud_api', // 'cloud_api' | 'twilio'
      phoneNumberId: '',
      accessToken: '',
      verifyToken: 'yunque_verify_token_123',
      twilioAccountSid: '',
      twilioAuthToken: '',
      twilioPhoneNumber: ''
    },
    telegram: {
      enabled: false,
      botToken: '',
      polling: false
    },
    instagram: {
      enabled: false,
      pageId: '',
      accessToken: '',
      verifyToken: 'yunque_meta_verify_123'
    },
    messenger: {
      enabled: false,
      pageId: '',
      accessToken: '',
      verifyToken: 'yunque_meta_verify_123'
    },
    web: {
      enabled: true,
      title: 'Chat de Atención',
      subtitle: 'En línea 24/7',
      primaryColor: '#ff6a1f',
      position: 'bottom-right'
    }
  },
  integrations: {
    calComApiKey: '',
    calComEventType: '',
    googleCalendarUrl: '',
    stripeApiKey: '',
    mercadoPagoToken: '',
    webhookUrl: '',
    humanEscalationAlertWebhook: ''
  },
  server: {
    port: 3000,
    adminPassword: 'admin123',
    baseUrl: 'http://localhost:3000'
  }
};

/**
 * Load and merge configuration from local file, bot directory, env vars, and defaults
 */
export async function loadConfig(botIdOrBaseDir = 'default', storage = null, baseDir = process.cwd()) {
  let botId = 'default';
  let actualBaseDir = baseDir;

  if (typeof botIdOrBaseDir === 'string' && (botIdOrBaseDir.includes('/') || botIdOrBaseDir.includes('\\') || botIdOrBaseDir.startsWith('.'))) {
    actualBaseDir = botIdOrBaseDir;
  } else if (typeof botIdOrBaseDir === 'string') {
    botId = botIdOrBaseDir;
  }

  let config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  config.bot.id = botId;

  if (storage) {
    const storedConfig = await storage.getConfig(botId);
    if (storedConfig) {
      config = deepMerge(config, storedConfig);
      if (!config.bot.id) config.bot.id = botId;
    }
  } else {
    const fs = await import('fs');
    const path = await import('path');
    
    // Paths to try
    const configPaths = [];

    if (botId && botId !== 'default') {
      configPaths.push(path.join(actualBaseDir, 'member', 'bots', botId, 'config.json'));
      configPaths.push(path.join(actualBaseDir, 'member', 'bots', botId, 'config.local.json'));
    }

    configPaths.push(path.join(actualBaseDir, 'member', 'config.local.json'));
    configPaths.push(path.join(actualBaseDir, 'bot.config.json'));
    configPaths.push(path.join(actualBaseDir, 'config.json'));

    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        try {
          const raw = fs.readFileSync(configPath, 'utf8');
          const parsed = JSON.parse(raw);
          config = deepMerge(config, parsed);
          if (!config.bot.id) config.bot.id = botId;
          break;
        } catch (err) {
          console.warn(`[Config] Advertencia al leer ${configPath}:`, err.message);
        }
      }
    }
    
    // Override with environment variables if present
    if (typeof process !== 'undefined' && process.env) {
      if (process.env.BOT_NAME && botId === 'default') config.bot.name = process.env.BOT_NAME;
      if (process.env.BOT_NICHE && botId === 'default') config.bot.niche = process.env.BOT_NICHE;
      if (process.env.LLM_PROVIDER) config.llm.provider = process.env.LLM_PROVIDER;
      if (process.env.LLM_MODEL) config.llm.model = process.env.LLM_MODEL;
      if (process.env.GEMINI_API_KEY) config.llm.geminiApiKey = process.env.GEMINI_API_KEY;
      if (process.env.ANTHROPIC_API_KEY) config.llm.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
      if (process.env.OPENAI_API_KEY) config.llm.openaiApiKey = process.env.OPENAI_API_KEY;
      if (process.env.GROK_API_KEY || process.env.XAI_API_KEY) config.llm.grokApiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
      if (process.env.TELEGRAM_BOT_TOKEN && botId === 'default') {
        config.channels.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN;
        config.channels.telegram.enabled = true;
      }
      if (process.env.WHATSAPP_TOKEN && botId === 'default') {
        config.channels.whatsapp.accessToken = process.env.WHATSAPP_TOKEN;
        config.channels.whatsapp.enabled = true;
      }
      if (process.env.ADMIN_PASSWORD) config.server.adminPassword = process.env.ADMIN_PASSWORD;
      if (process.env.PORT) config.server.port = parseInt(process.env.PORT, 10);
    }
  }

  return config;
}

/**
 * List all registered bots in the system
 */
export async function listBots(storage = null, baseDir = process.cwd()) {
  if (storage) {
    return await storage.listBots();
  }

  const fs = await import('fs');
  const path = await import('path');
  
  const bots = [];

  // Default bot
  const defaultConfig = await loadConfig('default', null, baseDir);
  bots.push({
    id: 'default',
    name: defaultConfig.bot?.name || 'Asistente Principal',
    niche: defaultConfig.bot?.niche || 'starter',
    businessName: defaultConfig.business?.name || 'Mi Empresa',
    llmProvider: defaultConfig.llm?.provider || 'gemini',
    llmModel: defaultConfig.llm?.model || 'gemini-3.5-flash-lite'
  });

  // Additional bots in member/bots/
  const botsDir = path.join(baseDir, 'member', 'bots');
  if (fs.existsSync(botsDir)) {
    const entries = fs.readdirSync(botsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const botId = entry.name;
        const cfgPath = path.join(botsDir, botId, 'config.json');
        if (fs.existsSync(cfgPath)) {
          try {
            const raw = fs.readFileSync(cfgPath, 'utf8');
            const cfg = JSON.parse(raw);
            bots.push({
              id: botId,
              name: cfg.bot?.name || botId,
              niche: cfg.bot?.niche || 'starter',
              businessName: cfg.business?.name || botId,
              llmProvider: cfg.llm?.provider || 'gemini',
              llmModel: cfg.llm?.model || 'gemini-3.5-flash-lite'
            });
          } catch (e) {
            // Ignore unparseable
          }
        }
      }
    }
  }

  return bots;
}

/**
 * Create a new tenant bot instance with isolated config and KB
 */
export async function createBotInstance(botId, customConfig = {}, storage = null, baseDir = process.cwd()) {
  const cleanId = botId.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const fullConfig = deepMerge(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), customConfig);
  fullConfig.bot.id = cleanId;

  if (storage) {
    await storage.createBot(cleanId, fullConfig);
    return {
      botId: cleanId,
      config: fullConfig
    };
  }

  const fs = await import('fs');
  const path = await import('path');

  const botDir = path.join(baseDir, 'member', 'bots', cleanId);
  const kbDir = path.join(botDir, 'kb');

  fs.mkdirSync(kbDir, { recursive: true });
  fs.writeFileSync(path.join(botDir, 'config.json'), JSON.stringify(fullConfig, null, 2), 'utf8');

  return {
    botId: cleanId,
    botDir,
    kbDir,
    config: fullConfig
  };
}

/**
 * Save configuration to file or storage
 */
export async function saveConfig(newConfig, storage = null, targetFile = null, baseDir = process.cwd()) {
  const botId = newConfig.bot?.id || 'default';

  if (storage) {
    await storage.saveConfig(botId, newConfig);
    return botId;
  }

  const fs = await import('fs');
  const path = await import('path');
  
  let fileToSave = targetFile;
  
  if (!fileToSave) {
    if (botId && botId !== 'default') {
      fileToSave = path.join(baseDir, 'member', 'bots', botId, 'config.json');
    } else {
      fileToSave = path.join(baseDir, 'member', 'config.local.json');
    }
  }

  const dir = path.dirname(fileToSave);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fileToSave, JSON.stringify(newConfig, null, 2), 'utf8');
  return fileToSave;
}

export function deepMerge(target, source) {
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
