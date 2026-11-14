import { z } from 'zod';

export const feedbackCategoryEnum = z.enum([
  'Editor',
  'AI',
  'Infrastructure',
  'Collaboration',
  'Competitive',
]);

export const createFeedbackSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'Title must be at least 3 characters')
    .max(100, 'Title cannot exceed 100 characters'),
  description: z
    .string()
    .trim()
    .min(10, 'Description must be at least 10 characters')
    .max(1000, 'Description cannot exceed 1000 characters'),
  category: feedbackCategoryEnum,
});

export const voteFeedbackSchema = z.object({
  voterId: z.string().trim().optional(),
  direction: z.enum(['up', 'down']).optional(),
});
