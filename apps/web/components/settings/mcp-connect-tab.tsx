"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check, Terminal, Globe, Zap, RefreshCw } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

type Transport = "streamable-http" | "sse" | "stdio";

export function McpConnectTab() {
  const { t } = useTranslation();
  const [transport, setTransport] = useState<Transport>("streamable-http");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load existing key on mount
  if (!loaded && typeof window !== "undefined") {
    setLoaded(true);
    fetch("/api/user/mcp-key").then((r) => r.ok ? r.json() : null).then((data) => {
      if (data?.apiKey) setApiKey(data.apiKey);
    }).catch(() => {});
  }

  const serverUrl = typeof window !== "undefined"
    ? `${window.location.origin}/mcp`
    : "https://mind.sayknow.ai/mcp";

  const baseUrl = typeof window !== "undefined"
    ? window.location.origin
    : "https://mind.sayknow.ai";

  const generateApiKey = useCallback(async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/user/mcp-key", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setApiKey(data.apiKey);
      }
    } catch { /* silent */ }
    setGenerating(false);
  }, []);

  const configs: Record<Transport, { label: string; icon: typeof Globe; code: string }> = {
    "streamable-http": {
      label: "StreamableHTTP",
      icon: Globe,
      code: JSON.stringify({
        mcpServers: {
          sayknowmind: {
            url: `${baseUrl}/mcp`,
            ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
          },
        },
      }, null, 2),
    },
    sse: {
      label: "SSE",
      icon: Zap,
      code: JSON.stringify({
        mcpServers: {
          sayknowmind: {
            transport: "sse",
            url: `${baseUrl}/sse`,
            ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
          },
        },
      }, null, 2),
    },
    stdio: {
      label: "stdio (Local)",
      icon: Terminal,
      code: JSON.stringify({
        mcpServers: {
          sayknowmind: {
            command: "npx",
            args: ["-y", "@sayknowmind/mcp-server", "--stdio"],
            env: {
              EDGEQUAKE_URL: `${baseUrl}`,
              ...(apiKey ? { MCP_API_KEY: apiKey } : {}),
            },
          },
        },
      }, null, 2),
    },
  };

  const current = configs[transport];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">{t("mcp.title")}</h3>
        <p className="text-xs text-muted-foreground mb-4">
          {t("mcp.description")}
        </p>
      </div>

      {/* API Key */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium">{t("mcp.apiKey")}</h4>
          <Button size="sm" variant="outline" onClick={generateApiKey} disabled={generating}>
            <RefreshCw className={`size-3.5 mr-1.5 ${generating ? "animate-spin" : ""}`} />
            {apiKey ? t("mcp.regenerate") : t("mcp.generate")}
          </Button>
        </div>
        {apiKey ? (
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-md font-mono break-all">
              {apiKey}
            </code>
            <CopyButton text={apiKey} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("mcp.noKey")}</p>
        )}
      </div>

      {/* Transport selector */}
      <div className="flex gap-1 border rounded-lg p-1">
        {(Object.entries(configs) as [Transport, typeof current][]).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setTransport(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              transport === key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <cfg.icon className="size-3.5" />
            {cfg.label}
          </button>
        ))}
      </div>

      {/* Config code */}
      <div className="relative rounded-lg border bg-muted/30 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
          <span className="text-xs font-mono text-muted-foreground">
            {transport === "stdio" ? "claude_desktop_config.json" : "mcp.json"}
          </span>
          <CopyButton text={current.code} />
        </div>
        <pre className="p-3 text-xs font-mono overflow-x-auto whitespace-pre">
          {current.code}
        </pre>
      </div>

      {/* Usage instructions */}
      <div className="rounded-lg border p-4 bg-muted/30 space-y-2">
        <h4 className="text-xs font-medium">{t("mcp.howToUse")}</h4>
        <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
          <li>{t("mcp.step1")}</li>
          <li>{t("mcp.step2")}</li>
          <li>{t("mcp.step3")}</li>
        </ol>
      </div>

      {/* Compatible clients */}
      <div className="rounded-lg border p-4 space-y-2">
        <h4 className="text-xs font-medium">{t("mcp.compatible")}</h4>
        <div className="flex flex-wrap gap-2">
          {["Claude Desktop", "Claude Code", "Cursor", "Windsurf", "VS Code Copilot", "Cline"].map((client) => (
            <span key={client} className="text-xs px-2 py-1 rounded-full bg-muted font-medium">
              {client}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={copy}>
      {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
    </Button>
  );
}
