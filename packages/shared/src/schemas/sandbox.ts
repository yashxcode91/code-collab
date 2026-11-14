import { z } from 'zod';

export const SandboxStatusSchema = z.enum([
  'STARTING',
  'RUNNING',
  'STOPPING',
  'STOPPED',
  'FAILED',
]);

export const StartSandboxSchema = z.object({
  branchId: z.string().uuid().optional(),
  primaryPort: z.number().int().min(1024).max(65535).optional().default(5173),
  envVars: z.record(z.string(), z.string()).optional(),
});

export const StopSandboxSchema = z.object({
  branchId: z.string().uuid().optional(),
  force: z.boolean().optional().default(false),
});
