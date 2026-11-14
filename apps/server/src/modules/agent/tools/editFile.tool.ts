import {
  EditFileToolInput,
  EditFileToolInputSchema,
} from '@codecollab/shared';
import { AppError } from '../../../utils/AppError';
import { assertProjectAccess } from '../../projects/project.auth';
import { resolveInheritedOverride } from '../../projects/project.service';
import { AgentStagingService, normalizeFilePath } from '../agentStaging.service';
import { AgentTool, AgentToolContext } from './agentTool.interface';

export class EditFileTool implements AgentTool<EditFileToolInput> {
  readonly name = 'edit_file' as const;
  readonly description =
    'Performs surgical search-and-replace on an existing file, staging the modified version in the review buffer.';
  readonly schema = EditFileToolInputSchema;

  async execute(
    context: AgentToolContext,
    input: EditFileToolInput
  ): Promise<{
    path: string;
    replacementsCount: number;
    newContentLength: number;
    isStaged: boolean;
  }> {
    const { branchId, projectId, userId, sessionId } = context;
    const normalizedPath = normalizeFilePath(input.path);

    // ACL Check: editor access
    const { role } = await assertProjectAccess(projectId, userId, 'editor');

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
          `Cannot edit '${normalizedPath}': permission is ${override}`
        );
      }
    }

    const effective = await AgentStagingService.getEffectiveFileContent(
      sessionId,
      branchId,
      normalizedPath
    );

    if (!effective) {
      throw new AppError(
        404,
        'FILE_NOT_FOUND',
        `File '${normalizedPath}' does not exist to edit`
      );
    }

    if (!effective.content.includes(input.target)) {
      throw new AppError(
        400,
        'TARGET_NOT_FOUND',
        `Target string to replace was not found in '${normalizedPath}'`
      );
    }

    // Count occurrences and replace all
    const occurrences = effective.content.split(input.target).length - 1;
    const newContent = effective.content.replaceAll(
      input.target,
      input.replacement
    );

    await AgentStagingService.stageFile({
      sessionId,
      branchId,
      filePath: normalizedPath,
      content: newContent,
    });

    return {
      path: normalizedPath,
      replacementsCount: occurrences,
      newContentLength: newContent.length,
      isStaged: true,
    };
  }
}
