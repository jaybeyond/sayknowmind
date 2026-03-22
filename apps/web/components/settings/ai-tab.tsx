"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Eye,
  EyeOff,
  Bot,
  Sparkles,
  Check,
  ExternalLink,
  Server,
  Cloud,
  Cpu,
} from "lucide-react";
import { toast } from "sonner";
import { OllamaModels } from "./ollama-models";

// ─── Chat mode ───────────────────────────────────────────────

const chatModes = [
  { id: "simple", label: "Simple", description: "Direct answers", icon: Bot },
  { id: "agentic", label: "Agentic", description: "Multi-step reasoning", icon: Sparkles },
] as const;

// ─── Provider definitions ────────────────────────────────────

interface ProviderDef {
  id: string;
  name: string;
  description: string;
  category: "cloud" | "local";
  keyLabel: string;
  keyPlaceholder: string;
  keyStorageId: string;
  docsUrl: string;
  /** Extra fields beyond a single API key */
  extraFields?: Array<{
    id: string;
    label: string;
    placeholder: string;
    storageId: string;
  }>;
}

const providers: ProviderDef[] = [
  // ── Cloud providers ──
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Primary — routes to 100+ models (many free). Recommended.",
    category: "cloud",
    keyLabel: "API Key",
    keyPlaceholder: "sk-or-v1-...",
    keyStorageId: "sayknowmind-openrouter-key",
    docsUrl: "https://openrouter.ai/keys",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o, GPT-4.1, o3 series",
    category: "cloud",
    keyLabel: "API Key",
    keyPlaceholder: "sk-...",
    keyStorageId: "sayknowmind-openai-key",
    docsUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude Opus, Sonnet, Haiku",
    category: "cloud",
    keyLabel: "API Key",
    keyPlaceholder: "sk-ant-...",
    keyStorageId: "sayknowmind-anthropic-key",
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "zai",
    name: "Z.AI",
    description: "GLM-4.7 / GLM-4.7-Flash (fast, free tier available)",
    category: "cloud",
    keyLabel: "API Key",
    keyPlaceholder: "your-zai-api-key",
    keyStorageId: "sayknowmind-zai-key",
    docsUrl: "https://z.ai",
  },
  {
    id: "grok",
    name: "Grok (xAI)",
    description: "Grok 4.1 Fast Reasoning, Grok 3 Mini",
    category: "cloud",
    keyLabel: "API Key",
    keyPlaceholder: "xai-...",
    keyStorageId: "sayknowmind-grok-key",
    docsUrl: "https://console.x.ai",
  },
  {
    id: "google",
    name: "Google Gemini",
    description: "Gemini 2.5 Pro, Flash",
    category: "cloud",
    keyLabel: "API Key",
    keyPlaceholder: "AIza...",
    keyStorageId: "sayknowmind-google-key",
    docsUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "upstage",
    name: "Upstage",
    description: "Solar Pro 3 — optimized for Korean & Japanese",
    category: "cloud",
    keyLabel: "API Key",
    keyPlaceholder: "up_...",
    keyStorageId: "sayknowmind-upstage-key",
    docsUrl: "https://console.upstage.ai",
  },
  {
    id: "venice",
    name: "Venice AI",
    description: "Uncensored models — privacy-focused",
    category: "cloud",
    keyLabel: "API Key",
    keyPlaceholder: "your-venice-api-key",
    keyStorageId: "sayknowmind-venice-key",
    docsUrl: "https://venice.ai",
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    description: "Enterprise-grade GPU inference (DeepSeek, Llama, GLM)",
    category: "cloud",
    keyLabel: "API Key",
    keyPlaceholder: "nvapi-...",
    keyStorageId: "sayknowmind-nvidia-key",
    docsUrl: "https://build.nvidia.com",
  },
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    description: "Edge inference — Llama 3.1 70B/8B",
    category: "cloud",
    keyLabel: "API Token",
    keyPlaceholder: "your-api-token",
    keyStorageId: "sayknowmind-cloudflare-token",
    docsUrl: "https://dash.cloudflare.com",
    extraFields: [
      {
        id: "cloudflare-account",
        label: "Account ID",
        placeholder: "your-account-id",
        storageId: "sayknowmind-cloudflare-account-id",
      },
    ],
  },
];

// ─── Key field component ─────────────────────────────────────

function KeyField({
  id,
  label,
  placeholder,
  value,
  onChange,
  isUrl,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  isUrl?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={isUrl || show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pr-10 text-sm h-9"
        />
        {!isUrl && (
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Provider card component ─────────────────────────────────

function ProviderCard({
  provider,
  values,
  onValuesChange,
}: {
  provider: ProviderDef;
  values: Record<string, string>;
  onValuesChange: (id: string, value: string) => void;
}) {
  const mainValue = values[provider.keyStorageId] ?? "";
  const isConfigured = mainValue.length > 0;
  const isLocal = provider.category === "local";

  return (
    <div
      className={cn(
        "rounded-xl border p-4 space-y-3 transition-colors",
        isConfigured ? "border-primary/40 bg-primary/5" : "border-border"
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {isConfigured && (
            <div className="size-5 rounded-full bg-primary/20 text-primary flex items-center justify-center">
              <Check className="size-3" />
            </div>
          )}
          <div>
            <h4 className="text-sm font-medium">{provider.name}</h4>
            <p className="text-xs text-muted-foreground">{provider.description}</p>
          </div>
        </div>
        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          Docs
          <ExternalLink className="size-3" />
        </a>
      </div>

      <KeyField
        id={`key-${provider.id}`}
        label={provider.keyLabel}
        placeholder={provider.keyPlaceholder}
        value={mainValue}
        onChange={(v) => onValuesChange(provider.keyStorageId, v)}
        isUrl={isLocal}
      />

      {provider.extraFields?.map((field) => (
        <KeyField
          key={field.id}
          id={field.id}
          label={field.label}
          placeholder={field.placeholder}
          value={values[field.storageId] ?? ""}
          onChange={(v) => onValuesChange(field.storageId, v)}
        />
      ))}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────

export function AITab() {
  const [chatMode, setChatMode] = useState("simple");
  const [keyValues, setKeyValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setChatMode(localStorage.getItem("sayknowmind-chat-mode") ?? "simple");

    // Load all stored keys
    const loaded: Record<string, string> = {};
    for (const p of providers) {
      const v = localStorage.getItem(p.keyStorageId);
      if (v) loaded[p.keyStorageId] = v;
      for (const f of p.extraFields ?? []) {
        const fv = localStorage.getItem(f.storageId);
        if (fv) loaded[f.storageId] = fv;
      }
    }
    setKeyValues(loaded);
  }, []);

  const handleModeChange = (id: string) => {
    localStorage.setItem("sayknowmind-chat-mode", id);
    setChatMode(id);
    toast.success(`Chat mode set to ${id}`);
  };

  const handleValueChange = (storageId: string, value: string) => {
    setKeyValues((prev) => ({ ...prev, [storageId]: value }));
  };

  const handleSave = () => {
    for (const [key, value] of Object.entries(keyValues)) {
      if (value) {
        localStorage.setItem(key, value);
      } else {
        localStorage.removeItem(key);
      }
    }
    toast.success("Settings saved");
  };

  const cloudProviders = providers.filter((p) => p.category === "cloud");
  const configuredCount = providers.filter(
    (p) => (keyValues[p.keyStorageId] ?? "").length > 0
  ).length;

  return (
    <div className="space-y-8">
      {/* Chat Mode */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Default chat mode</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose how the AI assistant responds by default
          </p>
        </div>
        <div className="flex gap-3">
          {chatModes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => handleModeChange(mode.id)}
              className={cn(
                "flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors",
                chatMode === mode.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50"
              )}
            >
              <mode.icon className="size-5" />
              <span className="text-sm font-medium">{mode.label}</span>
              <span className="text-xs text-muted-foreground">
                {mode.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Cloud Providers */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Cloud className="size-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">Cloud Providers</h3>
            <p className="text-xs text-muted-foreground">
              {configuredCount} of {providers.length} configured — keys are stored locally
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          {cloudProviders.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              values={keyValues}
              onValuesChange={handleValueChange}
            />
          ))}
        </div>
      </div>

      {/* Local Models — Ollama */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">Local Models — Ollama</h3>
            <p className="text-xs text-muted-foreground">
              Run models on your own hardware — complete privacy, no API costs
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border p-4">
          <OllamaModels />
        </div>
      </div>

      {/* Server-side notice */}
      <div className="rounded-xl border border-dashed border-muted-foreground/30 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Server className="size-4 text-muted-foreground" />
          <h4 className="text-sm font-medium text-muted-foreground">Server Configuration</h4>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          For self-hosted deployments, you can also configure providers via environment variables in
          the AI server (<code className="text-[11px] bg-muted px-1 py-0.5 rounded">apps/ai-server/.env</code>).
          Server-level keys are shared across all users and take priority over per-user keys above.
        </p>
      </div>

      <Button onClick={handleSave} className="w-full sm:w-auto">
        Save settings
      </Button>
    </div>
  );
}
