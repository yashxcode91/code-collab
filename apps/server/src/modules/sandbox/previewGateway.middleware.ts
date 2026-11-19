import { Router, Request, Response, NextFunction } from 'express';
import { parsePreviewPath, previewGateway } from './previewGateway.service';

export const previewGatewayRouter = Router();

previewGatewayRouter.all('*', async (req: Request, res: Response, next: NextFunction) => {
  const urlToParse = req.originalUrl || req.url;
  const parsed = parsePreviewPath(urlToParse);

  if (!parsed) {
    next();
    return;
  }

  // Enforce trailing slash for root routes so relative resource paths in HTML resolve cleanly
  const pathWithoutQuery = urlToParse.split('?')[0];
  const queryPart = urlToParse.includes('?') ? urlToParse.slice(urlToParse.indexOf('?')) : '';

  if (
    (pathWithoutQuery === `/preview/${parsed.projectId}` ||
      (parsed.port && pathWithoutQuery === `/preview/${parsed.projectId}/${parsed.port}`)) &&
    !pathWithoutQuery.endsWith('/')
  ) {
    res.redirect(302, `${pathWithoutQuery}/${queryPart}`);
    return;
  }

  // Authenticate preview access (query token, auth header, or session cookie)
  const isAuthorized = await previewGateway.authenticatePreviewRequest(
    req,
    parsed.projectId
  );

  if (!isAuthorized) {
    res.status(403).send(
      previewGateway.renderErrorHtml(
        'Workspace Owner Only',
        'Preview privileges are reserved for the workspace owner. Collaborators, please enjoy the code without the power to run preview.'
      )
    );
    return;
  }

  await previewGateway.handleProxyRequest(req, res, parsed);
});
