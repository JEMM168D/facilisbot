import fs from 'fs';
import path from 'path';

/**
 * Skill: /cotizar (Modo Agencia)
 * Calculates healthy pricing for selling and maintaining a custom bot for a client.
 */
export async function calculateQuote({
  clientName = 'Cliente Potencial',
  niche = 'General',
  channelsCount = 2,
  includeBooking = true,
  includePayments = true
} = {}) {
  console.log(`\n\x1b[38;5;220m[Modo Agencia] Calculando Cotización para:\x1b[0m \x1b[1m${clientName}\x1b[0m\n`);

  // Healthy pricing standard
  let setupFee = 600; // Base setup in USD
  if (channelsCount > 1) setupFee += (channelsCount - 1) * 150;
  if (includeBooking) setupFee += 150;
  if (includePayments) setupFee += 150;

  let monthlyRetainer = 120; // Base monthly maintenance
  if (channelsCount > 2) monthlyRetainer += 40;
  if (includeBooking || includePayments) monthlyRetainer += 30;

  const quoteDir = path.join(process.cwd(), 'member', 'agencia');
  if (!fs.existsSync(quoteDir)) fs.mkdirSync(quoteDir, { recursive: true });

  const filename = `cotizacion-${clientName.toLowerCase().replace(/[^a-z0-9]/g, '-')}.md`;
  const filePath = path.join(quoteDir, filename);

  const quoteMd = `# 💼 Cotización de Chatbot de IA · ${clientName}
**Giro:** ${niche}  
**Fecha:** ${new Date().toLocaleDateString('es-ES')}  
**Validez:** 15 días naturales  

---

## 🛠️ Desglose de Inversión Inicial (Setup e Implementación)
1. **Configuración del Motor de IA y Personalidad:** $350 USD
2. **Carga e Indexación de Base de Conocimiento (RAG):** $250 USD
3. **Conexión Multicanal (${channelsCount} canales):** $${(channelsCount - 1) * 150} USD
4. **Integraciones Avanzadas (Agenda / Pagos / Leads):** $${(includeBooking ? 150 : 0) + (includePayments ? 150 : 0)} USD

**Total Setup Único:** **$${setupFee} USD** (50% anticipo al iniciar, 50% al entregar).

---

## 🔄 Mantenimiento y Operación Mensual
- **Monto Mensual:** **$${monthlyRetainer} USD / mes**
- **Incluye:**
  - Panel de control en vivo para el cliente con métricas y exportación de prospectos.
  - Actualización periódica de precios, horarios y promociones.
  - Supervisión de consumo de tokens y afinación mensual con informe de rendimiento.
  - Soporte técnico ante cambios de APIs de Meta/WhatsApp.

---
*Documento comercial generado por Yunque Bots para la agencia.*
`;

  fs.writeFileSync(filePath, quoteMd, 'utf8');

  console.log(`  \x1b[32m✓\x1b[0m Setup sugerido: \x1b[1m$${setupFee} USD\x1b[0m (pago único)`);
  console.log(`  \x1b[32m✓\x1b[0m Mensualidad recurrente: \x1b[1m$${monthlyRetainer} USD / mes\x1b[0m`);
  console.log(`  \x1b[32m✓\x1b[0m Documento guardado en: \x1b[36m${filePath}\x1b[0m\n`);

  return { setupFee, monthlyRetainer, filePath };
}

const clientArg = process.argv[2] || 'Prospecto Empresa';
const nicheArg = process.argv[3] || 'Comercial';
if (process.argv[1] && process.argv[1].endsWith('cotizar.js')) {
  calculateQuote({ clientName: clientArg, niche: nicheArg });
}
