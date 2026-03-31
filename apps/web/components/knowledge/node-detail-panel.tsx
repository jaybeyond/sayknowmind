"use client";

import { X, ExternalLink, FileText, Tag, Folder, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

interface ConnectedDoc {
  id: string;
  title: string;
  url?: string;
}

interface ConnectedEntity {
  id: string;
  name: string;
  type: string;
  confidence?: number;
}

export interface NodeDetail {
  id: string;
  label: string;
  type: string;
  properties?: Record<string, unknown>;
  connectedDocuments?: ConnectedDoc[];
  connectedEntities?: ConnectedEntity[];
}

interface NodeDetailPanelProps {
  node: NodeDetail | null;
  onClose: () => void;
  onDrillDown?: (nodeId: string) => void;
}

const typeConfig: Record<string, { bg: string; text: string; icon: typeof FileText }> = {
  document: { bg: "bg-cyan-500/20", text: "text-cyan-400", icon: FileText },
  entity: { bg: "bg-pink-500/20", text: "text-pink-400", icon: Tag },
  category: { bg: "bg-purple-500/20", text: "text-purple-400", icon: Folder },
  concept: { bg: "bg-emerald-500/20", text: "text-emerald-400", icon: Tag },
};

export function NodeDetailPanel({ node, onClose, onDrillDown }: NodeDetailPanelProps) {
  const { t } = useTranslation();

  if (!node) return null;

  const config = typeConfig[node.type] ?? { bg: "bg-muted", text: "text-muted-foreground", icon: Tag };
  const TypeIcon = config.icon;

  const properties: [string, string][] = node.properties
    ? Object.entries(node.properties)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => [k, String(v)])
    : [];
  const entities = node.connectedEntities ?? [];
  const documents = node.connectedDocuments ?? [];

  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-80 bg-background/95 backdrop-blur-sm border-l border-border overflow-y-auto z-10 animate-in slide-in-from-right-4 duration-200"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium", config.bg, config.text)}>
                <TypeIcon className="size-3" />
                {node.type}
              </span>
            </div>
            <h3 className="font-semibold text-base leading-tight break-words">{node.label}</h3>
          </div>
          <Button variant="ghost" size="icon-xs" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* Properties */}
        {properties.length > 0 && (
          <section>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {t("knowledge.properties")}
            </h4>
            <dl className="space-y-1.5">
              {properties.map(([key, value]) => (
                <div key={key} className="flex items-start gap-2 text-sm">
                  <dt className="text-muted-foreground shrink-0">{key}:</dt>
                  <dd className="min-w-0">
                    {key === "url" ? (
                      <a
                        href={value}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline truncate flex items-center gap-1"
                      >
                        <span className="truncate">{value}</span>
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-foreground break-words">{value}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* Connected Entities (for document nodes) */}
        {entities.length > 0 && (
          <section>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {t("knowledge.entities") || "Entities"} ({entities.length})
            </h4>
            <ul className="space-y-1">
              {entities.map((entity) => (
                <li key={entity.id}>
                  <button
                    onClick={() => onDrillDown?.(entity.id)}
                    className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-muted/80 transition-colors text-left group"
                  >
                    <Tag className="size-3.5 text-pink-400 shrink-0" />
                    <span className="text-sm flex-1 truncate">{entity.name}</span>
                    <span className="text-[10px] text-muted-foreground">{entity.type}</span>
                    <ArrowRight className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Connected Documents */}
        {documents.length > 0 && (
          <section>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {t("knowledge.connectedDocuments").replace("{{count}}", String(documents.length))}
            </h4>
            <ul className="space-y-1">
              {documents.map((doc) => (
                <li key={doc.id}>
                  <button
                    onClick={() => onDrillDown?.(doc.id)}
                    className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-muted/80 transition-colors text-left group"
                  >
                    <FileText className="size-3.5 text-cyan-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{doc.title}</p>
                      {doc.url && (
                        <p className="text-[11px] text-muted-foreground truncate">{doc.url}</p>
                      )}
                    </div>
                    <ArrowRight className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Open source link */}
        {typeof node.properties?.url === "string" && (
          <Button variant="outline" size="sm" className="w-full gap-2" asChild>
            <a href={node.properties.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" />
              {t("knowledge.openSource") || "Open source"}
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
