// user memory DTO
export interface UserProfile {
  name?: string;
  language?: string;
  timezone?: string;
  interests?: string[];
  occupation?: string;
  updatedAt: string;
}

export interface UserFact {
  fact: string;
  confidence: number;
  source: string;
  createdAt: string;
}

export interface UserMemory {
  profile: UserProfile;
  facts: UserFact[];
  preferences: {
    codeStyle?: string;
    responseLength?: 'brief' | 'detailed';
    emojiUsage?: 'none' | 'moderate' | 'frequent';
    likes?: string;
    dislikes?: string;
    language?: string;
  };
}

// Session Context DTO
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface SessionContext {
  userId: string;
  summary: string;
  summaryUpdatedAt?: string;
  recentMessages: ChatMessage[];
  messageCount: number;
  topics: string[];
  keyPoints: string[];  // Key points extracted from conversation
  lastActivity: string;
  lastModelUsed?: string;  // Last used AI model (for branding)
}

// Shared Learning DTO
export interface QueryPattern {
  pattern: string;
  action: 'enableSearch' | 'enableThinking' | 'detectLanguage' | 'none';
  confidence: number;
  occurrences: number;
}

export interface ErrorFix {
  error: string;
  fix: string;
  occurrences: number;
}

export interface CommonQuestion {
  question: string;
  answer: string;
  frequency: number;
}

export interface GlobalLearnings {
  queryPatterns: QueryPattern[];
  errorFixes: ErrorFix[];
  commonQuestions: CommonQuestion[];
}

// Context Builder Result
export interface BuiltContext {
  systemPrompt: string;
  messages: ChatMessage[];
  userMemorySummary?: string;
  sessionSummary?: string;
  appliedPatterns?: string[];
}
