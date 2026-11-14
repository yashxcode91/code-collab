import React, { useEffect, useRef, useState } from 'react';
import {
  Code2,
  FileCode,
  Loader2,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { ProjectFileNodeDto, SemanticSearchResultDto } from '@codecollab/shared';
import { searchCodebaseSemantic } from '@/lib/queries';
import { useStudioStore } from '@/stores/useStudioStore';
import { cn } from '@/lib/utils';

export interface SemanticSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  branchId: string;
  files?: ProjectFileNodeDto[];
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
  files,
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

  // Fast debounced code search across client buffers & server files
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
      const startTime = performance.now();
      const lowerQuery = trimmed.toLowerCase();
      const localResults: SemanticSearchResultDto[] = [];
      const fileMap = new Map((files ?? []).map((f) => [f.id, f.name]));

      // 1. Instantly scan open memory buffers in Monaco / Zustand store
      try {
        const storeBuffers = useStudioStore.getState().buffers;
        for (const [fileId, buffer] of Object.entries(storeBuffers)) {
          if (!buffer?.content) continue;
          const fileName = fileMap.get(fileId) ?? 'file';

          if (activeExt && !fileName.endsWith(activeExt)) continue;

          const lines = buffer.content.split('\n');
          lines.forEach((lineText, idx) => {
            if (lineText.toLowerCase().includes(lowerQuery)) {
              const startLine = idx + 1;
              const endLine = Math.min(lines.length, startLine + 3);
              const snippet = lines.slice(idx, endLine).join('\n');

              localResults.push({
                id: `buffer-${fileId}-${startLine}`,
                fileId,
                filePath: fileName,
                startLine,
                endLine,
                content: snippet || lineText,
                similarity: 1.0,
              });
            }
          });
        }
      } catch (err) {
        console.warn('Local buffer search error:', err);
      }

      // 2. Scan file names from the active branch file tree
      if (files) {
        for (const f of files) {
          if (f.nodeType !== 'file') continue;
          if (activeExt && !f.name.endsWith(activeExt)) continue;
          if (f.name.toLowerCase().includes(lowerQuery)) {
            const alreadyMatched = localResults.some((r) => r.fileId === f.id);
            if (!alreadyMatched) {
              localResults.push({
                id: `file-${f.id}`,
                fileId: f.id,
                filePath: f.name,
                startLine: 1,
                endLine: 1,
                content: f.name,
                similarity: 0.95,
              });
            }
          }
        }
      }

      // Immediately show local matches to eliminate latency
      if (localResults.length > 0) {
        setResults(localResults);
        setLatencyMs(Math.round(performance.now() - startTime));
      }

      // 3. Query server database for all persisted files on the branch
      try {
        const response = await searchCodebaseSemantic(projectId, branchId, {
          query: trimmed,
          topK: 15,
          minScore: 0.1,
          fileExtensionFilter: activeExt ? [activeExt] : undefined,
        });

        // Merge without duplicate file/line keys
        const seen = new Set(localResults.map((r) => `${r.fileId}:${r.startLine}`));
        const merged = [...localResults];
        for (const res of response.results) {
          const key = `${res.fileId}:${res.startLine}`;
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(res);
          }
        }

        setResults(merged);
        setLatencyMs(Math.round(performance.now() - startTime));
        setSelectedIndex(0);
      } catch (err) {
        // If server call fails, keep local results
        if (localResults.length > 0) {
          setResults(localResults);
        } else {
          console.error('Code search error:', err);
          setResults([]);
        }
      } finally {
        setIsSearching(false);
      }
    }, 120);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, activeExt, isOpen, projectId, branchId, files]);

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
        className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-primary/30 bg-card/95 shadow-2xl shadow-primary/10 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header Input */}
        <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
          <Search className="h-5 w-5 text-primary shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search code, functions, or file names (e.g. 'greet', 'main', 'iostream')..."
            className="flex-1 bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
          {isSearching ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
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

        {/* Extension Filter Chips & Results Count */}
        <div className="flex items-center justify-between gap-1.5 overflow-x-auto border-b border-border/40 bg-muted/20 px-4 py-2 no-scrollbar">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground/70 mr-1">Filter:</span>
            {EXTENSION_FILTERS.map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => setActiveExt(f.ext)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
                  activeExt === f.ext
                    ? 'bg-primary/20 text-primary border border-primary/40 font-semibold'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {latencyMs !== null && query.trim().length > 0 && (
              <span className="text-[10px] text-muted-foreground font-mono">
                {results.length} {results.length === 1 ? 'match' : 'matches'} ({latencyMs}ms)
              </span>
            )}
          </div>
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          className="max-h-[380px] overflow-y-auto p-2 space-y-1.5 focus:outline-none"
        >
          {query.trim().length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Search className="h-8 w-8 text-primary/40 mb-2" />
              <p className="text-sm font-medium text-foreground">Find in Files & Code</p>
              <p className="text-xs text-muted-foreground/70 max-w-sm mt-1">
                Instantly search for functions, variables, keywords, and files across this branch.
              </p>
            </div>
          ) : isSearching && results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary mb-2" />
              <p className="text-xs font-medium">Searching files...</p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground px-4">
              <Code2 className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm font-medium text-foreground">No matching code found for &quot;{query}&quot;</p>
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-md">
                Try searching for a different keyword, function name, or check your active file extension filters.
              </p>
            </div>
          ) : (
            results.map((result, idx) => {
              const isSelected = idx === selectedIndex;

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
                      ? 'border-primary/50 bg-primary/10 shadow-sm'
                      : 'border-border/30 bg-background/50 hover:border-primary/30 hover:bg-muted/30'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 truncate">
                      <FileCode className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="text-xs font-semibold text-foreground truncate">
                        {result.filePath}
                      </span>
                      <span className="rounded bg-primary/15 border border-primary/25 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-primary">
                        Line {result.startLine}
                      </span>
                    </div>

                    <span className="shrink-0 text-[10px] text-muted-foreground group-hover:text-foreground transition-colors font-mono">
                      Jump &rarr;
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
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              Code Search
            </span>
            <span className="text-muted-foreground/40">•</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 text-[9.5px] font-medium text-purple-400">
              <Sparkles className="h-2.5 w-2.5" />
              <span>AI Semantic Search Coming Soon</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
