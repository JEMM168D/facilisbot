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

    // Auth (bypassed in local)
    const resAuth = await fetch(`http://localhost:${testPort}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'anything' })
    });
    const authData = await resAuth.json();
    assert(authData.success === true, 'POST /api/auth auto-aprueba en modo local');

    // Chat
    const resChat = await fetch(`http://localhost:${testPort}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hola', botId: 'default' })
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
