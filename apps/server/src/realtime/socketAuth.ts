import type { Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@codecollab/shared';
import { getAllowedOrigin } from '../middleware/csrf.middleware';
import { AUTH_COOKIE_NAME, verifyAccessToken } from '../utils/jwt';
import { getUserById } from '../modules/auth/auth.service';

export interface SocketUser {
  id: string;
  username: string;
  avatarUrl?: string;
}

export interface SocketData {
  user: SocketUser;
}

export type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

/**
 * Authenticates incoming Socket.IO connections before they join any room:
 * 1. Enforces strict WebSocket Origin matching against `CLIENT_URL` (CSWSH protection).
 * 2. Reads and verifies the HttpOnly `codecollab_token` JWT cookie.
 * 3. Confirms the user account still exists in PostgreSQL.
 */
export const socketAuthMiddleware = async (
  socket: RealtimeSocket,
  next: (err?: Error) => void
): Promise<void> => {
  try {
    const allowedOrigin = getAllowedOrigin();
    const requestOrigin = socket.handshake.headers.origin;

    // WebSocket upgrades bypass CORS preflight in browsers; strictly require matching Origin
    if (!requestOrigin || requestOrigin === 'null' || requestOrigin !== allowedOrigin) {
      next(new Error('CORS_ORIGIN_FORBIDDEN'));
      return;
    }

    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader || typeof cookieHeader !== 'string') {
      next(new Error('UNAUTHORIZED'));
      return;
    }

    // `cookie@2.x` ships as ESM; dynamic import stays compatible with NodeNext + CJS compilation
    const { parseCookie } = await import('cookie');
    const cookies = parseCookie(cookieHeader);
    const token = cookies[AUTH_COOKIE_NAME];

    if (!token || typeof token !== 'string') {
      next(new Error('UNAUTHORIZED'));
      return;
    }

    let userId: string;
    try {
      const payload = verifyAccessToken(token);
      userId = payload.sub;
    } catch {
      next(new Error('INVALID_TOKEN'));
      return;
    }

    const user = await getUserById(userId);
    if (!user) {
      next(new Error('UNAUTHORIZED'));
      return;
    }

    socket.data.user = {
      id: user.id,
      username: user.username,
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    };

    next();
  } catch {
    next(new Error('INTERNAL_ERROR'));
  }
};
