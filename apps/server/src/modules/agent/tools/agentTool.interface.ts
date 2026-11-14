import { z } from 'zod';
import { AgentToolName } from '@codecollab/shared';

export interface AgentToolContext {
  sessionId: string;
  projectId: string;
  branchId: string;
  userId: string;
}

export interface AgentTool<TInput = any, TOutput = any> {
  readonly name: AgentToolName;
  readonly description: string;
  readonly schema: z.ZodSchema<TInput>;
  execute(context: AgentToolContext, input: TInput): Promise<TOutput>;
}
