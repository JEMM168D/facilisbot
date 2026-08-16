import fs from 'fs';
import path from 'path';
import { db } from '../src/core/storage/db.js';
import { kb } from '../src/core/knowledge/search.js';
import { loadConfig } from '../src/core/config.js';

/**
 * Skill: /afinar
 * Mines conversation logs to find unanswered questions and proposes knowledge base diffs.
 */
export async function runTuning(queryFilter = null) {
  console.log(`\n\x1b[38;5;220mAnalizando conversaciones para afinación de respuestas...\x1b[0m\n`);

  const messages = db.data.messages || [];
  const userMessages = messages.filter(m => m.role === 'user');

  const unansweredQueries = [];

  for (const msg of userMessages) {
    const text = msg.content;
    if (!text || text.length < 5) continue;

    // Search KB for this query
    const results = kb.search(text, 2);
    if (results.length === 0 || results[0].score < 1.0) {
      unansweredQueries.push({
        text,
        date: msg.createdAt,
        matchedScore: results[0]?.score || 0
      });
    }
  }

  console.log(`  \x1b[32m✓\x1b[0m Se analizaron ${userMessages.length} mensajes de usuarios.`);
  console.log(`  \x1b[38;5;208m●\x1b[0m Preguntas con baja cobertura en Base de Conocimiento encontradas: ${unansweredQueries.length}\n`);

  if (unansweredQueries.length > 0) {
    console.log(`\x1b[38;5;220mTop preguntas que requieren afinación en /member/kb:\x1b[0m`);
    unansweredQueries.slice(0, 5).forEach((q, i) => {
      console.log(`  ${i + 1}. "${q.text}" (Coincidencia actual: ${q.matchedScore.toFixed(1)})`);
    });

    console.log(`\n\x1b[36mSugerencia de acción:\x1b[0m`);
    console.log(`  Crea o amplía un archivo en \x1b[1mmember/kb/faq.md\x1b[0m agregando las respuestas oficiales para estas consultas.`);
  } else {
    console.log(`\x1b[32m¡Excelente! La base de conocimiento cubre todas las consultas recientes de tus clientes.\x1b[0m`);
  }

  return { analyzed: userMessages.length, unanswered: unansweredQueries };
}

if (process.argv[1] && process.argv[1].endsWith('afinar.js')) {
  runTuning();
}
