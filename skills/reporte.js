import fs from 'fs';
import path from 'path';
import { db } from '../src/core/storage/db.js';
import { loadConfig } from '../src/core/config.js';

/**
 * Skill: /reporte
 * Generates an executive monthly value report for the business owner or client.
 */
export async function generateMonthlyReport() {
  const config = await loadConfig();
  const metrics = db.getOverviewMetrics();
  const leads = db.listLeads({ limit: 1000 }).leads;

  const now = new Date();
  const monthName = now.toLocaleString('es-ES', { month: 'long' });
  const year = now.getFullYear();

  const reportDir = path.join(process.cwd(), 'member', 'reportes');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

  const filename = `informe-${monthName}-${year}.md`;
  const targetPath = path.join(reportDir, filename);

  const markdown = `# 📊 Informe Mensual de Rendimiento · ${config.business?.name || 'Mi Negocio'}
**Período:** ${monthName.toUpperCase()} ${year}  
**Asistente IA:** ${config.bot?.name || 'Asistente'} (${config.bot?.niche || 'Giro General'})  
**Generado:** ${now.toLocaleDateString('es-ES')} ${now.toLocaleTimeString('es-ES')}

---

## 🚀 Resumen Ejecutivo
Durante este mes, tu asistente de inteligencia artificial operó de forma continua para atender consultas, prospectos y solicitudes en todos tus canales:

- **Total de conversaciones atendidas:** ${metrics.totalConversations}
- **Tasa de resolución automática del bot:** **${metrics.botResolutionRate}** (sin requerir intervención humana)
- **Transferencias a equipo humano:** ${metrics.escalatedCount} (${metrics.escalationRate})
- **Nuevos prospectos / leads capturados:** **${metrics.totalLeads}**
- **Costo aproximado de IA del mes:** **$${metrics.estimatedCostUsd} USD**

---

## 📈 Valor Generado para el Negocio
1. **Ahorro de Tiempo:** El asistente resolvió ${metrics.totalConversations - metrics.escalatedCount} consultas de forma 100% autónoma, ahorrando aproximadamente **${Math.round((metrics.totalConversations * 4) / 60)} horas** de atención manual.
2. **Atención 24/7:** Clientes atendidos fuera de horario comercial sin esperas.
3. **Captura Oportuna de Datos:** ${metrics.totalLeads} prospectos registrados con nombre, contacto e interés directo para seguimiento comercial.

---

## 👥 Últimos Prospectos Capturados
${leads.slice(0, 10).map(l => `- **${l.name || 'Prospecto'}** (${l.phone || l.email || 'Sin contacto'}): *${l.interest || 'Consulta general'}* [Estado: ${l.status}]`).join('\n') || '- Sin prospectos registrados en este período.'}

---
*Informe generado automáticamente por Yunque Bots para ${config.business?.name || 'la empresa'}.*
`;

  fs.writeFileSync(targetPath, markdown, 'utf8');

  console.log(`\n\x1b[32m✓\x1b[0m Informe mensual generado exitosamente en: \x1b[36m${targetPath}\x1b[0m`);
  console.log(`\x1b[38;5;220mResumen rápido:\x1b[0m ${metrics.totalConversations} conversaciones · ${metrics.botResolutionRate} resueltas sin humano · ${metrics.totalLeads} leads capturados.\n`);

  return { success: true, path: targetPath, metrics };
}

// Direct execution
if (process.argv[1] && process.argv[1].endsWith('reporte.js')) {
  generateMonthlyReport();
}
