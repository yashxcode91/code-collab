import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiActionKind,
  AiConversationSummaryDto,
  AiPromptContext,
  AiStreamChunkDto,
  SemanticSearchResultDto,
} from '@codecollab/shared';
import {
  createAiConversation,
  deleteAiConversation,
  fetchAiConversationDetail,
  fetchAiConversations,
  fetchCodebaseIndexStatus,
  queryKeys,
  triggerCodebaseIndex,
} from '@/lib/queries';

export interface UseStudioAiOptions {
  projectId: string | null;
  branchId: string | null;
  activeFileId?: string | null;
  activeFileName?: string | null;
  activeSelection?: { startLine: number; endLine: number; text: string } | null;
  onApplyCode?: (code: string) => Promise<void> | void;
}

export interface StudioAiMessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  actionKind: AiActionKind;
  content: string;
  model?: string | null;
  suggestedCode?: string | null;
  fileName?: string | null;
  lineRange?: string | null;
  citations?: SemanticSearchResultDto[];
  createdAt: string;
  isStreaming?: boolean;
}

export function useStudioAi({
  projectId,
  branchId,
  activeFileId,
  activeFileName,
  activeSelection,
  onApplyCode,
}: UseStudioAiOptions) {
  const queryClient = useQueryClient();

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingActionKind, setStreamingActionKind] = useState<AiActionKind>('chat');
  const [streamingSuggestedCode, setStreamingSuggestedCode] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [ragMode, setRagMode] = useState<boolean>(true);
  const [streamingCitations, setStreamingCitations] = useState<SemanticSearchResultDto[] | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Codebase RAG indexing status
  const indexStatusQuery = useQuery({
    queryKey:
      projectId && branchId
        ? queryKeys.projects.codebaseIndexStatus(projectId, branchId)
        : ['disabled-ai-index-status'],
    queryFn: () => fetchCodebaseIndexStatus(projectId!, branchId!),
    enabled: Boolean(projectId && branchId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'PENDING' || status === 'PROCESSING' ? 3000 : false;
    },
  });

  const triggerIndexMutation = useMutation({
    mutationFn: (forceReindex?: boolean) =>
      triggerCodebaseIndex(projectId!, branchId!, forceReindex),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.codebaseIndexStatus(projectId!, branchId!),
      });
    },
  });

  // 1. Fetch conversations list for this project & branch
  const conversationsQuery = useQuery({
    queryKey:
      projectId && branchId
        ? queryKeys.projects.aiConversations(projectId, branchId)
        : ['disabled-ai-conversations'],
    queryFn: () => fetchAiConversations(projectId!, branchId!),
    enabled: Boolean(projectId && branchId),
  });

  const conversations = useMemo(
    () => conversationsQuery.data ?? [],
    [conversationsQuery.data]
  );

  const hasAutoSelectedRef = useRef(false);

  // Reset auto-select ref when project or branch changes
  useEffect(() => {
    hasAutoSelectedRef.current = false;
  }, [projectId, branchId]);

  // Auto-select the latest conversation ONLY ONCE on initial load if user hasn't explicitly chosen "+ New Conversation"
  useEffect(() => {
    if (!hasAutoSelectedRef.current && conversations.length > 0 && !activeConversationId && !isStreaming) {
      hasAutoSelectedRef.current = true;
      setActiveConversationId(conversations[0]?.id ?? null);
    }
  }, [conversations, activeConversationId, isStreaming]);

  // 2. Fetch conversation detail with messages when an activeConversationId is selected
  const detailQuery = useQuery({
    queryKey:
      projectId && branchId && activeConversationId
        ? queryKeys.projects.aiConversationDetail(
            projectId,
            branchId,
            activeConversationId
          )
        : ['disabled-ai-conversation-detail'],
    queryFn: () =>
      fetchAiConversationDetail(projectId!, branchId!, activeConversationId!),
    enabled: Boolean(projectId && branchId && activeConversationId),
  });

  // Local optimistic message cache combined with query data
  const [localMessages, setLocalMessages] = useState<StudioAiMessageItem[]>([]);

  useEffect(() => {
    if (detailQuery.data?.messages && activeConversationId) {
      const items: StudioAiMessageItem[] = detailQuery.data.messages.map((m) => ({
        id: m.id,
        role: m.role,
        actionKind: m.actionKind,
        content: m.content,
        model: m.model,
        suggestedCode: m.suggestedCode,
        fileName: m.codeContext?.fileName,
        lineRange:
          m.codeContext?.lineStart && m.codeContext?.lineEnd
            ? `L${m.codeContext.lineStart}-${m.codeContext.lineEnd}`
            : undefined,
        createdAt: m.createdAt,
      }));
      setLocalMessages(items);
    } else if (!activeConversationId) {
      setLocalMessages([]);
    }
  }, [detailQuery.data, activeConversationId]);

  // 3. Delete Conversation Mutation
  const deleteMutation = useMutation({
    mutationFn: (conversationId: string) =>
      deleteAiConversation(projectId!, branchId!, conversationId),
    onSuccess: async (_, conversationId) => {
      hasAutoSelectedRef.current = true;
      setActiveConversationId((prev) => (prev === conversationId ? null : prev));
      setLocalMessages([]);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.aiConversations(projectId!, branchId!),
      });
    },
  });

  // 3b. Explicitly Create AI Conversation Thread Mutation
  const createMutation = useMutation({
    mutationFn: (title?: string) =>
      createAiConversation(projectId!, branchId!, title),
    onSuccess: (created) => {
      hasAutoSelectedRef.current = true;
      setActiveConversationId(created.id);
      setLocalMessages([]);
      setAiError(null);
      queryClient.setQueryData<AiConversationSummaryDto[]>(
        queryKeys.projects.aiConversations(projectId!, branchId!),
        (prev) => [created, ...(prev?.filter((c) => c.id !== created.id) ?? [])]
      );
    },
  });

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  // 4. Send AI Prompt over Server-Sent Events (SSE)
  const sendPrompt = useCallback(
    async (
      promptText: string,
      actionKind: AiActionKind = 'chat',
      extraContext?: Partial<AiPromptContext>
    ) => {
      if (!projectId || !branchId || !promptText.trim()) return;

      const trimmedPrompt = promptText.trim();
      setAiError(null);

      // Abort any ongoing stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsStreaming(true);
      setStreamingContent('');
      setStreamingActionKind(actionKind);
      setStreamingSuggestedCode(null);

      // Optimistically append user message
      const userMessageItem: StudioAiMessageItem = {
        id: `optimistic-user-${Date.now()}`,
        role: 'user',
        actionKind,
        content: trimmedPrompt,
        fileName: activeFileName ?? undefined,
        lineRange:
          activeSelection?.startLine && activeSelection?.endLine
            ? `L${activeSelection.startLine}-${activeSelection.endLine}`
            : undefined,
        createdAt: new Date().toISOString(),
      };

      setLocalMessages((prev) => [...prev, userMessageItem]);

      const contextPayload: AiPromptContext = {
        ...(activeFileId ? { fileId: activeFileId } : {}),
        ...(activeSelection
          ? {
              selection: {
                startLine: activeSelection.startLine,
                endLine: activeSelection.endLine,
                text: activeSelection.text,
              },
            }
          : {}),
        ragMode,
        ...extraContext,
      };

      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/ai/stream`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
            },
            credentials: 'include',
            body: JSON.stringify({
              conversationId: activeConversationId ?? undefined,
              actionKind,
              prompt: trimmedPrompt,
              context: contextPayload,
            }),
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          const errJson = await response.json().catch(() => ({}));
          const errMsg =
            errJson.error?.message ||
            errJson.message ||
            `AI request failed with status ${response.status}`;
          throw new Error(errMsg);
        }

        if (!response.body) {
          throw new Error('Readable stream not supported or empty body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullAccumulated = '';
        let resolvedConvId = activeConversationId;
        let currentCitations: SemanticSearchResultDto[] | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const dataStr = trimmed.slice(6).trim();
            if (!dataStr || dataStr === '[DONE]') continue;

            try {
              const chunk = JSON.parse(dataStr) as AiStreamChunkDto;

              if (chunk.type === 'start') {
                resolvedConvId = chunk.conversationId;
                hasAutoSelectedRef.current = true;
                setActiveConversationId(chunk.conversationId);
              } else if (chunk.type === 'token') {
                fullAccumulated += chunk.token;
                setStreamingContent(fullAccumulated);
              } else if (chunk.type === 'citations') {
                currentCitations = chunk.citations;
                setStreamingCitations(chunk.citations);
              } else if (chunk.type === 'action') {
                if (chunk.suggestedCode) {
                  setStreamingSuggestedCode(chunk.suggestedCode);
                }
              } else if (chunk.type === 'done') {
                // Done frame contains the complete persisted message
                const assistantItem: StudioAiMessageItem = {
                  id: chunk.message.id,
                  role: 'assistant',
                  actionKind: chunk.message.actionKind,
                  content: chunk.message.content,
                  model: chunk.message.model,
                  suggestedCode: chunk.message.suggestedCode,
                  fileName: chunk.message.codeContext?.fileName,
                  lineRange:
                    chunk.message.codeContext?.lineStart && chunk.message.codeContext?.lineEnd
                      ? `L${chunk.message.codeContext.lineStart}-${chunk.message.codeContext.lineEnd}`
                      : undefined,
                  citations: currentCitations ?? undefined,
                  createdAt: chunk.message.createdAt,
                };

                setLocalMessages((prev) => [...prev, assistantItem]);
                setStreamingContent('');
                setStreamingSuggestedCode(null);
                setStreamingCitations(null);
                setIsStreaming(false);

                // Invalidate conversation list so updated timestamp/title/message count sync
                await queryClient.invalidateQueries({
                  queryKey: queryKeys.projects.aiConversations(projectId, branchId),
                });
                if (resolvedConvId) {
                  await queryClient.invalidateQueries({
                    queryKey: queryKeys.projects.aiConversationDetail(
                      projectId,
                      branchId,
                      resolvedConvId
                    ),
                  });
                }
              } else if (chunk.type === 'error') {
                setAiError(chunk.message);
                setIsStreaming(false);
              }
            } catch {
              // Ignore JSON parse errors in malformed lines
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // Stream cancelled by user
          return;
        }
        setAiError(err.message || 'An error occurred during AI generation');
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [
      projectId,
      branchId,
      activeConversationId,
      activeFileId,
      activeFileName,
      activeSelection,
      queryClient,
    ]
  );

  // 5. Quick-Action One-Click Prompts
  const quickAction = useCallback(
    (
      actionKind: AiActionKind,
      customPrompt?: string,
      extraContext?: Partial<AiPromptContext>
    ) => {
      let defaultPrompt = '';
      switch (actionKind) {
        case 'explain':
          defaultPrompt = activeSelection
            ? `Explain the selected code (lines ${activeSelection.startLine}-${activeSelection.endLine}) in detail.`
            : `Explain the structure, key functions, and complexity of ${activeFileName ?? 'this file'}.`;
          break;
        case 'debug':
          defaultPrompt = extraContext?.terminalError
            ? `Diagnose and fix the runtime error shown in the terminal output.`
            : `Analyze ${activeFileName ?? 'this file'} for bugs, unhandled exceptions, and logic issues, then provide a fix.`;
          break;
        case 'generate_tests':
          defaultPrompt = `Generate a comprehensive unit test suite covering standard execution, boundary conditions, and edge cases.`;
          break;
        case 'review':
          defaultPrompt = `Conduct a senior engineer code review covering maintainability, algorithmic complexity, and security.`;
          break;
        case 'refactor':
          defaultPrompt = `Refactor this code to improve clarity, performance, and best practices.`;
          break;
        case 'chat':
        default:
          defaultPrompt = 'How can I optimize this implementation?';
          break;
      }

      const finalPrompt = customPrompt?.trim() || defaultPrompt;
      return sendPrompt(finalPrompt, actionKind, extraContext);
    },
    [activeFileName, activeSelection, sendPrompt]
  );

  const selectConversation = useCallback((id: string | null) => {
    hasAutoSelectedRef.current = true;
    setActiveConversationId(id);
    if (!id) {
      setLocalMessages([]);
      setAiError(null);
    }
  }, []);

  const startNewConversation = useCallback(() => {
    hasAutoSelectedRef.current = true;
    stopStreaming();
    setActiveConversationId(null);
    setLocalMessages([]);
    setAiError(null);
  }, [stopStreaming]);

  const applySuggestedCode = useCallback(
    async (code: string) => {
      if (onApplyCode) {
        await onApplyCode(code);
      }
    },
    [onApplyCode]
  );

  return {
    conversations,
    activeConversationId,
    setActiveConversationId: selectConversation,
    messages: localMessages,
    isStreaming,
    streamingContent,
    streamingActionKind,
    streamingSuggestedCode,
    aiError,
    clearError: () => setAiError(null),
    sendPrompt,
    quickAction,
    stopStreaming,
    startNewConversation,
    isCreating: createMutation.isPending,
    deleteConversation: (id: string) => deleteMutation.mutate(id),
    isDeleting: deleteMutation.isPending,
    applySuggestedCode,
    ragMode,
    setRagMode,
    streamingCitations,
    indexStatus: indexStatusQuery.data,
    isIndexing:
      indexStatusQuery.data?.status === 'PENDING' ||
      indexStatusQuery.data?.status === 'PROCESSING' ||
      triggerIndexMutation.isPending,
    triggerIndex: (forceReindex?: boolean) =>
      triggerIndexMutation.mutateAsync(forceReindex),
  };
}
