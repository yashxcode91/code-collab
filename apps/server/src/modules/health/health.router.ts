import { Router, Request, Response } from 'express';
import { ApiResponse, HealthCheckResponse } from '@codecollab/shared';

export const healthRouter = Router();

// GET /api/health
healthRouter.get('/', (_req: Request, res: Response) => {
  const healthData: HealthCheckResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    services: {
      database: false, // Will become true once PostgreSQL connects
      redis: false,    // Will become true once Redis connects
    },
  };

  const response: ApiResponse<HealthCheckResponse> = {
    success: true,
    data: healthData,
  };

  res.status(200).json(response);
});