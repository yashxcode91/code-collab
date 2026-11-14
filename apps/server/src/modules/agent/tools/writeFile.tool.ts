import {
  WriteFileToolInput,
  WriteFileToolInputSchema,
} from '@codecollab/shared';
import { AppError } from '../../../utils/AppError';
import { assertProjectAccess } from '../../projects/project.auth';
import { resolveInheritedOverride } from '../../projects/project.service';
import { AgentStagingService, normalizeFilePath } from '../agentStaging.service';
import { AgentTool, AgentToolContext } from './agentTool.interface';

export class WriteFileTool implements AgentTool<WriteFileToolInput> {
  readonly name = 'write_file' as const;
  readonly description =
    'Writes or replaces full source code in a file, placing changes in the quarantined staging buffer for user review.';
  readonly schema = WriteFileToolInputSchema;

  async execute(
    context: AgentToolContext,
    input: WriteFileToolInput
  ): Promise<{
    path: string;
    bytesWritten: number;
    changeType: string;
    isStaged: boolean;
  }> {
    const { branchId, projectId, userId, sessionId } = context;
    const normalizedPath = normalizeFilePath(input.path);

    // ACL Check: verify user has editor role
    const { role } = await assertProjectAccess(projectId, userId, 'editor');

    // Check existing file ACL if modifying
    const existingFile = await AgentStagingService.findFileByPath(
      branchId,
      normalizedPath
    );

    if (existingFile && role !== 'owner') {
      const override = await resolveInheritedOverride(
        branchId,
        existingFile.id,
        userId
      );
      if (override === 'denied' || override === 'read_only') {
        throw new AppError(
          403,
          'FILE_WRITE_DENIED',
          `Cannot write to '${normalizedPath}': permission is ${override}`
        );
      }
    }

    const staged = await AgentStagingService.stageFile({
      sessionId,
      branchId,
      filePath: normalizedPath,
      content: input.content,
    });

    return {
      path: normalizedPath,
      bytesWritten: Buffer.byteLength(input.content, 'utf8'),
      changeType: staged.changeType,
      isStaged: true,
    };
  }
}
