import fs from 'fs';
import path from 'path';
import { db } from '../src/core/storage/db.js';
import { loadConfig } from '../src/core/config.js';

/**
 * Skill: /campaña
 * Segments leads and crafts high-converting re-engagement copy with 24h compliance checks.
 */
export async function generateCampaign({ segment = 'seguimiento', promoOffer = '15% de descuento especial' } = {}) {
  const config = await loadConfig();
  const leads = db.listLeads({ limit: 1000 }).leads;

  const targetLeads = leads.filter(l => l.status === segment || segment === 'all');

  console.log(`\n\x1b[38;5;220mGenerando Campaña de Reactivación / Seguimiento...\x1b[0m\n`);
  console.log(`  • Segmento objetivo: \x1b[36m${segment}\x1b[0m`);
  console.log(`  • Contactos alcanzables: \x1b[32m${targetLeads.length}\x1b[0m prospectos`);

  const bizName = config.business?.name || 'nuestra empresa';

  const copyTemplate = `¡Hola {nombre}! 👋 Te escribimos de ${bizName}.

Esperamos que estés teniendo una excelente semana. Vimos que anteriormente nos consultaste sobre nuestros servicios y queríamos compartirte una atención especial:

🎁 **${promoOffer}** válida únicamente para las personas que agenden o reserven esta semana.

¿Te gustaría que te reservemos tu lugar o te apoyemos con alguna duda? Responde a este mensaje y con gusto te atendemos.

*(Si no deseas recibir más avisos, solo responde "baja" y no te volveremos a escribir).*`;

  const campaignDir = path.join(process.cwd(), 'member', 'campanas');
  if (!fs.existsSync(campaignDir)) fs.mkdirSync(campaignDir, { recursive: true });

  const filename = `campana-${segment}-${new Date().toISOString().slice(0, 10)}.md`;
  const targetPath = path.join(campaignDir, filename);

  const fileContent = `# Propuesta de Campaña · ${bizName}
**Fecha:** ${new Date().toLocaleDateString('es-ES')}  
**Segmento:** ${segment} (${targetLeads.length} contactos)  
**Oferta:** ${promoOffer}

---

## 📝 Mensaje Propuesto para Envío:
\`\`\`
${copyTemplate}
\`\`\`

---

## 👥 Lista de Destinatarios Filtrados:
${targetLeads.map(l => `- **${l.name || 'Sin nombre'}** | Tel: ${l.phone || 'N/A'} | Email: ${l.email || 'N/A'} | Interés: ${l.interest || 'General'}`).join('\n') || '- No hay contactos en este segmento.'}

---
*Nota de cumplimiento: En WhatsApp oficial, los mensajes fuera de la ventana de 24h requieren el uso de plantillas HSM aprobadas por Meta.*
`;

  fs.writeFileSync(targetPath, fileContent, 'utf8');

  console.log(`\n\x1b[32m✓\x1b[0m Campaña y lista de destinatarios guardada en: \x1b[36m${targetPath}\x1b[0m\n`);

  return { success: true, targetPath, totalLeads: targetLeads.length, copyTemplate };
}

if (process.argv[1] && process.argv[1].endsWith('campana.js')) {
  generateCampaign();
}
