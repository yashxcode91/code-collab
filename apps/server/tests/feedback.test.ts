import { beforeEach, describe, expect, it } from 'vitest';
import { feedbackService } from '../src/modules/feedback/feedback.service';

describe('FeedbackService', () => {
  beforeEach(() => {
    feedbackService.resetData();
  });
  it('loads default roadmap proposals', async () => {
    const proposals = await feedbackService.getProposals();
    expect(proposals.length).toBeGreaterThanOrEqual(6);
    const defaultItem = proposals.find((p) => p.id === 'f-1');
    expect(defaultItem?.votes).toBe(0);
  });

  it('allows creating a new proposal', async () => {
    const title = `AI Testing Tool ${Date.now()}`;
    const created = await feedbackService.createProposal(
      {
        title,
        description: 'Automated test suite generator directly inside Monaco Editor.',
        category: 'AI',
      },
      'TestUser',
      'user:test-123'
    );

    expect(created.title).toBe(title);
    expect(created.category).toBe('AI');
    expect(created.votes).toBe(1);
    expect(created.userVoted).toBe(true);

    const list = await feedbackService.getProposals('user:test-123');
    const found = list.find((p) => p.id === created.id);
    expect(found).toBeDefined();
    expect(found?.userVoted).toBe(true);
  });

  it('toggles upvotes correctly', async () => {
    const list = await feedbackService.getProposals('user:voter-abc');
    const first = list[0];
    const initialVotes = first.votes;
    const initialVoted = first.userVoted ?? false;

    // Toggle vote
    const res1 = await feedbackService.toggleVote(first.id, 'user:voter-abc');
    expect(res1.userVoted).toBe(!initialVoted);
    expect(res1.votes).toBe(initialVoted ? initialVotes - 1 : initialVotes + 1);

    // Toggle back
    const res2 = await feedbackService.toggleVote(first.id, 'user:voter-abc');
    expect(res2.userVoted).toBe(initialVoted);
    expect(res2.votes).toBe(initialVotes);
  });
});
