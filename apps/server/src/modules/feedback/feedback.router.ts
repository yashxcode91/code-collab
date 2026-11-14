import { Router } from 'express';
import { optionalAuth } from '../../middleware/auth.middleware';
import {
  createFeedbackHandler,
  getFeedbackHandler,
  voteFeedbackHandler,
} from './feedback.controller';

export const feedbackRouter = Router();

// GET /api/feedback - Retrieve all community proposals & live vote counts
feedbackRouter.get('/', optionalAuth, getFeedbackHandler);

// POST /api/feedback - Propose a new capability or improvement
feedbackRouter.post('/', optionalAuth, createFeedbackHandler);

// POST /api/feedback/:id/vote - Toggle upvote on a proposal
feedbackRouter.post('/:id/vote', optionalAuth, voteFeedbackHandler);
