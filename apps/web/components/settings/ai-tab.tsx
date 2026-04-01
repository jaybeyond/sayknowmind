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
  Zap,
  Loader2,
  RefreshCw,
  Database,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n";
import { isCloud } from "@/lib/environment";

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

const PROVIDER_BASE_URLS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api",
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  grok: "https://api.x.ai",
  google: "https://generativelanguage.googleapis.com",
  upstage: "https://api.upstage.ai",
  nvidia: "https://integrate.api.nvidia.com",
  venice: "https://api.venice.ai",
  zai: "https://open.bigmodel.cn/api/paas",
};

function getBaseUrl(provider: ProviderDef, keyValues: Record<string, string>): string {
  if (provider.id === "cloudflare") {
    const accountId = keyValues["sayknowmind-cloudflare-account-id"] ?? "";
    return accountId
      ? `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai`
      : "";
  }
  return PROVIDER_BASE_URLS[provider.id] ?? "";
}

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
  docsLabel,
  isActive,
  onSetActive,
  modelValue,
  onModelChange,
  activeLabel,
  modelLabel,
  modelPlaceholder,
  fetchModelsLabel,
  loadingLabel,
}: {
  provider: ProviderDef;
  values: Record<string, string>;
  onValuesChange: (id: string, value: string) => void;
  docsLabel: string;
  isActive: boolean;
  onSetActive: () => void;
  modelValue: string;
  onModelChange: (v: string) => void;
  activeLabel: string;
  modelLabel: string;
  modelPlaceholder: string;
  fetchModelsLabel: string;
  loadingLabel: string;
}) {
  const mainValue = values[provider.keyStorageId] ?? "";
  const isConfigured = mainValue.length > 0;
  const isLocal = provider.category === "local";

  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const fetchModels = async (apiKey?: string) => {
    const baseUrl = getBaseUrl(provider, values);
    const key = apiKey ?? mainValue;
    if (!baseUrl || !key) return;
    setLoadingModels(true);
    try {
      const res = await fetch("/api/models/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey: key }),
      });
      if (res.ok) {
        const data = await res.json();
        setModels(data.models ?? []);
      }
    } catch {
      // silently fail on auto-fetch
    } finally {
      setLoadingModels(false);
    }
  };

  // Auto-fetch models when key is available on mount
  useEffect(() => {
    if (isConfigured && !isLocal) {
      fetchModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigured]);

  return (
    <div
      className={cn(
        "rounded-xl border p-4 space-y-3 transition-colors",
        isActive ? "border-primary bg-primary/10 ring-1 ring-primary/30" : isConfigured ? "border-primary/40 bg-primary/5" : "border-border"
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {isActive ? (
            <div className="size-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
              <Zap className="size-3" />
            </div>
          ) : isConfigured ? (
            <div className="size-5 rounded-full bg-primary/20 text-primary flex items-center justify-center">
              <Check className="size-3" />
            </div>
          ) : null}
          <div>
            <h4 className="text-sm font-medium">
              {provider.name}
              {isActive && <span className="ml-1.5 text-xs text-primary font-normal">{activeLabel}</span>}
            </h4>
            <p className="text-xs text-muted-foreground">{provider.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isConfigured && !isActive && (
            <button
              type="button"
              onClick={onSetActive}
              className="text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded border border-border hover:border-primary/40"
            >
              {activeLabel}
            </button>
          )}
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            {docsLabel}
            <ExternalLink className="size-3" />
          </a>
        </div>
      </div>

      <KeyField
        id={`key-${provider.id}`}
        label={provider.keyLabel}
        placeholder={provider.keyPlaceholder}
        value={mainValue}
        onChange={(v) => onValuesChange(provider.keyStorageId, v)}
        isUrl={isLocal}
      />

      {/* Model selection — only for cloud providers with a key */}
      {!isLocal && isConfigured && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground" htmlFor={`model-${provider.id}`}>
              {modelLabel}
            </label>
            <button
              type="button"
              onClick={() => fetchModels()}
              disabled={loadingModels}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
            >
              {loadingModels ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
              {loadingModels ? loadingLabel : fetchModelsLabel}
            </button>
          </div>
          {models.length > 0 ? (
            <select
              id={`model-${provider.id}`}
              value={modelValue}
              onChange={(e) => onModelChange(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">{modelPlaceholder}</option>
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <Input
              id={`model-${provider.id}`}
              value={modelValue}
              onChange={(e) => onModelChange(e.target.value)}
              placeholder={modelPlaceholder}
              className="text-sm h-9"
            />
          )}
        </div>
      )}

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

// ─── Embedding provider definitions (cloud mode) ────────────

interface EmbeddingDef {
  id: string;
  name: string;
  models: string[];
  defaultModel: string;
}

const EMBEDDING_PROVIDERS: EmbeddingDef[] = [
  { id: "openai", name: "OpenAI", models: ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"], defaultModel: "text-embedding-3-small" },
  { id: "gemini", name: "Google Gemini", models: ["text-embedding-004", "embedding-001"], defaultModel: "text-embedding-004" },
  { id: "voyage", name: "Voyage AI", models: ["voyage-3", "voyage-3-lite", "voyage-code-3"], defaultModel: "voyage-3" },
  { id: "cohere", name: "Cohere", models: ["embed-v4.0", "embed-multilingual-v3.0", "embed-english-v3.0"], defaultModel: "embed-v4.0" },
];

export function AITab() {
  const { t } = useTranslation();
  const cloudMode = isCloud();
  const [chatMode, setChatMode] = useState("simple");
  const [keyValues, setKeyValues] = useState<Record<string, string>>({});
  const [activeProviderId, setActiveProviderId] = useState<string>("");
  const [modelValues, setModelValues] = useState<Record<string, string>>({});

  // Embedding provider state (cloud mode)
  const [embeddingProvider, setEmbeddingProvider] = useState("openai");
  const [embeddingModel, setEmbeddingModel] = useState("text-embedding-3-small");
  const [embeddingTesting, setEmbeddingTesting] = useState(false);

  const chatModes = [
    { id: "simple", label: t("chat.simpleMode"), description: t("chat.simpleModeDesc"), icon: Bot },
    { id: "agentic", label: t("chat.agenticMode"), description: t("chat.agenticModeDesc"), icon: Sparkles },
  ];

  useEffect(() => {
    // Load chat mode from localStorage (UI preference, not a secret)
    setChatMode(localStorage.getItem("sayknowmind-chat-mode") ?? "simple");
    setEmbeddingProvider(localStorage.getItem("sayknowmind-embedding-provider") ?? "openai");
    setEmbeddingModel(localStorage.getItem("sayknowmind-embedding-model") ?? "text-embedding-3-small");

    // Load provider configs from server DB (keys are masked)
    fetch("/api/settings/providers")
      .then((res) => res.json())
      .then((data) => {
        if (!data?.providers) return;
        setActiveProviderId(data.activeProviderId ?? "");
        const loaded: Record<string, string> = {};
        const models: Record<string, string> = {};
        for (const p of data.providers as Array<{ id: string; apiKey: string; model: string; baseUrl: string; extraFields?: Record<string, string> }>) {
          const def = providers.find((d) => d.id === p.id);
          if (def) {
            loaded[def.keyStorageId] = p.apiKey; // masked value from server
            if (p.model) models[p.id] = p.model;
            // Load extra fields
            if (p.extraFields && def.extraFields) {
              for (const f of def.extraFields) {
                const key = f.id.replace(`${p.id}-`, "").replace("-", "_");
                const val = p.extraFields[key] ?? p.extraFields[f.id] ?? "";
                if (val) loaded[f.storageId] = String(val);
              }
            }
          }
        }
        setKeyValues(loaded);
        setModelValues(models);
      })
      .catch(() => {
        // Server load failed — start with empty state
      });
  }, []);

  const handleModeChange = (id: string) => {
    localStorage.setItem("sayknowmind-chat-mode", id);
    setChatMode(id);
    toast.success(t("ai.chatModeSet").replace("{{mode}}", id));
  };

  const handleValueChange = (storageId: string, value: string) => {
    setKeyValues((prev) => ({ ...prev, [storageId]: value }));
  };

  const handleSetActive = (providerId: string) => {
    setActiveProviderId(providerId);
    toast.success(t("ai.providerActivated").replace("{{name}}", providers.find((p) => p.id === providerId)?.name ?? providerId));
  };

  const handleModelChange = (providerId: string, value: string) => {
    setModelValues((prev) => ({ ...prev, [providerId]: value }));
  };

  const handleTestEmbedding = async () => {
    // Find the API key for the selected embedding provider
    const providerKeyMap: Record<string, string> = {
      openai: "sayknowmind-openai-key",
      gemini: "sayknowmind-google-key",
      voyage: "sayknowmind-voyage-key",
      cohere: "sayknowmind-cohere-key",
    };
    const apiKey = keyValues[providerKeyMap[embeddingProvider] ?? ""] ?? "";
    if (!apiKey) {
      toast.error(t("settings.embeddingNoKey"));
      return;
    }
    setEmbeddingTesting(true);
    try {
      const res = await fetch("/api/models/embedding/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: embeddingProvider, model: embeddingModel, apiKey }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(t("settings.embeddingTestOk"));
      } else {
        toast.error(data.error ?? t("settings.embeddingTestFail"));
      }
    } catch {
      toast.error(t("settings.embeddingTestFail"));
    } finally {
      setEmbeddingTesting(false);
    }
  };

  const handleSave = async () => {
    // Save UI preferences to localStorage (not secrets)
    localStorage.setItem("sayknowmind-chat-mode", chatMode);
    localStorage.setItem("sayknowmind-embedding-provider", embeddingProvider);
    localStorage.setItem("sayknowmind-embedding-model", embeddingModel);

    // Save provider configs to server DB (AES-256-GCM encrypted)
    try {
      const serverProviders = providers
        .filter((p) => p.category === "cloud" && keyValues[p.keyStorageId])
        .map((p) => ({
          id: p.id,
          apiKey: keyValues[p.keyStorageId],
          model: modelValues[p.id] ?? "",
          baseUrl: getBaseUrl(p, keyValues),
          extraFields: Object.fromEntries(
            (p.extraFields ?? [])
              .map((f) => [f.id, keyValues[f.storageId] ?? ""])
              .filter(([, v]) => v),
          ),
        }))
        .filter((p) => p.apiKey && p.baseUrl);

      const res = await fetch("/api/settings/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeProviderId,
          providers: serverProviders,
          embedding: cloudMode ? { provider: embeddingProvider, model: embeddingModel } : undefined,
        }),
      });

      if (!res.ok) throw new Error("Save failed");
      toast.success(t("settings.saved"));
    } catch {
      toast.error(t("settings.saveFailed") ?? "Failed to save settings");
    }
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
          <h3 className="text-sm font-medium">{t("settings.defaultMode")}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("settings.defaultModeDesc")}
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
            <h3 className="text-sm font-medium">{t("ai.cloudProviders")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("ai.configuredCount")
                .replace("{{count}}", String(configuredCount))
                .replace("{{total}}", String(providers.length))}
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
              docsLabel={t("common.docs")}
              isActive={activeProviderId === provider.id}
              onSetActive={() => handleSetActive(provider.id)}
              modelValue={modelValues[provider.id] ?? ""}
              onModelChange={(v) => handleModelChange(provider.id, v)}
              activeLabel={t("ai.setActive")}
              modelLabel={t("ai.model")}
              modelPlaceholder={t("ai.modelPlaceholder")}
              fetchModelsLabel={t("ai.fetchModels")}
              loadingLabel={t("ai.loading")}
            />
          ))}
        </div>
      </div>

      {/* Embedding Provider — cloud mode only */}
      {cloudMode && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-medium">{t("settings.embeddingProvider")}</h3>
              <p className="text-xs text-muted-foreground">
                {t("settings.embeddingProviderDesc")}
              </p>
            </div>
          </div>

          <div className="rounded-xl border p-4 space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("settings.embeddingProvider")}
              </label>
              <select
                value={embeddingProvider}
                onChange={(e) => {
                  const id = e.target.value;
                  setEmbeddingProvider(id);
                  const def = EMBEDDING_PROVIDERS.find((p) => p.id === id);
                  if (def) setEmbeddingModel(def.defaultModel);
                }}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {EMBEDDING_PROVIDERS.map((ep) => (
                  <option key={ep.id} value={ep.id}>{ep.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("settings.embeddingModel")}
              </label>
              <select
                value={embeddingModel}
                onChange={(e) => setEmbeddingModel(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {(EMBEDDING_PROVIDERS.find((p) => p.id === embeddingProvider)?.models ?? []).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <p className="text-[11px] text-muted-foreground">
              {t("settings.embeddingKeyNote")}
            </p>

            <Button
              variant="outline"
              size="sm"
              onClick={handleTestEmbedding}
              disabled={embeddingTesting}
            >
              {embeddingTesting ? (
                <Loader2 className="size-3.5 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5 mr-1" />
              )}
              {t("settings.testConnection")}
            </Button>
          </div>
        </div>
      )}

      {/* Server-side notice */}
      <div className="rounded-xl border border-dashed border-muted-foreground/30 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Server className="size-4 text-muted-foreground" />
          <h4 className="text-sm font-medium text-muted-foreground">
            {t("ai.serverConfig")}
          </h4>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("ai.serverConfigDesc")}
        </p>
      </div>

      <Button onClick={handleSave} className="w-full sm:w-auto">
        {t("ai.saveSettings")}
      </Button>
    </div>
  );
}
