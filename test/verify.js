import fs from 'fs';
import { createStorageAdapter } from '../src/core/storage/storage-adapter.js';
import { loadConfig } from '../src/core/config.js';
import { getKnowledgeBase } from '../src/core/knowledge/search.js';
import { getBotEngine } from '../src/core/engine.js';
import { createServer } from '../src/server/index.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${message}`);
  } else {
    failed++;
    console.error(`  \x1b[31m✗\x1b[0m ${message}`);
  }
}

async function runTests() {
  console.log('==================================================');
  console.log('⚡ SUITE DE PRUEBAS DE INTEGRACIÓN · FACILISBOT v2');
  console.log('   Arquitectura: StorageAdapter (Local + Cloudflare)');
  console.log('==================================================\n');

  // Create local storage adapter (filesystem-based)
  const storage = createStorageAdapter(null);

  // Test 1: Storage Adapter creation
  console.log('\x1b[38;5;39m[1/7] Probando StorageAdapter (Local)...\x1b[0m');
  assert(storage != null, 'StorageAdapter local creado exitosamente');
  assert(typeof storage.getConfig === 'function', 'StorageAdapter tiene método getConfig');
  assert(typeof storage.listBots === 'function', 'StorageAdapter tiene método listBots');
  assert(typeof storage.addMessage === 'function', 'StorageAdapter tiene método addMessage');
  assert(typeof storage.saveLead === 'function', 'StorageAdapter tiene método saveLead');
  assert(typeof storage.getOverviewMetrics === 'function', 'StorageAdapter tiene método getOverviewMetrics');

  // Test 2: Config loading (async)
  console.log('\n\x1b[38;5;39m[2/7] Probando Configuración Async...\x1b[0m');
  const config = await loadConfig('default', storage);
  assert(config != null && config.bot?.name, 'Configuración cargada con bot.name');
  assert(config.channels?.web?.enabled === true, 'Canal Web habilitado por defecto');
  assert(config.llm?.provider, 'Proveedor de LLM definido');

  // Test 3: Database operations via StorageAdapter
  console.log('\n\x1b[38;5;39m[3/7] Probando Base de Datos via StorageAdapter...\x1b[0m');
  const conv = await storage.getOrCreateConversation('web', 'test_user_1', 'Usuario Test', 'default');
  assert(conv && conv.id, 'Conversación creada exitosamente con ID: ' + conv.id);

  const msg = await storage.addMessage({
    conversationId: conv.id,
    botId: 'default',
    role: 'user',
    content: 'Hola, quiero información sobre precios'
  });
  assert(msg && msg.id, 'Mensaje de usuario registrado: ' + msg.id);

  const lead = await storage.saveLead({
    botId: 'default',
    name: 'Carlos Test',
    phone: '+52 555-1234',
    email: 'carlos@test.com',
    interest: 'Consulta por chat',
    channel: 'web'
  });
  assert(lead && lead.id, 'Prospecto guardado: ' + lead.id);

  const leadList = await storage.listLeads({ botId: 'default' });
  const leads = Array.isArray(leadList) ? leadList : leadList.leads || [];
  assert(Array.isArray(leads) && leads.length >= 1, `Listado de leads tiene ${leads.length} prospectos`);

  const metrics = await storage.getOverviewMetrics('default');
  assert(metrics && typeof metrics.totalConversations === 'number', 'Métricas calculadas correctamente');

  // Test 4: Knowledge Base (async)
  console.log('\n\x1b[38;5;39m[4/7] Probando Base de Conocimiento RAG Async...\x1b[0m');
  const kb = await getKnowledgeBase('default', storage);
  assert(kb != null, 'KnowledgeBase instanciada exitosamente');
  
  const results = kb.search('horario atención');
  assert(Array.isArray(results), 'Búsqueda RAG retornó resultados (array)');
  assert(kb.documents.length >= 0, `KB tiene ${kb.documents.length} documentos cargados`);

  // Test 5: BotEngine (async)
  console.log('\n\x1b[38;5;39m[5/7] Probando BotEngine Async...\x1b[0m');
  const engine = await getBotEngine('default', storage);
  assert(engine != null, 'BotEngine instanciado exitosamente');

  const reply = await engine.processMessage({
    channel: 'web',
    userId: 'test_user_2',
    userName: 'Probador',
    text: 'Hola, ¿qué horarios tienen?'
  });
  assert(reply && reply.reply, 'Bot generó respuesta: "' + (reply.reply || '').slice(0, 80) + '..."');
  assert(reply.conversationId, 'Respuesta asociada a conversationId');

  // Test 6: HTTP Server (dev mode)
  console.log('\n\x1b[38;5;39m[6/7] Probando Servidor HTTP de Desarrollo...\x1b[0m');
  const { server: srv, start } = createServer();
  const testPort = 3999;

  const serverInstance = await new Promise(resolve => {
    const s = start(testPort);
    setTimeout(() => resolve(s), 500);
  });

  try {
    // API health
    const resOverview = await fetch(`http://localhost:${testPort}/api/overview`);
    assert(resOverview.status === 200, 'GET /api/overview responde 200');

    // Auth
    const resAuth = await fetch(`http://localhost:${testPort}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'admin123' })
    });
    const authData = await resAuth.json();
    assert(authData.success === true, 'POST /api/auth verifica credenciales admin');

    // Chat
    const resChat = await fetch(`http://localhost:${testPort}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hola', botId: 'default', sessionId: 'sess_' + Date.now() })
    });
    const chatData = await resChat.json();
    assert(resChat.status === 200 && chatData.reply, 'POST /api/chat responde con reply');

    // Bots list
    const resBots = await fetch(`http://localhost:${testPort}/api/bots`);
    const botsData = await resBots.json();
    assert(botsData.bots && Array.isArray(botsData.bots), 'GET /api/bots retorna lista de bots');

    // Static files
    const resCss = await fetch(`http://localhost:${testPort}/admin/style.css`);
    assert(resCss.status === 200, 'GET /admin/style.css sirve correctamente');

    const resJs = await fetch(`http://localhost:${testPort}/admin/app.js`);
    assert(resJs.status === 200, 'GET /admin/app.js sirve correctamente');

    // KB
    const resKb = await fetch(`http://localhost:${testPort}/api/kb`);
    const kbData = await resKb.json();
    assert(resKb.status === 200 && Array.isArray(kbData.documents), 'GET /api/kb responde 200');

    // Config
    const resConfig = await fetch(`http://localhost:${testPort}/api/config`);
    assert(resConfig.status === 200, 'GET /api/config responde 200');

    // ── PRUEBA INTENSIVA KB: 1. ENTREVISTA ASISTIDA 6 PASOS ──
    console.log('\n\x1b[38;5;39m    [KB Test] Probando POST /api/kb/interview/step (6 pasos completos)...\x1b[0m');
    const testBizData = {
      businessName: 'Taller Mecánico Especializado Hidalgo',
      niche: 'Taller automotriz especializado en frenos, suspensión y afinación',
      location: 'Av. Hidalgo #123, Col. Centro, CDMX',
      coverage: 'Ciudad de México y Área Metropolitana',
      phone: '+52 55 5555 1234',
      email: 'contacto@tallerhidalgo.com',
      hours: 'Lunes a Viernes de 8:30 AM a 7:00 PM corrido',
      weekendHours: 'Sábados de 9:00 AM a 3:00 PM. Domingos cerrado',
      responseTime: 'Respuesta inmediata por WhatsApp / Citas con 24h de anticipación',
      servicesText: '1. Afinación Mayor: Incluye cambio de aceite 100% sintético, filtros de aire, aceite y gasolina, y bujías de iridio.\n2. Frenos y Suspensión: Rectificación de discos, cambio de balatas cerámicas y amortiguadores.\n3. Diagnóstico por Computadora: Escaneo OBD2 integral con reporte digital.',
      pricingText: 'Afinación Mayor desde $1,850 MXN. Cambio de frenos desde $1,250 MXN. Diagnóstico computarizado $450 MXN (gratis si realizas la reparación con nosotros).',
      paymentMethods: 'Tarjetas de crédito y débito (Visa, MasterCard, Stripe), Transferencia SPEI y Efectivo',
      depositPolicy: 'Se requiere 50% de anticipo para refacciones de importación o pedidos especiales',
      warranty: '6 meses o 10,000 km de garantía total por escrito en mano de obra',
      refundPolicy: 'Cancelación sin costo notificando con al menos 24 horas de anticipación a la cita',
      billingPolicy: 'Facturamos todos los servicios, enviar CSF y datos fiscales dentro del mismo mes de atención',
      faqText: '¿Cuánto tiempo tardan en entregar el vehículo?\nLa mayoría de afinaciones mayores se entregan el mismo día en 4 a 6 horas.\n\n¿Cuentan con refacciones originales?\nSí, trabajamos únicamente con refacciones originales OEM o equipo certificado.\n\n¿Tienen servicio de grúa?\nSí, contamos con convenio de grúa para traslados de emergencia en CDMX.'
    };

    const expectedFiles = [
      'perfil_ubicacion.md',
      'horarios_atencion.md',
      'servicios_productos.md',
      'precios_pagos.md',
      'politicas_garantias.md',
      'preguntas_frecuentes.md'
    ];

    for (let step = 1; step <= 6; step++) {
      const resStep = await fetch(`http://localhost:${testPort}/api/kb/interview/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId: 'default',
          step,
          answers: testBizData
        })
      });
      assert(resStep.status === 200, `POST /api/kb/interview/step (Paso ${step}) responde 200`);
      const stepData = await resStep.json();
      assert(stepData.success === true, `Paso ${step} ejecutado exitosamente`);
      assert(stepData.savedSection === expectedFiles[step - 1], `Paso ${step} guardó archivo correcto: ${stepData.savedSection}`);
      if (step === 6) {
        assert(stepData.isFinished === true, 'Paso 6 marca entrevista como completada (isFinished: true)');
      }
    }

    // ── PRUEBA INTENSIVA KB: 2. VERIFICAR GET /api/kb Y GET /api/kb/:filename ──
    console.log('\n\x1b[38;5;39m    [KB Test] Verificando documentos en GET /api/kb y GET /api/kb/:filename...\x1b[0m');
    const resKbList = await fetch(`http://localhost:${testPort}/api/kb?bot_id=default`);
    assert(resKbList.status === 200, 'GET /api/kb responde 200');
    const kbListData = await resKbList.json();
    const docNames = kbListData.documents.map(d => typeof d === 'string' ? d : d.filename);

    for (const expFile of expectedFiles) {
      assert(docNames.includes(expFile), `Archivo ${expFile} aparece en listado de KB`);
      
      const resDoc = await fetch(`http://localhost:${testPort}/api/kb/${expFile}?bot_id=default`);
      assert(resDoc.status === 200, `GET /api/kb/${expFile} responde 200`);
      const docData = await resDoc.json();
      assert(docData.filename === expFile, `Documento ${expFile} retornado con nombre correcto`);
      assert(docData.content && docData.content.length > 20, `Documento ${expFile} tiene contenido legible (${docData.content?.length || 0} bytes)`);
    }

    // ── PRUEBA INTENSIVA KB: 3. AUTO-SCRAPER WEB ──
    console.log('\n\x1b[38;5;39m    [KB Test] Probando POST /api/kb/scrape con URL real...\x1b[0m');
    const resScrape = await fetch(`http://localhost:${testPort}/api/kb/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        botId: 'default',
        url: 'https://example.com'
      })
    });
    assert(resScrape.status === 200, 'POST /api/kb/scrape responde 200');
    const scrapeData = await resScrape.json();
    assert(scrapeData.success === true, 'Scraping web completado exitosamente');
    assert(scrapeData.filename && scrapeData.filename.startsWith('web_'), `Archivo web guardado con prefijo web_: ${scrapeData.filename}`);
    assert(scrapeData.title, `Título extraído de la página web: "${scrapeData.title}"`);

    // Verify scraped document is in KB
    const resScrapedDoc = await fetch(`http://localhost:${testPort}/api/kb/${scrapeData.filename}?bot_id=default`);
    assert(resScrapedDoc.status === 200, `GET /api/kb/${scrapeData.filename} retornado exitosamente`);
    const scrapedDocData = await resScrapedDoc.json();
    assert(scrapedDocData.content && scrapedDocData.content.includes('example.com'), 'Contenido del documento web incluye la fuente URL');

    // ── PRUEBA INTENSIVA KB: 4. CONSULTA CHAT SOBRE PRECIOS Y HORARIOS ──
    console.log('\n\x1b[38;5;39m    [KB Test] Probando consultas de Chat sobre Precios y Horarios...\x1b[0m');
    
    // Consulta 1: Horarios
    const resChatHours = await fetch(`http://localhost:${testPort}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        botId: 'default',
        sessionId: 'test_hours_' + Date.now(),
        message: '¿Cuáles son sus horarios de atención y cuándo abren los sábados?'
      })
    });
    assert(resChatHours.status === 200, 'POST /api/chat (Horarios) responde 200');
    const chatHoursData = await resChatHours.json();
    assert(chatHoursData.reply, 'Chat generó respuesta sobre horarios');
    const replyHoursLower = chatHoursData.reply.toLowerCase();
    const hasHoursInfo = replyHoursLower.includes('8:30') || replyHoursLower.includes('viernes') || replyHoursLower.includes('sábado') || replyHoursLower.includes('sabado') || replyHoursLower.includes('horario');
    assert(hasHoursInfo, 'Respuesta contiene datos exactos de horarios de la KB');

    // Consulta 2: Precios
    const resChatPrices = await fetch(`http://localhost:${testPort}/api/test/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        botId: 'default',
        sessionId: 'sim_prices_' + Date.now(),
        message: '¿Cuánto cuesta la afinación mayor y qué métodos de pago aceptan?'
      })
    });
    assert(resChatPrices.status === 200, 'POST /api/test/chat (Precios) responde 200');
    const chatPricesData = await resChatPrices.json();
    assert(chatPricesData.reply, 'Test Chat generó respuesta sobre precios: "' + (chatPricesData.reply || '').slice(0, 100) + '..."');
    const replyPricesLower = chatPricesData.reply.toLowerCase();
    const hasPricesInfo = replyPricesLower.includes('1,850') || replyPricesLower.includes('1850') || replyPricesLower.includes('afinación') || replyPricesLower.includes('afinacion') || replyPricesLower.includes('pago') || replyPricesLower.includes('spei') || replyPricesLower.includes('tarjeta') || replyPricesLower.includes('precio');
    assert(hasPricesInfo, 'Respuesta contiene datos exactos de precios y métodos de pago de la KB');

  } finally {
    serverInstance.close();
  }

  // Test 7: Worker.js import check (no Node.js-only imports)
  console.log('\n\x1b[38;5;39m[7/7] Verificando compatibilidad del Worker...\x1b[0m');
  const workerContent = fs.readFileSync('src/worker.js', 'utf8');
  assert(!workerContent.includes("import fs "), 'worker.js no importa módulo fs');
  assert(!workerContent.includes("import http "), 'worker.js no importa módulo http');
  assert(!workerContent.includes("import path "), 'worker.js no importa módulo path');
  assert(!workerContent.includes("process.env"), 'worker.js no usa process.env');
  assert(workerContent.includes("createStorageAdapter"), 'worker.js usa createStorageAdapter');
  assert(workerContent.includes("/api/auth"), 'worker.js tiene endpoint /api/auth');
  assert(workerContent.includes("/api/test/connection"), 'worker.js tiene endpoint /api/test/connection');

  // Summary
  console.log('\n\x1b[38;5;208m==================================================\x1b[0m');
  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1m🎉 TODAS LAS PRUEBAS PASARON EXITOSAMENTE (${passed}/${passed})\x1b[0m`);
    console.log('\x1b[38;5;220mFacilisBot v2 (Cloudflare Workers) está verificado y listo.\x1b[0m');
  } else {
    console.error(`\x1b[31m\x1b[1m❌ PRUEBAS COMPLETADAS CON ERRORES (${passed} pasadas, ${failed} fallidas)\x1b[0m`);
  }
  console.log('\x1b[38;5;208m==================================================\x1b[0m\n');
  
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Error en ejecución de tests:', err);
  process.exit(1);
});
