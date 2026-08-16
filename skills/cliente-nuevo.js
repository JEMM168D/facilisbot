import fs from 'fs';
import path from 'path';

/**
 * Skill: /cliente-nuevo (Modo Agencia)
 * Sets up a dedicated, isolated bot project directory for a new client.
 */
export async function createClientBot({
  clientName,
  niche = 'starter',
  targetFolder = null
}) {
  if (!clientName) {
    console.error('Debes proporcionar el nombre del cliente. Uso: node skills/cliente-nuevo.js "Nombre Cliente" [giro]');
    return;
  }

  const slug = clientName.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const baseDir = targetFolder || path.join(process.cwd(), 'clientes', slug);

  console.log(`\n\x1b[38;5;220m[Modo Agencia] Desplegando instancia independiente para cliente:\x1b[0m \x1b[1m${clientName}\x1b[0m\n`);

  fs.mkdirSync(path.join(baseDir, 'member', 'kb'), { recursive: true });
  fs.mkdirSync(path.join(baseDir, 'data'), { recursive: true });

  const clientConfig = {
    bot: {
      name: `Asistente ${clientName}`,
      niche,
      language: 'es',
      personality: 'profesional, atento, servicial y enfocado en ventas',
      greeting: `¡Hola! Bienvenido a ${clientName}. ¿En qué te podemos ayudar hoy?`,
      fallbackMessage: 'Disculpa, ¿podrías darme más detalles de tu consulta?',
      escalationMessage: 'Te paso de inmediato con un asesor humano del equipo.'
    },
    business: {
      name: clientName,
      industry: niche,
      description: `Empresa líder en ${niche}.`,
      services: 'Atención personalizada, cotizaciones y ventas',
      hours: 'Lunes a Sábado de 9:00 AM a 7:00 PM',
      location: 'Atención presencial y en línea',
      phone: '+1 555-0199',
      email: `contacto@${slug}.com`,
      paymentMethods: 'Efectivo, Tarjetas, Transferencia'
    },
    llm: {
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      temperature: 0.4
    },
    channels: {
      web: { enabled: true, title: `Chat ${clientName}` },
      whatsapp: { enabled: false },
      telegram: { enabled: false }
    }
  };

  fs.writeFileSync(path.join(baseDir, 'member', 'config.local.json'), JSON.stringify(clientConfig, null, 2), 'utf8');

  // Create initial KB file
  fs.writeFileSync(
    path.join(baseDir, 'member', 'kb', 'servicios.md'),
    `# Información y Servicios · ${clientName}\n\nDetalla aquí los servicios y precios de ${clientName}...`,
    'utf8'
  );

  console.log(`  \x1b[32m✓\x1b[0m Instancia creada en: \x1b[36m${baseDir}\x1b[0m`);
  console.log(`  \x1b[32m✓\x1b[0m Configuración inicial: \x1b[36m${path.join(baseDir, 'member', 'config.local.json')}\x1b[0m`);
  console.log(`\n\x1b[38;5;220mSiguiente paso comercial:\x1b[0m`);
  console.log(`  Ejecuta \x1b[1mnode skills/cotizar.js "${clientName}" ${niche}\x1b[0m para calcular precio de venta y mensualidad.\n`);

  return { success: true, clientDir: baseDir };
}

const clientNameArg = process.argv[2];
const nicheArg = process.argv[3] || 'starter';
if (process.argv[1] && process.argv[1].endsWith('cliente-nuevo.js') && clientNameArg) {
  createClientBot({ clientName: clientNameArg, niche: nicheArg });
}
