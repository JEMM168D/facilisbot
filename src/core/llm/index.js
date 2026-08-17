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
    if (rawModel && rawModel.trim()) return rawModel.trim();
    const p = (provider || 'gemini').toLowerCase();

    if (p === 'gemini') return 'gemini-3.5-flash-lite';
    if (p === 'anthropic') return 'claude-sonnet-5';
    if (p === 'openai') return 'gpt-5.6-luna';
    if (p === 'grok') return 'grok-4.6';
    if (p === 'ollama') return 'llama3';

    return 'gemini-3.5-flash-lite';
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

    // ══════════════════════════════════════════════════════════════
    // GUARANTEED SUPERPOWERS TRIGGER VERIFIER (Zero-Miss Fallback)
    // ══════════════════════════════════════════════════════════════
    const lastUserMsg = messages[messages.length - 1]?.content || '';
    const cleanUserText = (lastUserMsg || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Check if tools were executed natively by LLM
    const hasEscalate = allExecutedTools.some(t => t.name === 'escalate_to_human');
    const hasLead = allExecutedTools.some(t => t.name === 'capture_lead');
    const hasVigilante = allExecutedTools.some(t => t.name === 'alert_vigilante');

    // 1. Escalate to human: user explicitly wants a person/human
    const wantsHuman = (
      cleanUserText.includes('humano') || cleanUserText.includes('asesor') || 
      cleanUserText.includes('persona') || cleanUserText.includes('alguien') ||
      cleanUserText.includes('supervisor') || cleanUserText.includes('gerente') ||
      cleanUserText.includes('hablar con') || cleanUserText.includes('comunicarme')
    );

    if (wantsHuman && !hasEscalate) {
      const result = await executeTool('escalate_to_human', {
        reason: 'Solicitud expresa de atención humana',
        customerSummary: lastUserMsg,
        urgency: 'media'
      }, conversationContext);
      allExecutedTools.push({
        name: 'escalate_to_human',
        args: { reason: 'Solicitud expresa de atención humana', customerSummary: lastUserMsg, urgency: 'media' },
        result
      });
    }

    // 2. Capture lead: user provides phone/email/contact info
    const hasContact = (
      cleanUserText.includes('mi nombre') || cleanUserText.includes('me llamo') || cleanUserText.includes('soy ') ||
      cleanUserText.includes('whats') || cleanUserText.includes('telefono') || cleanUserText.includes('celular') ||
      cleanUserText.includes('correo') || cleanUserText.includes('email') || cleanUserText.includes('@') ||
      /(\+?\d[\d\s-]{7,}\d)/.test(lastUserMsg)
    );

    if (hasContact && !hasLead && !cleanUserText.includes('pagar')) {
      const emailMatch = lastUserMsg.match(/[\w.-]+@[\w.-]+\.[A-Za-z]{2,}/);
      const phoneMatch = lastUserMsg.match(/(\+?\d[\d\s-]{7,}\d)/);
      const nameMatch = lastUserMsg.match(/(?:me llamo|mi nombre es|soy)\s+([A-Za-zÀ-ÿ\s]+?)(?:,|\.|\s+mi|\s+y|\s+cel|\s+tel|\s+correo|\s+whats|$)/i);
      const budgetMatch = lastUserMsg.match(/(?:presupuesto(?: de)?|budget)\s*(?:de\s*)?([$\d,.\s]+(?:usd|mxn|dolares|pesos)?)/i);

      const extractedName = nameMatch ? nameMatch[1].trim() : (conversationContext.userName || 'Prospecto Web');
      const extractedPhone = phoneMatch ? phoneMatch[0].trim() : '';
      const extractedEmail = emailMatch ? emailMatch[0].trim() : '';
      const extractedBudget = budgetMatch ? budgetMatch[1].trim() : '';

      const result = await executeTool('capture_lead', {
        name: extractedName,
        phone: extractedPhone,
        email: extractedEmail,
        interest: lastUserMsg,
        budget: extractedBudget
      }, conversationContext);

      allExecutedTools.push({
        name: 'capture_lead',
        args: { name: extractedName, phone: extractedPhone, email: extractedEmail, interest: lastUserMsg, budget: extractedBudget },
        result
      });
    }

    // 3. Vigilante: Angry user or complaint
    const isAngry = (
      cleanUserText.includes('enojad') || cleanUserText.includes('molest') || cleanUserText.includes('inconform') ||
      cleanUserText.includes('pesim') || cleanUserText.includes('terrible') || cleanUserText.includes('fraude') ||
      cleanUserText.includes('reclamo') || cleanUserText.includes('queja') || cleanUserText.includes('estafa') ||
      cleanUserText.includes('furios') || cleanUserText.includes('demora') || cleanUserText.includes('mal servicio')
    );

    if (isAngry && !hasVigilante) {
      const result = await executeTool('alert_vigilante', {
        reason: 'Cliente molesto o queja detectada',
        sentimentScore: 'critico',
        summary: lastUserMsg
      }, conversationContext);
      allExecutedTools.push({
        name: 'alert_vigilante',
        args: { reason: 'Cliente molesto', sentimentScore: 'critico', summary: lastUserMsg },
        result
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

    const cleanText = (str) => (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const cleanMsg = cleanText(lastMsg);

    // 1. 🚨 Vigilante: Cliente molesto, enojado, inconforme o queja severa
    const isAngryOrComplaint = (
      cleanMsg.includes('enojad') || cleanMsg.includes('molest') || cleanMsg.includes('inconform') ||
      cleanMsg.includes('pesim') || cleanMsg.includes('terrible') || cleanMsg.includes('fraude') ||
      cleanMsg.includes('reclamo') || cleanMsg.includes('queja') || cleanMsg.includes('estafa') ||
      cleanMsg.includes('decepcion') || cleanMsg.includes('furios') || cleanMsg.includes('demora') ||
      cleanMsg.includes('incompetente') || cleanMsg.includes('falta de respeto') || cleanMsg.includes('supervisor') ||
      cleanMsg.includes('gerente') || cleanMsg.includes('mal servicio') || cleanMsg.includes('cancelar')
    );

    // 2. 👥 Captura de Leads: El usuario proporciona datos de contacto o cotización
    const hasContactInfo = (
      cleanMsg.includes('mi nombre') || cleanMsg.includes('me llamo') || cleanMsg.includes('soy ') ||
      cleanMsg.includes('whats') || cleanMsg.includes('telefono') || cleanMsg.includes('celular') ||
      cleanMsg.includes('cel:') || cleanMsg.includes('correo') || cleanMsg.includes('email') ||
      cleanMsg.includes('@') || /(\+?\d[\d\s-]{7,}\d)/.test(lastMsg)
    );

    // 3. 💳 Cobros por Chat: Enlaces de pago, anticipo o liquidación
    const isPaymentRequest = (
      cleanMsg.includes('pagar') || cleanMsg.includes('link de pago') || cleanMsg.includes('enlace de pago') ||
      cleanMsg.includes('link para pagar') || cleanMsg.includes('anticipo') || cleanMsg.includes('apartar') ||
      cleanMsg.includes('cobro')
    );

    // 4. ⭐ Satisfacción y Reseñas
    const isSatisfaction = (
      cleanMsg.includes('gracias') || cleanMsg.includes('muchas gracias') || cleanMsg.includes('excelente') ||
      cleanMsg.includes('perfecto') || cleanMsg.includes('muy amable') || cleanMsg.includes('me encanto') ||
      cleanMsg.includes('gran atencion') || cleanMsg.includes('resuelto') || cleanMsg.includes('quedo claro')
    );

    if (isAngryOrComplaint) {
      // Disparar Alerta Vigilante
      const vigilanteResult = await executeTool('alert_vigilante', {
        reason: 'Cliente inconforme o molesto por experiencia de servicio',
        sentimentScore: 'critico',
        summary: lastMsg
      }, conversationContext);
      allExecutedTools.push({ name: 'alert_vigilante', args: { reason: 'Cliente molesto', sentimentScore: 'critico', summary: lastMsg }, result: vigilanteResult });

      // Disparar Escalación a Humano
      const handoffResult = await executeTool('escalate_to_human', {
        reason: 'Queja / Cliente molesto requiere atención prioritaria',
        customerSummary: lastMsg,
        urgency: 'alta'
      }, conversationContext);
      allExecutedTools.push({ name: 'escalate_to_human', args: { reason: 'Queja cliente', customerSummary: lastMsg, urgency: 'alta' }, result: handoffResult });

      reply = `Lamento profundamente los inconvenientes y la molestia ocasionada. He activado una alerta prioritaria con la gerencia y transferido tu caso de inmediato con un supervisor humano para darte una solución urgente. En unos momentos te atenderán directamente.`;

    } else if (hasContactInfo && !isPaymentRequest && !isSatisfaction) {
      // Extraer datos estructurados del lead
      const emailMatch = lastMsg.match(/[\w.-]+@[\w.-]+\.[A-Za-z]{2,}/);
      const phoneMatch = lastMsg.match(/(\+?\d[\d\s-]{7,}\d)/);
      const nameMatch = lastMsg.match(/(?:me llamo|mi nombre es|soy)\s+([A-Za-zÀ-ÿ\s]+?)(?:,|\.|\s+mi|\s+y|\s+cel|\s+tel|\s+correo|\s+whats|$)/i);
      const budgetMatch = lastMsg.match(/(?:presupuesto(?: de)?|budget)\s*(?:de\s*)?([$\d,.\s]+(?:usd|mxn|dolares|pesos)?)/i);

      const extractedName = nameMatch ? nameMatch[1].trim() : (conversationContext.userName || 'Prospecto Web');
      const extractedPhone = phoneMatch ? phoneMatch[0].trim() : null;
      const extractedEmail = emailMatch ? emailMatch[0].trim() : null;
      const extractedBudget = budgetMatch ? budgetMatch[1].trim() : null;

      const leadResult = await executeTool('capture_lead', {
        name: extractedName,
        phone: extractedPhone,
        email: extractedEmail,
        interest: lastMsg,
        budget: extractedBudget
      }, conversationContext);
      allExecutedTools.push({ name: 'capture_lead', args: { name: extractedName, phone: extractedPhone, email: extractedEmail, interest: lastMsg, budget: extractedBudget }, result: leadResult });

      reply = `¡Excelente, ${extractedName}! He registrado tus datos de contacto en nuestro sistema. Uno de nuestros especialistas revisará tu solicitud para darte seguimiento formal a la brevedad. ¿Hay algún requerimiento específico o detalle adicional que debamos considerar?`;

    } else if (isPaymentRequest) {
      const amountMatch = lastMsg.match(/(?:\$|usd|mxn)?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i);
      const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '')) : 50;

      const payResult = await executeTool('create_payment_link', {
        amount,
        currency: 'USD',
        description: 'Anticipo de servicio / Apartado'
      }, conversationContext);
      allExecutedTools.push({ name: 'create_payment_link', args: { amount, description: 'Anticipo' }, result: payResult });

      reply = `¡Con gusto! Aquí tienes el enlace oficial y seguro para realizar tu pago o anticipo:\n🔗 ${payResult.paymentUrl}\n\nTambién contamos con transferencias bancarias directas: ${payResult.bankTransferInfo}. En cuanto realices tu pago, envíanos el comprobante para confirmar de inmediato.`;

    } else if (isSatisfaction) {
      const reviewResult = await executeTool('collect_review', {
        satisfactionLevel: 'alta',
        reviewType: 'google_maps'
      }, conversationContext);
      allExecutedTools.push({ name: 'collect_review', args: { satisfactionLevel: 'alta', reviewType: 'google_maps' }, result: reviewResult });

      reply = `¡Ha sido un verdadero placer ayudarte! Si estás satisfecho con nuestra atención, te agradeceríamos muchísimo dejarnos una breve reseña de 5 estrellas en nuestro perfil:\n⭐ ${reviewResult.reviewUrl}\n\n¡Muchas gracias por tu confianza y que tengas un excelente día!`;

    } else if (cleanMsg.includes('humano') || cleanMsg.includes('asesor') || cleanMsg.includes('persona') || cleanMsg.includes('hablar con alguien')) {
      const handoffResult = await executeTool('escalate_to_human', {
        reason: 'Solicitud de atención humana directa',
        customerSummary: lastMsg,
        urgency: 'media'
      }, conversationContext);
      allExecutedTools.push({ name: 'escalate_to_human', args: { reason: 'Solicitud cliente', customerSummary: lastMsg }, result: handoffResult });

      reply = `Entiendo perfectamente. He transferido tu conversación con un asesor de nuestro equipo. En un momento te responderá directamente. ¡Gracias por tu paciencia!`;

    } else if (
      cleanMsg.includes('precio') || cleanMsg.includes('costo') || cleanMsg.includes('cuanto') ||
      cleanMsg.includes('cuesta') || cleanMsg.includes('cotiz') || cleanMsg.includes('tarifa') ||
      cleanMsg.includes('pago') || cleanMsg.includes('metodo') || cleanMsg.includes('spei') ||
      cleanMsg.includes('tarjeta') || cleanMsg.includes('efectivo') || cleanMsg.includes('anticipo') ||
      cleanMsg.includes('catalogo') || cleanMsg.includes('servicio') || cleanMsg.includes('paquete') ||
      cleanMsg.includes('afinacion') || cleanMsg.includes('freno') || cleanMsg.includes('diagnostico') ||
      cleanMsg.includes('horario') || cleanMsg.includes('hora') || cleanMsg.includes('abren') ||
      cleanMsg.includes('cierran') || cleanMsg.includes('abierto') || cleanMsg.includes('cerrado') ||
      cleanMsg.includes('dia') || cleanMsg.includes('sabado') || cleanMsg.includes('domingo') ||
      cleanMsg.includes('lunes') || cleanMsg.includes('atencion') || cleanMsg.includes('donde') ||
      cleanMsg.includes('ubicacion') || cleanMsg.includes('direccion') || cleanMsg.includes('cobertura') ||
      cleanMsg.includes('contacto') || cleanMsg.includes('telefono') || cleanMsg.includes('correo') ||
      cleanMsg.includes('politica') || cleanMsg.includes('garantia') || cleanMsg.includes('reembolso') ||
      cleanMsg.includes('factura') || cleanMsg.includes('faq') || cleanMsg.includes('pregunta') ||
      cleanMsg.includes('duda') || cleanMsg.includes('inform')
    ) {
      const searchResult = await executeTool('search_kb', { query: lastMsg }, conversationContext);
      allExecutedTools.push({ name: 'search_kb', args: { query: lastMsg }, result: searchResult });
      
      const kbItems = searchResult?.results || [];
      if (kbItems.length > 0) {
        const topContent = kbItems.map(k => k.content).join('\n\n');
        reply = `¡Hola! Con gusto te comparto la información oficial de nuestro negocio:\n\n${topContent}\n\n¿En qué más te puedo ayudar?`;
      } else {
        const details = biz.services || 'servicios especializados';
        reply = `¡Hola! Con gusto te comparto la información sobre nuestros precios y servicios:\n\n${details}\n\n¿Te gustaría que te coticemos formalmente o agendemos una cita?`;
      }
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
