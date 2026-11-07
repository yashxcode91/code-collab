import { Router, Request, Response } from 'express';
import { ApiResponse, HealthCheckResponse } from '@codecollab/shared';
import { redis } from '../../lib/redis';
import { prisma } from '@codecollab/database';

export const healthRouter = Router();

// GET /api/health
healthRouter.get('/', async (_req: Request, res: Response) => {
  // 1. Check Redis connectivity
  let isRedisHealthy = false;
  try {
    const pong = await redis.ping();
    isRedisHealthy = pong === 'PONG';
  } catch {
    isRedisHealthy = false;
  }

  // 2. Check PostgreSQL connectivity
  let isDatabaseHealthy = false;
  try {
    await prisma.$queryRaw`SELECT 1;`;
    isDatabaseHealthy = true;
  } catch {
    isDatabaseHealthy = false;
  }

  const allHealthy = isRedisHealthy && isDatabaseHealthy;

  const healthData: HealthCheckResponse = {
    status: allHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    services: {
      database: isDatabaseHealthy,
      redis: isRedisHealthy,
    },
  };

  const response: ApiResponse<HealthCheckResponse> = {
    success: true,
    data: healthData,
  };

  res.status(200).json(response);
});
