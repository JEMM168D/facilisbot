#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { createBotInstance, loadConfig, saveConfig } from '../src/core/config.js';
import { getKnowledgeBase } from '../src/core/knowledge/search.js';
import { getBotEngine } from '../src/core/engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT_DIR, 'templates');

// Parse flags
const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    const nextArg = args[i + 1];
    if (nextArg && !nextArg.startsWith('--')) {
      flags[key] = nextArg;
      i++;
    } else {
      flags[key] = true;
    }
  } else if (!flags.name) {
    flags.name = arg;
  }
}

export async function createBotConversational(options = {}) {
  const bizName = options.business || options.name || flags.business || flags.name || 'Nuevo Negocio';
  const botName = options.botName || flags.botName || `Asistente ${bizName}`;
  const niche = (options.niche || flags.niche || 'starter').toLowerCase();
  const botId = options.botId || flags.botId || bizName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const services = options.services || flags.services || 'Consultoría, Atención personalizada, Cotizaciones y Reservas';
  const hours = options.hours || flags.hours || 'Lunes a Viernes de 9:00 AM a 6:00 PM';
  const location = options.location || flags.location || 'Atención en línea y presencial';
  const phone = options.phone || flags.phone || '+1 555-0100';
  const email = options.email || flags.email || `contacto@${botId}.com`;
  const personality = options.personality || flags.personality || 'cercano, servicial, profesional y conciso';
  const provider = options.provider || flags.provider || 'gemini';
  const model = options.model || flags.model || 'gemini-3.5-flash-lite';

  console.log(`\n\x1b[38;5;208m\x1b[1m⚡ Asistente de Creación de Bot · FacilisBot Agent Engine\x1b[0m`);
  console.log(`\x1b[90mCreando instancia aislada para: ${bizName} (ID: ${botId})...\x1b[0m\n`);

  // 1. Check if template exists for niche
  let templateConfig = {};
  const templateDir = path.join(TEMPLATES_DIR, niche);
  if (fs.existsSync(path.join(templateDir, 'bot.config.json'))) {
    try {
      templateConfig = JSON.parse(fs.readFileSync(path.join(templateDir, 'bot.config.json'), 'utf8'));
    } catch (e) {}
  }

  // 2. Build configuration
  const botConfig = Object.assign({}, templateConfig, {
    bot: {
      id: botId,
      name: botName,
      niche,
      language: 'es',
      personality,
      greeting: `¡Hola! Bienvenido a ${bizName}. ¿En qué te puedo ayudar hoy?`,
      fallbackMessage: 'Disculpa, ¿podrías darme más detalles de tu consulta?',
      escalationMessage: 'Un momento por favor, te transfiero con un asesor humano.'
    },
    business: {
      name: bizName,
      industry: niche,
      description: `${bizName} ofrece atención especializada en ${niche}.`,
      services,
      hours,
      location,
      phone,
      email,
      website: `https://${botId}.com`,
      paymentMethods: 'Efectivo, Tarjetas de débito/crédito, Transferencia bancaria'
    },
    llm: {
      provider,
      model,
      temperature: 0.4,
      maxTokens: 1000,
      systemPromptBonus: ''
    },
    channels: {
      web: {
        enabled: true,
        title: `Chat de ${bizName}`,
        subtitle: 'En línea 24/7',
        primaryColor: '#ff6a1f',
        position: 'bottom-right'
      },
      whatsapp: {
        enabled: false,
        verifyToken: `verify_${botId}`
      },
      telegram: {
        enabled: false
      }
    }
  });

  // 3. Create bot instance folder and config
  const instance = createBotInstance(botId, botConfig);

  // 4. Generate Knowledge Base Markdown Files
  // Copy template KB if available, or generate tailored files
  if (fs.existsSync(path.join(templateDir, 'kb'))) {
    const kbFiles = fs.readdirSync(path.join(templateDir, 'kb'));
    for (const file of kbFiles) {
      const src = path.join(templateDir, 'kb', file);
      const dest = path.join(instance.kbDir, file);
      fs.copyFileSync(src, dest);
    }
  }

  // Write/Update tailored servicios.md
  const serviciosMd = `# Catálogo Oficial de Servicios y Precios · ${bizName}

## Giro de Negocio
${niche.toUpperCase()}

## Oferta de Servicios
${services}

## Horarios de Atención
- ${hours}

## Ubicación y Contacto
- **Dirección / Modalidad:** ${location}
- **Teléfono / WhatsApp:** ${phone}
- **Correo Electrónico:** ${email}
- **Métodos de Pago:** Efectivo, Tarjeta, Transferencia.
`;
  fs.writeFileSync(path.join(instance.kbDir, 'servicios.md'), serviciosMd, 'utf8');

  // Write/Update tailored faq.md
  const faqMd = `# Preguntas Frecuentes (FAQ) · ${bizName}

### ¿Cómo puedo agendar una cita o servicio?
Para agendar, solo indícanos tu nombre completo, número de WhatsApp y la fecha/horario de tu preferencia. Nuestro asistente o un asesor confirmará tu turno.

### ¿Cuáles son las formas de pago?
Aceptamos pagos en efectivo, transferencias bancarias y tarjetas de crédito/débito.

### ¿Tienen atención personalizada o asesor humano?
Sí, en cualquier momento puedes solicitar hablar con una persona de nuestro equipo y transferiremos tu conversación de inmediato.
`;
  fs.writeFileSync(path.join(instance.kbDir, 'faq.md'), faqMd, 'utf8');

  // 5. Reload Knowledge Base and instantiate engine
  const kbInstance = getKnowledgeBase(botId);
  kbInstance.reload();

  const engine = getBotEngine(botId);

  // 6. Run automated verification simulation
  console.log(`\x1b[38;5;220m[Prueba de Simulación Automática]\x1b[0m`);
  const testRes = await engine.processMessage({
    channel: 'web',
    userId: 'agent_tester_1',
    userName: 'Tester IA',
    text: 'Hola, ¿cuál es su horario y qué servicios ofrecen?'
  });

  console.log(`\x1b[32m✓\x1b[0m \x1b[1mBot configurado y verificado exitosamente:\x1b[0m`);
  console.log(`  • \x1b[90mID del Bot:\x1b[0m       \x1b[36m${botId}\x1b[0m`);
  console.log(`  • \x1b[90mEmpresa:\x1b[0m          ${bizName}`);
  console.log(`  • \x1b[90mGiro:\x1b[0m             ${niche}`);
  console.log(`  • \x1b[90mModelo IA:\x1b[0m        ${provider} (${model})`);
  console.log(`  • \x1b[90mRespuesta Test:\x1b[0m   "${testRes.reply.slice(0, 100)}..."`);
  console.log(`  • \x1b[90mCarpeta:\x1b[0m          member/bots/${botId}/`);
  console.log(`\n\x1b[38;5;208mIntegración para el Cliente:\x1b[0m`);
  console.log(`  • \x1b[90mWidget Web:\x1b[0m      <script src="https://tu-dominio.com/widget/widget.js" data-bot-id="${botId}" async></script>`);
  console.log(`  • \x1b[90mWebhook WhatsApp:\x1b[0m https://tu-dominio.com/webhook/whatsapp/${botId}`);
  console.log(`  • \x1b[90mWebhook Telegram:\x1b[0m https://tu-dominio.com/webhook/telegram/${botId}\n`);

  return {
    success: true,
    botId,
    botConfig,
    testResponse: testRes.reply
  };
}

if (process.argv[1] && process.argv[1].endsWith('crear-bot.js')) {
  createBotConversational().catch(err => {
    console.error('Error en skill crear-bot:', err);
  });
}
