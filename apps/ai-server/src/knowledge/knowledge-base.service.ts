import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface KnowledgeEntry {
  id: string;
  content: string;
  keywords: string[];
  embedding: number[];
  source?: string;       // Source (document name, URL, etc.)
  imageUrl?: string;     // Image link (included in AI response)
  createdAt: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  keywords: string;       // Tree keywords (comma separated)
  imageUrl?: string;      // Knowledge base representative image
  status: 'ready' | 'disabled';
  entries: KnowledgeEntry[];
  resources: Array<{ type: string; value: string; image?: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeConfig {
  bases: KnowledgeBase[];
  globalSettings: {
    embeddingModel: string;
    hybridAlpha: number;
    rankingModel: string;
    minScore: number;
    lookbackWindow: string;
  };
}

export interface SearchResult {
  content: string;
  similarity: number;
  baseName: string;
  source?: string;
  imageUrl?: string;
  url?: string;
  type?: string;
}

@Injectable()
export class KnowledgeBaseService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeBaseService.name);
  private readonly dataPath: string;
  private config: KnowledgeConfig;

  constructor() {
    this.dataPath = path.join(process.cwd(), 'data', 'knowledge.json');
    this.config = this.getDefaultConfig();
  }

  onModuleInit() {
    this.loadConfig();
    this.logger.log(`📚 Knowledge base loaded: ${this.config.bases.length} bases`);
  }

  private getDefaultConfig(): KnowledgeConfig {
    return {
      bases: [],
      globalSettings: {
        embeddingModel: 'simclusters_v2',
        hybridAlpha: 0.7,
        rankingModel: 'heavy_ranker',
        minScore: 0.1,
        lookbackWindow: '30d',
      },
    };
  }

  private loadConfig() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const raw = fs.readFileSync(this.dataPath, 'utf-8');
        this.config = JSON.parse(raw);
        this.logger.log(`✅ Knowledge config loaded from ${this.dataPath}`);
      }
    } catch (error) {
      this.logger.warn(`⚠️ Failed to load knowledge.json: ${error.message}`);
    }
  }

  private saveConfig() {
    try {
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dataPath, JSON.stringify(this.config, null, 2), 'utf-8');
      this.logger.log(`📝 Knowledge config saved`);
    } catch (error) {
      this.logger.error(`❌ Failed to save knowledge.json: ${error.message}`);
    }
  }

  // ===== CRUD =====

  getAll(): KnowledgeConfig {
    return this.config;
  }

  getBases(): KnowledgeBase[] {
    return this.config.bases;
  }

  getBase(id: string): KnowledgeBase | undefined {
    return this.config.bases.find(b => b.id === id);
  }

  createBase(data: { name: string; description: string; keywords: string; imageUrl?: string; resources?: any[] }): KnowledgeBase {
    const base: KnowledgeBase = {
      id: `kb_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      name: data.name,
      description: data.description,
      keywords: data.keywords || '',
      imageUrl: data.imageUrl || '',
      status: 'ready',
      entries: [],
      resources: data.resources || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.config.bases.push(base);
    this.saveConfig();
    this.logger.log(`📚 Created knowledge base: ${base.name} (${base.id})`);
    return base;
  }

  updateBase(id: string, data: Partial<KnowledgeBase>): KnowledgeBase | null {
    const index = this.config.bases.findIndex(b => b.id === id);
    if (index === -1) return null;
    const base = this.config.bases[index];
    if (data.name !== undefined) base.name = data.name;
    if (data.description !== undefined) base.description = data.description;
    if (data.keywords !== undefined) base.keywords = data.keywords;
    if (data.imageUrl !== undefined) base.imageUrl = data.imageUrl;
    if (data.status !== undefined) base.status = data.status;
    if (data.resources !== undefined) base.resources = data.resources;
    base.updatedAt = new Date().toISOString();
    this.saveConfig();
    return base;
  }

  deleteBase(id: string): boolean {
    const before = this.config.bases.length;
    this.config.bases = this.config.bases.filter(b => b.id !== id);
    if (this.config.bases.length < before) {
      this.saveConfig();
      this.logger.log(`🗑️ Deleted knowledge base: ${id}`);
      return true;
    }
    return false;
  }

  // ===== Entry (knowledge entry) management =====

  addEntry(baseId: string, content: string, source?: string, imageUrl?: string): KnowledgeEntry | null {
    const base = this.getBase(baseId);
    if (!base) return null;

    const entry: KnowledgeEntry = {
      id: `ke_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      content: content.substring(0, 2000),
      keywords: this.extractKeywords(content),
      embedding: this.generateEmbedding(content),
      source,
      imageUrl,
      createdAt: new Date().toISOString(),
    };
    base.entries.push(entry);
    base.updatedAt = new Date().toISOString();
    this.saveConfig();
    this.logger.log(`📄 Added entry to ${base.name}: ${content.substring(0, 50)}...`);
    return entry;
  }

  deleteEntry(baseId: string, entryId: string): boolean {
    const base = this.getBase(baseId);
    if (!base) return false;
    const before = base.entries.length;
    base.entries = base.entries.filter(e => e.id !== entryId);
    if (base.entries.length < before) {
      base.updatedAt = new Date().toISOString();
      this.saveConfig();
      return true;
    }
    return false;
  }

  // ===== global settings =====

  getGlobalSettings() {
    return this.config.globalSettings;
  }

  updateGlobalSettings(settings: Partial<KnowledgeConfig['globalSettings']>) {
    Object.assign(this.config.globalSettings, settings);
    this.saveConfig();
    return this.config.globalSettings;
  }

  // ===== Search (keyword + embedding hybrid) =====

  search(query: string, topK: number = 5): SearchResult[] {
    const queryEmbedding = this.generateEmbedding(query);
    const queryLower = query.toLowerCase();
    const queryKeywords = this.extractKeywords(query);
    const results: SearchResult[] = [];

    for (const base of this.config.bases) {
      if (base.status !== 'ready') continue;

      // Step 1: Direct match between knowledge base keywords and query (including substring)
      const baseKeywords = base.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
      const directMatch = baseKeywords.some(bk => queryLower.includes(bk) || bk.includes(queryLower));

      // If direct match, return all entries + resources of that knowledge base with high score
      if (directMatch) {
        for (const entry of base.entries) {
          results.push({
            content: entry.content,
            similarity: 0.9,
            baseName: base.name,
            source: entry.source,
            imageUrl: entry.imageUrl || base.imageUrl,
          });
        }
        // Include resources in recommendation results
        if (base.resources && base.resources.length > 0) {
          for (const resource of base.resources) {
            results.push({
              content: resource.value,
              similarity: 0.85,
              baseName: base.name,
              source: base.name,
              imageUrl: resource.image || base.imageUrl,
              url: resource.value,
              type: resource.type,
            });
          }
        }
        continue;
      }

      // Step 2: Hybrid score (keyword + vector)
      for (const entry of base.entries) {
        const alpha = this.config.globalSettings.hybridAlpha;
        const vectorScore = this.cosineSimilarity(queryEmbedding, entry.embedding);
        const keywordScore = this.keywordOverlap(queryKeywords, entry.keywords);
        // Boost if query is directly included in entry content
        const contentMatch = entry.content.toLowerCase().includes(queryLower) ? 0.3 : 0;
        const score = alpha * vectorScore + (1 - alpha) * keywordScore + contentMatch;

        if (score >= this.config.globalSettings.minScore) {
          results.push({
            content: entry.content,
            similarity: score,
            baseName: base.name,
            source: entry.source,
            imageUrl: entry.imageUrl || base.imageUrl,
          });
        }
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  /**
   * Convert knowledge related to query into Context string
   * (for injection in buildEnhancedMessages)
   */
  getRelevantKnowledge(query: string): string | null {
    const results = this.search(query, 3);
    if (results.length === 0) return null;

    const parts = results.map(r => {
      let line = `- [${r.baseName}] ${r.content}`;
      if (r.source) line += ` (Source: ${r.source})`;
      if (r.imageUrl) line += `\n  Related image: ${r.imageUrl}`;
      return line;
    });
    return `[Knowledge base reference]\n${parts.join('\n')}`;
  }

  reload() {
    this.loadConfig();
    return { message: 'Knowledge config reloaded', bases: this.config.bases.length };
  }

  // ===== Utilities =====

  private generateEmbedding(text: string): number[] {
    const VECTOR_SIZE = 128;
    const vector = new Array(VECTOR_SIZE).fill(0);
    const normalized = text.toLowerCase().replace(/[^\w\s가-힣\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(w => w.length > 1);

    for (const word of normalized) {
      const hash = this.hashString(word);
      vector[Math.abs(hash) % VECTOR_SIZE] += 1;
      if (word.length > 2) {
        for (let i = 0; i < word.length - 1; i++) {
          const bh = this.hashString(word.substring(i, i + 2));
          vector[Math.abs(bh) % VECTOR_SIZE] += 0.5;
        }
      }
    }

    const mag = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    if (mag > 0) for (let i = 0; i < vector.length; i++) vector[i] /= mag;
    return vector;
  }

  private extractKeywords(text: string): string[] {
    return text.toLowerCase()
      .replace(/[^\w\s가-힣\u4e00-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1)
      .reduce((acc: string[], w) => { if (!acc.includes(w)) acc.push(w); return acc; }, [])
      .slice(0, 30);
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return hash;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, nA = 0, nB = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; nA += a[i] * a[i]; nB += b[i] * b[i]; }
    const mag = Math.sqrt(nA) * Math.sqrt(nB);
    return mag > 0 ? dot / mag : 0;
  }

  private keywordOverlap(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    const overlap = a.filter(w => b.some(bw => bw.includes(w) || w.includes(bw))).length;
    return overlap / Math.max(a.length, b.length);
  }
}
