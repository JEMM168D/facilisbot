import { createStorageAdapter } from '../src/core/storage/storage-adapter.js';
import { getBotEngine } from '../src/core/engine.js';
import { createServer } from '../src/server/index.js';

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${message}`);
  } else {
    failed++;
    console.error(`  \x1b[31m✗\x1b[0m ${message}`);
    errors.push(message);
  }
}

async function runAudit() {
  console.log('================================================================');
  console.log('🕵️ AUDITORÍA DE FUNCTION CALLING & LOS 12 SUPERPODERES · FACILISBOT');
  console.log('================================================================\n');

  const storage = createStorageAdapter(null);
  const engine = await getBotEngine('default', storage);

  // ─────────────────────────────────────────────────────────────
  // 1. Simulación: Captura de Leads (Cliente proporciona datos para cotizar)
  // ─────────────────────────────────────────────────────────────
  console.log('\x1b[36m[Escenario 1] Consulta de cliente con datos para cotizar (capture_lead)...\x1b[0m');
  const quoteMsg = 'Hola, me llamo Valeria Gómez, mi WhatsApp es +52 55 9876 5432 y correo valeria@empresa.com. Me gustaría cotizar un desarrollo de tienda online con presupuesto de $2,500 USD.';
  
  const res1 = await engine.processMessage({
    channel: 'web',
    userId: 'lead_user_valeria',
    userName: 'Valeria Gómez',
    text: quoteMsg
  });

  assert(res1 && res1.reply, 'El bot generó respuesta para la cotización');
  assert(res1.tools && res1.tools.length > 0, 'Se ejecutaron herramientas en la interacción');
  
  const leadTool = res1.tools?.find(t => t.name === 'capture_lead');
  assert(leadTool != null, 'Herramienta capture_lead fue ejecutada');
  assert(leadTool?.result?.success === true, 'capture_lead retornó success: true');
  assert(leadTool?.result?.leadId, `Lead registrado con ID: ${leadTool?.result?.leadId}`);

  // Verificar que el lead quedó guardado en el storage
  const leadsInDb = await storage.listLeads({ botId: 'default' });
  const savedLead = leadsInDb.find(l => l.phone?.includes('9876') || l.email?.includes('valeria') || l.name?.includes('Valeria'));
  assert(savedLead != null, `Lead guardado en la base de datos (${savedLead?.name}, ${savedLead?.phone})`);
  assert(savedLead?.status === 'nuevo' || savedLead?.status === 'new', `Estado del lead: ${savedLead?.status}`);

  // ─────────────────────────────────────────────────────────────
  // 2. Simulación: Cliente enojado / inconforme (alert_vigilante & escalate_to_human)
  // ─────────────────────────────────────────────────────────────
  console.log('\n\x1b[36m[Escenario 2] Cliente enojado o inconforme (alert_vigilante / escalate_to_human)...\x1b[0m');
  const angryMsg = '¡Estoy muy enojado y furioso por el pésimo servicio y la demora! Nadie me atiende, es una falta de respeto. Exijo hablar de inmediato con un supervisor o gerente.';
  
  const res2 = await engine.processMessage({
    channel: 'web',
    userId: 'angry_user_pedro',
    userName: 'Pedro Morales',
    text: angryMsg
  });

  assert(res2 && res2.reply, 'El bot respondió con empatía y manejo de crisis');
  assert(res2.tools && res2.tools.length > 0, 'Se ejecutaron herramientas de protección');
  
  const vigilanteTool = res2.tools?.find(t => t.name === 'alert_vigilante');
  const escalateTool = res2.tools?.find(t => t.name === 'escalate_to_human');
  assert(vigilanteTool != null || escalateTool != null, 'alert_vigilante y/o escalate_to_human fueron ejecutados');
  if (vigilanteTool) {
    assert(vigilanteTool.result?.success === true, 'alert_vigilante despachó la alerta');
  }
  if (escalateTool) {
    assert(escalateTool.result?.escalated === true, 'escalate_to_human transfirió a asesor humano');
  }

  // Verificar estado de la conversación en storage
  const conv2 = await storage.getConversation(res2.conversationId);
  assert(conv2?.status === 'escalated', `Estado de la conversación actualizado a "escalated": ${conv2?.status}`);

  // ─────────────────────────────────────────────────────────────
  // 3. Simulación: Cliente solicitando pagar anticipo (create_payment_link)
  // ─────────────────────────────────────────────────────────────
  console.log('\n\x1b[36m[Escenario 3] Cliente solicitando pagar anticipo (create_payment_link)...\x1b[0m');
  const payMsg = 'Quiero pagar el anticipo de $150 USD para apartar mi lugar, ¿me puedes pasar el link de pago por tarjeta?';
  
  const res3 = await engine.processMessage({
    channel: 'web',
    userId: 'pay_user_mario',
    userName: 'Mario Vargas',
    text: payMsg
  });

  assert(res3 && res3.reply, 'El bot generó respuesta para cobro');
  const payTool = res3.tools?.find(t => t.name === 'create_payment_link');
  assert(payTool != null, 'Herramienta create_payment_link fue ejecutada');
  assert(payTool?.result?.success === true, 'create_payment_link generó enlace exitoso');
  assert(payTool?.result?.paymentUrl && payTool?.result?.paymentUrl.includes('http'), `URL de pago generada: ${payTool?.result?.paymentUrl}`);
  assert(payTool?.result?.amount === 150, `Monto detectado correctamente: $${payTool?.result?.amount}`);

  // ─────────────────────────────────────────────────────────────
  // 4. Simulación: Cliente satisfecho agradeciendo (collect_review)
  // ─────────────────────────────────────────────────────────────
  console.log('\n\x1b[36m[Escenario 4] Cliente satisfecho que agradece el servicio (collect_review)...\x1b[0m');
  const thankMsg = '¡Muchísimas gracias! Quedó todo súper claro, excelente atención y servicio muy rápido.';
  
  const res4 = await engine.processMessage({
    channel: 'web',
    userId: 'happy_user_ana',
    userName: 'Ana Torres',
    text: thankMsg
  });

  assert(res4 && res4.reply, 'El bot agradeció la preferencia del cliente');
  const reviewTool = res4.tools?.find(t => t.name === 'collect_review');
  assert(reviewTool != null, 'Herramienta collect_review fue ejecutada');
  assert(reviewTool?.result?.success === true, 'collect_review retornó éxito');
  assert(reviewTool?.result?.reviewUrl && reviewTool?.result?.reviewUrl.includes('http'), `URL de reseña entregada: ${reviewTool?.result?.reviewUrl}`);

  // ─────────────────────────────────────────────────────────────
  // 5. Validación de Endpoints de Analítica y 12 Superpoderes
  // ─────────────────────────────────────────────────────────────
  console.log('\n\x1b[36m[Escenario 5] Validando consistencia de endpoints de analítica y superpoderes...\x1b[0m');
  
  const { start } = createServer(null, storage);
  const testPort = 4055;
  const serverInstance = await new Promise(resolve => {
    const s = start(testPort);
    setTimeout(() => resolve(s), 400);
  });

  try {
    // 5.1 /api/reports/daily
    const resReport = await fetch(`http://localhost:${testPort}/api/reports/daily?bot_id=default`);
    assert(resReport.status === 200, 'GET /api/reports/daily responde 200');
    const dataReport = await resReport.json();
    assert(dataReport.success === true, '/api/reports/daily success es true');
    assert(dataReport.report && dataReport.report.includes('Resumen Ejecutivo Diario'), 'Contenido markdown de reporte diario generado');
    assert(dataReport.recentLeads && Array.isArray(dataReport.recentLeads) && dataReport.recentLeads.length > 0, `Reporte incluye ${dataReport.recentLeads.length} leads recientes`);
    assert(dataReport.metrics && typeof dataReport.metrics.totalConversations === 'number', 'Métricas consistentes en reporte');

    // 5.2 /api/insights
    const resInsights = await fetch(`http://localhost:${testPort}/api/insights?bot_id=default`);
    assert(resInsights.status === 200, 'GET /api/insights responde 200');
    const dataInsights = await resInsights.json();
    assert(Array.isArray(dataInsights.topIntents) && dataInsights.topIntents.length > 0, 'topIntents devuelto con datos');
    assert(Array.isArray(dataInsights.commonObjections) && dataInsights.commonObjections.length > 0, 'commonObjections devuelto con datos');
    assert(typeof dataInsights.totalAnalyzed === 'number' && dataInsights.totalAnalyzed >= 4, `totalAnalyzed consistente con actividad (${dataInsights.totalAnalyzed})`);

    // 5.3 /api/kb/gaps
    const resGaps = await fetch(`http://localhost:${testPort}/api/kb/gaps?bot_id=default`);
    assert(resGaps.status === 200, 'GET /api/kb/gaps responde 200');
    const dataGaps = await resGaps.json();
    assert(Array.isArray(dataGaps.gaps) && dataGaps.gaps.length > 0, `gaps devueltos: ${dataGaps.gaps.length} oportunidades detectadas`);

    // 5.4 /api/reviews/stats
    const resReviews = await fetch(`http://localhost:${testPort}/api/reviews/stats?bot_id=default`);
    assert(resReviews.status === 200, 'GET /api/reviews/stats responde 200');
    const dataReviews = await resReviews.json();
    assert(typeof dataReviews.csatScore === 'number' && dataReviews.csatScore >= 4.0, `csatScore coherente: ${dataReviews.csatScore}/5.0`);
    assert(dataReviews.totalRatings >= 1, `totalRatings registrado: ${dataReviews.totalRatings}`);
    assert(dataReviews.googleMapsInvitesSent >= 1, `googleMapsInvitesSent registrado: ${dataReviews.googleMapsInvitesSent}`);

  } finally {
    serverInstance.close();
  }

  // ─────────────────────────────────────────────────────────────
  // Resumen Final de Auditoría
  // ─────────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log(`📊 RESUMEN DE LA AUDITORÍA`);
  console.log(`   Pruebas ejecutadas: ${passed + failed}`);
  console.log(`   Exitosas: \x1b[32m${passed}\x1b[0m`);
  console.log(`   Fallidas: \x1b[31m${failed}\x1b[0m`);
  console.log('================================================================\n');

  if (failed > 0) {
    console.error('Anomalías detectadas:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  } else {
    console.log('\x1b[32m\x1b[1m✅ TODOS LOS SUPERPODERES Y FUNCTION CALLING OPERAN DE FORMA ÓPTIMA Y ROBUSTA.\x1b[0m\n');
  }
}

runAudit().catch(err => {
  console.error('Error fatal en auditoría:', err);
  process.exit(1);
});
