import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface PromptConfig {
  // Model-specific system prompts
  models: {
    pro: string;
    flash: string;
    lite: string;
  };
  // Feature-specific prompts
  features: {
    search: string;
    vision: string;
    tools: string;
    noThink: string;
  };
  // Rules
  rules: {
    modelNameBan: string;
    branding: string;
  };
  // Default persona
  defaultPersona: {
    name: string;
    systemPrompt: string;
  };
}

const DEFAULT_CONFIG: PromptConfig = {
  models: {
    pro: 'You are SayKnow AI assistant. Provide friendly and helpful responses.',
    flash: 'You are a helpful assistant. Answer concisely in the user\'s language.',
    lite: 'You are a helpful assistant. Answer concisely in the user\'s language.',
  },
  features: {
    search: 'You are an AI that answers accurately based on search results.',
    vision: 'Analyze images and answer the user\'s questions. Respond in the language the user is using.',
    tools: `Analyze the user's request and call the appropriate tool.

Available tools:
- browser_open: Open web browser
- weather: Weather lookup
- screenshot: Screenshot capture
- clipboard_read/write: Clipboard read/write
- datetime: Current time/date
- calculator: Calculation
- notification: Show notification
- tts: Text-to-speech
- news: News lookup
- stock: Stock information
- crypto: Cryptocurrency information
- translate: Translation
- web_search: Web search
- read_file/write_file/list_dir: File system

If a tool is needed, call it via tool_calls. If not, provide a normal response.`,
    noThink: `[Important: Response format rules]
- Never output thinking process, analysis steps, or internal reasoning
- Do not use <think>, <thinking> tags
- Do not output step-by-step analysis like "1. Analyze...", "Draft 1:", "Final Check:"
- Output only the final answer directly and naturally`,
  },
  rules: {
    modelNameBan: '[Important: Never mention AI model names (Solar, GPT, Gemini, Claude, Qwen, GLM, Llama, etc.)]',
    branding: '',
  },
  defaultPersona: {
    name: 'SayKnow AI',
    systemPrompt: `You are SayKnow AI, a friendly and helpful AI assistant.
You respond warmly and naturally in the user's language.
Style: concise, friendly, emoji-friendly 😊
Always be helpful, accurate, and engaging.`,
  },
};

@Injectable()
export class PromptManagerService implements OnModuleInit {
  private readonly logger = new Logger(PromptManagerService.name);
  private config: PromptConfig = DEFAULT_CONFIG;
  private readonly configPath: string;

  constructor() {
    this.configPath = path.join(process.cwd(), 'data', 'prompts.json');
  }

  async onModuleInit() {
    this.loadConfig();
  }

  private loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const saved = JSON.parse(raw) as Partial<PromptConfig>;
        // Merge saved config with defaults (safe when new fields are added)
        this.config = this.mergeDeep(DEFAULT_CONFIG, saved);
        this.logger.log(`✅ Prompts loaded from ${this.configPath}`);
      } else {
        this.config = { ...DEFAULT_CONFIG };
        this.saveConfig();
        this.logger.log(`📝 Created default prompts.json`);
      }
    } catch (error) {
      this.logger.warn(`⚠️ Failed to load prompts.json, using defaults: ${error.message}`);
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  private saveConfig() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (error) {
      this.logger.error(`❌ Failed to save prompts.json: ${error.message}`);
    }
  }

  private mergeDeep(target: any, source: any): any {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.mergeDeep(target[key] || {}, source[key]);
      } else if (source[key] !== undefined) {
        result[key] = source[key];
      }
    }
    return result;
  }

  // === Query API ===

  getAll(): PromptConfig {
    return this.config;
  }

  getModelPrompt(model: 'pro' | 'flash' | 'lite'): string {
    return this.config.models[model] || this.config.models.pro;
  }

  getFeaturePrompt(feature: keyof PromptConfig['features']): string {
    return this.config.features[feature] || '';
  }

  getRule(rule: keyof PromptConfig['rules']): string {
    return this.config.rules[rule] || '';
  }

  getDefaultPersona() {
    return this.config.defaultPersona;
  }

  // === Update API ===

  updateModelPrompt(model: 'pro' | 'flash' | 'lite', prompt: string) {
    this.config.models[model] = prompt;
    this.saveConfig();
    this.logger.log(`📝 Updated ${model} model prompt`);
  }

  updateFeaturePrompt(feature: keyof PromptConfig['features'], prompt: string) {
    this.config.features[feature] = prompt;
    this.saveConfig();
    this.logger.log(`📝 Updated ${feature} feature prompt`);
  }

  updateRule(rule: keyof PromptConfig['rules'], value: string) {
    this.config.rules[rule] = value;
    this.saveConfig();
    this.logger.log(`📝 Updated ${rule} rule`);
  }

  updateAll(config: Partial<PromptConfig>) {
    this.config = this.mergeDeep(this.config, config);
    this.saveConfig();
    this.logger.log(`📝 Updated all prompts`);
  }

  // Reload config (after direct file modification)
  reload() {
    this.loadConfig();
    return this.config;
  }
}
