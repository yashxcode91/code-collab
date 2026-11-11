import type { User } from '@codecollab/shared';

import type { User } from '@codecollab/shared';

/**
 * TypeScript module augmentation adding the authenticated `req.user` property
 * (set by `requireAuth` middleware) onto Express's Request interface globally.
 */
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export {};
