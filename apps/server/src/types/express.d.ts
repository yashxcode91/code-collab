import type { User } from '@codecollab/shared';

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export {};
