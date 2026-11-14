import {
  AgentVerificationResultDto,
  RunVerificationToolInput,
  RunVerificationToolInputSchema,
} from '@codecollab/shared';
import { AgentVerificationService } from '../agentVerification.service';
import { AgentTool, AgentToolContext } from './agentTool.interface';

export class RunVerificationTool implements AgentTool<RunVerificationToolInput> {
  readonly name = 'run_verification' as const;
  readonly description =
    'Runs TypeScript syntax and type-check verification across all project files overlaid with current staged changes. Returns compiler diagnostics for self-healing.';
  readonly schema = RunVerificationToolInputSchema;

  async execute(
    context: AgentToolContext,
    input: RunVerificationToolInput
  ): Promise<AgentVerificationResultDto> {
    const { sessionId, branchId } = context;

    return AgentVerificationService.verifyWorkspace({
      sessionId,
      branchId,
      command: input.command,
    });
  }
}
