import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { parsePreviewPath, previewGateway } from './previewGateway.service';

/**
 * Handles incoming HTTP 'upgrade' requests for Preview environments (Vite HMR WebSockets).
 *
 * Returns `true` if the request was handled by the preview gateway, or `false` if it
 * should be handled by downstream listeners (e.g., Socket.IO).
 */
export function handlePreviewWebSocketUpgrade(
  req: http.IncomingMessage,
  clientSocket: Duplex,
  head: Buffer
): boolean {
  const url = req.url || '';

  // Only intercept requests directed to preview paths
  if (!url.startsWith('/preview') && !url.startsWith('/api/preview')) {
    return false;
  }

  const parsed = parsePreviewPath(url);
  if (!parsed) {
    clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    clientSocket.destroy();
    return true;
  }

  void (async () => {
    try {
      const isAuthorized = await previewGateway.authenticatePreviewRequest(
        req,
        parsed.projectId
      );

      if (!isAuthorized) {
        clientSocket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        clientSocket.destroy();
        return;
      }

      const resolution = await previewGateway.resolveSandboxTarget(
        parsed.projectId,
        parsed.port
      );

      if (resolution.state !== 'READY') {
        clientSocket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        clientSocket.destroy();
        return;
      }

      const { targetHost, targetPort } = resolution;

      const upstreamSocket = net.connect(targetPort, targetHost, () => {
        // Forward HTTP Upgrade request line and headers to upstream container
        upstreamSocket.write(
          `${req.method || 'GET'} ${parsed.subPath} HTTP/${req.httpVersion || '1.1'}\r\n`
        );

        if (req.rawHeaders) {
          for (let i = 0; i < req.rawHeaders.length; i += 2) {
            const key = req.rawHeaders[i];
            const value = req.rawHeaders[i + 1];
            if (key.toLowerCase() === 'host') {
              upstreamSocket.write(`Host: ${targetHost}:${targetPort}\r\n`);
            } else {
              upstreamSocket.write(`${key}: ${value}\r\n`);
            }
          }
        }

        upstreamSocket.write('\r\n');
        if (head && head.length > 0) {
          upstreamSocket.write(head);
        }

        // Bi-directional streaming pipe
        clientSocket.pipe(upstreamSocket);
        upstreamSocket.pipe(clientSocket);
      });

      upstreamSocket.on('error', (_err) => {
        clientSocket.destroy();
      });

      clientSocket.on('error', (_err) => {
        upstreamSocket.destroy();
      });

      clientSocket.on('close', () => {
        upstreamSocket.end();
      });

      upstreamSocket.on('close', () => {
        clientSocket.end();
      });
    } catch {
      clientSocket.destroy();
    }
  })();

  return true;
}
