/**
 * Storage Adapter for FacilisBot
 * 
 * Provides a unified interface for BOTH Cloudflare Workers (D1, KV) 
 * and Node.js local environments (fs, in-memory).
 */

// Cost per 1k tokens (input + output blended average for estimation)
const COST_RATES = {
  gemini: 0.00015,
  anthropic: 0.003,
  openai: 0.0015,
  grok: 0.002,
  mock: 0
};

/**
 * Guess a MIME content type from a filename extension
 */
function guessContentType(filename = '') {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    avif: 'image/avif',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    txt: 'text/plain',
    csv: 'text/csv',
    md: 'text/markdown',
    json: 'application/json',
    zip: 'application/zip',
    mp3: 'audio/mpeg'
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * Cloudflare Workers Storage Adapter
 * Uses D1 (env.DB) for structured data and KV (env.KV) for Knowledge Base.
 */
class CloudflareStorageAdapter {
  constructor(env) {
    this.env = env;
    this.db = env.DB;
    this.kv = env.KV;
  }

  // --- Bot Config ---

  async getConfig(botId) {
    const result = await this.db.prepare('SELECT config, api_provider, api_key FROM bots WHERE id = ?').bind(botId).first();
    if (!result || !result.config) return null;
    try {
      const cfg = JSON.parse(result.config);
      if (result.api_key && cfg.llm) {
        const prov = result.api_provider || cfg.llm.provider || 'gemini';
        if (prov === 'gemini' && !cfg.llm.geminiApiKey) cfg.llm.geminiApiKey = result.api_key;
        if (prov === 'anthropic' && !cfg.llm.anthropicApiKey) cfg.llm.anthropicApiKey = result.api_key;
        if (prov === 'openai' && !cfg.llm.openaiApiKey) cfg.llm.openaiApiKey = result.api_key;
        if (prov === 'grok' && !cfg.llm.grokApiKey) cfg.llm.grokApiKey = result.api_key;
      }
      return cfg;
    } catch (e) {
      return null;
    }
  }

  async saveConfig(botId, config) {
    const configStr = JSON.stringify(config);
    const name = config.bot?.name || botId;
    const niche = config.bot?.niche || 'starter';
    const apiProvider = config.llm?.provider || 'gemini';
    const apiKey = config.llm?.geminiApiKey || config.llm?.anthropicApiKey || config.llm?.openaiApiKey || config.llm?.grokApiKey || null;
    const accessCode = config._accessCode || config.accessCode || config.pin || null;

    if (accessCode) {
      await this.db.prepare(`
        INSERT INTO bots (id, name, niche, config, api_provider, api_key, access_code, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET 
          name=excluded.name, niche=excluded.niche, config=excluded.config, 
          api_provider=excluded.api_provider, api_key=excluded.api_key,
          access_code=coalesce(excluded.access_code, bots.access_code),
          updated_at=datetime('now')
      `).bind(botId, name, niche, configStr, apiProvider, apiKey, accessCode).run();
    } else {
      await this.db.prepare(`
        INSERT INTO bots (id, name, niche, config, api_provider, api_key, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET 
          name=excluded.name, niche=excluded.niche, config=excluded.config, 
          api_provider=excluded.api_provider, api_key=excluded.api_key, 
          updated_at=datetime('now')
      `).bind(botId, name, niche, configStr, apiProvider, apiKey).run();
    }
  }

  async listBots() {
    const { results } = await this.db.prepare('SELECT id, name, niche, api_provider as apiProvider, config FROM bots WHERE active = 1').all();
    return (results || []).map(r => {
      let parsed = {};
      try { parsed = JSON.parse(r.config); } catch(e) {}
      return {
        id: r.id,
        name: r.name,
        niche: r.niche,
        businessName: parsed.business?.name || r.name,
        llmProvider: r.apiProvider || 'gemini',
        llmModel: parsed.llm?.model || 'gemini-3.5-flash-lite'
      };
    });
  }

  async createBot(botId, config) {
    return this.saveConfig(botId, config);
  }

  async deleteBot(botId) {
    await this.db.prepare('DELETE FROM bots WHERE id = ?').bind(botId).run();
  }

  // --- Conversations ---

  async getOrCreateConversation(channel = 'web', userId = 'user_1', userName = '', botId = 'default') {
    const cleanChannel = channel || 'web';
    const cleanUserId = userId || 'user_1';
    const cleanBotId = botId || 'default';
    const cleanUserName = userName || '';

    let conv = await this.db.prepare(
      'SELECT * FROM conversations WHERE channel = ? AND user_id = ? AND bot_id = ?'
    ).bind(cleanChannel, cleanUserId, cleanBotId).first();

    if (!conv) {
      const id = 'conv_' + crypto.randomUUID().slice(0, 8);
      await this.db.prepare(`
        INSERT INTO conversations (id, bot_id, channel, user_id, user_name, status, created_at, updated_at) 
        VALUES (?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
      `).bind(id, cleanBotId, cleanChannel, cleanUserId, cleanUserName).run();
      
      conv = await this.getConversation(id);
    }
    return conv;
  }

  async getConversation(id) {
    return await this.db.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first();
  }

  async listConversations({ channel, status, botId = 'default', limit = 50, offset = 0 } = {}) {
    let query = 'SELECT * FROM conversations WHERE bot_id = ?';
    const params = [botId || 'default'];
    
    if (channel) {
      query += ' AND channel = ?';
      params.push(channel);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(limit || 50, offset || 0);

    const { results } = await this.db.prepare(query).bind(...params).all();
    return results || [];
  }

  async updateConversationStatus(id, status) {
    await this.db.prepare(
      "UPDATE conversations SET status = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(status || 'active', id).run();
  }

  async updateConversation(id, updates = {}) {
    const keys = Object.keys(updates).filter(k => updates[k] !== undefined);
    if (keys.length === 0) return;
    
    // Map camelCase to snake_case if needed
    const columnMap = {
      leadId: 'lead_id',
      userName: 'user_name',
      userId: 'user_id',
      lastMessage: 'last_message'
    };

    const setClauses = [];
    const params = [];
    for (const k of keys) {
      const col = columnMap[k] || k;
      setClauses.push(`${col} = ?`);
      params.push(updates[k]);
    }
    params.push(id);

    await this.db.prepare(`
      UPDATE conversations SET ${setClauses.join(', ')}, updated_at = datetime('now') WHERE id = ?
    `).bind(...params).run();
  }

  // --- Messages ---

  async addMessage({ conversationId, botId = 'default', role = 'user', content = '', toolCalls = null, tokens = 0 }) {
    const id = 'msg_' + crypto.randomUUID().slice(0, 8);
    const toolCallsStr = toolCalls ? JSON.stringify(toolCalls) : null;
    const cleanBotId = botId || 'default';
    const cleanContent = content || '';
    const cleanRole = role || 'user';
    const cleanTokens = tokens || 0;
    
    await this.db.prepare(`
      INSERT INTO messages (id, conversation_id, bot_id, role, content, tool_calls, tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(id, conversationId, cleanBotId, cleanRole, cleanContent, toolCallsStr, cleanTokens).run();
    
    await this.db.prepare(
      "UPDATE conversations SET updated_at = datetime('now'), last_message = ? WHERE id = ?"
    ).bind(cleanContent, conversationId).run();
    
    return {
      id,
      conversationId,
      botId: cleanBotId,
      role: cleanRole,
      content: cleanContent,
      toolCalls,
      tokens: cleanTokens,
      createdAt: new Date().toISOString()
    };
  }

  async getMessages(conversationId, limit = 50) {
    const { results } = await this.db.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?'
    ).bind(conversationId, limit || 50).all();
    
    // Return in chronological order
    return (results || []).reverse().map(msg => ({
      ...msg,
      tool_calls: msg.tool_calls ? JSON.parse(msg.tool_calls) : null
    }));
  }

  // --- Leads ---

  async saveLead({ botId = 'default', name = '', phone = '', email = '', interest = '', budget = '', notes = '', channel = 'web', status = 'new' }) {
    const cleanBotId = botId || 'default';
    const cleanName = name || '';
    const cleanPhone = phone || '';
    const cleanEmail = email || '';
    const cleanInterest = interest || '';
    const cleanBudget = budget || '';
    const cleanNotes = notes || '';
    const cleanChannel = channel || 'web';
    const cleanStatus = status || 'new';

    // Basic deduplication
    let query = 'SELECT id FROM leads WHERE bot_id = ? AND (';
    const params = [cleanBotId];
    const conditions = [];
    
    if (cleanPhone) { conditions.push('phone = ?'); params.push(cleanPhone); }
    if (cleanEmail) { conditions.push('email = ?'); params.push(cleanEmail); }
    
    if (conditions.length > 0) {
      query += conditions.join(' OR ') + ') LIMIT 1';
      const existing = await this.db.prepare(query).bind(...params).first();
      
      if (existing) {
        // Update existing lead
        await this.updateLead(existing.id, { name: cleanName, phone: cleanPhone, email: cleanEmail, interest: cleanInterest, budget: cleanBudget, notes: cleanNotes, status: cleanStatus });
        return { id: existing.id, botId: cleanBotId, name: cleanName, phone: cleanPhone, email: cleanEmail, interest: cleanInterest, budget: cleanBudget, notes: cleanNotes, channel: cleanChannel, status: cleanStatus };
      }
    }
    
    // Create new
    const id = 'lead_' + crypto.randomUUID().slice(0, 8);
    await this.db.prepare(`
      INSERT INTO leads (id, bot_id, name, phone, email, interest, budget, notes, channel, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(id, cleanBotId, cleanName, cleanPhone, cleanEmail, cleanInterest, cleanBudget, cleanNotes, cleanChannel, cleanStatus).run();
    return { id, botId: cleanBotId, name: cleanName, phone: cleanPhone, email: cleanEmail, interest: cleanInterest, budget: cleanBudget, notes: cleanNotes, channel: cleanChannel, status: cleanStatus };
  }

  async listLeads({ botId, status, search, limit = 50, offset = 0 } = {}) {
    let query = 'SELECT * FROM leads WHERE bot_id = ?';
    const params = [botId];
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (search) {
      query += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
      const searchParam = '%' + search + '%';
      params.push(searchParam, searchParam, searchParam);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const { results } = await this.db.prepare(query).bind(...params).all();
    return results || [];
  }

  async updateLead(id, updates) {
    const keys = Object.keys(updates).filter(k => updates[k] !== undefined);
    if (keys.length === 0) return;
    
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const params = keys.map(k => updates[k]);
    params.push(id);
    
    await this.db.prepare(`
      UPDATE leads SET ${setClause}, updated_at = datetime('now') WHERE id = ?
    `).bind(...params).run();
  }

  // --- Knowledge Base (KV) ---

  async listKBDocuments(botId) {
    if (!this.kv) return [];
    
    // Check manifest first for instant consistency
    try {
      const manifest = await this.kv.get(`kb:${botId}:__manifest__`, { type: 'json' });
      if (manifest && Array.isArray(manifest)) {
        return manifest.filter(f => f && f !== '__manifest__');
      }
    } catch (e) {}

    const prefix = `kb:${botId}:`;
    const result = await this.kv.list({ prefix });
    return (result.keys || [])
      .map(k => k.name.replace(prefix, ''))
      .filter(name => name && name !== '__manifest__');
  }

  async getKBDocument(botId, filename) {
    if (!this.kv || filename === '__manifest__') return null;
    return await this.kv.get(`kb:${botId}:${filename}`);
  }

  async saveKBDocument(botId, filename, content) {
    if (!this.kv || filename === '__manifest__') return;
    await this.kv.put(`kb:${botId}:${filename}`, content);
    
    // Update manifest for instant consistency
    try {
      const currentList = await this.listKBDocuments(botId);
      if (!currentList.includes(filename)) {
        currentList.push(filename);
      }
      const cleanList = currentList.filter(f => f && f !== '__manifest__');
      await this.kv.put(`kb:${botId}:__manifest__`, JSON.stringify(cleanList));
    } catch (e) {}
  }

  async deleteKBDocument(botId, filename) {
    if (!this.kv || filename === '__manifest__') return;
    await this.kv.delete(`kb:${botId}:${filename}`);
    
    try {
      const currentList = await this.listKBDocuments(botId);
      const cleanList = currentList.filter(f => f !== filename && f !== '__manifest__');
      await this.kv.put(`kb:${botId}:__manifest__`, JSON.stringify(cleanList));
    } catch (e) {}
  }

  // --- Media Library (KV) ---

  async saveMedia(botId, filename, dataBase64, contentType = 'application/octet-stream') {
    if (!this.kv) return;
    const key = `media:${botId}:${filename}`;
    await this.kv.put(key, dataBase64, { metadata: { contentType, filename } });

    // Update manifest
    try {
      const currentList = await this.listMedia(botId);
      if (!currentList.find(f => f.filename === filename)) {
        currentList.push({ filename, contentType, size: Math.floor((dataBase64.length * 3) / 4) });
      }
      await this.kv.put(`media:${botId}:__manifest__`, JSON.stringify(currentList));
    } catch (e) {}
  }

  async getMedia(botId, filename) {
    if (!this.kv || filename === '__manifest__') return null;
    const data = await this.kv.get(`media:${botId}:${filename}`);
    if (data === null) return null;
    const meta = await this.kv.getWithMetadata(`media:${botId}:${filename}`);
    return {
      filename,
      dataBase64: data,
      contentType: meta?.metadata?.contentType || guessContentType(filename)
    };
  }

  async listMedia(botId) {
    if (!this.kv) return [];
    try {
      const manifest = await this.kv.get(`media:${botId}:__manifest__`, { type: 'json' });
      if (manifest && Array.isArray(manifest)) return manifest;
    } catch (e) {}

    const prefix = `media:${botId}:`;
    const result = await this.kv.list({ prefix });
    return (result.keys || [])
      .filter(k => !k.name.endsWith('__manifest__'))
      .map(k => ({ filename: k.name.replace(prefix, ''), contentType: '', size: k.metadata?.size || 0 }));
  }

  async deleteMedia(botId, filename) {
    if (!this.kv || filename === '__manifest__') return;
    await this.kv.delete(`media:${botId}:${filename}`);
    try {
      const currentList = await this.listMedia(botId);
      const cleanList = currentList.filter(f => f.filename !== filename);
      await this.kv.put(`media:${botId}:__manifest__`, JSON.stringify(cleanList));
    } catch (e) {}
  }

  // --- Metrics ---

  async recordLlmUsage(botId = 'default', provider = 'gemini', tokens = 0) {
    const cleanBotId = botId || 'default';
    const cleanProvider = provider || 'gemini';
    const cleanTokens = tokens || 0;
    const month = new Date().toISOString().slice(0, 7);
    const rate = COST_RATES[cleanProvider] || 0.0001;
    const cost = (cleanTokens / 1000) * rate;

    await this.db.prepare(`
      INSERT INTO metrics (bot_id, provider, tokens_used, calls_made, cost_usd, month)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(bot_id, provider, month) DO UPDATE SET
        tokens_used = tokens_used + excluded.tokens_used,
        calls_made = calls_made + 1,
        cost_usd = cost_usd + excluded.cost_usd
    `).bind(cleanBotId, cleanProvider, cleanTokens, cost, month).run();
  }

  async getOverviewMetrics(botId = 'default') {
    const cleanBotId = botId || 'default';

    // Total conversations
    const totalConvsResult = await this.db.prepare('SELECT COUNT(*) as totalConversations FROM conversations WHERE bot_id = ?').bind(cleanBotId).first();
    const totalConversations = totalConvsResult?.totalConversations || 0;
    
    // Total leads
    const totalLeadsResult = await this.db.prepare('SELECT COUNT(*) as totalLeads FROM leads WHERE bot_id = ?').bind(cleanBotId).first();
    const totalLeads = totalLeadsResult?.totalLeads || 0;
    
    // Conversations and messages in last 24 hours
    const convs24hResult = await this.db.prepare(
      "SELECT COUNT(*) as c24 FROM conversations WHERE bot_id = ? AND updated_at >= datetime('now', '-1 day')"
    ).bind(cleanBotId).first();
    const conversations24h = convs24hResult?.c24 || 0;

    const msgs24hResult = await this.db.prepare(
      "SELECT COUNT(*) as m24 FROM messages WHERE bot_id = ? AND created_at >= datetime('now', '-1 day')"
    ).bind(cleanBotId).first();
    const messages24h = msgs24hResult?.m24 || 0;

    // Status counts for resolution/escalation
    const { results: statuses } = await this.db.prepare('SELECT status, COUNT(*) as count FROM conversations WHERE bot_id = ? GROUP BY status').bind(cleanBotId).all();
    
    let resolved = 0, escalated = 0;
    for (const row of (statuses || [])) {
      if (row.status === 'resolved') resolved = row.count;
      if (row.status === 'escalated') escalated = row.count;
    }

    const nonEscalated = Math.max(0, totalConversations - escalated);
    const botResolutionRate = totalConversations > 0 ? ((nonEscalated / totalConversations) * 100).toFixed(1) + '%' : '100%';
    const escalationRate = totalConversations > 0 ? ((escalated / totalConversations) * 100).toFixed(1) + '%' : '0%';

    // Usage from metrics table
    const { results: usage } = await this.db.prepare('SELECT provider, SUM(tokens_used) as tokens, SUM(cost_usd) as cost FROM metrics WHERE bot_id = ? GROUP BY provider').bind(cleanBotId).all();
    
    let totalTokens = 0;
    let estimatedCostUsd = 0;
    const providerUsage = {};
    
    for (const row of (usage || [])) {
      totalTokens += (row.tokens || 0);
      estimatedCostUsd += (row.cost || 0);
      providerUsage[row.provider] = row.tokens || 0;
    }

    return {
      totalConversations,
      conversations24h,
      messages24h,
      totalLeads,
      escalationRate,
      escalatedCount: escalated,
      botResolutionRate,
      totalTokens,
      estimatedCostUsd: estimatedCostUsd.toFixed(4),
      providerUsage
    };
  }

  // --- Export ---

  async exportLeadsCsv(botId) {
    const leads = await this.listLeads({ botId, limit: 1000 });
    if (!leads || leads.length === 0) return 'id,name,phone,email,interest,budget,status,created_at\n';
    
    const header = 'id,name,phone,email,interest,budget,status,created_at\n';
    const rows = leads.map(l => 
      `${l.id},"${l.name || ''}","${l.phone || ''}","${l.email || ''}","${l.interest || ''}","${l.budget || ''}","${l.status || ''}","${l.created_at || ''}"`
    ).join('\n');
    return header + rows;
  }

  async exportConversationsCsv(botId) {
    const convs = await this.listConversations({ botId, limit: 1000 });
    if (!convs || convs.length === 0) return 'id,channel,user_name,status,created_at\n';
    
    const header = 'id,channel,user_name,status,created_at\n';
    const rows = convs.map(c => 
      `${c.id},"${c.channel || ''}","${c.user_name || ''}","${c.status || ''}","${c.created_at || ''}"`
    ).join('\n');
    return header + rows;
  }

  // --- Auth ---

  async authenticateBot(accessCode) {
    const result = await this.db.prepare('SELECT id FROM bots WHERE access_code = ?').bind(accessCode).first();
    return result ? result.id : null;
  }
}

/**
 * Local Node.js Storage Adapter
 * Uses local filesystem and in-memory arrays for development.
 */
class LocalStorageAdapter {
  constructor() {
    this.memoryDb = {
      conversations: [],
      messages: [],
      leads: [],
      metrics: [],
      bots: []
    };
    this.baseDir = null; // Will be resolved dynamically
  }

  async _initPaths() {
    if (!this.fs) {
      this.fs = await import('fs');
      this.fsPromises = this.fs.promises;
      this.path = await import('path');
      this.baseDir = this.path.join(process.cwd(), 'member');
      
      // Ensure member directory exists
      if (!this.fs.existsSync(this.baseDir)) {
        this.fs.mkdirSync(this.baseDir, { recursive: true });
      }
    }
  }

  // --- Bot Config ---

  async getConfig(botId) {
    await this._initPaths();
    
    // 1. Try bot specific config first
    const botPath = this.path.join(this.baseDir, 'bots', botId, 'config.json');
    if (this.fs.existsSync(botPath)) {
      try {
        const data = await this.fsPromises.readFile(botPath, 'utf8');
        return JSON.parse(data);
      } catch (e) {}
    }

    // 2. Try single config file ONLY for default bot
    if (botId === 'default') {
      const legacyPath = this.path.join(this.baseDir, 'config.local.json');
      if (this.fs.existsSync(legacyPath)) {
        try {
          const data = await this.fsPromises.readFile(legacyPath, 'utf8');
          return JSON.parse(data);
        } catch (e) {}
      }
    }

    return null;
  }

  async saveConfig(botId, config) {
    await this._initPaths();
    const botDir = this.path.join(this.baseDir, 'bots', botId);
    
    if (!this.fs.existsSync(botDir)) {
      await this.fsPromises.mkdir(botDir, { recursive: true });
    }
    
    await this.fsPromises.writeFile(
      this.path.join(botDir, 'config.json'), 
      JSON.stringify(config, null, 2), 
      'utf8'
    );
    
    // Update memory representation
    let bot = this.memoryDb.bots.find(b => b.id === botId);
    if (!bot) {
      bot = { id: botId };
      this.memoryDb.bots.push(bot);
    }
    bot.name = config.botName || config.systemPrompt?.name || botId;
    bot.niche = config.botPersona || 'general';
    bot.businessName = config.businessDetails?.name || '';
    bot.llmProvider = config.llmProvider || 'gemini';
    bot.llmModel = config.llmModel || '';
  }

  async listBots() {
    await this._initPaths();
    const botsDir = this.path.join(this.baseDir, 'bots');
    
    if (!this.fs.existsSync(botsDir)) {
      return [{ id: 'default', name: 'Default Local Bot', niche: 'general' }];
    }
    
    const items = await this.fsPromises.readdir(botsDir, { withFileTypes: true });
    const bots = [];
    
    for (const item of items) {
      if (item.isDirectory()) {
        const config = await this.getConfig(item.name);
        if (config) {
          bots.push({
            id: item.name,
            name: config.botName || config.systemPrompt?.name || item.name,
            niche: config.botPersona || 'general',
            businessName: config.businessDetails?.name || '',
            llmProvider: config.llmProvider || 'gemini',
            llmModel: config.llmModel || ''
          });
        }
      }
    }
    
    return bots.length > 0 ? bots : [{ id: 'default', name: 'Default Local Bot', niche: 'general' }];
  }

  async createBot(botId, config) {
    return this.saveConfig(botId, config);
  }

  async deleteBot(botId) {
    await this._initPaths();
    const botDir = this.path.join(this.baseDir, 'bots', botId);
    if (this.fs.existsSync(botDir)) {
      await this.fsPromises.rm(botDir, { recursive: true, force: true });
    }
  }

  // --- Conversations ---

  async getOrCreateConversation(channel, userId, userName, botId) {
    let conv = this.memoryDb.conversations.find(c => 
      c.channel === channel && c.user_id === userId && c.bot_id === botId
    );

    if (!conv) {
      conv = {
        id: 'conv_' + crypto.randomUUID().slice(0, 8),
        bot_id: botId,
        channel,
        user_id: userId,
        user_name: userName,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      this.memoryDb.conversations.push(conv);
    }
    return { ...conv };
  }

  async getConversation(id) {
    return this.memoryDb.conversations.find(c => c.id === id) || null;
  }

  async listConversations({ channel, status, botId, limit = 50, offset = 0 } = {}) {
    let filtered = this.memoryDb.conversations.filter(c => c.bot_id === botId);
    if (channel) filtered = filtered.filter(c => c.channel === channel);
    if (status) filtered = filtered.filter(c => c.status === status);
    
    filtered.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return filtered.slice(offset, offset + limit);
  }

  async updateConversationStatus(id, status) {
    const conv = this.memoryDb.conversations.find(c => c.id === id);
    if (conv) {
      conv.status = status;
      conv.updated_at = new Date().toISOString();
    }
  }

  async updateConversation(id, updates = {}) {
    const conv = this.memoryDb.conversations.find(c => c.id === id);
    if (conv) {
      Object.assign(conv, updates, { updated_at: new Date().toISOString() });
    }
  }

  // --- Messages ---

  async addMessage({ conversationId, botId, role, content, toolCalls = null, tokens = 0 }) {
    const msg = {
      id: 'msg_' + crypto.randomUUID().slice(0, 8),
      conversation_id: conversationId,
      bot_id: botId,
      role,
      content,
      tool_calls: toolCalls,
      tokens,
      created_at: new Date().toISOString()
    };
    
    this.memoryDb.messages.push(msg);
    
    const conv = this.memoryDb.conversations.find(c => c.id === conversationId);
    if (conv) {
      conv.updated_at = new Date().toISOString();
      conv.last_message = content;
    }
    
    return { ...msg };
  }

  async getMessages(conversationId, limit = 50) {
    let msgs = this.memoryDb.messages.filter(m => m.conversation_id === conversationId);
    msgs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return msgs.slice(0, limit).reverse();
  }

  // --- Leads ---

  async saveLead({ botId, name, phone, email, interest, budget, notes, channel, status = 'new' }) {
    let existing = null;
    if (phone) existing = this.memoryDb.leads.find(l => (l.bot_id === botId || l.botId === botId) && l.phone === phone);
    if (!existing && email) existing = this.memoryDb.leads.find(l => (l.bot_id === botId || l.botId === botId) && l.email === email);

    if (existing) {
      Object.assign(existing, { name, phone, email, interest, budget, notes, status, updated_at: new Date().toISOString() });
      return { ...existing };
    }

    const id = 'lead_' + crypto.randomUUID().slice(0, 8);
    const newLead = {
      id, botId, name, phone, email, interest, budget, notes, channel, status,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.memoryDb.leads.push(newLead);
    return { ...newLead };
  }

  async listLeads({ botId, status, search, limit = 50, offset = 0 } = {}) {
    let filtered = this.memoryDb.leads.filter(l => l.bot_id === botId || l.botId === botId);
    if (status) filtered = filtered.filter(l => l.status === status);
    if (search) {
      const lowerSearch = search.toLowerCase();
      filtered = filtered.filter(l => 
        (l.name && l.name.toLowerCase().includes(lowerSearch)) ||
        (l.phone && l.phone.includes(search)) ||
        (l.email && l.email.toLowerCase().includes(lowerSearch))
      );
    }
    
    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return filtered.slice(offset, offset + limit);
  }

  async updateLead(id, updates) {
    const lead = this.memoryDb.leads.find(l => l.id === id);
    if (lead) {
      Object.assign(lead, updates, { updated_at: new Date().toISOString() });
    }
  }

  // --- Knowledge Base ---

  async listKBDocuments(botId) {
    await this._initPaths();
    
    // Check old location for default bot and new bot-specific location
    const legacyKbPath = this.path.join(this.baseDir, 'kb');
    const botKbPath = this.path.join(this.baseDir, 'bots', botId, 'kb');
    
    let docs = [];
    
    try {
      if (this.fs.existsSync(botKbPath)) {
        const files = await this.fsPromises.readdir(botKbPath);
        docs = files;
      } else if (botId === 'default' && this.fs.existsSync(legacyKbPath)) {
        const files = await this.fsPromises.readdir(legacyKbPath);
        docs = files;
      }
    } catch (e) {}
    
    return docs;
  }

  async getKBDocument(botId, filename) {
    await this._initPaths();
    
    const botKbPath = this.path.join(this.baseDir, 'bots', botId, 'kb', filename);
    const legacyKbPath = this.path.join(this.baseDir, 'kb', filename);
    
    try {
      if (this.fs.existsSync(botKbPath)) {
        return await this.fsPromises.readFile(botKbPath, 'utf8');
      } else if (botId === 'default' && this.fs.existsSync(legacyKbPath)) {
        return await this.fsPromises.readFile(legacyKbPath, 'utf8');
      }
    } catch (e) {}
    
    return null;
  }

  async saveKBDocument(botId, filename, content) {
    await this._initPaths();
    const kbDir = this.path.join(this.baseDir, 'bots', botId, 'kb');
    
    if (!this.fs.existsSync(kbDir)) {
      await this.fsPromises.mkdir(kbDir, { recursive: true });
    }
    
    await this.fsPromises.writeFile(this.path.join(kbDir, filename), content, 'utf8');
  }

  async deleteKBDocument(botId, filename) {
    await this._initPaths();
    const botKbPath = this.path.join(this.baseDir, 'bots', botId, 'kb', filename);
    
    try {
      if (this.fs.existsSync(botKbPath)) {
        await this.fsPromises.unlink(botKbPath);
      }
    } catch (e) {}
  }

  // --- Media Library (fs) ---

  async saveMedia(botId, filename, dataBase64, contentType = 'application/octet-stream') {
    await this._initPaths();
    const mediaDir = this.path.join(this.baseDir, 'bots', botId, 'media');
    if (!this.fs.existsSync(mediaDir)) {
      await this.fsPromises.mkdir(mediaDir, { recursive: true });
    }
    const buffer = Buffer.from(dataBase64, 'base64');
    await this.fsPromises.writeFile(this.path.join(mediaDir, filename), buffer);
  }

  async getMedia(botId, filename) {
    await this._initPaths();
    const mediaPath = this.path.join(this.baseDir, 'bots', botId, 'media', filename);
    try {
      if (!this.fs.existsSync(mediaPath)) return null;
      const buffer = await this.fsPromises.readFile(mediaPath);
      return {
        filename,
        dataBase64: buffer.toString('base64'),
        contentType: guessContentType(filename)
      };
    } catch (e) {
      return null;
    }
  }

  async listMedia(botId) {
    await this._initPaths();
    const mediaDir = this.path.join(this.baseDir, 'bots', botId, 'media');
    try {
      if (!this.fs.existsSync(mediaDir)) return [];
      const files = await this.fsPromises.readdir(mediaDir);
      return files.map(filename => {
        let size = 0;
        try {
          const stat = this.fs.statSync(this.path.join(mediaDir, filename));
          size = stat.size;
        } catch (e) {}
        return { filename, contentType: guessContentType(filename), size };
      });
    } catch (e) {
      return [];
    }
  }

  async deleteMedia(botId, filename) {
    await this._initPaths();
    const mediaPath = this.path.join(this.baseDir, 'bots', botId, 'media', filename);
    try {
      if (this.fs.existsSync(mediaPath)) {
        await this.fsPromises.unlink(mediaPath);
      }
    } catch (e) {}
  }

  // --- Metrics ---

  async recordLlmUsage(botId, provider, tokens) {
    this.memoryDb.metrics.push({
      id: crypto.randomUUID(),
      bot_id: botId,
      type: 'tokens',
      provider,
      value: tokens,
      created_at: new Date().toISOString()
    });
  }

  async getOverviewMetrics(botId) {
    const convs = this.memoryDb.conversations.filter(c => c.bot_id === botId);
    const totalConversations = convs.length;
    
    const leads = this.memoryDb.leads.filter(l => l.bot_id === botId || l.botId === botId);
    const totalLeads = leads.length;
    
    const resolved = convs.filter(c => c.status === 'resolved').length;
    const escalated = convs.filter(c => c.status === 'escalated').length;
    
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const conversations24h = convs.filter(c => new Date(c.updated_at || c.created_at).getTime() >= oneDayAgo).length;
    
    const msgs = this.memoryDb.messages.filter(m => m.bot_id === botId);
    const messages24h = msgs.filter(m => new Date(m.created_at).getTime() >= oneDayAgo).length;

    const nonEscalated = Math.max(0, totalConversations - escalated);
    const botResolutionRate = totalConversations > 0 ? ((nonEscalated / totalConversations) * 100).toFixed(1) + '%' : '100%';
    const escalationRate = totalConversations > 0 ? ((escalated / totalConversations) * 100).toFixed(1) + '%' : '0%';

    const metrics = this.memoryDb.metrics.filter(m => m.bot_id === botId && m.type === 'tokens');
    let totalTokens = 0;
    let estimatedCostUsd = 0;
    const providerUsage = {};
    
    for (const m of metrics) {
      totalTokens += m.value;
      providerUsage[m.provider] = (providerUsage[m.provider] || 0) + m.value;
      const rate = COST_RATES[m.provider] || 0;
      estimatedCostUsd += (m.value / 1000) * rate;
    }

    return {
      totalConversations,
      conversations24h,
      messages24h,
      totalLeads,
      escalationRate,
      escalatedCount: escalated,
      botResolutionRate,
      totalTokens,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
      providerUsage
    };
  }

  // --- Export ---

  async exportLeadsCsv(botId) {
    const leads = await this.listLeads({ botId });
    if (!leads || leads.length === 0) return 'id,name,phone,email,interest,budget,status,created_at\n';
    
    const header = 'id,name,phone,email,interest,budget,status,created_at\n';
    const rows = leads.map(l => 
      `${l.id},"${l.name || ''}","${l.phone || ''}","${l.email || ''}","${l.interest || ''}","${l.budget || ''}","${l.status || ''}","${l.created_at || ''}"`
    ).join('\n');
    return header + rows;
  }

  async exportConversationsCsv(botId) {
    const convs = await this.listConversations({ botId });
    if (!convs || convs.length === 0) return 'id,channel,user_name,status,created_at\n';
    
    const header = 'id,channel,user_name,status,created_at\n';
    const rows = convs.map(c => 
      `${c.id},"${c.channel || ''}","${c.user_name || ''}","${c.status || ''}","${c.created_at || ''}"`
    ).join('\n');
    return header + rows;
  }

  // --- Auth ---

  async authenticateBot(accessCode) {
    if (!accessCode) return null;
    await this._initPaths();
    const botsDir = this.path.join(this.baseDir, 'bots');
    if (this.fs.existsSync(botsDir)) {
      const items = await this.fsPromises.readdir(botsDir, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory()) {
          const config = await this.getConfig(item.name);
          if (config && (config._accessCode === accessCode || config.accessCode === accessCode || config.pin === accessCode)) {
            return item.name;
          }
        }
      }
    }
    // Also check default bot config
    const defaultConfig = await this.getConfig('default');
    if (defaultConfig && (defaultConfig._accessCode === accessCode || defaultConfig.accessCode === accessCode || defaultConfig.pin === accessCode)) {
      return 'default';
    }
    return null;
  }
}

/**
 * Factory function to create the appropriate storage adapter
 * based on the environment.
 * 
 * @param {Object} env - The Cloudflare environment object (bindings)
 * @returns {CloudflareStorageAdapter|LocalStorageAdapter}
 */
export function createStorageAdapter(env) {
  if (env && env.DB) {
    return new CloudflareStorageAdapter(env);
  } else {
    return new LocalStorageAdapter();
  }
}

export default createStorageAdapter;
