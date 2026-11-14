import { Request, Response } from 'express';
import { createFeedbackSchema, voteFeedbackSchema } from '@codecollab/shared';
import { feedbackService } from './feedback.service';

function resolveVoterId(req: Request): string {
  // 1. Authenticated user ID
  if ((req as any).user?.id) {
    return `user:${(req as any).user.id}`;
  }

  // 2. Custom voter ID header from client local storage
  const headerVoterId = req.headers['x-voter-id'];
  if (typeof headerVoterId === 'string' && headerVoterId.trim()) {
    return `client:${headerVoterId.trim()}`;
  }

  // 3. Fallback to client IP
  const ip = req.ip || req.socket.remoteAddress || 'anonymous';
  return `ip:${ip}`;
}

export async function getFeedbackHandler(req: Request, res: Response) {
  try {
    const voterId = resolveVoterId(req);
    const items = await feedbackService.getProposals(voterId);

    return res.status(200).json({
      success: true,
      data: items,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'FEEDBACK_FETCH_FAILED',
        message: err?.message || 'Failed to load community feedback',
      },
    });
  }
}

export async function createFeedbackHandler(req: Request, res: Response) {
  try {
    const parsed = createFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid feedback proposal data',
          details: parsed.error.flatten(),
        },
      });
    }

    const voterId = resolveVoterId(req);
    const authorName = (req as any).user?.username || undefined;

    const created = await feedbackService.createProposal(
      parsed.data,
      authorName,
      voterId,
    );

    return res.status(201).json({
      success: true,
      data: created,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'FEEDBACK_CREATE_FAILED',
        message: err?.message || 'Failed to create feature proposal',
      },
    });
  }
}

export async function voteFeedbackHandler(req: Request, res: Response) {
  try {
    const rawId = req.params.id;
    if (!rawId || typeof rawId !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Proposal ID is required',
        },
      });
    }

    const id = String(rawId);
    const bodyParsed = voteFeedbackSchema.safeParse(req.body);
    const customVoterId = bodyParsed.success ? bodyParsed.data.voterId : undefined;
    const direction = bodyParsed.success && bodyParsed.data.direction ? bodyParsed.data.direction : 'up';
    const voterId = customVoterId ? `client:${customVoterId}` : resolveVoterId(req);

    const result = await feedbackService.toggleVote(id, voterId, direction);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    const statusCode = err?.message?.includes('not found') ? 404 : 500;
    return res.status(statusCode).json({
      success: false,
      error: {
        code: statusCode === 404 ? 'PROPOSAL_NOT_FOUND' : 'VOTE_FAILED',
        message: err?.message || 'Failed to update vote',
      },
    });
  }
}
