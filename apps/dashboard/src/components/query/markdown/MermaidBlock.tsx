/**
 * Mermaid Diagram Component
 * 
 * Lazy-loads and renders Mermaid diagrams with proper error handling.
 * Supports light/dark themes via next-themes.
 * Includes a full-view dialog for large diagrams.
 * Shows a placeholder during streaming to avoid parsing incomplete syntax.
 */
'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { AlertTriangle, GitBranch, Maximize2, RefreshCw } from 'lucide-react';
import { useTheme } from 'next-themes';
import { memo, useEffect, useId, useRef, useState } from 'react';

interface MermaidBlockProps {
  code: string;
  className?: string;
  isStreaming?: boolean;
}

// Mermaid is imported dynamically to reduce initial bundle size
let mermaidPromise: Promise<typeof import('mermaid')> | null = null;
let mermaidInstance: typeof import('mermaid').default | null = null;
let currentMermaidTheme: string | null = null;

async function getMermaid(isDark: boolean) {
  const desiredTheme = isDark ? 'dark' : 'default';
  
  // If mermaid is already loaded but theme changed, re-initialize
  if (mermaidInstance && currentMermaidTheme !== desiredTheme) {
    mermaidInstance.initialize({
      startOnLoad: false,
      theme: desiredTheme,
      securityLevel: 'loose',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      flowchart: { htmlLabels: true, curve: 'basis' },
      sequence: {
        diagramMarginX: 50, diagramMarginY: 10, actorMargin: 50,
        width: 150, height: 65, boxMargin: 10, boxTextMargin: 5,
        noteMargin: 10, messageMargin: 35,
      },
    });
    currentMermaidTheme = desiredTheme;
    return mermaidInstance;
  }
  
  if (mermaidInstance) return mermaidInstance;
  
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      mermaidInstance = mod.default;
      currentMermaidTheme = desiredTheme;
      mermaidInstance.initialize({
        startOnLoad: false,
        theme: desiredTheme,
        securityLevel: 'loose',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        flowchart: { htmlLabels: true, curve: 'basis' },
        sequence: {
          diagramMarginX: 50, diagramMarginY: 10, actorMargin: 50,
          width: 150, height: 65, boxMargin: 10, boxTextMargin: 5,
          noteMargin: 10, messageMargin: 35,
        },
      });
      return mod;
    });
  }
  
  const mod = await mermaidPromise;
  return mod.default;
}

/**
 * Pre-validate and sanitize Mermaid code to fix common LLM output issues.
 * Returns sanitized code and any detected issues.
 *
 * WHY: LLMs frequently generate Mermaid syntax that is semantically correct
 * but syntactically invalid. The most common issues are:
 * 1. Parentheses inside brackets: `A[text (note)]` — Mermaid interprets `(` as shape delimiter
 * 2. Unicode characters in node IDs: `动作模型[label]` — must be ASCII IDs
 * 3. Unquoted labels with special chars: pipes, braces, etc.
 *
 * The fix: wrap label text in double quotes when it contains problematic characters.
 * Mermaid supports `A["text with (parens) and 中文"]` syntax.
 */
function sanitizeMermaidCode(code: string): { sanitized: string; issues: string[] } {
  const issues: string[] = [];
  let sanitized = code.trim();

  // Remove markdown code block markers if present
  if (sanitized.startsWith('```')) {
    sanitized = sanitized.replace(/^```(?:mermaid)?\n?/, '').replace(/\n?```$/, '');
    issues.push('Removed code block markers');
  }

  const lines = sanitized.split('\n');
  const fixedLines = lines.map((line) => {
    const trimmed = line.trim();

    // Skip empty lines, comments, diagram type declarations, and subgraph/end/style keywords
    if (
      !trimmed ||
      trimmed.startsWith('%%') ||
      /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|journey|mindmap|timeline|sankey|block)\b/i.test(trimmed) ||
      /^(subgraph|end|style|classDef|click|linkStyle|direction)\b/i.test(trimmed)
    ) {
      return line;
    }

    // Fix node definitions with bracket-style labels that contain special characters.
    // Matches patterns like: NodeId[label text] or NodeId[label (with parens)]
    // Captures: (nodeId)(openBracket)(labelText)(closeBracket)
    // We handle [], (), {}, (()) and >] shapes.
    return line.replace(
      /([A-Za-z0-9_\u4e00-\u9fff\u3400-\u4dbf]+)\[([^\]"]*[(){}|><\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef][^\]"]*)\]/g,
      (_match, nodeId: string, labelText: string) => {
        // If the label already has quotes, leave it alone
        if (labelText.startsWith('"') && labelText.endsWith('"')) return _match;

        // Escape any internal double quotes in the label
        const escaped = labelText.replace(/"/g, '#quot;');
        issues.push(`Quoted label: ${nodeId}["${escaped}"]`);
        return `${nodeId}["${escaped}"]`;
      }
    );
  });
  sanitized = fixedLines.join('\n');

  // Fix node IDs that contain non-ASCII characters (e.g., Chinese)
  // Convert them to ASCII IDs while preserving the label.
  // e.g., `动作模型 --> 其他` becomes `node_1["动作模型"] --> node_2["其他"]`
  // Only fix standalone non-ASCII IDs in arrow definitions (not already in brackets).
  let nodeCounter = 0;
  const nodeIdMap = new Map<string, string>();

  sanitized = sanitized.replace(
    // Match non-ASCII word appearing in arrow context (not inside brackets)
    /(?<=^|\s|-->|---|-\.->|==>|-.->|~~>|--?>)[\s]*([\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef][\w\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]*)[\s]*(?=$|\s|-->|---|-\.->|==>|-.->|~~>|--?>)/gm,
    (_match, unicodeId: string) => {
      if (!nodeIdMap.has(unicodeId)) {
        nodeCounter++;
        nodeIdMap.set(unicodeId, `node_${nodeCounter}`);
      }
      const asciiId = nodeIdMap.get(unicodeId)!;
      issues.push(`Mapped non-ASCII node ID: ${unicodeId} → ${asciiId}`);
      return `${asciiId}["${unicodeId}"]`;
    }
  );

  // Check for completely empty diagram
  const contentLines = sanitized.split('\n').filter(l => l.trim() && !l.trim().startsWith('%%'));
  if (contentLines.length < 2) {
    issues.push('Diagram appears incomplete (less than 2 content lines)');
  }

  return { sanitized, issues };
}

/**
 * Check if Mermaid code looks complete enough to attempt rendering.
 * This is a lightweight pre-check before invoking the full parser.
 */
function isProbablyValidMermaid(code: string): boolean {
  const trimmed = code.trim();
  
  // Must start with a valid diagram type
  const validStarts = [
    'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 
    'stateDiagram', 'erDiagram', 'gantt', 'pie', 'gitGraph',
    'journey', 'mindmap', 'timeline', 'sankey', 'block',
  ];
  
  const firstWord = trimmed.split(/[\s\n]/)[0].toLowerCase();
  if (!validStarts.some(start => firstWord.startsWith(start))) {
    return false;
  }

  // Must have at least some content after the declaration
  const lines = trimmed.split('\n').filter(l => l.trim() && !l.trim().startsWith('%%'));
  return lines.length >= 2;
}

export const MermaidBlock = memo(function MermaidBlock({
  code,
  className,
  isStreaming = false,
}: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const uniqueId = useId().replace(/:/g, '-');
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sanitizedCode, setSanitizedCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFullView, setIsFullView] = useState(false);
  const { resolvedTheme } = useTheme();

  const isDark = resolvedTheme === 'dark';

  useEffect(() => {
    // Don't render while streaming - mermaid syntax is often incomplete
    if (isStreaming) {
      setIsLoading(true);
      setSvg(null);
      setError(null);
      return;
    }

    let cancelled = false;

    async function renderDiagram() {
      if (!code.trim()) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        // Pre-validate and sanitize the code
        const { sanitized, issues } = sanitizeMermaidCode(code);
        setSanitizedCode(sanitized);
        
        if (issues.length > 0) {
          console.log('Mermaid code sanitization:', issues);
        }

        // Quick pre-check before loading Mermaid
        if (!isProbablyValidMermaid(sanitized)) {
          if (!cancelled) {
            setError('Invalid diagram format. Mermaid diagrams must start with a diagram type (graph, flowchart, sequenceDiagram, etc.)');
            setIsLoading(false);
          }
          return;
        }

        const mermaid = await getMermaid(isDark);
        
        // Try to parse first - this will throw if invalid
        try {
          await mermaid.parse(sanitized);
        } catch (parseError) {
          if (!cancelled) {
            const errorMsg = parseError instanceof Error ? parseError.message : 'Syntax error';
            throw new Error(`Parse error: ${errorMsg}`);
          }
          return;
        }

        // Render the diagram with sanitized code
        const { svg: renderedSvg } = await mermaid.render(
          `mermaid-${uniqueId}-${isDark ? 'd' : 'l'}`,
          sanitized
        );

        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Mermaid render error:', err);
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
          setSvg(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [code, isStreaming, uniqueId, isDark]);

  const handleRetry = () => {
    setError(null);
    setIsLoading(true);
    setSvg(null);
  };

  // Streaming placeholder
  if (isStreaming) {
    return (
      <div
        className={cn(
          'my-4 flex items-center justify-center rounded-lg border border-dashed p-8',
          'border-border/60 bg-muted/30',
          className
        )}
        role="status"
        aria-label="Diagram loading"
      >
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <GitBranch className="h-8 w-8 motion-safe:animate-pulse" aria-hidden="true" />
          <span className="text-sm">Diagram loading...</span>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div
        className={cn(
          'my-4 flex items-center justify-center rounded-lg border border-border bg-muted/40 dark:bg-zinc-900 p-8',
          className
        )}
        role="status"
        aria-label="Rendering diagram"
      >
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <RefreshCw className="h-6 w-6 motion-safe:animate-spin" aria-hidden="true" />
          <span className="text-sm">Rendering diagram...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className={cn(
          'my-4 rounded-lg border border-destructive/50 bg-destructive/5 p-4',
          className
        )}
        role="alert"
        aria-label="Diagram rendering failed"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-destructive">
              Failed to render Mermaid diagram
            </p>
            <p className="mt-1 text-xs text-destructive/70 wrap-break-word">{error}</p>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Show source
              </summary>
              <pre className="mt-2 overflow-x-auto rounded bg-muted p-3 text-xs text-muted-foreground">
                <code>{code}</code>
              </pre>
              {sanitizedCode && sanitizedCode !== code && (
                <>
                  <p className="mt-2 text-xs text-muted-foreground font-medium">Sanitized version:</p>
                  <pre className="mt-1 overflow-x-auto rounded bg-muted p-3 text-xs text-muted-foreground">
                    <code>{sanitizedCode}</code>
                  </pre>
                </>
              )}
            </details>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleRetry}
            aria-label="Retry rendering diagram"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  // Success - render the SVG with full-view button
  if (svg) {
    return (
      <>
        <div
          ref={containerRef}
          className={cn(
            'group relative my-4 overflow-x-auto rounded-lg border border-border p-4',
            'bg-muted/40 dark:bg-zinc-900',
            '[&_svg]:mx-auto [&_svg]:max-w-full',
            className
          )}
        >
          {/* Floating full-view button */}
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent"
              onClick={() => setIsFullView(true)}
              title="Full view"
              aria-label="Expand diagram to full view"
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
          <div
            dangerouslySetInnerHTML={{ __html: svg }}
            role="img"
            aria-label="Mermaid diagram"
          />
        </div>

        {/* Full-view dialog */}
        <Dialog open={isFullView} onOpenChange={setIsFullView}>
          <DialogContent className="max-w-[90vw] w-full max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="text-sm font-mono uppercase tracking-wider">
                Mermaid Diagram
              </DialogTitle>
            </DialogHeader>
            <div
              className={cn(
                'flex-1 overflow-auto rounded-lg border border-border p-6',
                'bg-muted/40 dark:bg-zinc-900',
                '[&_svg]:mx-auto [&_svg]:max-w-full'
              )}
              dangerouslySetInnerHTML={{ __html: svg }}
              role="img"
              aria-label="Mermaid diagram (expanded)"
            />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Empty state
  return null;
});

export default MermaidBlock;
