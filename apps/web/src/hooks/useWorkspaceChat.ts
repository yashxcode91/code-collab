import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHAT_LIMITS,
  hasDisallowedChatControlChars,
  type ChatMessageDto,
  type ChatSendPayload,
  type ChatTypingServerPayload,
} from '@codecollab/shared';
import type { TypedClientSocket } from '@/hooks/useRealtimeCollab';
import { ApiClientError } from '@/lib/api';
import {
  fetchProjectChatMessages,
  sendProjectChatMessage,
} from '@/lib/queries';

export interface TypingPeer {
  userId: string;
  username: string;
  expiresAt: number;
}

interface UseWorkspaceChatParams {
  socket: TypedClientSocket | null;
  projectId: string;
  currentUserId: string;
  isMember: boolean;
  canSend: boolean;
  isOpen: boolean;
}

/**
 * Manages authenticated workspace team chat over Socket.IO (`chat:join`, `chat:send`, `chat:typing`)
 * with cursor-paginated history loading, unread tracking, and automatic ACL-redacted rendering.
 */
export function useWorkspaceChat({
  socket,
  projectId,
  currentUserId,
  isMember,
  canSend,
  isOpen,
}: UseWorkspaceChatParams) {
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [chatJoined, setChatJoined] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [typingPeers, setTypingPeers] = useState<TypingPeer[]>([]);

  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const lastTypingEmitRef = useRef(0);
  const stopTypingTimerRef = useRef<number | null>(null);

  // Reset unread counter whenever the user opens the Chat tab
  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
    }
  }, [isOpen]);

  // Prune stale typing indicators every 1s
  useEffect(() => {
    if (typingPeers.length === 0) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      setTypingPeers((prev) => prev.filter((p) => p.expiresAt > now));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [typingPeers.length]);

  // Initial history load (`GET /api/projects/:projectId/chat`)
  const loadInitialHistory = useCallback(async () => {
    if (!projectId || !isMember) {
      setMessages([]);
      setNextCursor(null);
      return;
    }

    setIsLoadingHistory(true);
    setChatError(null);
    try {
      const page = await fetchProjectChatMessages(projectId, {
        limit: CHAT_LIMITS.DEFAULT_PAGE_SIZE,
      });
      // Backend already reverses each cursor page into oldest -> newest chronological order
      seenMessageIdsRef.current = new Set(page.messages.map((m) => m.id));
      setMessages(page.messages);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setChatError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load workspace chat history',
      );
    } finally {
      setIsLoadingHistory(false);
    }
  }, [isMember, projectId]);

  useEffect(() => {
    seenMessageIdsRef.current.clear();
    setMessages([]);
    setNextCursor(null);
    setUnreadCount(0);
    setTypingPeers([]);
    void loadInitialHistory();
  }, [loadInitialHistory]);

  const loadOlderMessages = useCallback(async () => {
    if (!projectId || !isMember || !nextCursor || isLoadingOlder) return;

    setIsLoadingOlder(true);
    setChatError(null);
    try {
      const page = await fetchProjectChatMessages(projectId, {
        cursor: nextCursor,
        limit: CHAT_LIMITS.DEFAULT_PAGE_SIZE,
      });
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const dedupedOlder = page.messages.filter((m) => !seen.has(m.id));
        for (const m of dedupedOlder) seenMessageIdsRef.current.add(m.id);
        return [...dedupedOlder, ...prev];
      });
      setNextCursor(page.nextCursor);
    } catch (err) {
      setChatError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load older chat messages',
      );
    } finally {
      setIsLoadingOlder(false);
    }
  }, [isLoadingOlder, isMember, nextCursor, projectId]);

  // Multiplex real-time chat room on shared Studio socket
  useEffect(() => {
    if (!socket || !projectId || !isMember) {
      setChatJoined(false);
      return;
    }

    const joinChatRoom = () => {
      if (!socket.connected) return;
      socket.emit('chat:join', { projectId }, (ack) => {
        if (!ack?.ok) {
          setChatJoined(false);
          if (ack?.error) {
            setChatError(ack.error.message);
          }
          return;
        }
        setChatJoined(true);
        setChatError(null);
      });
    };

    const handleConnect = () => {
      joinChatRoom();
    };

    const handleDisconnect = () => {
      setChatJoined(false);
    };

    const handleIncomingMessage = (msg: ChatMessageDto) => {
      if (msg.projectId !== projectId) return;
      if (seenMessageIdsRef.current.has(msg.id)) return;
      seenMessageIdsRef.current.add(msg.id);

      setMessages((prev) => {
        if (prev.some((existing) => existing.id === msg.id)) {
          return prev;
        }
        return [...prev, msg];
      });

      if (!isOpenRef.current && msg.author?.id !== currentUserId) {
        setUnreadCount((count) => Math.min(99, count + 1));
      }

      if (msg.author?.id) {
        setTypingPeers((prev) =>
          prev.filter((peer) => peer.userId !== msg.author?.id),
        );
      }
    };

    const handleTyping = (payload: ChatTypingServerPayload) => {
      if (payload.projectId !== projectId || payload.userId === currentUserId) {
        return;
      }
      setTypingPeers((prev) => {
        const filtered = prev.filter((p) => p.userId !== payload.userId);
        if (!payload.isTyping) return filtered;
        return [
          ...filtered,
          {
            userId: payload.userId,
            username: payload.username,
            expiresAt: Date.now() + 3500,
          },
        ];
      });
    };

    const handleRealtimeError = (err: {
      code: string;
      message: string;
      projectId?: string;
      fileId?: string;
      runId?: string;
    }) => {
      if (
        err.code === 'UNAUTHORIZED' ||
        ((!err.projectId || err.projectId === projectId) &&
          (err.code === 'CHAT_FORBIDDEN' ||
            err.code === 'PROJECT_FORBIDDEN' ||
            err.code === 'PROJECT_NOT_FOUND'))
      ) {
        seenMessageIdsRef.current.clear();
        setChatJoined(false);
        setMessages([]);
        setNextCursor(null);
        setUnreadCount(0);
        setTypingPeers([]);
        setChatError(err.message);
        return;
      }

      if (err.code === 'FILE_ACCESS_DENIED' && err.fileId) {
        const deniedFileId = err.fileId;
        setMessages((prev) =>
          prev.map((m) =>
            m.fileRef?.fileId === deniedFileId ? { ...m, fileRef: null } : m,
          ),
        );
      }
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('chat:message', handleIncomingMessage);
    socket.on('chat:typing', handleTyping);
    socket.on('realtime:error', handleRealtimeError);

    if (socket.connected) {
      joinChatRoom();
    }

    return () => {
      if (stopTypingTimerRef.current) {
        window.clearTimeout(stopTypingTimerRef.current);
        stopTypingTimerRef.current = null;
      }
      if (socket.connected) {
        socket.emit('chat:leave', { projectId });
      }
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('chat:message', handleIncomingMessage);
      socket.off('chat:typing', handleTyping);
      socket.off('realtime:error', handleRealtimeError);
      setChatJoined(false);
    };
  }, [currentUserId, isMember, projectId, socket]);

  const notifyTyping = useCallback(
    (isTyping: boolean) => {
      if (!canSend || !socket || !socket.connected || !chatJoined) return;
      const now = Date.now();
      if (isTyping && now - lastTypingEmitRef.current < 1500) {
        return;
      }
      lastTypingEmitRef.current = now;
      socket.emit('chat:typing', { projectId, isTyping });

      if (stopTypingTimerRef.current) {
        window.clearTimeout(stopTypingTimerRef.current);
        stopTypingTimerRef.current = null;
      }
      if (isTyping) {
        stopTypingTimerRef.current = window.setTimeout(() => {
          stopTypingTimerRef.current = null;
          if (socket.connected) {
            socket.emit('chat:typing', { projectId, isTyping: false });
          }
        }, 2500);
      }
    },
    [canSend, chatJoined, projectId, socket],
  );

  const sendMessage = useCallback(
    async (input: {
      content: string;
      branchId?: string | null;
      fileId?: string | null;
      lineNumber?: number | null;
    }): Promise<boolean> => {
      if (!canSend || !projectId) {
        setChatError('Only workspace owners and editors can send chat messages');
        return false;
      }

      const trimmed = input.content.trim();
      if (!trimmed) return false;

      if (trimmed.length > CHAT_LIMITS.MAX_MESSAGE_CHARS) {
        setChatError(
          `Message cannot exceed ${CHAT_LIMITS.MAX_MESSAGE_CHARS.toLocaleString()} characters`,
        );
        return false;
      }

      if (hasDisallowedChatControlChars(trimmed)) {
        setChatError('Message contains unsupported control or ANSI escape characters');
        return false;
      }

      setChatError(null);
      setIsSending(true);
      notifyTyping(false);

      const payload: ChatSendPayload = {
        projectId,
        content: trimmed,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.fileId ? { fileId: input.fileId } : {}),
        ...(input.fileId && input.lineNumber ? { lineNumber: input.lineNumber } : {}),
      };

      try {
        if (socket && socket.connected && chatJoined) {
          const created = await new Promise<ChatMessageDto>((resolve, reject) => {
            socket.emit('chat:send', payload, (ack) => {
              if (!ack?.ok || !ack.data) {
                reject(
                  new Error(ack?.error?.message ?? 'Unable to send chat message'),
                );
                return;
              }
              resolve(ack.data);
            });
          });

          seenMessageIdsRef.current.add(created.id);
          setMessages((prev) =>
            prev.some((m) => m.id === created.id) ? prev : [...prev, created],
          );
          return true;
        }

        const created = await sendProjectChatMessage(projectId, {
          content: payload.content,
          branchId: payload.branchId,
          fileId: payload.fileId,
          lineNumber: payload.lineNumber,
        });
        seenMessageIdsRef.current.add(created.id);
        setMessages((prev) =>
          prev.some((m) => m.id === created.id) ? prev : [...prev, created],
        );
        return true;
      } catch (err) {
        setChatError(
          err instanceof Error ? err.message : 'Unable to send chat message',
        );
        return false;
      } finally {
        setIsSending(false);
      }
    },
    [canSend, chatJoined, notifyTyping, projectId, socket],
  );

  return {
    messages,
    nextCursor,
    isLoadingHistory,
    isLoadingOlder,
    isSending,
    chatJoined,
    chatError,
    unreadCount,
    typingPeers,
    loadOlderMessages,
    sendMessage,
    notifyTyping,
    clearChatError: () => setChatError(null),
  };
}
