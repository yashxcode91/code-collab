import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { TerminalClientMessageSchema } from '@codecollab/shared';
import { verifyAccessToken, verifyPreviewToken, AUTH_COOKIE_NAME } from '../../utils/jwt';
import { isAllowedOrigin } from '../../middleware/csrf.middleware';
import { terminalService, type TerminalSession } from './terminal.service';

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 64 * 1024, // 64KB max incoming frame payload to prevent DoS buffer flooding
});

interface AuthResult {
  userId: string;
}

/**
 * Extracts and verifies JWT credentials from query, cookie, or authorization header.
 */
function authenticateRequest(req: http.IncomingMessage, targetProjectId: string): AuthResult | null {
  const url = req.url || '';
  const urlObj = new URL(url, 'http://localhost');

  // 1. Check query parameter `?token=...`
  const queryToken = urlObj.searchParams.get('token');
  if (queryToken) {
    // Try Preview Token first
    try {
      const previewClaims = verifyPreviewToken(queryToken);
      if (previewClaims.projectId === targetProjectId) {
        return { userId: previewClaims.userId };
      }
    } catch {
      // Fall through to Access Token
    }

    // Try Standard Access Token
    try {
      const accessClaims = verifyAccessToken(queryToken);
      return { userId: accessClaims.sub };
    } catch {
      // Invalid query token
    }
  }

  // 2. Check Cookie
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    const authCookie = cookies.find((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`));
    if (authCookie) {
      const token = authCookie.slice(AUTH_COOKIE_NAME.length + 1);
      try {
        const claims = verifyAccessToken(token);
        return { userId: claims.sub };
      } catch {
        // Invalid cookie token
      }
    }
  }

  // 3. Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    try {
      const claims = verifyAccessToken(token);
      return { userId: claims.sub };
    } catch {
      // Invalid bearer token
    }
  }

  return null;
}

function processClientMessage(session: TerminalSession, raw: any): void {
  try {
    const parsedJson = JSON.parse(raw.toString('utf-8'));
    const validated = TerminalClientMessageSchema.safeParse(parsedJson);
    if (validated.success) {
      terminalService.handleMessage(session.sessionId, validated.data);
    }
  } catch {
    // Ignore malformed client frames
  }
}

/**
 * Handles incoming HTTP 'upgrade' requests for interactive container terminal WebSockets.
 *
 * Returns `true` if handled by the terminal gateway, or `false` otherwise.
 */
export function handleTerminalWebSocketUpgrade(
  req: http.IncomingMessage,
  clientSocket: Duplex,
  head: Buffer
): boolean {
  const url = req.url || '';

  // Intercept requests directed to terminal paths (/terminal/:projectId or /api/terminal/:projectId)
  const match = url.match(/^\/(?:api\/)?terminal\/([^/?#]+)/);
  if (!match) {
    return false;
  }

  const projectId = match[1];

  // 1. Cross-Site WebSocket Hijacking (CSWSH) Defense:
  // Validate Origin / Referer against authorized frontend host
  const requestOrigin =
    (req.headers.origin as string | undefined) ||
    (req.headers.referer as string | undefined);

  if (requestOrigin && requestOrigin !== 'null' && !isAllowedOrigin(requestOrigin)) {
    clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    clientSocket.destroy();
    return true;
  }

  if (process.env.NODE_ENV === 'production' && !requestOrigin) {
    clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    clientSocket.destroy();
    return true;
  }

  const auth = authenticateRequest(req, projectId);

  if (!auth) {
    clientSocket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    clientSocket.destroy();
    return true;
  }

  wss.handleUpgrade(req, clientSocket, head, (ws: WebSocket) => {
    let session: TerminalSession | null = null;
    const pendingQueue: any[] = [];

    // Register message handler immediately to prevent dropped initial frames
    ws.on('message', (raw) => {
      if (!session) {
        pendingQueue.push(raw);
      } else {
        processClientMessage(session, raw);
      }
    });

    ws.on('close', () => {
      if (session) {
        terminalService.closeSession(session.sessionId);
      }
    });

    ws.on('error', () => {
      if (session) {
        terminalService.closeSession(session.sessionId);
      }
    });

    void (async () => {
      try {
        const urlObj = new URL(url, 'http://localhost');
        const cols = parseInt(urlObj.searchParams.get('cols') || '80', 10);
        const rows = parseInt(urlObj.searchParams.get('rows') || '24', 10);

        session = await terminalService.createSession(auth.userId, projectId, ws, {
          cols,
          rows,
        });

        // Drain any frames sent while session was initializing
        for (const raw of pendingQueue) {
          processClientMessage(session, raw);
        }
        pendingQueue.length = 0;
      } catch (err: any) {
        if (ws.readyState === ws.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'error',
              message: err?.message || 'Failed to initialize terminal session',
            })
          );
          ws.close();
        }
      }
    })();
  });

  return true;
}
