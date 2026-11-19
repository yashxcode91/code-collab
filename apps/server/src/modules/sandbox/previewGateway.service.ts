import http from 'node:http';
import type { Request, Response } from 'express';
import { prisma } from '@codecollab/database';
import { getAllowedOrigin } from '../../middleware/csrf.middleware';
import { verifyPreviewToken } from '../../utils/jwt';
import { verifyAccessToken } from '../../utils/jwt';
import { AUTH_COOKIE_NAME } from '../../utils/jwt';

export interface ParsedPreviewRequest {
  projectId: string;
  port: number | null;
  subPath: string;
}

export type PreviewResolution =
  | { state: 'READY'; targetHost: string; targetPort: number; sandbox: any }
  | { state: 'STARTING'; targetPort: number; sandbox: any }
  | { state: 'STOPPED'; sandbox: any }
  | { state: 'FAILED'; sandbox: any }
  | { state: 'NOT_FOUND' };

const previewTouchThrottleMap = new Map<string, number>();

/**
 * Parses route paths like:
 * - `/preview/proj-123/5173/index.html` -> { projectId: 'proj-123', port: 5173, subPath: '/index.html' }
 * - `/preview/proj-123/5173` -> { projectId: 'proj-123', port: 5173, subPath: '/' }
 * - `/preview/proj-123/style.css` -> { projectId: 'proj-123', port: null, subPath: '/style.css' }
 * - `/preview/proj-123` -> { projectId: 'proj-123', port: null, subPath: '/' }
 */
export function parsePreviewPath(rawPath: string): ParsedPreviewRequest | null {
  const clean = rawPath.replace(/^\/(?:api\/)?preview\/?/, '');
  const segments = clean.split('/').filter(Boolean);

  if (segments.length === 0 || !segments[0]) {
    return null;
  }

  const projectId = segments[0];
  let port: number | null = null;
  let subPathSegments: string[] = [];

  if (segments.length > 1) {
    const maybePort = parseInt(segments[1], 10);
    if (!isNaN(maybePort) && maybePort > 0 && maybePort < 65536) {
      port = maybePort;
      subPathSegments = segments.slice(2);
    } else {
      subPathSegments = segments.slice(1);
    }
  }

  const subPath = '/' + subPathSegments.join('/');
  return { projectId, port, subPath };
}

export class PreviewGatewayService {
  /**
   * Verifies preview access permissions via query token, Auth header, or session cookie.
   */
  async authenticatePreviewRequest(
    req: Request | http.IncomingMessage,
    projectId: string
  ): Promise<boolean> {
    const urlObj = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`
    );
    const queryToken = urlObj.searchParams.get('token');

    // 1. Direct Preview Token Check
    if (queryToken) {
      try {
        const payload = verifyPreviewToken(queryToken);
        if (payload.projectId === projectId) {
          // Strictly verify that token was generated for the project owner
          const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { ownerId: true },
          });
          if (project && payload.userId === project.ownerId) {
            return true;
          }
        }
      } catch {
        // Fall through to other auth mechanisms
      }

      // Check against DB recorded token
      const dbMatch = await prisma.previewSandbox.findFirst({
        where: { projectId, previewToken: queryToken },
      });
      if (dbMatch) return true;
    }

    // 2. Cookie or Authorization Header Check
    const cookieHeader = req.headers.cookie;
    let sessionToken: string | null = null;

    if (cookieHeader) {
      const match = cookieHeader
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`));
      if (match) {
        sessionToken = match.slice(AUTH_COOKIE_NAME.length + 1);
      }
    }

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      sessionToken = authHeader.slice(7).trim();
    }

    if (sessionToken) {
      try {
        const sessionPayload = verifyAccessToken(sessionToken);
        const userId = sessionPayload.sub;

        // Verify strictly workspace owner
        const project = await prisma.project.findUnique({
          where: { id: projectId },
          select: { ownerId: true },
        });

        if (project && project.ownerId === userId) {
          return true;
        }
      } catch {
        // Session token invalid
      }
    }

    return false;
  }

  /**
   * Resolves target destination (IP/port) for an active sandbox.
   */
  async resolveSandboxTarget(
    projectId: string,
    requestedPort?: number | null
  ): Promise<PreviewResolution> {
    const sandbox = await prisma.previewSandbox.findFirst({
      where: { projectId },
      orderBy: { updatedAt: 'desc' },
    });

    if (!sandbox) {
      return { state: 'NOT_FOUND' };
    }

    const targetPort = requestedPort || sandbox.primaryPort;

    if (sandbox.status === 'STARTING') {
      return { state: 'STARTING', targetPort, sandbox };
    }

    if (sandbox.status === 'STOPPED' || sandbox.status === 'STOPPING') {
      return { state: 'STOPPED', sandbox };
    }

    if (sandbox.status === 'FAILED') {
      return { state: 'FAILED', sandbox };
    }

    // Status is RUNNING
    let portsList: Array<{ containerPort: number; hostPort?: number }> = [];
    if (Array.isArray(sandbox.ports)) {
      portsList = sandbox.ports as any[];
    } else if (typeof sandbox.ports === 'string') {
      try {
        portsList = JSON.parse(sandbox.ports);
      } catch {
        portsList = [];
      }
    }

    const portEntry = portsList.find((p) => p.containerPort === targetPort);
    const hostPort = portEntry?.hostPort;

    // Prefer loopback hostPort if allocated (cross-platform macOS/Linux support), then internal bridge IP/containerName
    const targetHost = hostPort ? '127.0.0.1' : (sandbox.internalIp || sandbox.containerName || '127.0.0.1');
    const finalPort = hostPort || targetPort;

    return {
      state: 'READY',
      targetHost,
      targetPort: finalPort,
      sandbox,
    };
  }

  /**
   * Proxies an incoming Express HTTP request directly to the container's dev server.
   */
  async handleProxyRequest(
    req: Request,
    res: Response,
    parsed: ParsedPreviewRequest
  ): Promise<void> {
    const resolution = await this.resolveSandboxTarget(
      parsed.projectId,
      parsed.port
    );

    if (resolution.state === 'NOT_FOUND') {
      res.status(404).send(this.renderErrorHtml('Workspace Sandbox Not Found', 'No preview sandbox has been initialized for this workspace. Launch it from the Studio Preview toolbar.'));
      return;
    }

    if (resolution.state === 'STARTING') {
      res.status(200).send(this.renderBootingHtml(parsed.projectId, resolution.targetPort));
      return;
    }

    if (resolution.state === 'STOPPED') {
      res.status(200).send(this.renderStoppedHtml(parsed.projectId));
      return;
    }

    if (resolution.state === 'FAILED') {
      res.status(502).send(this.renderErrorHtml('Sandbox Execution Failed', 'The container runtime encountered an error starting your development server. Check logs in the Studio console.'));
      return;
    }

    const { targetHost, targetPort } = resolution;
    const allowedOrigin = getAllowedOrigin();

    // Refresh sandbox activity timestamp (throttled to once every 15s) so active preview users don't get reaped
    const now = Date.now();
    const lastTouch = previewTouchThrottleMap.get(parsed.projectId) || 0;
    if (now - lastTouch > 15_000) {
      previewTouchThrottleMap.set(parsed.projectId, now);
      prisma.previewSandbox
        .updateMany({
          where: { projectId: parsed.projectId, status: 'RUNNING' },
          data: { lastPingAt: new Date() },
        })
        .catch(() => undefined);
    }

    // Reconstruct upstream target path with query parameters
    const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const upstreamPath = parsed.subPath + queryString;

    const proxyReq = http.request(
      {
        hostname: targetHost,
        port: targetPort,
        path: upstreamPath,
        method: req.method,
        headers: {
          ...req.headers,
          host: `${targetHost}:${targetPort}`,
          'x-forwarded-for': req.ip || req.socket.remoteAddress || '127.0.0.1',
          'x-forwarded-proto': req.protocol || 'http',
          'x-forwarded-host': req.get('host') || 'localhost',
        },
      },
      (proxyRes) => {
        // Strip upstream framing restrictions so CodeCollab Studio can embed inside <iframe>
        const headers = { ...proxyRes.headers };
        delete headers['x-frame-options'];
        delete headers['content-security-policy'];

        // Enforce frame-ancestors allowing our frontend origin
        headers['Content-Security-Policy'] = `frame-ancestors 'self' ${allowedOrigin}`;

        // Set preview session cookie for subsequent relative asset requests
        res.cookie('codecollab_preview_session', `${parsed.projectId}:${parsed.port || 5173}`, {
          path: '/',
          httpOnly: false,
          sameSite: 'lax',
        });

        res.writeHead(proxyRes.statusCode || 200, headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (err: any) => {
      // If the container server is still binding or starting up
      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(this.renderBootingHtml(parsed.projectId, targetPort));
        return;
      }

      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.renderErrorHtml('Bad Gateway: Container Upstream Unreachable', err.message));
    });

    // Pipe request stream to proxy
    req.pipe(proxyReq);
  }

  /**
   * High-contrast, dark-mode booting screen with auto-refresh meta polling.
   */
  public renderBootingHtml(_projectId: string, port: number): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="2">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booting Cloud Sandbox...</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #090b10;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      padding: 20px;
    }
    .card {
      background: #11141c;
      border: 1px solid rgba(251, 146, 60, 0.35);
      border-radius: 12px;
      padding: 36px 32px;
      text-align: center;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 20px 45px rgba(0,0,0,0.7);
    }
    .spinner {
      width: 42px;
      height: 42px;
      border: 3px solid rgba(251, 146, 60, 0.2);
      border-top-color: #fb923c;
      border-radius: 50%;
      animation: spin 0.75s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h2 {
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 10px;
      color: #ffffff;
      letter-spacing: -0.01em;
    }
    p {
      font-size: 13px;
      color: #94a3b8;
      margin: 0 0 18px;
      line-height: 1.5;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 9999px;
      background: rgba(251, 146, 60, 0.12);
      color: #fb923c;
      font-size: 11px;
      font-family: ui-monospace, Menlo, Monaco, monospace;
      border: 1px solid rgba(251, 146, 60, 0.25);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>Booting Cloud Sandbox</h2>
    <p>Mounting isolated container, synchronizing branch files, and binding development server on port ${port}...</p>
    <div class="badge">codecollab-sandbox &bull; port ${port}</div>
  </div>
  <script>
    setTimeout(function() { window.location.reload(); }, 2000);
  </script>
</body>
</html>`;
  }

  /**
   * Informative screen rendered when the sandbox container is stopped.
   */
  public renderStoppedHtml(_projectId: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sandbox Stopped</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #090b10;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      padding: 20px;
    }
    .card {
      background: #11141c;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 36px 32px;
      text-align: center;
      max-width: 440px;
      width: 100%;
    }
    h2 { font-size: 18px; margin: 0 0 10px; color: #fff; }
    p { font-size: 13px; color: #94a3b8; margin: 0 0 20px; line-height: 1.5; }
    .btn {
      display: inline-block;
      background: #ea580c;
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="card">
    <h2>Sandbox is Stopped</h2>
    <p>This development container is currently powered down to conserve compute resources. Start it directly from the Studio Preview toolbar.</p>
    <button class="btn" onclick="window.location.reload()">Refresh State</button>
  </div>
</body>
</html>`;
  }

  /**
   * Diagnostic error screen.
   */
  public renderErrorHtml(title: string, message: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #090b10;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      padding: 20px;
    }
    .card {
      background: #11141c;
      border: 1px solid rgba(239, 68, 68, 0.4);
      border-radius: 12px;
      padding: 36px 32px;
      text-align: center;
      max-width: 440px;
      width: 100%;
    }
    h2 { font-size: 18px; margin: 0 0 10px; color: #f87171; }
    p { font-size: 13px; color: #94a3b8; margin: 0 0 20px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${title}</h2>
    <p>${message}</p>
    <button style="background:#262b3d;color:#e2e8f0;border:1px solid #3b4252;padding:8px 16px;border-radius:6px;cursor:pointer;" onclick="window.location.reload()">Retry</button>
  </div>
</body>
</html>`;
  }
}

export const previewGateway = new PreviewGatewayService();
