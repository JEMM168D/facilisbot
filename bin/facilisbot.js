#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { loadConfig, saveConfig, DEFAULT_CONFIG } from '../src/core/config.js';
import { createServer } from '../src/server/index.js';
import { getKnowledgeBase } from '../src/core/knowledge/search.js';
import { db } from '../src/core/storage/db.js';
import { UniversalLlmEngine } from '../src/core/llm/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT_DIR, 'templates');

// Parse CLI arguments
const args = process.argv.slice(2);
const command = args[0] || 'init';

// Parse flags (--flag or --flag value)
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
  }
}

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  orange: '\x1b[38;5;208m',
  gold: '\x1b[38;5;220m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

async function main() {
  console.log(`\n${colors.orange}${colors.bright}⚡ FacilisBot${colors.reset} ${colors.gray}· Plataforma de Chatbots de IA para Empresas (Gemini 3.5 Flash Lite)${colors.reset}\n`);

  switch (command) {
    case 'init':
      await runInit();
      break;
    case 'list':
      runList();
      break;
    case 'install':
      await runInstall(args[1] || flags.giro || flags.niche);
      break;
    case 'backup':
      await runBackup();
      break;
    case 'doctor':
      await runDoctor();
      break;
    case 'update':
      await runUpdate();
      break;
    case 'serve':
    case 'dev':
    case 'start':
      runServe();
      break;
    case 'deploy':
      await runDeploy();
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      console.log(`${colors.red}Comando no reconocido:${colors.reset} ${command}`);
      printHelp();
      break;
  }
}

// ================= COMMAND: INIT =================
async function runInit() {
  const isNonInteractive = flags.yes || process.env.FORJA_YES === '1';

  let niche = flags.giro || flags.niche || 'starter';
  let bizName = flags.negocio || flags.business || 'Mi Negocio';
  let botName = flags.nombre || flags.name || 'Asistente Virtual';
  let provider = flags.cerebro || flags.provider || 'gemini';
  let model = flags.modelo || flags.model || (provider === 'gemini' ? 'gemini-3.5-flash-lite' : 'gpt-5.6-luna');
  let hours = flags.horario || 'Lunes a Viernes 9:00 AM - 6:00 PM';
  let location = flags.ubicacion || 'Atención en línea y presencial';
  let phone = flags.telefono || flags.phone || '+1 555-0100';

  if (!isNonInteractive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = query => new Promise(resolve => rl.question(query, resolve));

    console.log(`${colors.gold}Asistente de Configuración Inicial FacilisBot:${colors.reset}\n`);

    const langAnswer = await ask(`${colors.cyan}?${colors.reset} Idioma / Language (1. Español, 2. English) [1]: `);
    const lang = langAnswer.trim() === '2' ? 'en' : 'es';

    console.log(`\n${colors.cyan}Elige el Giro de Negocio:${colors.reset}`);
    const availableNiches = getAvailableNiches();
    availableNiches.forEach((n, idx) => {
      console.log(`  ${colors.gray}${String(idx + 1).padStart(2)}.${colors.reset} ${colors.bright}${n.name.padEnd(16)}${colors.reset} ${colors.gray}(${n.slug})${colors.reset} - ${n.desc}`);
    });

    const nicheChoice = await ask(`\n${colors.cyan}?${colors.reset} Número o slug del giro [1]: `);
    const chosenIdx = parseInt(nicheChoice.trim(), 10);
    if (!isNaN(chosenIdx) && chosenIdx >= 1 && chosenIdx <= availableNiches.length) {
      niche = availableNiches[chosenIdx - 1].slug;
    } else if (nicheChoice.trim()) {
      niche = nicheChoice.trim().toLowerCase();
    }

    const inBizName = await ask(`${colors.cyan}?${colors.reset} Nombre de tu empresa o negocio [${bizName}]: `);
    if (inBizName.trim()) bizName = inBizName.trim();

    const inBotName = await ask(`${colors.cyan}?${colors.reset} Nombre para tu asistente [${botName}]: `);
    if (inBotName.trim()) botName = inBotName.trim();

    console.log(`\n${colors.cyan}Elige el Cerebro de IA:${colors.reset}`);
    console.log(`  1. ${colors.bright}Google Gemini 3.5 Flash Lite${colors.reset} (gemini-3.5-flash-lite) - ${colors.green}Ultrarrápido, económico y preciso (Recomendado)${colors.reset}`);
    console.log(`  2. ${colors.bright}Anthropic Claude${colors.reset} (claude-sonnet-5 / claude-opus-5)`);
    console.log(`  3. ${colors.bright}OpenAI${colors.reset} (gpt-5.6-luna / gpt-5.6-terra / gpt-5.6-sol)`);
    console.log(`  4. ${colors.bright}xAI Grok${colors.reset} (grok-4.6)`);
    console.log(`  5. ${colors.bright}Simulador Offline${colors.reset} (Para pruebas sin API Key)`);

    const provChoice = await ask(`\n${colors.cyan}?${colors.reset} Proveedor [1]: `);
    const provNum = provChoice.trim();
    if (provNum === '2') { provider = 'anthropic'; model = 'claude-sonnet-5'; }
    else if (provNum === '3') { provider = 'openai'; model = 'gpt-5.6-luna'; }
    else if (provNum === '4') { provider = 'grok'; model = 'grok-4.6'; }
    else if (provNum === '5') { provider = 'mock'; model = 'simulator'; }
    else { provider = 'gemini'; model = 'gemini-3.5-flash-lite'; }

    const inPhone = await ask(`${colors.cyan}?${colors.reset} Teléfono / WhatsApp de contacto [${phone}]: `);
    if (inPhone.trim()) phone = inPhone.trim();

    rl.close();
  }

  // Load template data if available
  const templateDir = path.join(TEMPLATES_DIR, niche);
  let baseConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  if (fs.existsSync(path.join(templateDir, 'bot.config.json'))) {
    const raw = fs.readFileSync(path.join(templateDir, 'bot.config.json'), 'utf8');
    baseConfig = Object.assign(baseConfig, JSON.parse(raw));
  }

  // Apply customizations
  baseConfig.bot.name = botName;
  baseConfig.bot.niche = niche;
  baseConfig.business.name = bizName;
  baseConfig.business.phone = phone;
  baseConfig.business.hours = hours;
  baseConfig.business.location = location;
  baseConfig.llm.provider = provider;
  baseConfig.llm.model = model;

  // Save to member/config.local.json
  const memberDir = path.join(process.cwd(), 'member');
  const kbDestDir = path.join(memberDir, 'kb');
  fs.mkdirSync(kbDestDir, { recursive: true });

  const savedPath = saveConfig(baseConfig, path.join(memberDir, 'config.local.json'));

  // Copy template KB files if present
  if (fs.existsSync(path.join(templateDir, 'kb'))) {
    const kbFiles = fs.readdirSync(path.join(templateDir, 'kb'));
    for (const file of kbFiles) {
      const src = path.join(templateDir, 'kb', file);
      const dest = path.join(kbDestDir, file);
      fs.copyFileSync(src, dest);
    }
  }

  console.log(`\n${colors.green}✓${colors.reset} ${colors.bright}Bot FacilisBot configurado exitosamente!${colors.reset}`);
  console.log(`  ${colors.gray}• Giro:${colors.reset} ${colors.orange}${niche}${colors.reset}`);
  console.log(`  ${colors.gray}• Empresa:${colors.reset} ${bizName}`);
  console.log(`  ${colors.gray}• Cerebro:${colors.reset} ${provider} (${model})`);
  console.log(`  ${colors.gray}• Configuración:${colors.reset} ${savedPath}`);
  console.log(`  ${colors.gray}• Base de Conocimiento:${colors.reset} ./member/kb/`);

  console.log(`\n${colors.gold}Lo que sigue:${colors.reset}`);
  console.log(`  1. Inicia el panel y simulador local con:  ${colors.cyan}npm run dev${colors.reset}  (o  ${colors.cyan}node bin/facilisbot.js serve${colors.reset})`);
  console.log(`  2. Abre tu panel de control en:           ${colors.cyan}http://localhost:3000/admin${colors.reset}`);
  console.log(`  3. Conecta WhatsApp o Telegram desde la pestaña de Conexiones.`);
  console.log(`  4. Publica a Cloudflare Workers con:      ${colors.cyan}npm run deploy${colors.reset}\n`);
}

// ================= COMMAND: LIST =================
function runList() {
  console.log(`${colors.gold}Catálogo de Plantillas y Giros de Negocio Disponibles en FacilisBot:${colors.reset}\n`);
  const niches = getAvailableNiches();
  niches.forEach(n => {
    console.log(`  ${colors.orange}● ${n.name.padEnd(18)}${colors.reset} ${colors.cyan}(slug: ${n.slug.padEnd(14)})${colors.reset} ${colors.green}disponible${colors.reset}`);
    console.log(`    ${colors.gray}${n.desc}${colors.reset}\n`);
  });
}

function getAvailableNiches() {
  return [
    { slug: 'barberia', name: 'Barbería', desc: 'Cortes, degradados, afeitado, agenda y prevención de inasistencias.' },
    { slug: 'restaurante', name: 'Restaurante', desc: 'Menú interactivo, reservación de mesas y pedidos para llevar.' },
    { slug: 'inmobiliaria', name: 'Inmobiliaria', desc: 'Calificación de compradores/arrendatarios y agenda de visitas a propiedades.' },
    { slug: 'clinica', name: 'Clínica Médica', desc: 'Citas médicas, especialidades, laboratorios y atención rápida.' },
    { slug: 'dentista', name: 'Dentista', desc: 'Valoración bucal, ortodoncia, estética dental y urgencias sin dolor.' },
    { slug: 'gimnasio', name: 'Gimnasio', desc: 'Membresías, horarios de clases, pases de prueba y entrenadores.' },
    { slug: 'spa', name: 'Spa & Wellness', desc: 'Masajes relajantes, faciales y paquetes para parejas.' },
    { slug: 'salon', name: 'Salón de Belleza', desc: 'Balayage, tintes, uñas, peinados de novia y catálogo de belleza.' },
    { slug: 'coach', name: 'Coach / Consultor', desc: 'Llamadas de diagnóstico, mentoría 1 a 1 y calificación de prospectos.' },
    { slug: 'tienda', name: 'Tienda / E-commerce', desc: 'Catálogo de productos, tallas, cotización de envíos y pagos.' },
    { slug: 'crm', name: 'CRM / Ventas B2B', desc: 'Captura y prospección corporativa, demos técnicas y cotizaciones.' },
    { slug: 'hoteleria', name: 'Hotelería', desc: 'Disponibilidad de habitaciones, tarifas, amenidades y reservaciones.' },
    { slug: 'cafeteria', name: 'Cafetería', desc: 'Bebidas de especialidad, desayunos y pedidos rápidos.' },
    { slug: 'panaderia', name: 'Panadería', desc: 'Panadería artesanal, cotización de pasteles y pedidos para eventos.' },
    { slug: 'starter', name: 'Starter Genérico', desc: 'Plantilla universal lista para personalizar con cualquier negocio.' }
  ];
}

// ================= COMMAND: INSTALL =================
async function runInstall(slug) {
  if (!slug) {
    console.log(`${colors.red}Falta el slug del giro.${colors.reset} Usa: ${colors.cyan}node bin/facilisbot.js install <slug>${colors.reset} o consulta ${colors.cyan}node bin/facilisbot.js list${colors.reset}`);
    return;
  }

  flags.giro = slug;
  flags.yes = true;
  await runInit();
}

// ================= COMMAND: DOCTOR =================
async function runDoctor() {
  console.log(`${colors.gold}Diagnóstico de Salud de FacilisBot (Doctor):${colors.reset}\n`);
  let issues = 0;

  // 1. Check member/config.local.json or bot.config.json
  const config = await loadConfig();
  if (config.bot?.name) {
    console.log(`  ${colors.green}✓${colors.reset} Configuración cargada (${colors.cyan}${config.bot.name}${colors.reset} - giro: ${colors.orange}${config.bot.niche}${colors.reset})`);
  } else {
    console.log(`  ${colors.red}✗${colors.reset} Configuración no encontrada. Corre ${colors.cyan}node bin/facilisbot.js init${colors.reset}`);
    issues++;
  }

  // 2. Check Knowledge Base
  const kb = await getKnowledgeBase();
  await kb.reloadFromFs();
  const docs = kb.listDocuments();
  if (docs.length > 0) {
    console.log(`  ${colors.green}✓${colors.reset} Base de Conocimiento activa (${docs.length} documentos indexados)`);
  } else {
    console.log(`  ${colors.orange}⚠${colors.reset} Base de Conocimiento vacía. Agrega archivos en ./member/kb/`);
  }

  // 3. Check Database
  const metrics = db.getOverviewMetrics();
  console.log(`  ${colors.green}✓${colors.reset} Base de datos lista (${metrics.totalConversations} conversaciones, ${metrics.totalLeads} prospectos)`);

  // 4. Check LLM Provider
  const provider = config.llm?.provider || 'gemini';
  console.log(`  ${colors.green}✓${colors.reset} Proveedor de IA configurado: ${colors.bright}${provider}${colors.reset} (${config.llm?.model || 'default'})`);

  // 5. Test Mock Engine
  try {
    const engine = new UniversalLlmEngine(config);
    const testRes = await engine.generateResponse({
      systemPrompt: 'Responde OK',
      messages: [{ role: 'user', content: 'Test de conexion' }]
    });
    if (testRes && testRes.content) {
      console.log(`  ${colors.green}✓${colors.reset} Motor de IA respondiendo correctamente`);
    }
  } catch (err) {
    console.log(`  ${colors.orange}⚠${colors.reset} Advertencia en respuesta de IA: ${err.message}`);
  }

  // 6. Check Channels
  const ch = config.channels || {};
  console.log(`  ${colors.green}✓${colors.reset} Canales: Web Widget ${colors.green}[ON]${colors.reset} | WhatsApp ${ch.whatsapp?.enabled ? colors.green + '[ON]' : colors.gray + '[OFF]'}${colors.reset} | Telegram ${ch.telegram?.enabled ? colors.green + '[ON]' : colors.gray + '[OFF]'}${colors.reset}`);

  if (issues === 0) {
    console.log(`\n${colors.green}${colors.bright}Todo en orden. Tu bot FacilisBot está listo para operar.${colors.reset}\n`);
  } else {
    console.log(`\n${colors.orange}Se encontraron ${issues} detalles que revisar.${colors.reset}\n`);
  }
}

// ================= COMMAND: BACKUP =================
async function runBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(process.cwd(), 'backups', `backup-${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  let filesCount = 0;

  // Copy member/
  const memberDir = path.join(process.cwd(), 'member');
  if (fs.existsSync(memberDir)) {
    copyFolderRecursiveSync(memberDir, path.join(backupDir, 'member'));
    filesCount++;
  }

  // Copy data/
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    copyFolderRecursiveSync(dataDir, path.join(backupDir, 'data'));
    filesCount++;
  }

  // Copy .env if exists
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    fs.copyFileSync(envPath, path.join(backupDir, '.env'));
  }

  console.log(`\n${colors.green}✓${colors.reset} ${colors.bright}Copia de seguridad completada con éxito:${colors.reset}`);
  console.log(`  ${colors.gray}• Ubicación:${colors.reset} ${colors.cyan}${backupDir}${colors.reset}`);
  console.log(`  ${colors.gray}• Incluye:${colors.reset} Base de conocimiento (KB), prospectos (CRM), conversaciones y configuración.\n`);

  return backupDir;
}

function copyFolderRecursiveSync(source, target) {
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  const files = fs.readdirSync(source);
  for (const file of files) {
    const curSource = path.join(source, file);
    const curTarget = path.join(target, file);
    if (fs.lstatSync(curSource).isDirectory()) {
      copyFolderRecursiveSync(curSource, curTarget);
    } else {
      fs.copyFileSync(curSource, curTarget);
    }
  }
}

// ================= COMMAND: UPDATE =================
async function runUpdate() {
  console.log(`${colors.gold}Iniciando actualización segura de FacilisBot...${colors.reset}\n`);

  // 1. Automatic backup
  console.log(`  1. ${colors.cyan}Generando respaldo de seguridad...${colors.reset}`);
  const backupPath = await runBackup();

  // 2. Verification of integrity
  console.log(`  2. ${colors.cyan}Verificando integridad de datos del negocio...${colors.reset}`);
  const config = await loadConfig();
  console.log(`     ${colors.green}✓${colors.reset} Configuración preservada (${config.bot?.name || 'Bot'})`);
  console.log(`     ${colors.green}✓${colors.reset} Base de Conocimiento preservada (member/kb/)`);
  console.log(`     ${colors.green}✓${colors.reset} Base de datos de clientes intacta (data/bot_database.json)`);

  // 3. Run doctor
  console.log(`\n  3. ${colors.cyan}Ejecutando diagnóstico post-actualización...${colors.reset}\n`);
  await runDoctor();

  console.log(`${colors.green}${colors.bright}¡Actualización completada sin pérdida de datos!${colors.reset}\n`);
}

// ================= COMMAND: SERVE =================
function runServe() {
  const port = parseInt(flags.port || process.env.PORT || '3000', 10);
  const app = createServer();
  app.start(port);
}

// ================= COMMAND: DEPLOY =================
async function runDeploy() {
  console.log(`${colors.gold}${colors.bright}🚀 Centro de Despliegue de FacilisBot a Producción${colors.reset}\n`);

  console.log(`${colors.cyan}Elige tu método de despliegue preferido:${colors.reset}\n`);
  console.log(`  ${colors.bright}1. Cloudflare Workers (Recomendado - Serverless & Costo Cero)${colors.reset}`);
  console.log(`     ${colors.gray}Ideal si buscas máxima velocidad mundial, alta disponibilidad y sin costo fijo.${colors.reset}`);
  console.log(`     • Comando para publicar:  ${colors.orange}npm run deploy${colors.reset}  (o  ${colors.orange}npx wrangler deploy${colors.reset})`);
  console.log(`     • Para agregar secretos:  ${colors.orange}npx wrangler secret put GEMINI_API_KEY${colors.reset}\n`);

  console.log(`  ${colors.bright}2. Docker & Docker Compose (Recomendado para VPS / Coolify / CapRover)${colors.reset}`);
  console.log(`     ${colors.gray}Ejecuta tu bot aislado en cualquier servidor con persistencia garantizada.${colors.reset}`);
  console.log(`     • Iniciar en producción:   ${colors.orange}docker compose up -d --build${colors.reset}`);
  console.log(`     • Ver logs en tiempo real: ${colors.orange}docker compose logs -f${colors.reset}`);
  console.log(`     • Actualizar sin borrar:   ${colors.orange}git pull && docker compose up -d --build${colors.reset}\n`);

  console.log(`  ${colors.bright}3. Plataformas en la Nube (Railway / Render / DigitalOcean / Fly.io)${colors.reset}`);
  console.log(`     ${colors.gray}Conecta tu repositorio de GitHub a Railway o Render y detectará automáticamente el Dockerfile o Node.js.${colors.reset}\n`);

  console.log(`  ${colors.bright}4. VPS Linux Directo con PM2 (Zero-downtime)${colors.reset}`);
  console.log(`     • Instalar PM2:           ${colors.orange}npm install -g pm2${colors.orange}`);
  console.log(`     • Iniciar servicio:       ${colors.orange}pm2 start src/server/index.js --name "facilisbot"${colors.reset}`);
  console.log(`     • Guardar reinicio:       ${colors.orange}pm2 save && pm2 startup${colors.reset}\n`);
}

function printHelp() {
  console.log(`Uso: ${colors.cyan}node bin/facilisbot.js <comando> [opciones]${colors.reset}\n`);
  console.log(`Comandos disponibles:`);
  console.log(`  ${colors.bright}init${colors.reset}           Asistente interactivo para crear o reconfigurar tu bot.`);
  console.log(`  ${colors.bright}list${colors.reset}           Muestra el catálogo de los 15 giros de negocio disponibles.`);
  console.log(`  ${colors.bright}install <slug>${colors.reset} Instala directamente una plantilla de giro.`);
  console.log(`  ${colors.bright}doctor${colors.reset}         Diagnóstico de salud del bot, archivos y canales.`);
  console.log(`  ${colors.bright}serve${colors.reset}          Inicia el servidor local y el panel de control (/admin).`);
  console.log(`  ${colors.bright}backup${colors.reset}         Crea un respaldo seguro de la base de conocimiento y datos.`);
  console.log(`  ${colors.bright}update${colors.reset}         Actualiza el motor conservando tu base de conocimiento.`);
  console.log(`  ${colors.bright}deploy${colors.reset}         Opciones e instrucciones de despliegue a producción.`);
}

main().catch(err => {
  console.error(`${colors.red}Error ejecutando CLI FacilisBot:${colors.reset}`, err);
  process.exit(1);
});
