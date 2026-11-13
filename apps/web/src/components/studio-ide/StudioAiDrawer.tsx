import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Bug,
  Check,
  Code2,
  Copy,
  FileCode,
  Lightbulb,
  Plus,
  Send,
  Sparkles,
  Square,
  TestTube,
  Trash2,
  User,
  Wand2,
} from 'lucide-react';
import type { AiActionKind } from '@codecollab/shared';
import { useStudioAi } from '@/hooks/useStudioAi';
import { cn } from '@/lib/utils';

export interface StudioAiDrawerProps {
  projectId: string;
  branchId: string;
  activeFileId: string | null;
  activeFileName?: string | null;
  activeSelection?: { startLine: number; endLine: number; text: string } | null;
  onApplyCode?: (code: string) => Promise<void> | void;
}

const ACTION_KIND_LABELS: Record<
  AiActionKind,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  chat: { label: 'Chat', icon: Bot },
  explain: { label: 'Explain', icon: Lightbulb },
  debug: { label: 'Debug', icon: Bug },
  generate_tests: { label: 'Tests', icon: TestTube },
  review: { label: 'Review', icon: Code2 },
  refactor: { label: 'Refactor', icon: Wand2 },
};

/**
 * Lightweight, safe Markdown & Code block renderer for AI responses.
 * Highlights code fences with syntax styling, copy-to-clipboard, and Apply to Editor.
 */
function MarkdownBlock({
  content,
  onApplyCode,
}: {
  content: string;
  onApplyCode?: (code: string) => void;
}) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const parts = useMemo(() => {
    const segments: Array<
      | { type: 'text'; value: string }
      | { type: 'code'; language: string; code: string }
    > = [];

    const regex = /```([a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        segments.push({
          type: 'text',
          value: content.slice(lastIndex, match.index),
        });
      }

      segments.push({
        type: 'code',
        language: match[1]?.trim() || 'code',
        code: match[2]?.trimEnd() || '',
      });

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < content.length) {
      segments.push({
        type: 'text',
        value: content.slice(lastIndex),
      });
    }

    return segments;
  }, [content]);

  const handleCopy = async (code: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedIndex(idx);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // Best effort clipboard
    }
  };

  return (
    <div className="space-y-2.5 text-xs leading-relaxed text-foreground/90">
      {parts.map((part, idx) => {
        if (part.type === 'code') {
          const isCopied = copiedIndex === idx;
          return (
            <div
              key={idx}
              className="group my-2 overflow-hidden rounded-xl border border-white/10 bg-black/60 shadow-lg dark:bg-black/80"
            >
              {/* Code Card Toolbar */}
              <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px]">
                <span className="font-mono text-muted-foreground">
                  {part.language}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleCopy(part.code, idx)}
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                    title="Copy code snippet"
                  >
                    {isCopied ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span className="text-[10px] text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span className="text-[10px]">Copy</span>
                      </>
                    )}
                  </button>

                  {onApplyCode && (
                    <button
                      type="button"
                      onClick={() => onApplyCode(part.code)}
                      className="inline-flex items-center gap-1 rounded bg-primary/20 px-2 py-0.5 font-medium text-primary transition-colors hover:bg-primary/30"
                      title="Apply code patch into active Monaco editor"
                    >
                      <ArrowRight className="h-3 w-3" />
                      <span className="text-[10px]">Apply to Editor</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Code Pre Body */}
              <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-emerald-300">
                <code>{part.code}</code>
              </pre>
            </div>
          );
        }

        // Render formatted text paragraphs with basic inline code and bolding
        return (
          <div key={idx} className="space-y-1.5 whitespace-pre-wrap">
            {part.value}
          </div>
        );
      })}
    </div>
  );
}

export function StudioAiDrawer({
  projectId,
  branchId,
  activeFileId,
  activeFileName,
  activeSelection,
  onApplyCode,
}: StudioAiDrawerProps) {
  const {
    conversations,
    activeConversationId,
    setActiveConversationId,
    messages,
    isStreaming,
    streamingContent,
    streamingActionKind,
    aiError,
    clearError,
    sendPrompt,
    quickAction,
    stopStreaming,
    startNewConversation,
    deleteConversation,
    isDeleting,
  } = useStudioAi({
    projectId,
    branchId,
    activeFileId,
    activeFileName,
    activeSelection,
    onApplyCode,
  });

  const [inputPrompt, setInputPrompt] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom as new tokens arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputPrompt.trim() || isStreaming) return;

    const text = inputPrompt;
    setInputPrompt('');
    void sendPrompt(text, 'chat');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background/50">
      {/* Top Conversation Selector & Controls */}
      <div className="flex shrink-0 items-center justify-between gap-1.5 border-b border-border/50 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <select
            value={activeConversationId ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              setActiveConversationId(val ? val : null);
            }}
            className="glass-control h-7 min-w-0 max-w-[190px] truncate rounded-lg border border-border/40 bg-background/40 px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            title="Switch AI conversation thread"
          >
            <option value="">+ New Conversation</option>
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({c.messageCount})
              </option>
            ))}
          </select>

          {activeConversationId && (
            <button
              type="button"
              onClick={() => deleteConversation(activeConversationId)}
              disabled={isDeleting}
              title="Delete conversation"
              className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={startNewConversation}
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
          title="Start fresh conversation"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New</span>
        </button>
      </div>

      {/* Context Banner: Active File & Line Selection */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/40 bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
        <div className="flex min-w-0 items-center gap-1.5 truncate">
          <FileCode className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate font-medium text-foreground">
            {activeFileName ?? 'No file selected'}
          </span>
          {activeSelection && (
            <span className="rounded bg-primary/15 px-1 font-mono text-[9.5px] font-semibold text-primary">
              L{activeSelection.startLine}-{activeSelection.endLine}
            </span>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground/80">
          {activeSelection ? 'Selection Context' : 'File Context'}
        </span>
      </div>

      {/* 1-Click Action Chips Bar */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border/40 px-3 py-2 no-scrollbar">
        <button
          type="button"
          disabled={isStreaming}
          onClick={() => quickAction('explain')}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/50 bg-background/60 px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-500 disabled:opacity-40"
          title="Explain active selection or file"
        >
          <Lightbulb className="h-3 w-3 text-amber-500" />
          <span>Explain</span>
        </button>

        <button
          type="button"
          disabled={isStreaming}
          onClick={() => quickAction('debug')}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/50 bg-background/60 px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-40"
          title="Analyze errors and generate bug fix"
        >
          <Bug className="h-3 w-3 text-rose-500" />
          <span>Debug</span>
        </button>

        <button
          type="button"
          disabled={isStreaming}
          onClick={() => quickAction('generate_tests')}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/50 bg-background/60 px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-blue-500/40 hover:bg-blue-500/10 hover:text-blue-500 disabled:opacity-40"
          title="Generate comprehensive unit test suite"
        >
          <TestTube className="h-3 w-3 text-blue-500" />
          <span>Tests</span>
        </button>

        <button
          type="button"
          disabled={isStreaming}
          onClick={() => quickAction('review')}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/50 bg-background/60 px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-500 disabled:opacity-40"
          title="Senior engineer code review"
        >
          <Code2 className="h-3 w-3 text-emerald-500" />
          <span>Review</span>
        </button>

        <button
          type="button"
          disabled={isStreaming}
          onClick={() => quickAction('refactor')}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/50 bg-background/60 px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-purple-500/40 hover:bg-purple-500/10 hover:text-purple-500 disabled:opacity-40"
          title="Refactor for clean code and performance"
        >
          <Wand2 className="h-3 w-3 text-purple-500" />
          <span>Refactor</span>
        </button>
      </div>

      {/* Message Timeline */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm mb-3">
              <Sparkles className="h-6 w-6" />
            </div>
            <h4 className="text-sm font-semibold tracking-tight text-foreground">
              CodeCollab AI Assistant
            </h4>
            <p className="mt-1 text-xs text-muted-foreground max-w-[240px]">
              Ask coding questions, explain logic, debug runtime crashes, or generate tests for your active files.
            </p>
          </div>
        )}

        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          const ActionIcon = ACTION_KIND_LABELS[msg.actionKind]?.icon || Bot;

          return (
            <div
              key={msg.id}
              className={cn(
                'flex flex-col gap-1',
                isUser ? 'items-end' : 'items-start'
              )}
            >
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground px-1">
                {isUser ? (
                  <>
                    <span>You</span>
                    <User className="h-3 w-3" />
                  </>
                ) : (
                  <>
                    <ActionIcon className="h-3 w-3 text-primary" />
                    <span className="font-medium text-foreground">
                      {ACTION_KIND_LABELS[msg.actionKind]?.label ?? 'AI'}
                    </span>
                    {msg.fileName && (
                      <span className="font-mono text-[9px] text-muted-foreground/80">
                        ({msg.fileName}{msg.lineRange ? `:${msg.lineRange}` : ''})
                      </span>
                    )}
                  </>
                )}
              </div>

              <div
                className={cn(
                  'rounded-2xl px-3.5 py-2.5 max-w-[92%] shadow-sm',
                  isUser
                    ? 'bg-primary text-primary-foreground font-normal text-xs'
                    : 'glass-surface border border-border/50 text-foreground'
                )}
              >
                {isUser ? (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <MarkdownBlock
                    content={msg.content}
                    onApplyCode={onApplyCode}
                  />
                )}
              </div>
            </div>
          );
        })}

        {/* Streaming In-Flight Message */}
        {isStreaming && (
          <div className="flex flex-col items-start gap-1">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground px-1">
              <Sparkles className="h-3 w-3 animate-spin text-purple-400" />
              <span className="font-medium text-foreground">
                Generating {ACTION_KIND_LABELS[streamingActionKind]?.label}...
              </span>
            </div>

            <div className="glass-surface border border-purple-500/30 rounded-2xl px-3.5 py-2.5 max-w-[92%] shadow-md">
              <MarkdownBlock
                content={streamingContent || 'Thinking...'}
                onApplyCode={onApplyCode}
              />
              <span className="inline-block h-3.5 w-1 animate-pulse bg-purple-500 ml-1 rounded" />
            </div>
          </div>
        )}

        {/* Error Banner */}
        {aiError && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold">AI Assistant Error</p>
              <p className="text-[11px] opacity-90 break-words">{aiError}</p>
            </div>
            <button
              type="button"
              onClick={clearError}
              className="text-[10px] underline hover:opacity-80"
            >
              Dismiss
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-border/60 bg-muted/20 p-2.5"
      >
        <div className="relative flex items-center rounded-xl border border-border/60 bg-background/80 shadow-sm focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/40">
          <textarea
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            placeholder={
              activeFileName
                ? `Ask about ${activeFileName} (Enter to send)...`
                : 'Ask AI assistant (Enter to send)...'
            }
            rows={1}
            className="w-full resize-none bg-transparent px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none max-h-32"
          />

          <div className="flex items-center gap-1 pr-2">
            {isStreaming ? (
              <button
                type="button"
                onClick={stopStreaming}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-destructive text-destructive-foreground transition-colors hover:bg-destructive/90"
                title="Stop generation"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!inputPrompt.trim()}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                title="Send prompt"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
