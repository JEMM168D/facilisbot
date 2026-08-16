import fs from 'fs';
import path from 'path';

/**
 * Skill: /cobrar (Modo Agencia)
 * Generates payment links and logs receipts in member/agencia/cobros.md.
 */
export async function generatePaymentRecord({
  clientName = 'Cliente Empresa',
  concept = 'Setup e Implementación de Chatbot',
  amount = 600,
  currency = 'USD',
  paymentMethod = 'Stripe'
} = {}) {
  const agencyDir = path.join(process.cwd(), 'member', 'agencia');
  if (!fs.existsSync(agencyDir)) fs.mkdirSync(agencyDir, { recursive: true });

  const cobrosFile = path.join(agencyDir, 'cobros.md');

  // Simulated link if not connected
  let paymentLink = `https://checkout.stripe.com/pay/cs_live_${Date.now()}`;
  if (paymentMethod.toLowerCase() === 'mercadopago') {
    paymentLink = `https://mpago.la/pos/${Date.now()}`;
  }

  const logEntry = `\n| ${new Date().toLocaleDateString('es-ES')} | **${clientName}** | ${concept} | **$${amount} ${currency}** | ${paymentMethod} | [Link de Pago](${paymentLink}) | Pendiente |`;

  let fileContent = '';
  if (fs.existsSync(cobrosFile)) {
    fileContent = fs.readFileSync(cobrosFile, 'utf8');
  } else {
    fileContent = `# 💳 Registro y Control de Cobros · Agencia\n\n| Fecha | Cliente | Concepto | Monto | Método | Enlace de Pago | Estado |\n|---|---|---|---|---|---|---|`;
  }

  fileContent += logEntry;
  fs.writeFileSync(cobrosFile, fileContent, 'utf8');

  console.log(`\n\x1b[38;5;220m[Modo Agencia] Registro de Cobro Generado:\x1b[0m\n`);
  console.log(`  • Cliente:         \x1b[1m${clientName}\x1b[0m`);
  console.log(`  • Concepto:        ${concept}`);
  console.log(`  • Monto:           \x1b[32m$${amount} ${currency}\x1b[0m`);
  console.log(`  • Link de pago:    \x1b[36m${paymentLink}\x1b[0m`);
  console.log(`  • Registro en:     ${cobrosFile}\n`);

  return { success: true, paymentLink, cobrosFile };
}

const clientArg = process.argv[2] || 'Cliente Empresa';
const amountArg = parseFloat(process.argv[3] || '600');
if (process.argv[1] && process.argv[1].endsWith('cobrar.js')) {
  generatePaymentRecord({ clientName: clientArg, amount: amountArg });
}
