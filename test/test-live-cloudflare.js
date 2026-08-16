/**
 * Test Suite for Live Cloudflare Worker: https://facilisbot.facilis-bots.workers.dev
 */

const BASE_URL = 'https://facilisbot.facilis-bots.workers.dev';

async function runLiveTests() {
  console.log(`==================================================`);
  console.log(`🌐 SUITE DE PRUEBAS EN VIVO: CLOUDFLARE WORKERS`);
  console.log(`   URL Base: ${BASE_URL}`);
  console.log(`==================================================\n`);

  let total = 0;
  let passed = 0;
  let failed = 0;
  const failures = [];

  async function test(name, fn) {
    total++;
    try {
      const res = await fn();
      console.log(`  ✓ ${name}`);
      passed++;
      return res;
    } catch (err) {
      console.error(`  ✗ ${name} -> ERROR: ${err.message}`);
      failed++;
      failures.push({ name, error: err.message });
    }
  }

  // 1. Health
  console.log('[1/16] Probando Health Endpoint...');
  await test('GET /health', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error(`Expected status ok, got ${JSON.stringify(data)}`);
  });

  // 2. Auth
  console.log('\n[2/16] Probando Auth Endpoint...');
  await test('POST /api/auth (Master Admin - admin123)', async () => {
    const res = await fetch(`${BASE_URL}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'admin123' })
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.success || data.role !== 'admin') throw new Error(`Invalid response: ${JSON.stringify(data)}`);
  });

  await test('POST /api/auth (Invalid Code - 401 expected)', async () => {
    const res = await fetch(`${BASE_URL}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'wrong_code_xyz' })
    });
    if (res.status !== 401) throw new Error(`Expected status 401, got ${res.status}`);
    const data = await res.json();
    if (data.success) throw new Error(`Expected failure, got success`);
  });

  // 3. Bots Management
  console.log('\n[3/16] Probando Bots Management...');
  await test('GET /api/bots', async () => {
    const res = await fetch(`${BASE_URL}/api/bots`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.bots)) throw new Error(`Expected bots array, got ${JSON.stringify(data)}`);
  });

  const testBotId = `qa-test-bot-${Date.now()}`;
  const testAccessCode = `pass_${Date.now()}`;
  await test('POST /api/bots (Create bot)', async () => {
    const res = await fetch(`${BASE_URL}/api/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        botId: testBotId,
        accessCode: testAccessCode,
        config: {
          bot: { name: 'Bot QA Test', niche: 'dentist' },
          business: { name: 'Clínica Dental QA' }
        }
      })
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(`Failed to create bot: ${JSON.stringify(data)}`);
  });

  await test('POST /api/auth (Client Access Code)', async () => {
    const res = await fetch(`${BASE_URL}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: testAccessCode })
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.success || data.role !== 'client' || data.botId !== testBotId) {
      throw new Error(`Unexpected client auth: ${JSON.stringify(data)}`);
    }
  });

  // 4. Overview Metrics
  console.log('\n[4/16] Probando Overview Metrics...');
  await test('GET /api/overview (default bot)', async () => {
    const res = await fetch(`${BASE_URL}/api/overview`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.bot || !data.metrics) throw new Error(`Invalid overview structure: ${JSON.stringify(data)}`);
  });

  await test(`GET /api/overview?bot_id=${testBotId}`, async () => {
    const res = await fetch(`${BASE_URL}/api/overview?bot_id=${testBotId}`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.bot || !data.metrics) throw new Error(`Invalid overview structure: ${JSON.stringify(data)}`);
  });

  // 5. Web Chat and Simulator Chat
  console.log('\n[5/16] Probando Chat y Test Chat...');
  let createdConvId = null;
  await test('POST /api/chat (Web message)', async () => {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        botId: 'default',
        sessionId: 'test_session_' + Date.now(),
        userName: 'Usuario QA',
        message: 'Hola, ¿qué servicios ofrecen?'
      })
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.reply) throw new Error(`Expected reply in response: ${JSON.stringify(data)}`);
    createdConvId = data.conversationId;
  });

  await test('POST /api/test/chat (Simulator message)', async () => {
    const res = await fetch(`${BASE_URL}/api/test/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        botId: 'default',
        sessionId: 'sim_session_qa',
        message: 'Me llamo Carlos y mi teléfono es 5551234567, quiero informes de precios'
      })
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.reply) throw new Error(`Expected reply: ${JSON.stringify(data)}`);
  });

  // 6. Conversations & Messages
  console.log('\n[6/16] Probando Conversations & Messages...');
  let activeConvId = createdConvId;
  await test('GET /api/conversations', async () => {
    const res = await fetch(`${BASE_URL}/api/conversations?bot_id=default`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error(`Expected array of conversations: ${JSON.stringify(data)}`);
    if (data.length > 0 && !activeConvId) {
      activeConvId = data[0].id;
    }
  });

  if (activeConvId) {
    await test(`GET /api/conversations/${activeConvId}/messages`, async () => {
      const res = await fetch(`${BASE_URL}/api/conversations/${activeConvId}/messages`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.messages)) throw new Error(`Expected messages array: ${JSON.stringify(data)}`);
    });

    await test(`POST /api/conversations/${activeConvId}/reply (Human agent reply)`, async () => {
      const res = await fetch(`${BASE_URL}/api/conversations/${activeConvId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hola! Soy un asesor humano atendiendo tu mensaje.' })
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(`Reply failed: ${JSON.stringify(data)}`);
    });

    await test(`POST /api/conversations/${activeConvId}/status (Change status)`, async () => {
      const res = await fetch(`${BASE_URL}/api/conversations/${activeConvId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' })
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(`Status update failed: ${JSON.stringify(data)}`);
    });
  }

  // 7. Leads
  console.log('\n[7/16] Probando Leads & CRM...');
  let testLeadId = null;
  await test('GET /api/leads', async () => {
    const res = await fetch(`${BASE_URL}/api/leads?bot_id=default`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error(`Expected array of leads: ${JSON.stringify(data)}`);
    if (data.length > 0) testLeadId = data[0].id;
  });

  if (testLeadId) {
    await test(`PUT /api/leads/${testLeadId} (Update lead status)`, async () => {
      const res = await fetch(`${BASE_URL}/api/leads/${testLeadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'contactado', notes: 'Actualizado en prueba QA' })
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(`Update lead failed: ${JSON.stringify(data)}`);
    });
  }

  await test('GET /api/leads/export/csv', async () => {
    const res = await fetch(`${BASE_URL}/api/leads/export/csv?bot_id=default`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const text = await res.text();
    if (!text.includes('id,name,phone')) throw new Error(`Invalid CSV header: ${text.slice(0, 50)}`);
  });

  await test('GET /api/conversations/export/csv', async () => {
    const res = await fetch(`${BASE_URL}/api/conversations/export/csv?bot_id=default`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const text = await res.text();
    if (!text.includes('id,channel')) throw new Error(`Invalid CSV header: ${text.slice(0, 50)}`);
  });

  // 8. Knowledge Base
  console.log('\n[8/16] Probando Knowledge Base (KV)...');
  await test('GET /api/kb', async () => {
    const res = await fetch(`${BASE_URL}/api/kb?bot_id=default`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.documents)) throw new Error(`Expected documents array: ${JSON.stringify(data)}`);
  });

  const testKbFilename = `qa_doc_${Date.now()}.md`;
  await test(`POST /api/kb (Create doc ${testKbFilename})`, async () => {
    const res = await fetch(`${BASE_URL}/api/kb?bot_id=default`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: testKbFilename,
        content: '# QA Test Doc\n\nEste es un documento de prueba QA.'
      })
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(`KB save failed: ${JSON.stringify(data)}`);
  });

  await test(`GET /api/kb/${testKbFilename}`, async () => {
    const res = await fetch(`${BASE_URL}/api/kb/${testKbFilename}?bot_id=default`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (data.filename !== testKbFilename || !data.content.includes('QA Test Doc')) {
      throw new Error(`Invalid KB doc content: ${JSON.stringify(data)}`);
    }
  });

  await test(`DELETE /api/kb/${testKbFilename}`, async () => {
    const res = await fetch(`${BASE_URL}/api/kb/${testKbFilename}?bot_id=default`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(`KB delete failed: ${JSON.stringify(data)}`);
  });

  // 9. Test Connection
  console.log('\n[9/16] Probando Test Connection (API key validation)...');
  await test('POST /api/test/connection (Empty key - 400 expected)', async () => {
    const res = await fetch(`${BASE_URL}/api/test/connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', apiKey: '' })
    });
    if (res.status !== 400) throw new Error(`Expected status 400, got ${res.status}`);
  });

  // 10. Reports Daily
  console.log('\n[10/16] Probando Reporte Diario Ejecutivo...');
  await test('GET /api/reports/daily', async () => {
    const res = await fetch(`${BASE_URL}/api/reports/daily?bot_id=default`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.success || !data.report) throw new Error(`Invalid daily report response: ${JSON.stringify(data)}`);
  });

  // 11. Campaigns Reactivate
  console.log('\n[11/16] Probando Campañas de Reactivación...');
  await test('POST /api/campaigns/reactivate', async () => {
    const res = await fetch(`${BASE_URL}/api/campaigns/reactivate?bot_id=default`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.success || !Array.isArray(data.reactivatedLeads)) {
      throw new Error(`Invalid reactivate response: ${JSON.stringify(data)}`);
    }
  });

  // 12. Insights
  console.log('\n[12/16] Probando IA Insights...');
  await test('GET /api/insights', async () => {
    const res = await fetch(`${BASE_URL}/api/insights?bot_id=default`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.topIntents || !data.commonObjections) throw new Error(`Invalid insights response: ${JSON.stringify(data)}`);
  });

  // 13. KB Gaps
  console.log('\n[13/16] Probando KB Gaps...');
  await test('GET /api/kb/gaps', async () => {
    const res = await fetch(`${BASE_URL}/api/kb/gaps?bot_id=default`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.gaps)) throw new Error(`Invalid gaps response: ${JSON.stringify(data)}`);
  });

  // 14. Reviews Stats
  console.log('\n[14/16] Probando Reviews Stats...');
  await test('GET /api/reviews/stats', async () => {
    const res = await fetch(`${BASE_URL}/api/reviews/stats?bot_id=default`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (typeof data.csatScore !== 'number') throw new Error(`Invalid reviews stats response: ${JSON.stringify(data)}`);
  });

  // 15. Webhooks (WhatsApp & Telegram)
  console.log('\n[15/16] Probando Webhooks Multi-Canal...');
  await test('GET /webhook/whatsapp (Meta Hub Challenge Verification)', async () => {
    const challenge = '1158201444';
    const token = 'facilisbot_secret';
    const res = await fetch(`${BASE_URL}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=${challenge}`);
    // Should return 200 or 403 based on token match, but shouldn't crash with 500
    if (res.status === 500) throw new Error(`Server returned 500`);
  });

  await test('POST /webhook/whatsapp (Mock Payload)', async () => {
    const res = await fetch(`${BASE_URL}/webhook/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: []
      })
    });
    if (res.status === 500) throw new Error(`Server returned 500`);
  });

  await test('POST /webhook/telegram (Mock Payload)', async () => {
    const res = await fetch(`${BASE_URL}/webhook/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 123456
      })
    });
    if (res.status === 500) throw new Error(`Server returned 500`);
  });

  // 16. Static Assets & Widget
  console.log('\n[16/16] Probando Archivos Estáticos y Widget...');
  await test('GET /widget/widget.js', async () => {
    const res = await fetch(`${BASE_URL}/widget/widget.js`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const text = await res.text();
    if (!text.includes('FacilisBot') && !text.includes('facilisbot')) {
      throw new Error(`Widget JS content check failed`);
    }
  });

  await test('GET /admin/ (Admin HTML)', async () => {
    const res = await fetch(`${BASE_URL}/admin/`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const text = await res.text();
    if (!text.includes('FacilisBot') && !text.includes('<!DOCTYPE html>')) {
      throw new Error(`Admin HTML content check failed`);
    }
  });

  await test('GET /admin/app.js', async () => {
    const res = await fetch(`${BASE_URL}/admin/app.js`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const text = await res.text();
    if (text.length < 100) throw new Error(`Admin app.js too short`);
  });

  await test('GET /admin/style.css', async () => {
    const res = await fetch(`${BASE_URL}/admin/style.css`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const text = await res.text();
    if (!text.includes(':root') && !text.includes('body')) {
      throw new Error(`Admin CSS content check failed`);
    }
  });

  // Summary
  console.log(`\n==================================================`);
  console.log(`📊 RESUMEN FINAL DE PRUEBAS EN VIVO`);
  console.log(`   Total ejecutadas: ${total}`);
  console.log(`   Pasaron exitosamente: ${passed} ✅`);
  console.log(`   Fallaron: ${failed} ❌`);
  console.log(`==================================================`);

  if (failures.length > 0) {
    console.log('\nDetalles de fallas:');
    failures.forEach(f => console.log(`- ${f.name}: ${f.error}`));
    process.exit(1);
  } else {
    console.log('\n🎉 ¡TODOS LOS ENDPOINTS FUNCIONAN AL 100% EN CLOUDFLARE WORKERS!');
  }
}

runLiveTests();
