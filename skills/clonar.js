import fs from 'fs';
import path from 'path';
import { kb } from '../src/core/knowledge/search.js';

/**
 * Skill: /clonar
 * Crawls a business website, parses its content, and builds accurate Knowledge Base markdown files.
 */
export async function cloneWebsite(targetUrl) {
  if (!targetUrl) {
    console.error('Debes proporcionar una URL. Uso: node skills/clonar.js <https://ejemplo.com>');
    return;
  }

  console.log(`\n\x1b[38;5;220mExtrayendo información de:\x1b[0m \x1b[36m${targetUrl}\x1b[0m\n`);

  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) YunqueBot-Cloner/1.0'
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const html = await res.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Sitio Web';

    // Extract meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
    const description = descMatch ? descMatch[1].trim() : '';

    // Strip HTML scripts and styles
    let cleanText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\n\s*\n+/g, '\n')
      .trim();

    // Extract potential contact info
    const phones = cleanText.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g) || [];
    const emails = cleanText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];

    const kbDir = path.join(process.cwd(), 'member', 'kb');
    if (!fs.existsSync(kbDir)) fs.mkdirSync(kbDir, { recursive: true });

    const filename = 'sitio-web-clonado.md';
    const filePath = path.join(kbDir, filename);

    const docContent = `# Información Extraída de ${title}
**Fuente Oficial:** ${targetUrl}  
**Fecha de Clonación:** ${new Date().toLocaleDateString('es-ES')}  
**Descripción General:** ${description || 'No especificada'}

---

## 📞 Datos de Contacto Detectados
- **Teléfonos detectados:** ${Array.from(new Set(phones)).slice(0, 3).join(', ') || 'No detectados'}
- **Correos detectados:** ${Array.from(new Set(emails)).slice(0, 3).join(', ') || 'No detectados'}

---

## 📄 Contenido y Servicios Extraídos
${cleanText.slice(0, 4000)}

---
*Nota: Revisa y ajusta este documento para validar que no haya datos obsoletos.*
`;

    fs.writeFileSync(filePath, docContent, 'utf8');
    kb.reload();

    console.log(`  \x1b[32m✓\x1b[0m Información extraída y guardada en: \x1b[36m${filePath}\x1b[0m`);
    console.log(`  \x1b[32m✓\x1b[0m Base de conocimiento actualizada e indexada automáticamente.\n`);

    return { success: true, filePath, title, description };
  } catch (err) {
    console.error(`\x1b[31mError clonando sitio web:\x1b[0m`, err.message);
    return { success: false, error: err.message };
  }
}

const targetUrlArg = process.argv[2];
if (process.argv[1] && process.argv[1].endsWith('clonar.js') && targetUrlArg) {
  cloneWebsite(targetUrlArg);
}
