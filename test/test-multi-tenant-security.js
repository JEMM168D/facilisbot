/**
 * Test Suite: Multi-inquilino y Seguridad de Aislamiento de Clientes
 * 
 * Valida:
 * 1. POST /api/bots -> Crear 'clinica-dental-norte' con PIN 'dental2026'
 * 2. POST /api/auth -> Login con 'dental2026' devuelve role: 'client' y botId: 'clinica-dental-norte'
 * 3. POST /api/kb -> Guardar documentos en KB exclusivamente para 'clinica-dental-norte'
 * 4. GET /api/kb?bot_id=clinica-dental-norte -> Aislamiento estricto (no muestra docs de default)
 * 5. POST /api/chat -> Bot responde con nombre y servicios de la clínica dental
 * 6. Validación de aislamiento cruzado (default vs clinica-dental-norte)
 */
import { createServer } from '../src/server/index.js';

export async function runMultiTenantTests(baseUrl = null) {
  let serverInstance = null;
  let url = baseUrl;

  if (!url) {
    const { server, start } = createServer();
    const port = 4055;
    serverInstance = await new Promise(resolve => {
      const s = start(port);
      setTimeout(() => resolve(s), 500);
    });
    url = `http://localhost:${port}`;
  }

  console.log(`\n==================================================`);
  console.log(`🔒 SUITE DE PRUEBAS MULTI-INQUILINO Y SEGURIDAD`);
  console.log(`   Destino: ${url}`);
  console.log(`==================================================\n`);

  let total = 0;
  let passed = 0;
  let failed = 0;

  async function check(desc, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✓ ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${desc} -> ERROR: ${err.message}`);
      failed++;
    }
  }

  try {
    // 1. Crear nuevo bot cliente 'clinica-dental-norte' con PIN 'dental2026'
    console.log('[1/6] Creando bot cliente: clinica-dental-norte con PIN dental2026...');
    await check('POST /api/bots crea clinica-dental-norte con PIN', async () => {
      const res = await fetch(`${url}/api/bots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId: 'clinica-dental-norte',
          pin: 'dental2026',
          config: {
            bot: {
              name: 'Asistente Dental Norte',
              niche: 'Clínica Odontológica y Estética Dental',
              personality: 'cálido, profesional, empático y claro en procedimientos dentales'
            },
            business: {
              name: 'Clínica Dental Norte',
              industry: 'Salud y Odontología',
              description: 'Especialistas en ortodoncia, implantes dentales, blanqueamiento y urgencias 24h.',
              services: '1. Ortodoncia Invisible e Invisalign\n2. Implantes Dentales de Titanio\n3. Limpieza y Blanqueamiento Láser\n4. Endodoncia y Extracciones sin dolor',
              hours: 'Lunes a Sábado de 8:00 AM a 8:00 PM',
              location: 'Av. Las Palmas #400, Piso 3, Zona Norte',
              phone: '+52 81 8300 9999',
              email: 'citas@dentalnorte.com',
              paymentMethods: 'Efectivo, Tarjetas (hasta 12 MSI), Transferencia SPEI'
            }
          }
        })
      });
      if (res.status !== 201 && res.status !== 200) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      if (!data.success || data.botId !== 'clinica-dental-norte') {
        throw new Error(`Respuesta inválida: ${JSON.stringify(data)}`);
      }
    });

    // 2. Iniciar sesión con PIN 'dental2026' en POST /api/auth
    console.log('\n[2/6] Verificando Autenticación y Rol de Cliente con PIN dental2026...');
    await check('POST /api/auth con PIN dental2026 devuelve role: client y botId: clinica-dental-norte', async () => {
      const res = await fetch(`${url}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'dental2026' })
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(`Auth falló: ${JSON.stringify(data)}`);
      if (data.role !== 'client') throw new Error(`Rol esperado "client", recibido "${data.role}"`);
      if (data.botId !== 'clinica-dental-norte') throw new Error(`botId esperado "clinica-dental-norte", recibido "${data.botId}"`);
    });

    await check('POST /api/auth con PIN incorrecto es rechazado con 401', async () => {
      const res = await fetch(`${url}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'pin_invalido_9999' })
      });
      if (res.status !== 401) throw new Error(`Status esperado 401, recibido ${res.status}`);
    });

    // 3. Guardar documentos en KB exclusivamente para clinica-dental-norte
    console.log('\n[3/6] Guardando documentos exclusivos en la KB de clinica-dental-norte...');
    const dentalDoc1 = `# Servicios y Tratamientos Odontológicos · Clínica Dental Norte
- **Ortodoncia Invisible:** Alineadores transparentes personalizados desde $24,000 MXN o $1,500 mensuales.
- **Implantes Dentales:** Implante unitario con corona de zirconio por $14,500 MXN.
- **Blanqueamiento Dental Láser:** Sesión de 45 minutos aclarando hasta 4 tonos por $2,200 MXN.
- **Limpieza Ultrasónica Profiláctica:** Incluye pulido y fluoruro por $650 MXN.
- **Urgencias Odontológicas:** Atención para dolor agudo o fracturas dentales 24/7.`;

    const dentalDoc2 = `# Preguntas Frecuentes y Políticas · Clínica Dental Norte
- **¿Aceptan pagos a meses sin intereses?** Sí, aceptamos 3, 6 y 12 MSI con todas las tarjetas de crédito participantes.
- **¿Los procedimientos duelen?** Usamos anestesia digital sin dolor y técnicas mínimamente invasivas.
- **¿Cómo agendar una cita?** Puedes agendar directo por WhatsApp o por nuestro asistente virtual.`;

    await check('POST /api/kb guarda servicios_dentales.md para clinica-dental-norte', async () => {
      const res = await fetch(`${url}/api/kb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId: 'clinica-dental-norte',
          filename: 'servicios_dentales.md',
          content: dentalDoc1
        })
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(`Error al guardar KB: ${JSON.stringify(data)}`);
    });

    await check('POST /api/kb guarda faq_dental.md para clinica-dental-norte', async () => {
      const res = await fetch(`${url}/api/kb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId: 'clinica-dental-norte',
          filename: 'faq_dental.md',
          content: dentalDoc2
        })
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(`Error al guardar KB: ${JSON.stringify(data)}`);
    });

    // 4. Verificar aislamiento estricto de Knowledge Base
    console.log('\n[4/6] Verificando aislamiento estricto de la Knowledge Base...');
    await check('GET /api/kb?bot_id=clinica-dental-norte muestra SOLO sus documentos', async () => {
      const res = await fetch(`${url}/api/kb?bot_id=clinica-dental-norte`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      const docNames = (data.documents || []).map(d => typeof d === 'string' ? d : d.filename);
      
      if (!docNames.includes('servicios_dentales.md')) {
        throw new Error(`Falta servicios_dentales.md en KB de clinica-dental-norte. Encontrados: ${JSON.stringify(docNames)}`);
      }
      if (!docNames.includes('faq_dental.md')) {
        throw new Error(`Falta faq_dental.md en KB de clinica-dental-norte. Encontrados: ${JSON.stringify(docNames)}`);
      }
      
      // Asegurar que NO tiene documentos de otros bots
      const forbiddenDefaultDocs = ['taller_servicios.md', 'web_example_com.md', 'afinacion.md'];
      for (const forbidden of forbiddenDefaultDocs) {
        if (docNames.includes(forbidden)) {
          throw new Error(`FUGA DE DATOS: clinica-dental-norte tiene acceso a documento ajeno "${forbidden}"`);
        }
      }
    });

    await check('GET /api/kb?bot_id=default NO contiene documentos de clinica-dental-norte', async () => {
      const res = await fetch(`${url}/api/kb?bot_id=default`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      const docNames = (data.documents || []).map(d => typeof d === 'string' ? d : d.filename);
      
      if (docNames.includes('servicios_dentales.md') || docNames.includes('faq_dental.md')) {
        throw new Error(`FUGA DE DATOS: bot default tiene acceso a documentos de clinica-dental-norte`);
      }
    });

    // 5. Conversación de prueba en /api/chat para clinica-dental-norte
    console.log('\n[5/6] Probando conversación en /api/chat para clinica-dental-norte...');
    await check('POST /api/chat responde con identidad de Clínica Dental Norte y servicios', async () => {
      const res = await fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId: 'clinica-dental-norte',
          sessionId: 'test_paciente_001',
          userName: 'Carlos Méndez',
          message: '¡Hola! ¿Qué tratamientos dentales ofrecen y cuánto cuesta el blanqueamiento o la limpieza?'
        })
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      if (!data.reply) throw new Error(`Sin respuesta en reply: ${JSON.stringify(data)}`);
      
      const replyLower = data.reply.toLowerCase();
      const hasDentalContext = replyLower.includes('dental') || replyLower.includes('blanqueamiento') || replyLower.includes('ortodoncia') || replyLower.includes('implante') || replyLower.includes('limpieza') || replyLower.includes('diente') || replyLower.includes('sonrisa');
      if (!hasDentalContext) {
        throw new Error(`La respuesta no contiene contexto dental. Respuesta: "${data.reply}"`);
      }
    });

    await check('POST /api/chat sobre formas de pago y MSI responde con datos de la clínica', async () => {
      const res = await fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId: 'clinica-dental-norte',
          sessionId: 'test_paciente_002',
          message: '¿Tienen meses sin intereses para ortodoncia o implantes?'
        })
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      if (!data.reply) throw new Error(`Sin respuesta en reply: ${JSON.stringify(data)}`);
      
      const replyLower = data.reply.toLowerCase();
      const hasPaymentContext = replyLower.includes('msi') || replyLower.includes('meses') || replyLower.includes('tarjeta') || replyLower.includes('intereses') || replyLower.includes('pago') || replyLower.includes('ortodoncia') || replyLower.includes('implante');
      if (!hasPaymentContext) {
        throw new Error(`La respuesta no contiene datos de pago/MSI. Respuesta: "${data.reply}"`);
      }
    });

    // 6. Resumen de Métricas / Overview aislado
    console.log('\n[6/6] Verificando métricas aisladas de clinica-dental-norte...');
    await check('GET /api/overview?bot_id=clinica-dental-norte devuelve datos de la clínica dental', async () => {
      const res = await fetch(`${url}/api/overview?bot_id=clinica-dental-norte`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      if (!data.business || data.business.name !== 'Clínica Dental Norte') {
        throw new Error(`Nombre de negocio incorrecto: ${data.business?.name}`);
      }
      if (!data.bot || data.bot.name !== 'Asistente Dental Norte') {
        throw new Error(`Nombre de bot incorrecto: ${data.bot?.name}`);
      }
    });

  } finally {
    if (serverInstance) {
      serverInstance.close();
    }
  }

  console.log('\n==================================================');
  if (failed === 0) {
    console.log(`🎉 TODAS LAS PRUEBAS DE SEGURIDAD Y MULTI-TENANT PASARON (${passed}/${total})`);
  } else {
    console.error(`❌ FALLARON PRUEBAS (${passed} pasadas, ${failed} fallidas de ${total})`);
  }
  console.log('==================================================\n');

  if (failed > 0) throw new Error(`Fallaron ${failed} pruebas multi-tenant`);
  return { total, passed, failed };
}

// Auto-ejecución si se corre directo
if (process.argv[1].endsWith('test-multi-tenant-security.js')) {
  const targetUrl = process.argv[2] || null;
  runMultiTenantTests(targetUrl).catch(err => {
    console.error('Fallo general:', err);
    process.exit(1);
  });
}
