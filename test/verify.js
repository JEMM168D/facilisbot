import fs from 'fs';
import { loadConfig } from '../src/core/config.js';
import { db } from '../src/core/storage/db.js';
import { kb } from '../src/core/knowledge/search.js';
import { executeTool } from '../src/core/tools/registry.js';
import { BotEngine } from '../src/core/engine.js';
import { createServer } from '../src/server/index.js';
import { generateMonthlyReport } from '../skills/reporte.js';
import { exportData } from '../skills/exportar.js';
import { runMaintenance } from '../skills/mantenimiento.js';
import { runTuning } from '../skills/afinar.js';
import { generateCampaign } from '../skills/campana.js';
import { calculateQuote } from '../skills/cotizar.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${message}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✗ FAIL:\x1b[0m ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n\x1b[38;5;208m==================================================\x1b[0m');
  console.log('\x1b[1m⚡ SUITE DE PRUEBAS DE INTEGRACIÓN · YUNQUE BOTS\x1b[0m');
  console.log('\x1b[38;5;208m==================================================\x1b[0m\n');

  // Test 1: Config
  console.log('\x1b[38;5;220m[1/8] Probando Módulo de Configuración...\x1b[0m');
  const config = loadConfig();
  assert(config.bot && config.bot.name, 'Configuración cargada con bot.name');
  assert(config.channels && config.channels.web.enabled === true, 'Canal Web habilitado por defecto');
  assert(config.llm && config.llm.provider, 'Proveedor de LLM definido');

  // Test 2: Database
  console.log('\n\x1b[38;5;220m[2/8] Probando Motor de Base de Datos y CRM...\x1b[0m');
  const conv = db.getOrCreateConversation('web', 'test_user_1', 'Carlos Mendoza');
  assert(conv && conv.id.startsWith('conv_'), 'Conversación creada exitosamente con ID único');

  const msg = db.addMessage({
    conversationId: conv.id,
    role: 'user',
    content: 'Hola, me gustaría saber precios de sus servicios'
  });
  assert(msg && msg.id.startsWith('msg_'), 'Mensaje de usuario registrado en la base de datos');

  const lead = db.saveLead({
    name: 'Carlos Mendoza',
    phone: '+52 55 1234 5678',
    email: 'carlos@empresa.com',
    interest: 'Consultoría Estratégica',
    channel: 'web'
  });
  assert(lead && lead.id.startsWith('lead_'), 'Prospecto guardado exitosamente en CRM');

  const leadsList = db.listLeads();
  assert(leadsList.total > 0, `CRM devuelve listado de prospectos (${leadsList.total} encontrados)`);

  const metrics = db.getOverviewMetrics();
  assert(metrics.totalConversations > 0, `Métricas calculadas correctamente (${metrics.totalConversations} conversaciones)`);

  // Test 3: Knowledge Base RAG Search
  console.log('\n\x1b[38;5;220m[3/8] Probando Base de Conocimiento RAG y Búsqueda BM25...\x1b[0m');
  kb.saveDocument('test-faq.md', `# Preguntas Frecuentes de Prueba\n\n## ¿Cuál es el horario de atención?\nNuestro horario es de lunes a viernes de 8:00 AM a 8:00 PM.`);
  const searchResults = kb.search('horario de atencion');
  assert(searchResults.length > 0, `Búsqueda RAG encontró fragmento relevante (Score: ${searchResults[0]?.score})`);
  assert(searchResults[0]?.content.includes('8:00 AM'), 'Fragmento contiene la respuesta correcta');

  // Test 4: Business Tools Execution
  console.log('\n\x1b[38;5;220m[4/8] Probando Herramientas de Negocio (Function Calling)...\x1b[0m');
  const toolLeadRes = await executeTool('capture_lead', {
    name: 'Ana Gómez',
    phone: '+1 555-9988',
    email: 'ana@gmail.com',
    interest: 'Cita médica urgente'
  }, { conversationId: conv.id });
  assert(toolLeadRes.success === true, 'Herramienta capture_lead ejecutada exitosamente');

  const toolBookingRes = await executeTool('book_appointment', {
    customerName: 'Ana Gómez',
    serviceName: 'Consulta General',
    preferredDate: '2026-08-25 a las 10:00 AM',
    phone: '+1 555-9988'
  });
  assert(toolBookingRes.success === true, 'Herramienta book_appointment ejecutada exitosamente');

  const toolPaymentRes = await executeTool('create_payment_link', {
    amount: 150,
    currency: 'USD',
    description: 'Anticipo de servicio'
  });
  assert(toolPaymentRes.success === true && toolPaymentRes.paymentUrl, 'Herramienta create_payment_link generó enlace');

  const toolEscalateRes = await executeTool('escalate_to_human', {
    reason: 'Solicitud de hablar con gerente',
    urgency: 'alta'
  }, { conversationId: conv.id });
  assert(toolEscalateRes.success === true && toolEscalateRes.escalated === true, 'Herramienta escalate_to_human actualizó estado');

  // Test 5: BotEngine Conversation Pipeline
  console.log('\n\x1b[38;5;220m[5/8] Probando Orquestador BotEngine...\x1b[0m');
  const engine = new BotEngine(config);
  const botReply = await engine.processMessage({
    channel: 'web',
    userId: 'test_pipeline_user',
    userName: 'Roberto',
    text: 'Hola, ¿a qué hora abren y qué servicios ofrecen?'
  });
  assert(botReply && botReply.reply && botReply.reply.length > 0, `Bot generó respuesta conversacional: "${botReply.reply.slice(0, 60)}..."`);
  assert(botReply.conversationId, 'Respuesta asociada a un conversationId');

  // Test 6: Server & REST APIs
  console.log('\n\x1b[38;5;220m[6/8] Probando Servidor HTTP y Endpoints REST...\x1b[0m');
  const app = createServer(config);
  const testPort = 3999;
  const serverInstance = app.start(testPort);

  try {
    // Test /api/overview
    const resOverview = await fetch(`http://localhost:${testPort}/api/overview`);
    const dataOverview = await resOverview.json();
    assert(resOverview.status === 200 && dataOverview.metrics, 'Endpoint GET /api/overview responde 200');

    // Test /api/chat
    const resChat = await fetch(`http://localhost:${testPort}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hola desde prueba de integración', sessionId: 'test_sess' })
    });
    const dataChat = await resChat.json();
    assert(resChat.status === 200 && dataChat.reply, 'Endpoint POST /api/chat responde 200 con reply');

    // Test /api/leads
    const resLeads = await fetch(`http://localhost:${testPort}/api/leads`);
    const dataLeads = await resLeads.json();
    assert(resLeads.status === 200 && Array.isArray(dataLeads.leads), 'Endpoint GET /api/leads responde 200');

    // Test static assets
    const resCss = await fetch(`http://localhost:${testPort}/admin/style.css`);
    const cssType = resCss.headers.get('content-type');
    assert(resCss.status === 200 && cssType && cssType.includes('text/css'), 'GET /admin/style.css sirve text/css correctamente');

    const resJs = await fetch(`http://localhost:${testPort}/admin/app.js`);
    const jsType = resJs.headers.get('content-type');
    assert(resJs.status === 200 && jsType && jsType.includes('javascript'), 'GET /admin/app.js sirve application/javascript correctamente');

    // Test /api/kb
    const resKb = await fetch(`http://localhost:${testPort}/api/kb`);
    const dataKb = await resKb.json();
    assert(resKb.status === 200 && Array.isArray(dataKb.documents), 'Endpoint GET /api/kb responde 200');
  } finally {
    serverInstance.close();
  }

  // Test 7: Skills & Agency Suite
  console.log('\n\x1b[38;5;220m[7/8] Probando Skills de Operación y Modo Agencia...\x1b[0m');
  const reportRes = await generateMonthlyReport();
  assert(reportRes.success && fs.existsSync(reportRes.path), 'Skill /reporte generó archivo Markdown');

  const exportRes = await exportData();
  assert(fs.existsSync(exportRes.leadsCsvPath), 'Skill /exportar generó archivo CSV de leads');

  const maintRes = await runMaintenance();
  assert(maintRes.success === true, 'Skill /mantenimiento auditó el bot exitosamente');

  const tuningRes = await runTuning();
  assert(tuningRes.analyzed >= 0, 'Skill /afinar analizó el historial');

  const campRes = await generateCampaign({ segment: 'all', promoOffer: '20% OFF' });
  assert(campRes.success && fs.existsSync(campRes.targetPath), 'Skill /campaña estructuró propuesta');

  const quoteRes = await calculateQuote({ clientName: 'Empresa Test', niche: 'Restaurante' });
  assert(quoteRes.setupFee > 0 && fs.existsSync(quoteRes.filePath), 'Skill /cotizar calculó setup y mensualidad');

  // Test 8: Summary
  console.log('\n\x1b[38;5;208m==================================================\x1b[0m');
  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1m🎉 TODAS LAS PRUEBAS PASARON EXITOSAMENTE (${passed}/${passed})\x1b[0m`);
    console.log('\x1b[38;5;220mEl sistema Yunque Bots está 100% verificado y listo para producción.\x1b[0m');
  } else {
    console.error(`\x1b[31m\x1b[1m❌ PRUEBAS COMPLETADAS CON ERRORES (${passed} pasadas, ${failed} fallidas)\x1b[0m`);
  }
  console.log('\x1b[38;5;208m==================================================\x1b[0m\n');
}

runTests().catch(err => {
  console.error('Error en ejecución de tests:', err);
  process.exit(1);
});
