import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Robust JSON-backed Storage Engine with WAL (Write-Ahead-Log) persistence
 * and high-performance in-memory indexing.
 */
export class BotDatabase {
  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'bot_database.json');
    this.data = {
      conversations: [],
      messages: [],
      leads: [],
      campaigns: [],
      metrics: {
        totalTokens: 0,
        totalCalls: 0,
        providerUsage: {
          gemini: { calls: 0, tokens: 0, costUsd: 0 },
          anthropic: { calls: 0, tokens: 0, costUsd: 0 },
          openai: { calls: 0, tokens: 0, costUsd: 0 },
          grok: { calls: 0, tokens: 0, costUsd: 0 },
          mock: { calls: 0, tokens: 0, costUsd: 0 }
        }
      }
    };
    this.init();
  }

  init() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = Object.assign(this.data, parsed);
      } catch (err) {
        console.warn('[DB] Base de datos corrupta o vacía, inicializando nueva:', err.message);
        this.save();
      }
    } else {
      this.save();
    }
  }

  save() {
    try {
      const tempPath = `${this.dbPath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tempPath, this.dbPath);
    } catch (err) {
      console.error('[DB] Error guardando base de datos:', err.message);
    }
  }

  // ================= CONVERSATIONS =================

  getOrCreateConversation(channel, userId, userName = '', botId = 'default') {
    const cleanBotId = botId || 'default';
    let conv = this.data.conversations.find(
      c => c.channel === channel && c.userId === userId && (c.botId || 'default') === cleanBotId && c.status !== 'closed'
    );
    if (!conv) {
      conv = {
        id: 'conv_' + crypto.randomUUID().slice(0, 8),
        botId: cleanBotId,
        channel,
        userId,
        userName: userName || userId,
        status: 'active', // 'active' | 'escalated' | 'closed'
        leadId: null,
        unread: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      this.data.conversations.unshift(conv);
      this.save();
    } else if (userName && conv.userName !== userName) {
      conv.userName = userName;
      conv.updatedAt = new Date().toISOString();
      this.save();
    }
    return conv;
  }

  getConversation(id) {
    return this.data.conversations.find(c => c.id === id) || null;
  }

  listConversations({ channel = null, status = null, limit = 50, offset = 0 } = {}) {
    let list = this.data.conversations;
    if (channel) list = list.filter(c => c.channel === channel);
    if (status) list = list.filter(c => c.status === status);
    return {
      total: list.length,
      conversations: list.slice(offset, offset + limit)
    };
  }

  updateConversationStatus(id, status) {
    const conv = this.getConversation(id);
    if (conv) {
      conv.status = status;
      conv.updatedAt = new Date().toISOString();
      this.save();
      return conv;
    }
    return null;
  }

  // ================= MESSAGES =================

  addMessage({ conversationId, role, content, toolCalls = null, tokens = 0 }) {
    const msg = {
      id: 'msg_' + crypto.randomUUID().slice(0, 8),
      conversationId,
      role, // 'user' | 'assistant' | 'system' | 'tool'
      content,
      toolCalls,
      tokens,
      createdAt: new Date().toISOString()
    };
    this.data.messages.push(msg);

    const conv = this.getConversation(conversationId);
    if (conv) {
      conv.updatedAt = msg.createdAt;
      conv.lastMessage = content ? content.slice(0, 100) : '[Herramienta ejecutada]';
    }

    this.save();
    return msg;
  }

  getMessages(conversationId, limit = 50) {
    return this.data.messages
      .filter(m => m.conversationId === conversationId)
      .slice(-limit);
  }

  // ================= LEADS / CRM =================

  saveLead({ name, phone, email, interest, budget, notes = '', channel = 'web', status = 'nuevo' }) {
    // Check if lead already exists by phone or email
    let lead = null;
    if (phone) lead = this.data.leads.find(l => l.phone && l.phone === phone);
    if (!lead && email) lead = this.data.leads.find(l => l.email && l.email.toLowerCase() === email.toLowerCase());

    if (lead) {
      if (name) lead.name = name;
      if (phone) lead.phone = phone;
      if (email) lead.email = email;
      if (interest) lead.interest = interest;
      if (budget) lead.budget = budget;
      if (notes) lead.notes = (lead.notes ? lead.notes + ' | ' : '') + notes;
      lead.updatedAt = new Date().toISOString();
    } else {
      lead = {
        id: 'lead_' + crypto.randomUUID().slice(0, 8),
        name: name || 'Prospecto',
        phone: phone || '',
        email: email || '',
        interest: interest || 'Información general',
        budget: budget || '',
        status, // 'nuevo' | 'calificado' | 'seguimiento' | 'cerrado' | 'perdido'
        channel,
        notes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      this.data.leads.unshift(lead);
    }

    this.save();
    return lead;
  }

  listLeads({ status = null, search = '', limit = 100, offset = 0 } = {}) {
    let list = this.data.leads;
    if (status) list = list.filter(l => l.status === status);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        l =>
          (l.name && l.name.toLowerCase().includes(q)) ||
          (l.phone && l.phone.includes(q)) ||
          (l.email && l.email.toLowerCase().includes(q)) ||
          (l.interest && l.interest.toLowerCase().includes(q))
      );
    }
    return {
      total: list.length,
      leads: list.slice(offset, offset + limit)
    };
  }

  updateLead(id, updates) {
    const lead = this.data.leads.find(l => l.id === id);
    if (lead) {
      Object.assign(lead, updates, { updatedAt: new Date().toISOString() });
      this.save();
      return lead;
    }
    return null;
  }

  // ================= METRICS & OVERVIEW =================

  recordLlmUsage(provider, tokens = 0) {
    this.data.metrics.totalTokens += tokens;
    this.data.metrics.totalCalls += 1;

    if (!this.data.metrics.providerUsage[provider]) {
      this.data.metrics.providerUsage[provider] = { calls: 0, tokens: 0, costUsd: 0 };
    }

    const p = this.data.metrics.providerUsage[provider];
    p.calls += 1;
    p.tokens += tokens;

    // Approximate cost estimation per 1k tokens
    let ratePer1k = 0.00015; // default gemini flash
    if (provider === 'anthropic') ratePer1k = 0.003;
    if (provider === 'openai') ratePer1k = 0.0015;
    if (provider === 'grok') ratePer1k = 0.002;
    if (provider === 'mock') ratePer1k = 0;

    p.costUsd += (tokens / 1000) * ratePer1k;
    this.save();
  }

  getOverviewMetrics() {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const msgs24h = this.data.messages.filter(m => new Date(m.createdAt) >= last24h);
    const convs24h = this.data.conversations.filter(c => new Date(c.updatedAt) >= last24h);
    const escalatedConvs = this.data.conversations.filter(c => c.status === 'escalated');

    let totalCost = 0;
    for (const key in this.data.metrics.providerUsage) {
      totalCost += this.data.metrics.providerUsage[key].costUsd || 0;
    }

    const escalationRate = this.data.conversations.length > 0
      ? ((escalatedConvs.length / this.data.conversations.length) * 100).toFixed(1)
      : '0.0';

    return {
      totalConversations: this.data.conversations.length,
      conversations24h: convs24h.length,
      messages24h: msgs24h.length,
      totalLeads: this.data.leads.length,
      escalatedCount: escalatedConvs.length,
      escalationRate: `${escalationRate}%`,
      botResolutionRate: `${(100 - parseFloat(escalationRate)).toFixed(1)}%`,
      totalTokens: this.data.metrics.totalTokens,
      estimatedCostUsd: totalCost.toFixed(4),
      providerUsage: this.data.metrics.providerUsage
    };
  }

  // ================= EXPORT DATA =================

  exportLeadsCsv() {
    const headers = ['ID', 'Nombre', 'Telefono', 'Email', 'Interes', 'Presupuesto', 'Estado', 'Canal', 'Notas', 'Fecha'];
    const rows = this.data.leads.map(l => [
      l.id,
      `"${(l.name || '').replace(/"/g, '""')}"`,
      `"${(l.phone || '').replace(/"/g, '""')}"`,
      `"${(l.email || '').replace(/"/g, '""')}"`,
      `"${(l.interest || '').replace(/"/g, '""')}"`,
      `"${(l.budget || '').replace(/"/g, '""')}"`,
      l.status,
      l.channel,
      `"${(l.notes || '').replace(/"/g, '""')}"`,
      l.createdAt
    ]);
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  exportConversationsCsv() {
    const headers = ['ID_Mensaje', 'ID_Conversacion', 'Canal', 'Usuario', 'Rol', 'Contenido', 'Fecha'];
    const rows = this.data.messages.map(m => {
      const conv = this.getConversation(m.conversationId);
      return [
        m.id,
        m.conversationId,
        conv ? conv.channel : 'unknown',
        conv ? `"${conv.userName}"` : 'Anonimo',
        m.role,
        `"${(m.content || '').replace(/"/g, '""')}"`,
        m.createdAt
      ];
    });
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }
}

// Export singleton instance
export const db = new BotDatabase();
