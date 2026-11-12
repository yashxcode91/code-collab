import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUpCircle,
  FileCode2,
  Loader2,
  Lock,
  MessageSquare,
  Send,
  X,
} from 'lucide-react';
import {
  CHAT_LIMITS,
  type ChatFileReferenceDto,
  type ChatMessageDto,
  type ProjectFileNodeDto,
} from '@codecollab/shared';
import type { TypingPeer } from '@/hooks/useWorkspaceChat';
import { cn } from '@/lib/utils';

interface StudioChatPanelProps {
  isMember: boolean;
  canSend: boolean;
  currentUserId: string;
  messages: ChatMessageDto[];
  nextCursor: string | null;
  isLoadingHistory: boolean;
  isLoadingOlder: boolean;
  isSending: boolean;
  chatError: string | null;
  typingPeers: TypingPeer[];
  activeBranchId: string | null;
  activeFile: ProjectFileNodeDto | null;
  activeCursorLine: number;
  onLoadOlder: () => void;
  onSendMessage: (input: {
    content: string;
    branchId?: string | null;
    fileId?: string | null;
    lineNumber?: number | null;
  }) => Promise<boolean>;
  onNotifyTyping: (isTyping: boolean) => void;
  onClearError: () => void;
  onNavigateToFileRef: (fileRef: ChatFileReferenceDto) => void;
}

/**
 * Crystal-glass Real-Time Workspace Chat panel inside the Studio Inspector drawer.
 * Strictly visible to workspace members, with message/typing emission
 * gated to Owner/Editor and clickable code-line reference chips.
 */
export function StudioChatPanel({
  isMember,
  canSend,
  currentUserId,
  messages,
  nextCursor,
  isLoadingHistory,
  isLoadingOlder,
  isSending,
  chatError,
  typingPeers,
  activeBranchId,
  activeFile,
  activeCursorLine,
  onLoadOlder,
  onSendMessage,
  onNotifyTyping,
  onClearError,
  onNavigateToFileRef,
}: StudioChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [attachFileRef, setAttachFileRef] = useState(false);

  const listScrollRef = useRef<HTMLDivElement>(null);
  const prevLastMsgIdRef = useRef<string | null>(null);

  // Auto-scroll to bottom when opening chat or receiving new messages at tail
  useEffect(() => {
    const lastId = messages[messages.length - 1]?.id ?? null;
    if (lastId && lastId !== prevLastMsgIdRef.current) {
      prevLastMsgIdRef.current = lastId;
      const el = listScrollRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [messages]);

  // Turn off attachment toggle if no file is open
  useEffect(() => {
    if (!activeFile) {
      setAttachFileRef(false);
    }
  }, [activeFile]);

  if (!isMember) {
    return (
      <div className="glass-surface flex flex-col items-center justify-center gap-2 rounded-2xl p-6 text-center">
        <Lock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-xs font-semibold text-foreground">
          Workspace Members Only
        </p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Team chat is private to collaborators of this workspace.
        </p>
      </div>
    );
  }

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!canSend || isSending || !draft.trim()) return;

    const ok = await onSendMessage({
      content: draft,
      branchId: activeBranchId,
      ...(attachFileRef && activeFile
        ? {
            fileId: activeFile.id,
            lineNumber: activeCursorLine > 0 ? activeCursorLine : 1,
          }
        : {}),
    });

    if (ok) {
      setDraft('');
      setAttachFileRef(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  const typingText =
    typingPeers.length === 1
      ? `@${typingPeers[0].username} is typing…`
      : typingPeers.length > 1
        ? `${typingPeers.length} teammates are typing…`
        : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Error Banner */}
      {chatError && (
        <div className="mb-2.5 flex items-start justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/15 px-3 py-2 text-[11px] text-destructive backdrop-blur-md">
          <div className="flex items-start gap-1.5">
            <AlertCircle
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>{chatError}</span>
          </div>
          <button
            type="button"
            onClick={onClearError}
            aria-label="Dismiss chat error"
            className="shrink-0 hover:opacity-80"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Frosted Message Feed */}
      <div
        ref={listScrollRef}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1"
      >
        {nextCursor && (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              disabled={isLoadingOlder}
              onClick={onLoadOlder}
              className="glass-control inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10.5px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {isLoadingOlder ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowUpCircle className="h-3 w-3" aria-hidden="true" />
              )}
              <span>Load older messages</span>
            </button>
          </div>
        )}

        {isLoadingHistory ? (
          <div className="flex h-40 items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
            <Loader2
              className="h-4 w-4 animate-spin text-primary"
              aria-hidden="true"
            />
            <span>Loading team chat…</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center px-3 text-center">
            <div className="glass-surface flex h-11 w-11 items-center justify-center rounded-2xl text-primary">
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
            </div>
            <p className="mt-3 text-xs font-semibold text-foreground">
              Start a conversation
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Discuss edits, share run output, or tag a file line with your team.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.type === 'system') {
              return (
                <div key={msg.id} className="flex justify-center py-0.5">
                  <span className="glass-control rounded-full px-3 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {msg.content}
                  </span>
                </div>
              );
            }

            const isOwn = msg.author?.id === currentUserId;
            const authorLabel = msg.author?.username ?? 'collaborator';
            const authorInitial = authorLabel.slice(0, 1).toUpperCase() || '?';
            const timeLabel = new Date(msg.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={msg.id}
                className={cn(
                  'rounded-2xl px-3.5 py-2.5 text-xs transition-all',
                  isOwn
                    ? 'rounded-tr-md border border-primary/40 bg-gradient-to-br from-primary/[0.22] via-primary/[0.10] to-white/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_10px_24px_-14px_rgba(var(--studio-rgb),0.45)] backdrop-blur-xl dark:border-primary/35 dark:from-primary/[0.22] dark:via-primary/[0.11] dark:to-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_12px_26px_-14px_rgba(0,0,0,0.65)]'
                    : 'glass-surface rounded-tl-md',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={cn(
                        'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-bold',
                        isOwn
                          ? 'bg-primary/25 text-primary ring-1 ring-primary/40'
                          : 'glass-control text-foreground',
                      )}
                    >
                      {authorInitial}
                    </span>
                    <span className="truncate font-mono text-[11px] font-semibold text-foreground">
                      @{authorLabel}
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {timeLabel}
                  </span>
                </div>

                <p className="mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground">
                  {msg.content}
                </p>

                {msg.fileRef && (
                  <button
                    type="button"
                    onClick={() => onNavigateToFileRef(msg.fileRef!)}
                    title={`Open ${msg.fileRef.fileName}${msg.fileRef.lineNumber ? ` at line ${msg.fileRef.lineNumber}` : ''}`}
                    className="glass-control mt-2 inline-flex max-w-full items-center gap-1.5 rounded-lg border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10.5px] font-medium text-primary hover:bg-primary/20"
                  >
                    <FileCode2
                      className="h-3 w-3 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {msg.fileRef.fileName}
                      {msg.fileRef.lineNumber
                        ? `:L${msg.fileRef.lineNumber}`
                        : ''}
                    </span>
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Frosted Typing Indicator */}
      <div className="mt-1.5 min-h-[20px] px-0.5">
        {typingText && (
          <span className="glass-control inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            <span>{typingText}</span>
          </span>
        )}
      </div>

      {/* Crystal-Glass Composer / Viewer Gate */}
      {canSend ? (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="glass-mirror mt-1 rounded-2xl p-2.5"
        >
          <div className="relative z-10 space-y-2">
            {activeFile && (
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setAttachFileRef((prev) => !prev)}
                  className={cn(
                    'glass-control inline-flex max-w-full items-center gap-1 rounded-lg px-2 py-0.5 font-mono text-[10px]',
                    attachFileRef
                      ? 'border-primary/45 bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <FileCode2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    {attachFileRef
                      ? `Attached: ${activeFile.name}:L${activeCursorLine}`
                      : `Attach ${activeFile.name}:L${activeCursorLine}`}
                  </span>
                </button>

                {draft.length > CHAT_LIMITS.MAX_MESSAGE_CHARS - 200 && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {draft.length}/{CHAT_LIMITS.MAX_MESSAGE_CHARS}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-end gap-2">
              <textarea
                rows={2}
                value={draft}
                maxLength={CHAT_LIMITS.MAX_MESSAGE_CHARS}
                onChange={(e) => {
                  setDraft(e.target.value);
                  onNotifyTyping(Boolean(e.target.value.trim()));
                }}
                onKeyDown={handleKeyDown}
                placeholder="Message teammates… (Enter to send)"
                className="min-h-[38px] max-h-24 w-full resize-none bg-transparent text-xs text-foreground placeholder:text-muted-foreground/65 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isSending || !draft.trim()}
                aria-label="Send chat message"
                className="btn-studio-primary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isSending ? (
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="glass-surface mt-1 flex items-center gap-2 rounded-2xl px-3 py-2 text-[11px] text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Viewer role: read-only chat access (editors &amp; owners can post).
          </span>
        </div>
      )}
    </div>
  );
}
