import fs from 'fs';
import path from 'path';
import { db } from '../src/core/storage/db.js';

/**
 * Skill: /exportar
 * Exports all leads and conversations to CSV and JSON formats.
 */
export async function exportData() {
  const exportDir = path.join(process.cwd(), 'member', 'exportaciones');
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const dateStr = new Date().toISOString().slice(0, 10);

  // 1. Leads CSV & JSON
  const leadsCsv = db.exportLeadsCsv();
  const leadsJson = JSON.stringify(db.listLeads({ limit: 10000 }).leads, null, 2);

  const leadsCsvPath = path.join(exportDir, `leads-${dateStr}.csv`);
  const leadsJsonPath = path.join(exportDir, `leads-${dateStr}.json`);

  fs.writeFileSync(leadsCsvPath, leadsCsv, 'utf8');
  fs.writeFileSync(leadsJsonPath, leadsJson, 'utf8');

  // 2. Conversations CSV
  const convsCsv = db.exportConversationsCsv();
  const convsCsvPath = path.join(exportDir, `conversaciones-${dateStr}.csv`);
  fs.writeFileSync(convsCsvPath, convsCsv, 'utf8');

  console.log(`\n\x1b[32m✓\x1b[0m Exportación completada exitosamente en \x1b[36m${exportDir}\x1b[0m:`);
  console.log(`  • Leads CSV:          ${leadsCsvPath}`);
  console.log(`  • Leads JSON:         ${leadsJsonPath}`);
  console.log(`  • Conversaciones CSV: ${convsCsvPath}\n`);

  return { leadsCsvPath, leadsJsonPath, convsCsvPath };
}

if (process.argv[1] && process.argv[1].endsWith('exportar.js')) {
  exportData();
}
