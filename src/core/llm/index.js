import { TOOL_DEFINITIONS, executeTool } from '../tools/registry.js';

/**
 * Universal LLM Engine Bridge supporting Gemini, Claude, OpenAI, Grok, Ollama, and Mock.
 * Fully supports multi-hop Function Calling and real-time tool execution.
 */
export class UniversalLlmEngine {
  constructor(config = {}, storage) {
    this.config = config;
    this.storage = storage;
  }

  /**
   * Normalize model names to active, valid API identifiers
   */
  normalizeModel(provider, rawModel) {
    const p = (provider || 'gemini').toLowerCase();
    const m = (rawModel || '').trim().toLowerCase();

    if (p === 'gemini') {
      if (m.includes('1.5-pro') || m.includes('pro')) return 'gemini-1.5-pro';
      if (m.includes('1.5-flash')) return 'gemini-1.5-flash';
      if (m.includes('flash-lite') || m.includes('2.0-flash-lite')) return 'gemini-2.0-flash-lite-preview-02-05';
      return 'gemini-2.0-flash';
    }

    if (p === 'anthropic') {
      if (m.includes('opus')) return 'claude-3-opus-20240229';
      if (m.includes('haiku')) return 'claude-3-5-haiku-20241022';
      return 'claude-3-5-sonnet-20241022';
    }

    if (p === 'openai') {
      if (m.includes('gpt-4o-mini') || m.includes('mini')) return 'gpt-4o-mini';
      if (m.includes('gpt-4o')) return 'gpt-4o';
      if (m.includes('gpt-3.5')) return 'gpt-3.5-turbo';
      return 'gpt-4o-mini';
    }

    if (p === 'grok') {
      if (m.includes('vision')) return 'grok-2-vision-1212';
      return 'grok-2-latest';
    }

    if (p === 'ollama') {
      return rawModel || 'llama3';
    }

    return rawModel || 'mock';
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
    const rawModel = this.config.llm?.model;
    const model = this.normalizeModel(provider, rawModel);
    const temperature = this.config.llm?.temperature ?? 0.4;
    const maxTokens = this.config.llm?.maxTokens || 1000;

    const fullSystemPrompt = [
      systemPrompt,
      contextInfo,
      this.config.llm?.systemPromptBonus || ''
    ].filter(Boolean).join('\n\n');

    let response = null;
    let totalTokensAccumulated = 0;
    const allExecutedTools = [];

    try {
      if (provider === 'gemini') {
        response = await this.callGeminiLoop({
          model,
          fullSystemPrompt,
          messages,
          temperature,
          maxTokens,
          conversationContext,
          allExecutedTools
        });
      } else if (provider === 'anthropic') {
        response = await this.callAnthropicLoop({
          model,
          fullSystemPrompt,
          messages,
          temperature,
          maxTokens,
          conversationContext,
          allExecutedTools
        });
      } else if (provider === 'openai' || provider === 'grok' || provider === 'ollama') {
        response = await this.callOpenAILoop({
          provider,
          model,
          fullSystemPrompt,
          messages,
          temperature,
          maxTokens,
          conversationContext,
          allExecutedTools
        });
      } else {
        response = await this.callMock({ messages, contextInfo, allExecutedTools, conversationContext });
      }
    } catch (err) {
      console.error(`[LLM Bridge] Error llamando a proveedor ${provider} (${model}):`, err.message);
      // If live API key failed or threw, fall back to intelligent simulated handler with explanation
      response = await this.callMock({
        messages,
        contextInfo,
        allExecutedTools,
        conversationContext,
        fallbackReason: `${err.message}`
      });
    }

    // Record token usage
    totalTokensAccumulated += (response.tokensUsed || 150);
    if (this.storage && typeof this.storage.recordLlmUsage === 'function') {
      await this.storage.recordLlmUsage(this.config.bot?.id || 'default', provider, totalTokensAccumulated);
    }

    return {
      provider,
      model,
      reply: response.content || 'Disculpa, ¿podrías repetir tu consulta?',
      content: response.content,
      tools: allExecutedTools.length > 0 ? allExecutedTools : null,
      tokensUsed: totalTokensAccumulated
    };
  }

  // ================= GOOGLE GEMINI MULTI-HOP FUNCTION CALLING =================

  async callGeminiLoop({
    model,
    fullSystemPrompt,
    messages,
    temperature,
    maxTokens,
    conversationContext,
    allExecutedTools
  }) {
    const apiKey = this.config.llm?.geminiApiKey;
    if (!apiKey) throw new Error('GEMINI_API_KEY no configurada. Guarda tu API key en Ajustes.');

    const geminiTools = [{
      function_declarations: TOOL_DEFINITIONS.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }))
    }];

    // Build Gemini history
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || '' }]
    }));

    let currentModel = model;
    let turnCount = 0;
    const maxTurns = 3;
    let finalContent = '';
    let totalTokens = 0;

    while (turnCount < maxTurns) {
      turnCount++;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
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

      let res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      // If 404 model not found, auto-fallback to gemini-2.0-flash or gemini-1.5-flash
      if (res.status === 404 && currentModel !== 'gemini-2.0-flash' && currentModel !== 'gemini-1.5-flash') {
        currentModel = 'gemini-2.0-flash';
        const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
        res = await fetch(fallbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API error [${res.status}]: ${errText}`);
      }

      const data = await res.json();
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      totalTokens += (data.usageMetadata?.totalTokenCount || 100);

      let textPart = '';
      const toolCallsInTurn = [];

      for (const part of parts) {
        if (part.text) textPart += part.text;
        if (part.functionCall) {
          toolCallsInTurn.push({
            name: part.functionCall.name,
            args: part.functionCall.args || {}
          });
        }
      }

      if (textPart) {
        finalContent += (finalContent ? '\n\n' : '') + textPart.trim();
      }

      // If no function call, we have our final text
      if (toolCallsInTurn.length === 0) {
        break;
      }

      // Model requested tool call(s): add assistant response with functionCall to history
      contents.push({
        role: 'model',
        parts: parts
      });

      // Execute each tool and add functionResponse to history
      const responseParts = [];
      for (const tool of toolCallsInTurn) {
        const result = await executeTool(tool.name, tool.args, conversationContext);
        allExecutedTools.push({
          name: tool.name,
          args: tool.args,
          result
        });

        responseParts.push({
          functionResponse: {
            name: tool.name,
            response: result
          }
        });
      }

      contents.push({
        role: 'user',
        parts: responseParts
      });
    }

    // If text was generated or provided after tools, return it
    if (!finalContent && allExecutedTools.length > 0) {
      const first = allExecutedTools[0];
      if (first.name === 'capture_lead') {
        finalContent = '¡Excelente! He registrado tus datos de contacto. Uno de nuestros asesores te contactará a la brevedad. ¿Hay algo más en lo que te pueda apoyar?';
      } else if (first.name === 'search_kb' && first.result?.results?.length > 0) {
        finalContent = first.result.results.map(r => r.content).join('\n\n');
      } else {
        finalContent = 'He procesado tu solicitud con éxito. ¿Tienes alguna otra consulta?';
      }
    }

    return {
      content: finalContent,
      tokensUsed: totalTokens
    };
  }

  // ================= ANTHROPIC CLAUDE MULTI-HOP =================

  async callAnthropicLoop({
    model,
    fullSystemPrompt,
    messages,
    temperature,
    maxTokens,
    conversationContext,
    allExecutedTools
  }) {
    const apiKey = this.config.llm?.anthropicApiKey;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada. Guarda tu API key en Ajustes.');

    const formattedTools = TOOL_DEFINITIONS.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }));

    let anthropicMessages = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role,
        content: m.content || ''
      }));

    let turnCount = 0;
    const maxTurns = 3;
    let finalContent = '';
    let totalTokens = 0;

    while (turnCount < maxTurns) {
      turnCount++;

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
          messages: anthropicMessages,
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
      totalTokens += ((data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0));

      const toolUseItems = [];
      for (const item of data.content || []) {
        if (item.type === 'text') {
          finalContent += (finalContent ? '\n\n' : '') + item.text.trim();
        } else if (item.type === 'tool_use') {
          toolUseItems.push(item);
        }
      }

      if (toolUseItems.length === 0) {
        break;
      }

      // Add assistant response to history
      anthropicMessages.push({
        role: 'assistant',
        content: data.content
      });

      // Execute tool and add tool_result
      const toolResultContent = [];
      for (const t of toolUseItems) {
        const result = await executeTool(t.name, t.input, conversationContext);
        allExecutedTools.push({
          name: t.name,
          args: t.input,
          result
        });

        toolResultContent.push({
          type: 'tool_result',
          tool_use_id: t.id,
          content: JSON.stringify(result)
        });
      }

      anthropicMessages.push({
        role: 'user',
        content: toolResultContent
      });
    }

    return {
      content: finalContent || 'He procesado tu consulta exitosamente.',
      tokensUsed: totalTokens
    };
  }

  // ================= OPENAI / GROK / OLLAMA MULTI-HOP =================

  async callOpenAILoop({
    provider,
    model,
    fullSystemPrompt,
    messages,
    temperature,
    maxTokens,
    conversationContext,
    allExecutedTools
  }) {
    let endpoint = 'https://api.openai.com/v1/chat/completions';
    let apiKey = this.config.llm?.openaiApiKey;

    if (provider === 'grok') {
      endpoint = 'https://api.x.ai/v1/chat/completions';
      apiKey = this.config.llm?.grokApiKey;
      if (!apiKey) throw new Error('GROK_API_KEY no configurada. Guarda tu API key en Ajustes.');
    } else if (provider === 'ollama') {
      endpoint = this.config.llm?.ollamaBaseUrl || 'http://localhost:11434/v1/chat/completions';
      apiKey = 'ollama';
    } else {
      if (!apiKey) throw new Error('OPENAI_API_KEY no configurada. Guarda tu API key en Ajustes.');
    }

    const formattedTools = TOOL_DEFINITIONS.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));

    let openAiMessages = [
      { role: 'system', content: fullSystemPrompt },
      ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' }))
    ];

    let turnCount = 0;
    const maxTurns = 3;
    let finalContent = '';
    let totalTokens = 0;

    while (turnCount < maxTurns) {
      turnCount++;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: openAiMessages,
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
      const choiceMsg = choice?.message;
      totalTokens += (data.usage?.total_tokens || 100);

      if (choiceMsg?.content) {
        finalContent += (finalContent ? '\n\n' : '') + choiceMsg.content.trim();
      }

      if (!choiceMsg?.tool_calls || choiceMsg.tool_calls.length === 0) {
        break;
      }

      // Add assistant tool calls to message history
      openAiMessages.push(choiceMsg);

      for (const call of choiceMsg.tool_calls) {
        let args = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch(e) {}

        const result = await executeTool(call.function.name, args, conversationContext);
        allExecutedTools.push({
          name: call.function.name,
          args,
          result
        });

        openAiMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result)
        });
      }
    }

    return {
      content: finalContent || 'He procesado tu solicitud.',
      tokensUsed: totalTokens
    };
  }

  // ================= INTELLIGENT SIMULATED FALLBACK =================

  async callMock({ messages, contextInfo, allExecutedTools = [], conversationContext = {}, fallbackReason = null }) {
    const lastMsg = messages[messages.length - 1]?.content || '';
    const lastLower = lastMsg.toLowerCase();
    const biz = this.config.business || {};
    const bot = this.config.bot || {};

    let reply = '';

    // Automatic tool triggers based on message intent in simulation/fallback mode
    if (lastLower.includes('precio') || lastLower.includes('costo') || lastLower.includes('cuanto') || lastLower.includes('catálogo') || lastLower.includes('servicio')) {
      const searchResult = await executeTool('search_kb', { query: lastMsg }, conversationContext);
      allExecutedTools.push({ name: 'search_kb', args: { query: lastMsg }, result: searchResult });
      
      const details = searchResult?.results?.[0]?.content || biz.services || 'servicios especializados';
      reply = `¡Hola! Con gusto te comparto la información sobre nuestros precios y servicios:\n\n${details}\n\n¿Te gustaría que te coticemos formalmente o agendemos una cita?`;
    } else if (lastLower.includes('mi nombre') || lastLower.includes('me llamo') || lastLower.includes('whats') || lastLower.includes('telefono') || lastLower.includes('correo') || lastLower.includes('@')) {
      // Extract phone/email/name
      const emailMatch = lastMsg.match(/[\w.-]+@[\w.-]+\.\w+/);
      const phoneMatch = lastMsg.match(/(\+?\d[\d\s-]{7,}\d)/);
      const leadResult = await executeTool('capture_lead', {
        name: 'Cliente Interesado',
        phone: phoneMatch ? phoneMatch[0] : null,
        email: emailMatch ? emailMatch[0] : null,
        interest: lastMsg
      }, conversationContext);
      allExecutedTools.push({ name: 'capture_lead', args: { interest: lastMsg }, result: leadResult });

      reply = `¡Excelente! He registrado tus datos con éxito en nuestro sistema de atención. Un asesor se comunicará contigo a la brevedad para darte seguimiento puntual. ¿Hay algún otro detalle que quieras agregar?`;
    } else if (lastLower.includes('humano') || lastLower.includes('asesor') || lastLower.includes('persona') || lastLower.includes('queja') || lastLower.includes('hablar con alguien')) {
      const handoffResult = await executeTool('escalate_to_human', {
        reason: 'Solicitud de atención humana directa',
        customerSummary: lastMsg,
        urgency: 'media'
      }, conversationContext);
      allExecutedTools.push({ name: 'escalate_to_human', args: { reason: 'Solicitud cliente' }, result: handoffResult });

      reply = `Entiendo perfectamente. He transferido tu conversación con un asesor humano de nuestro equipo. En un momento te responderá directamente. ¡Gracias por tu paciencia!`;
    } else if (lastLower.includes('pagar') || lastLower.includes('link') || lastLower.includes('anticipo') || lastLower.includes('tarjeta') || lastLower.includes('transferencia')) {
      const payResult = await executeTool('create_payment_link', {
        amount: 50,
        currency: 'USD',
        description: 'Anticipo de servicio'
      }, conversationContext);
      allExecutedTools.push({ name: 'create_payment_link', args: { amount: 50, description: 'Anticipo' }, result: payResult });

      reply = `¡Por supuesto! Puedes realizar tu pago o anticipo directamente a través de nuestro enlace seguro:\n🔗 ${payResult.paymentUrl}\n\nO mediante nuestros métodos oficiales: ${payResult.bankTransferInfo}. ¿Deseas que te envíe el comprobante a tu WhatsApp?`;
    } else if (lastLower.includes('gracias') || lastLower.includes('excelente') || lastLower.includes('perfecto') || lastLower.includes('muy bien')) {
      const reviewResult = await executeTool('collect_review', { satisfactionLevel: 'alta' }, conversationContext);
      allExecutedTools.push({ name: 'collect_review', args: { satisfactionLevel: 'alta' }, result: reviewResult });

      reply = `¡Ha sido un placer atenderte! Si te gustó nuestro servicio, te agradeceríamos muchísimo una breve reseña de 5 estrellas en nuestro perfil:\n⭐ ${reviewResult.reviewUrl}\n\n¡Que tengas un excelente día!`;
    } else {
      reply = `¡Hola! Te doy la bienvenida a ${biz.name || 'nuestro negocio'}. Soy ${bot.name || 'tu asistente virtual'}. Puedo brindarte información sobre ${biz.services || 'nuestros servicios'}, horarios (${biz.hours || 'horario habitual'}), cotizaciones y agendar tu atención. ¿En qué te puedo ayudar hoy?`;
    }

    if (fallbackReason) {
      console.log(`[LLM Bridge Simulator Fallback] Razón: ${fallbackReason}`);
    }

    return {
      content: reply,
      tokensUsed: 120
    };
  }
}
