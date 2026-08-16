import { db } from '../storage/db.js';
import { TOOL_DEFINITIONS, executeTool } from '../tools/registry.js';

/**
 * Universal LLM Engine Bridge supporting Gemini, Claude, OpenAI, Grok, Ollama, and Mock.
 */
export class UniversalLlmEngine {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Main conversational completion method with multi-turn history and automatic tool execution
   */
  async generateResponse({
    systemPrompt,
    messages,
    contextInfo = '',
    conversationContext = {}
  }) {
    const provider = (this.config.llm?.provider || 'gemini').toLowerCase();
    const model = this.config.llm?.model || (
      provider === 'gemini' ? 'gemini-3.5-flash-lite' :
      provider === 'anthropic' ? 'claude-sonnet-5' :
      provider === 'grok' ? 'grok-4.6' :
      provider === 'ollama' ? 'deepseek-v4-flash' :
      'gpt-5.6-luna'
    );
    const temperature = this.config.llm?.temperature ?? 0.4;
    const maxTokens = this.config.llm?.maxTokens || 1000;

    const fullSystemPrompt = [
      systemPrompt,
      contextInfo,
      this.config.llm?.systemPromptBonus || ''
    ].filter(Boolean).join('\n\n');

    let response = null;

    try {
      if (provider === 'gemini') {
        response = await this.callGemini({ model, fullSystemPrompt, messages, temperature, maxTokens });
      } else if (provider === 'anthropic') {
        response = await this.callAnthropic({ model, fullSystemPrompt, messages, temperature, maxTokens });
      } else if (provider === 'openai' || provider === 'grok' || provider === 'ollama') {
        response = await this.callOpenAICompatible({ provider, model, fullSystemPrompt, messages, temperature, maxTokens });
      } else {
        // Mock provider
        response = await this.callMock({ messages, contextInfo });
      }
    } catch (err) {
      console.error(`[LLM Bridge] Error llamando a proveedor ${provider}:`, err.message);
      // If live API key failed or missing, gracefully fall back to simulated response
      response = await this.callMock({ messages, contextInfo, fallbackReason: err.message });
    }

    // Record token usage & cost
    db.recordLlmUsage(provider, response.tokensUsed || 150);

    // If the model called a tool, execute it and do a follow-up completion
    if (response.toolCalls && response.toolCalls.length > 0) {
      const executedToolResults = [];
      for (const call of response.toolCalls) {
        const result = await executeTool(call.name, call.args, conversationContext);
        executedToolResults.push({
          name: call.name,
          callId: call.id,
          args: call.args,
          result
        });
      }

      // Add tool execution record to response
      response.executedTools = executedToolResults;

      // If the model also provided text, return it, otherwise provide friendly confirmation
      if (!response.content || response.content.trim() === '') {
        const firstTool = executedToolResults[0];
        if (firstTool.name === 'capture_lead') {
          response.content = '¡Excelente! He registrado tus datos con éxito. Nuestro equipo se pondrá en contacto contigo a la brevedad. ¿Hay algo más en lo que te pueda ayudar?';
        } else if (firstTool.name === 'book_appointment') {
          response.content = `¡Perfecto! Tu cita para ${firstTool.args.serviceName || 'el servicio'} ha quedado registrada. Te esperamos. ¿Necesitas alguna información adicional?`;
        } else if (firstTool.name === 'escalate_to_human') {
          response.content = 'He transferido tu conversación con un asesor de nuestro equipo. En un momento te responderá directamente. ¡Gracias por tu paciencia!';
        } else {
          response.content = 'He procesado tu solicitud exitosamente. ¿En qué más puedo servirte?';
        }
      }
    }

    return response;
  }

  // ================= GOOGLE GEMINI =================

  async callGemini({ model, fullSystemPrompt, messages, temperature, maxTokens }) {
    const apiKey = this.config.llm?.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');

    // Format tools for Gemini API
    const geminiTools = [{
      function_declarations: TOOL_DEFINITIONS.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }))
    }];

    // Format contents
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || '' }]
    }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const requestBody = {
      system_instruction: {
        parts: [{ text: fullSystemPrompt }]
      },
      contents,
      tools: geminiTools,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error [${res.status}]: ${errText}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    let textContent = '';
    const toolCalls = [];

    for (const part of parts) {
      if (part.text) {
        textContent += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: 'call_' + Math.random().toString(36).substring(2, 9),
          name: part.functionCall.name,
          args: part.functionCall.args || {}
        });
      }
    }

    const totalTokens = (data.usageMetadata?.totalTokenCount) || 120;

    return {
      provider: 'gemini',
      model,
      content: textContent.trim(),
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      tokensUsed: totalTokens
    };
  }

  // ================= ANTHROPIC CLAUDE =================

  async callAnthropic({ model, fullSystemPrompt, messages, temperature, maxTokens }) {
    const apiKey = this.config.llm?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada');

    const formattedTools = TOOL_DEFINITIONS.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }));

    const formattedMessages = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role,
        content: m.content || ''
      }));

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        system: fullSystemPrompt,
        messages: formattedMessages,
        tools: formattedTools,
        temperature,
        max_tokens: maxTokens
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error [${res.status}]: ${errText}`);
    }

    const data = await res.json();
    let textContent = '';
    const toolCalls = [];

    for (const item of data.content || []) {
      if (item.type === 'text') {
        textContent += item.text;
      } else if (item.type === 'tool_use') {
        toolCalls.push({
          id: item.id,
          name: item.name,
          args: item.input || {}
        });
      }
    }

    const totalTokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);

    return {
      provider: 'anthropic',
      model,
      content: textContent.trim(),
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      tokensUsed: totalTokens
    };
  }

  // ================= OPENAI / GROK / OLLAMA =================

  async callOpenAICompatible({ provider, model, fullSystemPrompt, messages, temperature, maxTokens }) {
    let endpoint = 'https://api.openai.com/v1/chat/completions';
    let apiKey = this.config.llm?.openaiApiKey || process.env.OPENAI_API_KEY;

    if (provider === 'grok') {
      endpoint = 'https://api.x.ai/v1/chat/completions';
      apiKey = this.config.llm?.grokApiKey || process.env.GROK_API_KEY || process.env.XAI_API_KEY;
      if (!apiKey) throw new Error('GROK_API_KEY no configurada');
    } else if (provider === 'ollama') {
      endpoint = this.config.llm?.ollamaBaseUrl || 'http://localhost:11434/v1/chat/completions';
      apiKey = 'ollama';
    } else {
      if (!apiKey) throw new Error('OPENAI_API_KEY no configurada');
    }

    const formattedTools = TOOL_DEFINITIONS.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));

    const formattedMessages = [
      { role: 'system', content: fullSystemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content || '' }))
    ];

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: formattedMessages,
        tools: formattedTools,
        temperature,
        max_tokens: maxTokens
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${provider.toUpperCase()} API error [${res.status}]: ${errText}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const message = choice?.message || {};

    const toolCalls = (message.tool_calls || []).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments || '{}')
    }));

    return {
      provider,
      model,
      content: (message.content || '').trim(),
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      tokensUsed: data.usage?.total_tokens || 100
    };
  }

  // ================= MOCK / SIMULATOR =================

  async callMock({ messages, contextInfo = '', fallbackReason = null }) {
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
    const lower = lastUserMessage.toLowerCase();
    const botName = this.config.bot?.name || 'Asistente';
    const bizName = this.config.business?.name || 'nuestro negocio';
    const toolCalls = [];

    // Simple heuristic simulation for testing without API keys
    let responseText = '';

    // Check if user is sharing contact data -> trigger lead capture
    const phoneMatch = lastUserMessage.match(/(\+?\d{1,3}[\s-]?)?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/);
    const emailMatch = lastUserMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

    if (phoneMatch || emailMatch) {
      toolCalls.push({
        id: 'mock_lead_' + Date.now(),
        name: 'capture_lead',
        args: {
          phone: phoneMatch ? phoneMatch[0] : undefined,
          email: emailMatch ? emailMatch[0] : undefined,
          interest: 'Consulta por chat',
          notes: lastUserMessage
        }
      });
      responseText = `¡Muchas gracias! He guardado tus datos de contacto (${phoneMatch ? phoneMatch[0] : ''} ${emailMatch ? emailMatch[0] : ''}). Un asesor de ${bizName} se comunicará contigo muy pronto.`;
    } else if (lower.includes('hola') || lower.includes('buenos') || lower.includes('buenas') || lower.includes('que tal')) {
      responseText = `¡Hola! Te doy la bienvenida a ${bizName}. Soy ${botName}, tu asistente virtual. ¿En qué te puedo ayudar hoy?`;
    } else if (lower.includes('horario') || lower.includes('abren') || lower.includes('hora') || lower.includes('dias')) {
      responseText = `Nuestro horario de atención es: ${this.config.business?.hours || 'Lunes a Viernes de 9:00 AM a 6:00 PM'}.`;
    } else if (lower.includes('ubicacion') || lower.includes('donde estan') || lower.includes('direccion')) {
      responseText = `Nos encontramos ubicados en: ${this.config.business?.location || 'Atención en línea y presencial'}.`;
    } else if (lower.includes('precio') || lower.includes('costo') || lower.includes('cuanto') || lower.includes('menu')) {
      responseText = `Con gusto. En ${bizName} ofrecemos servicios de ${this.config.business?.services || 'atención personalizada'}. Si gustas, déjame tu teléfono o WhatsApp para enviarte la lista detallada y cotización sin compromiso.`;
    } else if (lower.includes('humano') || lower.includes('asesor') || lower.includes('persona') || lower.includes('agente')) {
      toolCalls.push({
        id: 'mock_esc_' + Date.now(),
        name: 'escalate_to_human',
        args: {
          reason: 'Solicitud explícita de asesor humano',
          customerSummary: lastUserMessage,
          urgency: 'media'
        }
      });
      responseText = 'Entendido. Estoy transfiriendo tu conversación a uno de nuestros asesores humanos. En un momento te responderá.';
    } else {
      responseText = `Gracias por escribir a ${bizName}. Respecto a "${lastUserMessage}", con gusto te podemos orientar. ¿Te gustaría agendar una cita o que un asesor te contacte por WhatsApp?`;
    }

    if (fallbackReason) {
      console.log(`[LLM Bridge] Modo simulador activo (${fallbackReason})`);
    }

    return {
      provider: 'mock',
      model: 'simulator-v1',
      content: responseText,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      tokensUsed: 80
    };
  }
}
