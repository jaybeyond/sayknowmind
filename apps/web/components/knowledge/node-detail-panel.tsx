"use client";

import { useTranslation } from "@/lib/i18n";

interface NodeDetail {
  id: string;
  label: string;
  type: string;
  properties?: Record<string, unknown>;
  connectedDocuments?: Array<{
    id: string;
    title: string;
    url?: string;
  }>;
}

interface NodeDetailPanelProps {
  node: NodeDetail | null;
  onClose: () => void;
}

export function NodeDetailPanel({ node, onClose }: NodeDetailPanelProps) {
  const { t } = useTranslation();

  if (!node) return null;

  const typeColors: Record<string, string> = {
    document: "bg-cyan-500/20 text-cyan-400",
    entity: "bg-pink-500/20 text-pink-400",
    category: "bg-purple-500/20 text-purple-400",
    concept: "bg-emerald-500/20 text-emerald-400",
  };

  return (
    <div className="absolute right-0 top-0 bottom-0 w-80 bg-background/95 backdrop-blur-sm border-l border-border p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading font-semibold text-lg truncate">{node.label}</h3>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-1"
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
          </svg>
        </button>
      </div>

      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${typeColors[node.type] ?? "bg-muted text-muted-foreground"}`}>
        {node.type}
      </span>

      {node.properties && Object.keys(node.properties).length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-medium text-muted-foreground mb-2">
            {t("knowledge.properties")}
          </h4>
          <dl className="space-y-1">
            {Object.entries(node.properties).map(([key, value]) => (
              <div key={key} className="flex gap-2 text-sm">
                <dt className="text-muted-foreground min-w-0 shrink-0">{key}:</dt>
                <dd className="text-foreground truncate">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {node.connectedDocuments && node.connectedDocuments.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-medium text-muted-foreground mb-2">
            {t("knowledge.connectedDocuments").replace("{{count}}", String(node.connectedDocuments.length))}
          </h4>
          <ul className="space-y-2">
            {node.connectedDocuments.map((doc) => (
              <li key={doc.id} className="text-sm">
                <div className="p-2 rounded bg-muted/50 hover:bg-muted transition-colors">
                  <p className="font-medium truncate">{doc.title}</p>
                  {doc.url && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{doc.url}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
