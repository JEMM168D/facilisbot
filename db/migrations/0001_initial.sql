-- Bots table (each client has one)
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  niche TEXT DEFAULT 'starter',
  config TEXT NOT NULL,  -- Full JSON config blob
  api_provider TEXT DEFAULT 'gemini',
  api_key TEXT,  -- Client's API key
  access_code TEXT,  -- Access code for admin panel login
  owner_email TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  status TEXT DEFAULT 'active',
  lead_id TEXT,
  unread INTEGER DEFAULT 0,
  last_message TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (bot_id) REFERENCES bots(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  tokens INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  email TEXT,
  interest TEXT,
  budget TEXT,
  status TEXT DEFAULT 'nuevo',
  channel TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (bot_id) REFERENCES bots(id)
);

CREATE TABLE IF NOT EXISTS metrics (
  bot_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  calls_made INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  month TEXT NOT NULL,
  PRIMARY KEY (bot_id, provider, month),
  FOREIGN KEY (bot_id) REFERENCES bots(id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_bot ON conversations(bot_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(bot_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_bot ON messages(bot_id);
CREATE INDEX IF NOT EXISTS idx_leads_bot ON leads(bot_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(bot_id, status);
CREATE INDEX IF NOT EXISTS idx_metrics_bot_month ON metrics(bot_id, month);

-- Insert default bot
INSERT OR IGNORE INTO bots (id, name, niche, config, access_code) VALUES (
  'default',
  'Asistente Virtual',
  'starter',
  '{"bot":{"id":"default","name":"Asistente Virtual","niche":"starter","language":"es","personality":"cercano, servicial, profesional y conciso"},"business":{"name":"Mi Empresa","industry":"Servicios"},"llm":{"provider":"gemini","model":"gemini-3.5-flash-lite","temperature":0.4,"maxTokens":1000},"channels":{"web":{"enabled":true}}}',
  'admin123'
);
