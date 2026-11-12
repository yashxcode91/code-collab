import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessageDto } from '@codecollab/shared';
import type { TypedClientSocket } from '@/hooks/useRealtimeCollab';
import { useWorkspaceChat } from '@/hooks/useWorkspaceChat';

const { fetchProjectChatMessagesMock, sendProjectChatMessageMock } = vi.hoisted(
  () => ({
    fetchProjectChatMessagesMock: vi.fn(),
    sendProjectChatMessageMock: vi.fn(),
  })
);

vi.mock('@/lib/queries', () => ({
  fetchProjectChatMessages: fetchProjectChatMessagesMock,
  sendProjectChatMessage: sendProjectChatMessageMock,
}));

function makeMsg(
  id: string,
  content: string,
  authorId = 'user-peer',
  createdAt = '2026-11-13T00:00:00.000Z'
): ChatMessageDto {
  return {
    id,
    projectId: 'proj-1',
    branchId: null,
    type: 'user',
    content,
    author: { id: authorId, username: 'alice' },
    fileRef: null,
    createdAt,
  };
}

function createFakeSocket() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const emitSpy = vi.fn((event: string, ...args: unknown[]) => {
    const maybeAck = args[args.length - 1];
    if (event === 'chat:join' && typeof maybeAck === 'function') {
      maybeAck({ ok: true });
    }
  });

  const socket = {
    connected: true,
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    }),
    off: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(fn);
    }),
    emit: emitSpy,
  };

  return {
    socket: socket as unknown as TypedClientSocket,
    emitSpy,
    trigger: (event: string, ...args: unknown[]) => {
      for (const fn of listeners.get(event) ?? []) {
        fn(...args);
      }
    },
  };
}

describe('useWorkspaceChat', () => {
  beforeEach(() => {
    fetchProjectChatMessagesMock.mockReset();
    sendProjectChatMessageMock.mockReset();
  });

  it('preserves oldest -> newest chronological order from REST history and loadOlderMessages without double-reversing', async () => {
    fetchProjectChatMessagesMock
      .mockResolvedValueOnce({
        messages: [makeMsg('m3', 'third'), makeMsg('m4', 'fourth')],
        nextCursor: 'm3',
      })
      .mockResolvedValueOnce({
        messages: [makeMsg('m1', 'first'), makeMsg('m2', 'second')],
        nextCursor: null,
      });

    const { socket } = createFakeSocket();
    const { result } = renderHook(() =>
      useWorkspaceChat({
        socket,
        projectId: 'proj-1',
        currentUserId: 'user-me',
        isMember: true,
        canSend: true,
        isOpen: true,
      })
    );

    await waitFor(() => {
      expect(result.current.messages.map((m) => m.id)).toEqual(['m3', 'm4']);
    });
    expect(result.current.nextCursor).toBe('m3');

    await act(async () => {
      await result.current.loadOlderMessages();
    });

    expect(result.current.messages.map((m) => m.id)).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
    ]);
    expect(result.current.nextCursor).toBeNull();
  });

  it('tracks unread messages while drawer is closed, deduplicates incoming broadcasts, and blocks ANSI/BiDi input', async () => {
    fetchProjectChatMessagesMock.mockResolvedValue({
      messages: [],
      nextCursor: null,
    });

    const fake = createFakeSocket();
    const { result, rerender } = renderHook(
      ({ isOpen }) =>
        useWorkspaceChat({
          socket: fake.socket,
          projectId: 'proj-1',
          currentUserId: 'user-me',
          isMember: true,
          canSend: true,
          isOpen,
        }),
      { initialProps: { isOpen: false } }
    );

    await waitFor(() => expect(result.current.chatJoined).toBe(true));

    // Incoming peer message increments unreadCount when closed
    const incoming = makeMsg('m-live', 'hello from alice', 'user-peer');
    act(() => {
      fake.trigger('chat:message', incoming);
      fake.trigger('chat:message', incoming); // duplicate ignored
    });

    expect(result.current.messages.map((m) => m.id)).toEqual(['m-live']);
    expect(result.current.unreadCount).toBe(1);

    // Opening panel clears unreadCount
    rerender({ isOpen: true });
    expect(result.current.unreadCount).toBe(0);

    // ANSI escape sequence rejected before hitting socket or REST
    let sent = true;
    await act(async () => {
      sent = await result.current.sendMessage({ content: 'bad \x1b[31mred' });
    });
    expect(sent).toBe(false);
    expect(result.current.chatError).toContain('unsupported control');
    expect(
      fake.emitSpy.mock.calls.some(([ev]) => ev === 'chat:send')
    ).toBe(false);
  });

  it('clears chat state immediately when receiving PROJECT_FORBIDDEN revocation event', async () => {
    fetchProjectChatMessagesMock.mockResolvedValue({
      messages: [makeMsg('m1', 'confidential')],
      nextCursor: 'm1',
    });

    const fake = createFakeSocket();
    const { result } = renderHook(() =>
      useWorkspaceChat({
        socket: fake.socket,
        projectId: 'proj-1',
        currentUserId: 'user-me',
        isMember: true,
        canSend: true,
        isOpen: true,
      })
    );

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    act(() => {
      fake.trigger('realtime:error', {
        code: 'PROJECT_FORBIDDEN',
        message: 'Your access to this workspace has been revoked',
        projectId: 'proj-1',
      });
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.nextCursor).toBeNull();
    expect(result.current.chatJoined).toBe(false);
    expect(result.current.chatError).toContain('revoked');
  });
});
