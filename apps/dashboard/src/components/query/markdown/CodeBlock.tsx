/**
 * Code Block Component
 * 
 * Renders code blocks with syntax highlighting using Shiki.
 * Supports light/dark themes via next-themes.
 * Includes copy-to-clipboard, download, and full-view (expand) dialog.
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
import { Check, Copy, Download, Maximize2 } from 'lucide-react';
import { useTheme } from 'next-themes';
import { memo, useCallback, useEffect, useState } from 'react';
import { bundledLanguages, codeToHtml, type BundledLanguage } from 'shiki';

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
  showLineNumbers?: boolean;
}

// Map common language aliases to Shiki language identifiers
const LANGUAGE_MAP: Record<string, BundledLanguage> = {
  'js': 'javascript',
  'ts': 'typescript',
  'tsx': 'tsx',
  'jsx': 'jsx',
  'py': 'python',
  'rb': 'ruby',
  'sh': 'bash',
  'shell': 'bash',
  'zsh': 'bash',
  'yml': 'yaml',
  'md': 'markdown',
  'rs': 'rust',
  'go': 'go',
  'java': 'java',
  'cpp': 'cpp',
  'c': 'c',
  'cs': 'csharp',
  'php': 'php',
  'sql': 'sql',
  'json': 'json',
  'html': 'html',
  'css': 'css',
  'scss': 'scss',
  'dockerfile': 'dockerfile',
  'docker': 'dockerfile',
  'graphql': 'graphql',
  'gql': 'graphql',
  'toml': 'toml',
  'diff': 'diff',
  'plaintext': 'text' as BundledLanguage,
  'text': 'text' as BundledLanguage,
  '': 'text' as BundledLanguage,
} as const;

function normalizeLanguage(lang: string | undefined): string {
  if (!lang) return 'text';
  const normalized = lang.toLowerCase().trim();
  const mapped = LANGUAGE_MAP[normalized as keyof typeof LANGUAGE_MAP] ?? normalized;

  // WHY: Shiki throws `ShikiError: Language 'X' is not included in this bundle`
  // for languages not in the bundle (e.g., "dafny", "verilog"). Validate against
  // the bundled languages map and fall back to plain text for unsupported ones.
  if (mapped in bundledLanguages) {
    return mapped;
  }
  return 'text';
}

export const CodeBlock = memo(function CodeBlock({
  code,
  language,
  className,
  showLineNumbers = false,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFullView, setIsFullView] = useState(false);
  const { resolvedTheme } = useTheme();

  const normalizedLang = normalizeLanguage(language);
  const isDark = resolvedTheme === 'dark';
  const shikiTheme = isDark ? 'github-dark-dimmed' : 'github-light';

  // Highlight code with Shiki — re-runs when theme changes
  useEffect(() => {
    let cancelled = false;

    async function highlight() {
      try {
        setIsLoading(true);
        const html = await codeToHtml(code, {
          lang: normalizedLang,
          theme: shikiTheme,
        });
        if (!cancelled) {
          setHighlightedHtml(html);
        }
      } catch (error) {
        console.error('Shiki highlight error:', error);
        if (!cancelled) {
          setHighlightedHtml(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    highlight();

    return () => {
      cancelled = true;
    };
  }, [code, normalizedLang, shikiTheme]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, [code]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `code.${language || 'txt'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [code, language]);

  /** Shared code content renderer (used in-place and in full-view dialog) */
  const renderCodeContent = (fullHeight = false) => (
    <div className={cn('overflow-x-auto p-4', fullHeight && 'max-h-[80vh] overflow-y-auto')}>
      {isLoading ? (
        <pre className="text-sm font-mono whitespace-pre text-foreground/70">
          <code>{code}</code>
        </pre>
      ) : highlightedHtml ? (
        <div
          className="text-sm [&_pre]:bg-transparent! [&_pre]:p-0! [&_code]:text-sm"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        <pre className="text-sm font-mono whitespace-pre text-foreground/70">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );

  /** Shared action buttons */
  const renderActions = (alwaysVisible = false) => (
    <div className={cn(
      'flex items-center gap-1 transition-opacity',
      alwaysVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
    )}>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent"
        onClick={() => setIsFullView(true)}
        title="Full view"
        aria-label="Expand code to full view"
      >
        <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent"
        onClick={handleDownload}
        title="Download"
        aria-label="Download code as file"
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent"
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy'}
        aria-label={copied ? 'Code copied to clipboard' : 'Copy code to clipboard'}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </Button>
    </div>
  );

  return (
    <>
      <div
        className={cn(
          'group relative my-4 overflow-hidden rounded-lg border',
          'bg-muted/40 dark:bg-zinc-900',
          className
        )}
      >
        {/* Header with language badge and actions */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-muted/60 dark:bg-zinc-800">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {language || 'text'}
          </span>
          {renderActions()}
        </div>

        {/* Code content */}
        <div role="code" aria-label={`Code block in ${language || 'text'}`}>
          {renderCodeContent()}
        </div>
      </div>

      {/* Full-view dialog */}
      <Dialog open={isFullView} onOpenChange={setIsFullView}>
        <DialogContent className="max-w-[90vw] w-full max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span className="text-sm font-mono uppercase tracking-wider">
                {language || 'text'}
              </span>
              {renderActions(true)}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden rounded-lg border bg-muted/40 dark:bg-zinc-900">
            {renderCodeContent(true)}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});

export default CodeBlock;
