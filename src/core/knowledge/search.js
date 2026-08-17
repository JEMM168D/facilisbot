/**
 * High performance BM25 / TF-IDF Knowledge Base Search Engine
 * for RAG and accurate business context retrieval without hallucinations.
 */
export class KnowledgeBase {
  constructor(kbDir = null) {
    this.kbDir = kbDir;
    this.fallbackKbDir = null; // Set dynamically if no storage
    this.documents = [];
    this.chunks = [];
    this.catalog = [];
  }

  static async create(botId, storage, baseDir = null) {
    const kb = new KnowledgeBase();
    await kb.init(botId, storage, baseDir);
    return kb;
  }

  async init(botId, storage, baseDir = null) {
    this.documents = [];
    this.chunks = [];
    this.catalog = [];

    if (storage) {
      const documents = await storage.listKBDocuments(botId);
      for (const doc of documents) {
        const filename = typeof doc === 'string' ? doc : (doc?.filename || doc?.name);
        if (!filename) continue;
        const content = await storage.getKBDocument(botId, filename);
        if (content) {
          this.indexContent(filename, content);
        }
      }
    } else {
      const path = await import('path');
      const actualBaseDir = baseDir || process.cwd();
      this.kbDir = path.join(actualBaseDir, 'member', 'kb');
      this.fallbackKbDir = (botId === 'default') ? path.join(actualBaseDir, 'kb') : null;
      
      if (botId && botId !== 'default') {
        this.kbDir = path.join(actualBaseDir, 'member', 'bots', botId, 'kb');
        this.fallbackKbDir = null;
      }

      await this.reloadFromFs();
    }
  }

  async reloadFromFs() {
    this.documents = [];
    this.chunks = [];
    this.catalog = [];

    const fs = await import('fs');
    const path = await import('path');

    const dirsToScan = [this.kbDir, this.fallbackKbDir].filter(Boolean);
    const scannedFiles = new Set();

    for (const dir of dirsToScan) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (scannedFiles.has(file)) continue;
          scannedFiles.add(file);
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            const content = fs.readFileSync(fullPath, 'utf8');
            this.indexContent(file, content, fullPath);
          }
        }
      }
    }
  }

  indexContent(filename, rawContent, filePath = null) {
    const p = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '';
    const ext = p.toLowerCase();
    
    const doc = {
      filename,
      filePath,
      ext,
      rawContent,
      title: filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
    };
    this.documents.push(doc);

    if (ext === '.json') {
      try {
        const parsed = JSON.parse(rawContent);
        if (Array.isArray(parsed)) {
          this.catalog.push(...parsed);
          parsed.forEach((item, idx) => {
            const text = `${item.name || item.title || ''} ${item.description || ''} ${item.category || ''} ${item.price ? '$' + item.price : ''}`;
            this.chunks.push({
              source: filename,
              id: `${filename}#item_${idx}`,
              title: item.name || item.title || `Item ${idx}`,
              content: JSON.stringify(item),
              searchableText: this.cleanText(text),
              itemData: item
            });
          });
        }
      } catch (err) {
        console.warn(`[KB] Error parseando JSON ${filename}:`, err.message);
      }
    } else {
      // Markdown / Text chunking by headers or double newlines
      const sections = rawContent.split(/\n(?=#{1,3}\s)/g);
      sections.forEach((sec, idx) => {
        const lines = sec.trim().split('\n');
        const firstLine = lines[0] || '';
        const title = firstLine.startsWith('#') ? firstLine.replace(/^#+\s*/, '') : `Sección ${idx + 1}`;
        const content = sec.trim();

        if (content.length > 10) {
          this.chunks.push({
            source: filename,
            id: `${filename}#sec_${idx}`,
            title,
            content,
            searchableText: this.cleanText(`${filename} ${title} ${content}`)
          });
        }
      });
    }
  }

  cleanText(text) {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove accents
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  tokenize(text) {
    const cleaned = this.cleanText(text);
    const stopWords = new Set([
      'de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'se', 'las', 'por', 'un', 'para',
      'con', 'no', 'una', 'su', 'al', 'lo', 'como', 'mas', 'pero', 'sus', 'le', 'ya', 'o',
      'este', 'si', 'porque', 'esta', 'son', 'entre', 'esta', 'cuando', 'muy', 'sin', 'sobre',
      'the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'in', 'to', 'for', 'of', 'or', 'by'
    ]);
    return cleaned
      .split(' ')
      .filter(w => w.length > 2 && !stopWords.has(w));
  }

  /**
   * Search knowledge base for relevant chunks given a user query
   */
  search(query, topK = 4) {
    if (!query || this.chunks.length === 0) return [];

    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return [];

    const scored = this.chunks.map(chunk => {
      let score = 0;
      const text = chunk.searchableText;

      for (const token of queryTokens) {
        if (text.includes(token)) {
          // Exact token occurrence
          score += 1.5;
          // Bonus if token is in title
          if (this.cleanText(chunk.title).includes(token)) {
            score += 3.0;
          }
        }
      }

      // Check phrase match bonus
      const cleanQuery = this.cleanText(query);
      if (cleanQuery.length > 4 && text.includes(cleanQuery)) {
        score += 5.0;
      }

      return { chunk, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => ({
        source: s.chunk.source,
        title: s.chunk.title,
        content: s.chunk.content,
        score: s.score,
        itemData: s.chunk.itemData
      }));
  }

  /**
   * Quick catalog lookup for prices or item details
   */
  searchCatalog(itemName) {
    if (!itemName) return [];
    const query = this.cleanText(itemName);
    return this.catalog.filter(item => {
      const name = this.cleanText(item.name || item.title || '');
      return name.includes(query) || query.includes(name);
    });
  }

  /**
   * Get formatted context string for LLM system prompt injection
   */
  getContextForQuery(query) {
    const results = this.search(query, 3);
    if (results.length === 0) return '';

    return (
      '\n--- INFORMACIÓN RELEVANTE DE LA BASE DE CONOCIMIENTO ---\n' +
      results
        .map(r => `[Fuente: ${r.source} - ${r.title}]\n${r.content}`)
        .join('\n\n') +
      '\n--------------------------------------------------------\n'
    );
  }

  /**
   * List all documents for the admin panel
   */
  listDocuments() {
    return this.documents.map(d => ({
      filename: d.filename,
      filePath: d.filePath,
      title: d.title,
      size: d.rawContent.length,
      chunksCount: this.chunks.filter(c => c.source === d.filename).length
    }));
  }

  /**
   * Save or update a knowledge base file
   */
  async saveDocument(botId, filename, content, storage) {
    if (storage) {
      await storage.saveKBDocument(botId, filename, content);
    } else {
      const fs = await import('fs');
      const path = await import('path');
      
      if (!fs.existsSync(this.kbDir)) {
        fs.mkdirSync(this.kbDir, { recursive: true });
      }
      const targetPath = path.join(this.kbDir, filename);
      fs.writeFileSync(targetPath, content, 'utf8');
      
      // Update local array for fs paths
      const docIndex = this.documents.findIndex(d => d.filename === filename);
      if (docIndex !== -1) {
        this.documents[docIndex].filePath = targetPath;
      }
    }
    
    // Remove old chunks/doc for this file before re-indexing
    this.documents = this.documents.filter(d => d.filename !== filename);
    this.chunks = this.chunks.filter(c => c.source !== filename);
    
    // Rebuild catalog to ensure old entries from this file are removed
    this.catalog = [];
    
    this.indexContent(filename, content);
    
    // Quick hack to restore catalog from all documents
    this.documents.forEach(doc => {
      if (doc.filename !== filename && doc.ext === '.json') {
        try {
          const parsed = JSON.parse(doc.rawContent);
          if (Array.isArray(parsed)) {
            this.catalog.push(...parsed);
          }
        } catch(e) {}
      }
    });

    clearKbCache(botId);
    return { success: true, filename };
  }

  async deleteDocument(botId, filename, storage) {
    if (storage) {
      await storage.deleteKBDocument(botId, filename);
    } else {
      const fs = await import('fs');
      const path = await import('path');
      const targetPath = path.join(this.kbDir, filename);
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      } else {
        return false;
      }
    }

    this.documents = this.documents.filter(d => d.filename !== filename);
    this.chunks = this.chunks.filter(c => c.source !== filename);
    
    // Rebuild catalog
    this.catalog = [];
    this.documents.forEach(doc => {
      if (doc.ext === '.json') {
        try {
          const parsed = JSON.parse(doc.rawContent);
          if (Array.isArray(parsed)) {
            this.catalog.push(...parsed);
          }
        } catch(e) {}
      }
    });

    clearKbCache(botId);
    return true;
  }
}

const kbRegistry = new Map();

/**
 * Invalidate cached KnowledgeBase instance
 */
export function clearKbCache(botId = null) {
  if (botId) {
    kbRegistry.delete(botId);
  } else {
    kbRegistry.clear();
  }
}

/**
 * Get or instantiate KnowledgeBase for a specific botId
 */
export async function getKnowledgeBase(botId = 'default', storage = null, baseDir = null) {
  const cleanId = botId || 'default';
  
  if (kbRegistry.has(cleanId)) {
    return await kbRegistry.get(cleanId);
  }

  const kbPromise = KnowledgeBase.create(cleanId, storage, baseDir);
  kbRegistry.set(cleanId, kbPromise);
  
  try {
    return await kbPromise;
  } catch (err) {
    kbRegistry.delete(cleanId);
    throw err;
  }
}
