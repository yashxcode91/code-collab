import { describe, expect, it, vi } from 'vitest';
import type { AgentStreamEventDto } from '@codecollab/shared';
import { streamAgentSession } from '@/api/agent';

describe('streamAgentSession SSE stream parser', () => {
  it('correctly reassembles JSON frames split across network chunks', async () => {
    // Event split across 2 chunks:
    // Chunk 1: "data: {\"type\":\"step_started\",\"session"
    // Chunk 2: "Id\":\"s1\",\"stepNumber\":1,\"title\":\"Plan\"}\n\n"
    const chunk1 = new TextEncoder().encode('data: {"type":"step_started","session');
    const chunk2 = new TextEncoder().encode('Id":"s1","stepNumber":1,"title":"Plan"}\n\n');

    let readCount = 0;
    const mockStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (readCount === 0) {
          controller.enqueue(chunk1);
          readCount++;
        } else if (readCount === 1) {
          controller.enqueue(chunk2);
          readCount++;
        } else {
          controller.close();
        }
      },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      body: mockStream,
    });

    const receivedEvents: AgentStreamEventDto[] = [];
    let completed = false;

    await streamAgentSession('proj-1', 'branch-1', 's1', {
      onEvent: (ev) => receivedEvents.push(ev),
      onDone: () => {
        completed = true;
      },
    });

    expect(completed).toBe(true);
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: 'step_started',
      sessionId: 's1',
      stepNumber: 1,
      title: 'Plan',
    });
  });

  it('ignores comments and empty lines in SSE stream', async () => {
    const rawSse =
      ': heartbeat ping\n\n' +
      'data: {"type":"session_status","sessionId":"s1","status":"EXECUTING"}\n\n' +
      ': another comment\n\n';

    const chunk = new TextEncoder().encode(rawSse);
    const mockStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      body: mockStream,
    });

    const receivedEvents: AgentStreamEventDto[] = [];
    await streamAgentSession('proj-1', 'branch-1', 's1', {
      onEvent: (ev) => receivedEvents.push(ev),
    });

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].type).toBe('session_status');
  });
});
