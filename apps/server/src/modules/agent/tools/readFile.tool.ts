import {
  AGENT_LIMITS,
  ReadFileToolInput,
  ReadFileToolInputSchema,
} from '@codecollab/shared';
import { AppError } from '../../../utils/AppError';
import { resolveInheritedOverride } from '../../projects/project.service';
import { assertProjectAccess } from '../../projects/project.auth';
import { AgentStagingService, normalizeFilePath } from '../agentStaging.service';
import { AgentTool, AgentToolContext } from './agentTool.interface';

export class ReadFileTool implements AgentTool<ReadFileToolInput> {
  readonly name = 'read_file' as const;
  readonly description =
    'Reads source file content by relative workspace path. Returns line numbers, content, and staged status.';
  readonly schema = ReadFileToolInputSchema;

  async execute(
    context: AgentToolContext,
    input: ReadFileToolInput
  ): Promise<{
    path: string;
    content: string;
    totalLines: number;
    startLine: number;
    endLine: number;
    isStaged: boolean;
  }> {
    const { branchId, projectId, userId, sessionId } = context;
    const normalizedPath = normalizeFilePath(input.path);

    // 1. ACL Check: Verify project membership and per-file permissions
    const { role } = await assertProjectAccess(projectId, userId);

    // Look up file in branch
    const branchFile = await AgentStagingService.findFileByPath(
      branchId,
      normalizedPath
    );

    if (branchFile && role !== 'owner') {
      const override = await resolveInheritedOverride(
        branchId,
        branchFile.id,
        userId
      );
      if (override === 'denied') {
        throw new AppError(
          403,
          'FILE_ACCESS_DENIED',
          `Access to file '${normalizedPath}' is denied by project ACL policy`
        );
      }
    }

    // 2. Fetch effective content (from staging buffer or branch)
    const effective = await AgentStagingService.getEffectiveFileContent(
      sessionId,
      branchId,
      normalizedPath
    );

    if (!effective) {
      throw new AppError(
        404,
        'FILE_NOT_FOUND',
        `File '${normalizedPath}' not found in workspace branch or staging buffer`
      );
    }

    if (Buffer.byteLength(effective.content, 'utf8') > AGENT_LIMITS.MAX_FILE_READ_BYTES) {
      throw new AppError(
        400,
        'FILE_TOO_LARGE',
        `File '${normalizedPath}' exceeds maximum read limit of ${AGENT_LIMITS.MAX_FILE_READ_BYTES} bytes`
      );
    }

    const lines = effective.content.split('\n');
    const totalLines = lines.length;

    let startLine = input.lineStart ? Math.max(1, input.lineStart) : 1;
    let endLine = input.lineEnd
      ? Math.min(totalLines, input.lineEnd)
      : totalLines;

    if (startLine > endLine) {
      startLine = 1;
      endLine = totalLines;
    }

    const slicedLines = lines.slice(startLine - 1, endLine);
    const content = slicedLines.join('\n');

    return {
      path: normalizedPath,
      content,
      totalLines,
      startLine,
      endLine,
      isStaged: effective.isStaged,
    };
  }
}
