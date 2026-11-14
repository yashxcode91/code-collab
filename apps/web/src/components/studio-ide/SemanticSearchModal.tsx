import React, { useEffect, useRef, useState } from 'react';
import {
  Code2,
  FileCode,
  Loader2,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { SemanticSearchResultDto } from '@codecollab/shared';
import { searchCodebaseSemantic } from '@/lib/queries';
import { cn } from '@/lib/utils';

export interface SemanticSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  branchId: string;
  onSelectResult: (fileId: string, startLine: number, endLine: number) => void;
}

const EXTENSION_FILTERS = [
  { label: 'All Files', ext: null },
  { label: '.ts/.tsx', ext: '.ts' },
  { label: '.js/.jsx', ext: '.js' },
  { label: '.cpp/.h', ext: '.cpp' },
  { label: '.py', ext: '.py' },
  { label: '.json', ext: '.json' },
];

export function SemanticSearchModal({
  isOpen,
  onClose,
  projectId,
  branchId,
  onSelectResult,
}: SemanticSearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SemanticSearchResultDto[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeExt, setActiveExt] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setLatencyMs(null);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Debounced semantic search
  useEffect(() => {
    if (!isOpen) return;

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setIsSearching(false);
      setLatencyMs(null);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await searchCodebaseSemantic(projectId, branchId, {
          query: trimmed,
          topK: 8,
          minScore: 0.15,
          fileExtensionFilter: activeExt ? [activeExt] : undefined,
        });

        setResults(response.results);
        setLatencyMs(response.latencyMs);
        setSelectedIndex(0);
      } catch (err) {
        console.error('Semantic search error:', err);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 280);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, activeExt, isOpen, projectId, branchId]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        results.length > 0 ? (prev - 1 + results.length) % results.length : 0
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        const item = results[selectedIndex];
        onSelectResult(item.fileId, item.startLine, item.endLine);
        onClose();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-16 backdrop-blur-sm sm:pt-24"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-purple-500/30 bg-card/95 shadow-2xl shadow-purple-500/10 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header Input */}
        <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
          <Sparkles className="h-5 w-5 text-purple-400 shrink-0 animate-pulse" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Semantic Code Search (e.g. 'JWT verify token', 'Stripe checkout flow')..."
            className="flex-1 bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
          {isSearching ? (
            <Loader2 className="h-4 w-4 animate-spin text-purple-400 shrink-0" />
          ) : query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
          <kbd className="hidden sm:inline-block rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Extension Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border/40 bg-muted/20 px-4 py-2 no-scrollbar">
          <span className="text-[11px] font-semibold text-muted-foreground/70 mr-1">Filter:</span>
          {EXTENSION_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setActiveExt(f.ext)}
              className={cn(
                'rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
                activeExt === f.ext
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {f.label}
            </button>
          ))}
          {latencyMs !== null && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {results.length} matches ({latencyMs}ms)
            </span>
          )}
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          className="max-h-[380px] overflow-y-auto p-2 space-y-1.5 focus:outline-none"
        >
          {query.trim().length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Search className="h-8 w-8 text-purple-400/40 mb-2" />
              <p className="text-sm font-medium">Search Codebase by Meaning</p>
              <p className="text-xs text-muted-foreground/70 max-w-sm mt-1">
                Natural language queries find related functions, classes, and logic across all files in this branch.
              </p>
            </div>
          ) : isSearching && results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-purple-400 mb-2" />
              <p className="text-xs font-medium">Embedding query and scanning vectors...</p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
              <Code2 className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm font-medium">No matching code found</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Try broader phrasing or ensure your codebase has been indexed.
              </p>
            </div>
          ) : (
            results.map((result, idx) => {
              const isSelected = idx === selectedIndex;
              const similarityPercent = Math.min(100, Math.round(result.similarity * 100));

              return (
                <div
                  key={result.id}
                  onClick={() => {
                    onSelectResult(result.fileId, result.startLine, result.endLine);
                    onClose();
                  }}
                  className={cn(
                    'group cursor-pointer rounded-lg border p-2.5 transition-all text-left',
                    isSelected
                      ? 'border-purple-500/50 bg-purple-500/10 shadow-sm'
                      : 'border-border/30 bg-background/50 hover:border-purple-500/30 hover:bg-muted/30'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 truncate">
                      <FileCode className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                      <span className="text-xs font-semibold text-foreground truncate">
                        {result.filePath}
                      </span>
                      <span className="rounded bg-muted/60 px-1 py-0.2 font-mono text-[10px] text-muted-foreground">
                        L{result.startLine}-{result.endLine}
                      </span>
                    </div>

                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-tight',
                        similarityPercent >= 75
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : similarityPercent >= 50
                          ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                          : 'bg-muted/50 text-muted-foreground'
                      )}
                    >
                      {similarityPercent}% match
                    </span>
                  </div>

                  {/* Code snippet preview */}
                  <pre className="mt-2 max-h-24 overflow-hidden rounded bg-black/40 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground group-hover:text-foreground transition-colors border border-border/20">
                    <code>{result.content.trim()}</code>
                  </pre>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer Hints */}
        <div className="flex items-center justify-between border-t border-border/40 bg-muted/20 px-4 py-2 text-[10.5px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="font-mono bg-muted/50 px-1 rounded">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="font-mono bg-muted/50 px-1 rounded">↵</kbd> jump to code
            </span>
            <span>
              <kbd className="font-mono bg-muted/50 px-1 rounded">esc</kbd> close
            </span>
          </div>
          <span className="text-purple-400 font-medium">pgvector (768-dim)</span>
        </div>
      </div>
    </div>
  );
}
