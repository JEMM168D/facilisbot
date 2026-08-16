import { loadConfig } from './config.js';
import { db } from './storage/db.js';
import { kb } from './knowledge/search.js';
import { UniversalLlmEngine } from './llm/index.js';

/**
 * Main Conversation Engine for Yunque Bots
 */
export class BotEngine {
  constructor(config = null) {
    this.config = config || loadConfig();
    this.llm = new UniversalLlmEngine(this.config);
  }

  updateConfig(newConfig) {
    this.config = newConfig;
    this.llm = new UniversalLlmEngine(this.config);
    kb.reload();
  }

  /**
   * Process an incoming user message across any channel
   */
  async processMessage({
    channel = 'web',
    userId,
    userName = '',
    text,
    audioUrl = null,
    metadata = {}
  }) {
    if (!text || text.trim() === '') {
      return {
        reply: 'Disculpa, no recibí ningún mensaje de texto.',
        conversationId: null
      };
    }

    // 1. Get or create conversation
    const conversation = db.getOrCreateConversation(channel, userId, userName);

    // 2. Save incoming user message
    db.addMessage({
      conversationId: conversation.id,
      role: 'user',
      content: text.trim()
    });

    // 3. If conversation is escalated to human, return notification unless human resolved it
    if (conversation.status === 'escalated') {
      const escalationNotice = this.config.bot?.escalationMessage ||
        'Tu conversación está siendo atendida por un asesor humano. En breve te responderá directamente.';
      return {
        reply: escalationNotice,
        conversationId: conversation.id,
        status: 'escalated',
        isHumanEscalated: true
      };
    }

    // 4. Retrieve RAG context from Knowledge Base
    const kbContext = kb.getContextForQuery(text);

    // 5. Build dynamic system prompt
    const systemPrompt = this.buildSystemPrompt();

    // 6. Retrieve recent message history
    const rawHistory = db.getMessages(conversation.id, 12);
    const messages = rawHistory.map(m => ({
      role: m.role,
      content: m.content
    }));

    // 7. Call LLM Engine with tools and context
    const llmResponse = await this.llm.generateResponse({
      systemPrompt,
      messages,
      contextInfo: kbContext,
      conversationContext: {
        conversationId: conversation.id,
        channel,
        userId,
        userName: conversation.userName,
        config: this.config
      }
    });

    const replyText = llmResponse.content || this.config.bot?.fallbackMessage || '¿En qué más te puedo ayudar?';

    // 8. Save assistant response
    db.addMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: replyText,
      toolCalls: llmResponse.toolCalls,
      tokens: llmResponse.tokensUsed
    });

    return {
      reply: replyText,
      conversationId: conversation.id,
      status: conversation.status,
      leadId: conversation.leadId,
      tools: llmResponse.executedTools || null,
      tokensUsed: llmResponse.tokensUsed,
      provider: llmResponse.provider,
      model: llmResponse.model
    };
  }

  /**
   * Construct detailed, business-grounded system instructions
   */
  buildSystemPrompt() {
    const { bot, business } = this.config;

    return `Eres ${bot.name || 'el Asistente Virtual'}, un agente de atención al cliente y ventas altamente capacitado para "${business.name}".
Giro del negocio: ${bot.niche || 'Servicios'}.
Tu personalidad y tono de comunicación: ${bot.personality || 'cercano, servicial, profesional y conciso'}.

INFORMACIÓN OFICIAL DEL NEGOCIO:
- Nombre: ${business.name}
- Descripción: ${business.description || ''}
- Servicios / Oferta principal: ${business.services || ''}
- Horarios de atención: ${business.hours || 'Lunes a Viernes 9am - 6pm'}
- Ubicación / Cobertura: ${business.location || 'Online / Presencial'}
- Teléfono de contacto: ${business.phone || ''}
- Correo electrónico: ${business.email || ''}
- Sitio web: ${business.website || ''}
- Métodos de pago aceptados: ${business.paymentMethods || 'Efectivo, Tarjeta, Transferencia'}

DIRECTRICES Y REGLAS DE RESPUESTA:
1. Responde SIEMPRE en español de forma natural, clara y directa.
2. Da respuestas breves y legibles para mensajería instantánea (evita párrafos excesivamente largos).
3. Utiliza la base de conocimiento para datos específicos (precios, políticas, menú). NUNCA inventes precios, promociones o servicios que no estén en la información oficial.
4. Si un usuario muestra interés de compra, cotización o reserva, solicita amablemente sus datos (nombre, WhatsApp/teléfono o email) y utiliza la herramienta "capture_lead".
5. Si el cliente pide expresamente hablar con un humano o presenta una queja que no puedes resolver, utiliza "escalate_to_human" con empatía.
6. Guía la conversación hacia el cierre de citas, pedidos o resolución de dudas según el giro del negocio.`;
  }
}

export const botEngine = new BotEngine();
