import {
  ListDirectoryToolInput,
  ListDirectoryToolInputSchema,
} from '@codecollab/shared';
import { assertProjectAccess } from '../../projects/project.auth';
import { resolveInheritedOverride } from '../../projects/project.service';
import { AgentStagingService, normalizeFilePath } from '../agentStaging.service';
import { AgentTool, AgentToolContext } from './agentTool.interface';

export class ListDirectoryTool implements AgentTool<ListDirectoryToolInput> {
  readonly name = 'list_directory' as const;
  readonly description =
    'Lists file paths in the workspace branch, overlaid with uncommitted staged files and filtered by path prefix.';
  readonly schema = ListDirectoryToolInputSchema;

  async execute(
    context: AgentToolContext,
    input: ListDirectoryToolInput
  ): Promise<{
    files: Array<{
      path: string;
      size: number;
      isStaged: boolean;
      changeType?: string;
    }>;
    count: number;
  }> {
    const { branchId, projectId, userId, sessionId } = context;
    const prefix = input.path ? normalizeFilePath(input.path) : '';

    const { role } = await assertProjectAccess(projectId, userId);
    const { filesByPath } = await AgentStagingService.getBranchPathMap(branchId);
    const stagedFiles = await AgentStagingService.getStagedFiles(sessionId);

    const resultMap = new Map<
      string,
      { path: string; size: number; isStaged: boolean; changeType?: string }
    >();

    // 1. Add branch files
    for (const [filePath, fileNode] of filesByPath.entries()) {
      if (prefix && !filePath.startsWith(prefix)) {
        continue;
      }

      // Check ACL
      if (role !== 'owner') {
        const override = await resolveInheritedOverride(
          branchId,
          fileNode.id,
          userId
        );
        if (override === 'denied') {
          continue;
        }
      }

      resultMap.set(filePath, {
        path: filePath,
        size: Buffer.byteLength(fileNode.content, 'utf8'),
        isStaged: false,
      });
    }

    // 2. Overlay staged files
    for (const staged of stagedFiles) {
      const normPath = normalizeFilePath(staged.filePath);
      if (prefix && !normPath.startsWith(prefix)) {
        continue;
      }

      if (staged.changeType === 'DELETE') {
        resultMap.delete(normPath);
      } else {
        resultMap.set(normPath, {
          path: normPath,
          size: Buffer.byteLength(staged.stagedContent, 'utf8'),
          isStaged: true,
          changeType: staged.changeType,
        });
      }
    }

    const files = Array.from(resultMap.values()).sort((a, b) =>
      a.path.localeCompare(b.path)
    );

    return {
      files,
      count: files.length,
    };
  }
}
