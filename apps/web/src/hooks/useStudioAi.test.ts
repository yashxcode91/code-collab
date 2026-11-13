import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AiConversationDetailDto,
  AiConversationSummaryDto,
  AiMessageDto,
} from '@codecollab/shared';
import { useStudioAi } from '@/hooks/useStudioAi';

const {
  fetchAiConversationsMock,
  fetchAiConversationDetailMock,
  deleteAiConversationMock,
} = vi.hoisted(() => ({
  fetchAiConversationsMock: vi.fn(),
  fetchAiConversationDetailMock: vi.fn(),
  deleteAiConversationMock: vi.fn(),
}));

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/queries')>();
  return {
    ...actual,
    fetchAiConversations: fetchAiConversationsMock,
    fetchAiConversationDetail: fetchAiConversationDetailMock,
    deleteAiConversation: deleteAiConversationMock,
  };
});

function makeConversationSummary(
  id: string,
  title: string,
  messageCount = 2
): AiConversationSummaryDto {
  return {
    id,
    projectId: 'proj-1',
    branchId: 'branch-1',
    userId: 'user-1',
    title,
    messageCount,
    lastMessageAt: '2026-11-13T12:00:00.000Z',
    createdAt: '2026-11-13T11:00:00.000Z',
    updatedAt: '2026-11-13T12:00:00.000Z',
  };
}

function makeConversationDetail(
  conversation: AiConversationSummaryDto,
  messages: AiMessageDto[]
): AiConversationDetailDto {
  return {
    conversation,
    messages,
  };
}

function createSseStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('Day 6 useStudioAi Hook & SSE Stream Client', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children
      );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchAiConversationsMock.mockResolvedValue([]);
    fetchAiConversationDetailMock.mockResolvedValue({ conversation: null, messages: [] });
    deleteAiConversationMock.mockResolvedValue(undefined);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  });

  it('1. Initializes and auto-selects first conversation when available', async () => {
    const conv1 = makeConversationSummary('c-1', 'Explain parser logic');
    fetchAiConversationsMock.mockResolvedValueOnce([conv1]);
    fetchAiConversationDetailMock.mockResolvedValueOnce(
      makeConversationDetail(conv1, [
        {
          id: 'm-1',
          conversationId: 'c-1',
          role: 'user',
          actionKind: 'explain',
          content: 'Explain this parser',
          model: null,
          promptTokens: null,
          completionTokens: null,
          codeContext: null,
          suggestedCode: null,
          createdAt: '2026-11-13T12:00:00.000Z',
        },
      ])
    );

    const { result } = renderHook(
      () =>
        useStudioAi({
          projectId: 'proj-1',
          branchId: 'branch-1',
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.conversations).toHaveLength(1);
    });

    await waitFor(() => {
      expect(result.current.activeConversationId).toBe('c-1');
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]?.content).toBe('Explain this parser');
    });
  });

  it('2. Streams SSE tokens and commits done message', async () => {
    fetchAiConversationsMock.mockResolvedValueOnce([]);

    const doneMessage: AiMessageDto = {
      id: 'm-done-1',
      conversationId: 'c-new',
      role: 'assistant',
      actionKind: 'chat',
      content: 'Here is the completed explanation.',
      model: 'codecollab-offline-v1',
      promptTokens: 25,
      completionTokens: 40,
      codeContext: null,
      suggestedCode: 'const x = 42;',
      createdAt: '2026-11-13T12:05:00.000Z',
    };

    const sseChunks = [
      `data: {"type":"start","conversationId":"c-new","messageId":"pending","model":"codecollab-offline-v1","actionKind":"chat"}\n\n`,
      `data: {"type":"token","token":"Here "}\n\n`,
      `data: {"type":"token","token":"is the completed "}\n\n`,
      `data: {"type":"token","token":"explanation."}\n\n`,
      `data: {"type":"action","actionKind":"chat","suggestedCode":"const x = 42;"}\n\n`,
      `data: {"type":"done","message":${JSON.stringify(doneMessage)}}\n\n`,
    ];

    const globalFetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(createSseStreamResponse(sseChunks));

    const { result } = renderHook(
      () =>
        useStudioAi({
          projectId: 'proj-1',
          branchId: 'branch-1',
          activeFileName: 'index.ts',
        }),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      await result.current.sendPrompt('Help me write this', 'chat');
    });

    expect(globalFetchSpy).toHaveBeenCalledTimes(1);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.activeConversationId).toBe('c-new');

    // Should have both user message and assistant message
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]?.role).toBe('user');
    expect(result.current.messages[1]?.role).toBe('assistant');
    expect(result.current.messages[1]?.content).toBe('Here is the completed explanation.');
    expect(result.current.messages[1]?.suggestedCode).toBe('const x = 42;');

    globalFetchSpy.mockRestore();
  });

  it('3. Triggers quickAction with formatted prompt for explain', async () => {
    fetchAiConversationsMock.mockResolvedValueOnce([]);

    const globalFetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        createSseStreamResponse([
          `data: {"type":"start","conversationId":"c-quick","messageId":"pending","model":"codecollab-offline-v1","actionKind":"explain"}\n\n`,
          `data: {"type":"token","token":"Analysis done"}\n\n`,
          `data: {"type":"done","message":{"id":"m-done","conversationId":"c-quick","role":"assistant","actionKind":"explain","content":"Analysis done","model":null,"promptTokens":10,"completionTokens":10,"codeContext":null,"suggestedCode":null,"createdAt":"2026-11-13T12:00:00Z"}}\n\n`,
        ])
      );

    const { result } = renderHook(
      () =>
        useStudioAi({
          projectId: 'proj-1',
          branchId: 'branch-1',
          activeFileName: 'calc.ts',
          activeSelection: { startLine: 10, endLine: 20, text: 'return a + b;' },
        }),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      await result.current.quickAction('explain');
    });

    expect(globalFetchSpy).toHaveBeenCalledWith(
      '/api/projects/proj-1/branches/branch-1/ai/stream',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Explain the selected code'),
      })
    );

    globalFetchSpy.mockRestore();
  });

  it('4. Applies suggested code to onApplyCode handler', async () => {
    const onApplyCodeMock = vi.fn();

    const { result } = renderHook(
      () =>
        useStudioAi({
          projectId: 'proj-1',
          branchId: 'branch-1',
          onApplyCode: onApplyCodeMock,
        }),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      await result.current.applySuggestedCode('const fixed = true;');
    });

    expect(onApplyCodeMock).toHaveBeenCalledWith('const fixed = true;');
  });

  it('5. Deletes conversation and resets active selection', async () => {
    const conv1 = makeConversationSummary('c-to-delete', 'Temporary chat');
    fetchAiConversationsMock.mockResolvedValueOnce([conv1]);
    deleteAiConversationMock.mockResolvedValueOnce(undefined);

    const { result } = renderHook(
      () =>
        useStudioAi({
          projectId: 'proj-1',
          branchId: 'branch-1',
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.activeConversationId).toBe('c-to-delete');
    });

    await act(async () => {
      result.current.deleteConversation('c-to-delete');
    });

    await waitFor(() => {
      expect(deleteAiConversationMock).toHaveBeenCalledWith('proj-1', 'branch-1', 'c-to-delete');
      expect(result.current.activeConversationId).toBeNull();
    });
  });
});
