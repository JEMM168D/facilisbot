import fs from 'fs';
import path from 'path';
import { kb } from '../src/core/knowledge/search.js';

/**
 * Skill: /precios
 * Fast price and catalog updater.
 */
export async function updatePrices(itemUpdates = []) {
  console.log(`\n\x1b[38;5;220mActualizando catálogo de precios...\x1b[0m\n`);

  const kbDir = path.join(process.cwd(), 'member', 'kb');
  if (!fs.existsSync(kbDir)) fs.mkdirSync(kbDir, { recursive: true });

  const targetFile = path.join(kbDir, 'precios.md');

  let currentContent = '';
  if (fs.existsSync(targetFile)) {
    currentContent = fs.readFileSync(targetFile, 'utf8');
  }

  // Example update
  const newEntry = `\n- **${itemUpdates.name || 'Servicio/Producto'}**: $${itemUpdates.price || '0'} ${itemUpdates.currency || 'USD'} - ${itemUpdates.description || 'Actualizado recientemente'}`;

  const updatedContent = currentContent + newEntry;
  fs.writeFileSync(targetFile, updatedContent, 'utf8');
  kb.reload();

  console.log(`  \x1b[32m✓\x1b[0m Precio actualizado en \x1b[36m${targetFile}\x1b[0m`);
  console.log(`  \x1b[32m✓\x1b[0m Entrada añadida:\x1b[0m ${newEntry}\n`);

  return { success: true, targetFile };
}

if (process.argv[1] && process.argv[1].endsWith('precios.js')) {
  const name = process.argv[2] || 'Servicio Express';
  const price = process.argv[3] || '50';
  updatePrices({ name, price, currency: 'USD' });
}
