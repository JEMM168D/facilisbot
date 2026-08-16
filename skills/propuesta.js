import fs from 'fs';
import path from 'path';

/**
 * Skill: /propuesta (Modo Agencia)
 * Crafts a compelling, honest commercial proposal document for closing a client sale.
 */
export async function generateProposal({
  clientName = 'Cliente Empresa',
  businessProblem = 'pérdida de clientes por respuestas tardías fuera de horario en WhatsApp',
  setupPrice = 750,
  monthlyPrice = 150
} = {}) {
  const agencyDir = path.join(process.cwd(), 'member', 'agencia');
  if (!fs.existsSync(agencyDir)) fs.mkdirSync(agencyDir, { recursive: true });

  const filename = `propuesta-${clientName.toLowerCase().replace(/[^a-z0-9]/g, '-')}.md`;
  const filePath = path.join(agencyDir, filename);

  const proposalMd = `# 🚀 Propuesta Comercial · Implementación de Chatbot de IA
**Cliente:** ${clientName}  
**Fecha:** ${new Date().toLocaleDateString('es-ES')}  
**Preparado por:** Tu Agencia de Soluciones de IA  

---

## 1. El Desafío Actual
Hoy en día, los clientes esperan respuestas inmediatas en canales digitales como WhatsApp e Instagram. Detectamos que existe una oportunidad clave para resolver:
> *${businessProblem}*, permitiendo atender a cualquier interesado en segundos y calificar sus necesidades antes de que busquen a la competencia.

---

## 2. Nuestra Solución: Asistente de IA a Medida
Implementaremos un chatbot de inteligencia artificial entrenado exclusivamente con la información, catálogo, precios y políticas de **${clientName}**:
- **Atención Instantánea 24/7:** Respuestas precisas en menos de 2 segundos.
- **Captura Automática de Prospectos:** Guarda nombre, teléfono e interés de compra en una base de datos propia.
- **Panel Administrativo Exclusivo:** Para que tu equipo consulte conversaciones en vivo y exporte prospectos a Excel.
- **Filtro y Escalación Inteligente:** Detecta solicitudes complejas y las transfiere con cortesía a un asesor humano.

---

## 3. Plan de Inversión
- **Implementación y Entrenamiento Inicial:** **$${setupPrice} USD** (Pago único).
- **Mantenimiento, Servidores y Soporte Continuo:** **$${monthlyPrice} USD / mes**.

---

## 4. Tiempos de Entrega
- **Día 1-2:** Recopilación de información oficial (menú, horarios, FAQs).
- **Día 3-4:** Entrenamiento del motor de IA y pruebas en simulador.
- **Día 5:** Conexión de canales oficiales y entrega de accesos al panel.

---
*Para aprobar esta propuesta y comenzar el despliegue, confirma por este medio.*
`;

  fs.writeFileSync(filePath, proposalMd, 'utf8');

  console.log(`\n\x1b[32m✓\x1b[0m Propuesta comercial generada exitosamente en: \x1b[36m${filePath}\x1b[0m\n`);

  return { success: true, filePath };
}

const clientArg = process.argv[2] || 'Cliente Empresa';
if (process.argv[1] && process.argv[1].endsWith('propuesta.js')) {
  generateProposal({ clientName: clientArg });
}
