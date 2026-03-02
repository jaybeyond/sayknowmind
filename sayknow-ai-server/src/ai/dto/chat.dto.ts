import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class MessageDto {
  @IsString()
  role: 'system' | 'user' | 'assistant';

  @IsString()
  content: string;
}

export class FileDto {
  @IsString()
  name: string;

  @IsString()
  type: string;

  @IsString()
  data: string; // base64 encoded
}

export class ChatRequestDto {
  // New approach: userId + sessionId + message (uses memory system)
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  message?: string; // Single message (memory system manages context)

  // Legacy approach: pass messages array directly (backward compatible)
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  messages?: MessageDto[];

  @IsOptional()
  @IsString()
  systemPrompt?: string; // Persona prompt (sent from backend)

  @IsOptional()
  @IsString()
  customInstructions?: string; // User custom instructions (sent from backend)

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FileDto)
  files?: FileDto[];

  @IsOptional()
  @IsArray()
  images?: Array<{ data: string; mimeType: string }>; // base64 images (for vision models)

  @IsOptional()
  @IsBoolean()
  enableSearch?: boolean;

  @IsOptional()
  @IsBoolean()
  enableThinking?: boolean;

  @IsOptional()
  @IsBoolean()
  stream?: boolean;

  @IsOptional()
  @IsString()
  aiModel?: string; // 'pro' | 'flash' | 'lite'

  @IsOptional()
  @IsString()
  userLanguage?: string; // User language (ko, en, ja, etc.) - prioritizes Solar Pro 3 for Korean

  @IsOptional()
  @IsBoolean()
  useMemory?: boolean; // Whether to use memory system (default: true)

  @IsOptional()
  userContext?: {
    time?: {
      localTime?: string;
      timezone?: string;
      date?: string;
      time?: string;
      dayOfWeek?: string;
    };
    location?: {
      city?: string;
      country?: string;
    } | null;
  };

  @IsOptional()
  userProfile?: {
    name?: string;
    email?: string;
    imageUrl?: string;
  };

  @IsOptional()
  @IsBoolean()
  isNewSession?: boolean;
}

export class ChatResponseDto {
  content: string;
  hasOCR: boolean;
  hasSearch: boolean;
  hasThinking: boolean;
  model: string;
  tokensUsed?: number;
  searchSources?: Array<{ title: string; url: string }>;
  memoryUsed?: boolean; // Whether memory system was used
  sessionSummary?: string; // Session summary (for debugging)
}

export class SearchResultDto {
  title: string;
  url: string;
  snippet: string;
}
