import { Router } from 'express';
import {
  AddProjectMemberSchema,
  AI_LIMITS,
  AiPromptRequestSchema,
  CreateBranchSchema,
  CreateChatMessageSchema,
  CreateExecutionRunSchema,
  CreateFileNodeSchema,
  CreateProjectSchema,
  CreateSnapshotSchema,
  MergeBranchSchema,
  RestoreSnapshotSchema,
  SetFileAccessSchema,
  SNAPSHOT_LIMITS,
  UpdateBranchSchema,
  UpdateFileNodeSchema,
  UpdateProjectMemberRoleSchema,
  UpdateProjectSchema,
} from '@codecollab/shared';
import { requireAuth } from '../../middleware/auth.middleware';
import { createRateLimitMiddleware } from '../../middleware/rateLimit.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  deleteAiConversationController,
  getAiConversationDetailController,
  listAiConversationsController,
  streamAiPromptController,
} from '../ai/ai.controller';
import {
  createProjectChatMessageController,
  listProjectChatMessagesController,
} from '../chat/chat.controller';
import {
  createExecutionRunController,
  cancelExecutionRunController,
  getExecutionRunDetailController,
  listBranchExecutionRunsController,
} from '../execution/execution.controller';
import {
  createBranchSnapshotController,
  deleteBranchSnapshotController,
  diffBranchSnapshotController,
  getBranchSnapshotDetailController,
  listBranchSnapshotsController,
  restoreBranchSnapshotController,
} from '../snapshots/snapshot.controller';
import {
  addMemberController,
  createBranchController,
  createFileNodeController,
  createProjectController,
  deleteBranchController,
  deleteFileNodeController,
  deleteProjectController,
  getFileDetailController,
  getProjectDetailController,
  listBranchesController,
  listBranchFilesController,
  listFileAccessController,
  listProjectsController,
  lockFileNodeController,
  mergeBranchController,
  previewBranchMergeController,
  removeFileAccessController,
  removeMemberController,
  setFileAccessController,
  unlockFileNodeController,
  updateBranchController,
  updateFileNodeController,
  updateMemberRoleController,
  updateProjectController,
} from './project.controller';

/**
 * Express router mounted at `/api/projects`.
 * Every route enforces: HttpOnly JWT auth (`requireAuth`) -> Zod body validation
 * (`validateBody` on writes) -> async error forwarding (`asyncHandler`).
 */
export const projectRouter: Router = Router();

// Every workspace endpoint requires an authenticated HttpOnly session
projectRouter.use(requireAuth);

// --- Workspace Projects ---
projectRouter.get('/', asyncHandler(listProjectsController));
projectRouter.post(
  '/',
  validateBody(CreateProjectSchema),
  asyncHandler(createProjectController)
);
projectRouter.get('/:projectId', asyncHandler(getProjectDetailController));
projectRouter.patch(
  '/:projectId',
  validateBody(UpdateProjectSchema),
  asyncHandler(updateProjectController)
);
projectRouter.delete('/:projectId', asyncHandler(deleteProjectController));

// --- Collaborators ---
projectRouter.post(
  '/:projectId/members',
  validateBody(AddProjectMemberSchema),
  asyncHandler(addMemberController)
);
projectRouter.patch(
  '/:projectId/members/:userId',
  validateBody(UpdateProjectMemberRoleSchema),
  asyncHandler(updateMemberRoleController)
);
projectRouter.delete(
  '/:projectId/members/:userId',
  asyncHandler(removeMemberController)
);

// --- Branches ---
projectRouter.get('/:projectId/branches', asyncHandler(listBranchesController));
projectRouter.post(
  '/:projectId/branches',
  validateBody(CreateBranchSchema),
  asyncHandler(createBranchController)
);
projectRouter.patch(
  '/:projectId/branches/:branchId',
  validateBody(UpdateBranchSchema),
  asyncHandler(updateBranchController)
);
projectRouter.delete(
  '/:projectId/branches/:branchId',
  asyncHandler(deleteBranchController)
);
projectRouter.get(
  '/:projectId/branches/:branchId/merge/preview',
  asyncHandler(previewBranchMergeController)
);
projectRouter.post(
  '/:projectId/branches/:branchId/merge',
  validateBody(MergeBranchSchema),
  asyncHandler(mergeBranchController)
);

// --- Files, Folders & Locks ---
projectRouter.get(
  '/:projectId/branches/:branchId/files',
  asyncHandler(listBranchFilesController)
);
projectRouter.post(
  '/:projectId/branches/:branchId/files',
  validateBody(CreateFileNodeSchema),
  asyncHandler(createFileNodeController)
);
projectRouter.get(
  '/:projectId/branches/:branchId/files/:fileId',
  asyncHandler(getFileDetailController)
);
projectRouter.patch(
  '/:projectId/branches/:branchId/files/:fileId',
  validateBody(UpdateFileNodeSchema),
  asyncHandler(updateFileNodeController)
);
projectRouter.delete(
  '/:projectId/branches/:branchId/files/:fileId',
  asyncHandler(deleteFileNodeController)
);
projectRouter.post(
  '/:projectId/branches/:branchId/files/:fileId/lock',
  asyncHandler(lockFileNodeController)
);
projectRouter.delete(
  '/:projectId/branches/:branchId/files/:fileId/lock',
  asyncHandler(unlockFileNodeController)
);

// --- Per-File Access Overrides ---
projectRouter.get(
  '/:projectId/branches/:branchId/files/:fileId/access',
  asyncHandler(listFileAccessController)
);
projectRouter.put(
  '/:projectId/branches/:branchId/files/:fileId/access',
  validateBody(SetFileAccessSchema),
  asyncHandler(setFileAccessController)
);
projectRouter.delete(
  '/:projectId/branches/:branchId/files/:fileId/access/:userId',
  asyncHandler(removeFileAccessController)
);

// --- Day 4: Isolated Code Execution ---
projectRouter.get(
  '/:projectId/branches/:branchId/runs',
  asyncHandler(listBranchExecutionRunsController)
);
projectRouter.post(
  '/:projectId/branches/:branchId/runs',
  validateBody(CreateExecutionRunSchema),
  asyncHandler(createExecutionRunController)
);
projectRouter.get(
  '/:projectId/runs/:runId',
  asyncHandler(getExecutionRunDetailController)
);
projectRouter.post(
  '/:projectId/runs/:runId/cancel',
  asyncHandler(cancelExecutionRunController)
);

// --- Day 4: Real-Time Workspace Chat ---
projectRouter.get(
  '/:projectId/chat',
  asyncHandler(listProjectChatMessagesController)
);
projectRouter.post(
  '/:projectId/chat',
  validateBody(CreateChatMessageSchema),
  asyncHandler(createProjectChatMessageController)
);

// --- Day 5: Branch Snapshots & Version History ---
const snapshotReadLimiter = createRateLimitMiddleware({
  keyPrefix: 'snapshot:read',
  maxRequests: SNAPSHOT_LIMITS.RATE_LIMIT_MAX_READS,
  windowSec: SNAPSHOT_LIMITS.RATE_LIMIT_WINDOW_SEC,
  message: `Too many snapshot reads (max ${SNAPSHOT_LIMITS.RATE_LIMIT_MAX_READS} per ${SNAPSHOT_LIMITS.RATE_LIMIT_WINDOW_SEC}s)`,
  getKeySuffix: (req) => req.user?.id ?? null,
});

const snapshotDiffLimiter = createRateLimitMiddleware({
  keyPrefix: 'snapshot:diff',
  maxRequests: SNAPSHOT_LIMITS.RATE_LIMIT_MAX_DIFFS,
  windowSec: SNAPSHOT_LIMITS.RATE_LIMIT_WINDOW_SEC,
  message: `Too many snapshot diffs (max ${SNAPSHOT_LIMITS.RATE_LIMIT_MAX_DIFFS} per ${SNAPSHOT_LIMITS.RATE_LIMIT_WINDOW_SEC}s)`,
  getKeySuffix: (req) => req.user?.id ?? null,
});

const snapshotMutationLimiter = createRateLimitMiddleware({
  keyPrefix: 'snapshot:write',
  maxRequests: SNAPSHOT_LIMITS.RATE_LIMIT_MAX_MUTATIONS,
  windowSec: SNAPSHOT_LIMITS.RATE_LIMIT_WINDOW_SEC,
  message: `Snapshot write rate limit exceeded (max ${SNAPSHOT_LIMITS.RATE_LIMIT_MAX_MUTATIONS} operations per ${SNAPSHOT_LIMITS.RATE_LIMIT_WINDOW_SEC}s)`,
  getKeySuffix: (req) => req.user?.id ?? null,
});

projectRouter.get(
  '/:projectId/branches/:branchId/snapshots',
  snapshotReadLimiter,
  asyncHandler(listBranchSnapshotsController)
);
projectRouter.post(
  '/:projectId/branches/:branchId/snapshots',
  snapshotMutationLimiter,
  validateBody(CreateSnapshotSchema),
  asyncHandler(createBranchSnapshotController)
);
projectRouter.get(
  '/:projectId/branches/:branchId/snapshots/:snapshotId',
  snapshotReadLimiter,
  asyncHandler(getBranchSnapshotDetailController)
);
projectRouter.get(
  '/:projectId/branches/:branchId/snapshots/:snapshotId/diff',
  snapshotDiffLimiter,
  asyncHandler(diffBranchSnapshotController)
);
projectRouter.post(
  '/:projectId/branches/:branchId/snapshots/:snapshotId/restore',
  snapshotMutationLimiter,
  validateBody(RestoreSnapshotSchema),
  asyncHandler(restoreBranchSnapshotController)
);
projectRouter.delete(
  '/:projectId/branches/:branchId/snapshots/:snapshotId',
  snapshotMutationLimiter,
  asyncHandler(deleteBranchSnapshotController)
);

// --- Day 6: AI Assistant (SSE Stream & Conversations) ---
const aiPromptLimiter = createRateLimitMiddleware({
  keyPrefix: 'ai:prompt',
  maxRequests: AI_LIMITS.RATE_LIMIT_MAX_PROMPTS,
  windowSec: AI_LIMITS.RATE_LIMIT_WINDOW_SEC,
  message: `Too many AI requests (max ${AI_LIMITS.RATE_LIMIT_MAX_PROMPTS} per ${AI_LIMITS.RATE_LIMIT_WINDOW_SEC}s)`,
  getKeySuffix: (req) => req.user?.id ?? null,
});

const aiReadLimiter = createRateLimitMiddleware({
  keyPrefix: 'ai:read',
  maxRequests: 60,
  windowSec: 60,
  message: 'Too many AI read requests',
  getKeySuffix: (req) => req.user?.id ?? null,
});

projectRouter.post(
  '/:projectId/branches/:branchId/ai/stream',
  aiPromptLimiter,
  validateBody(AiPromptRequestSchema),
  asyncHandler(streamAiPromptController)
);

projectRouter.get(
  '/:projectId/branches/:branchId/ai/conversations',
  aiReadLimiter,
  asyncHandler(listAiConversationsController)
);

projectRouter.get(
  '/:projectId/branches/:branchId/ai/conversations/:conversationId',
  aiReadLimiter,
  asyncHandler(getAiConversationDetailController)
);

projectRouter.delete(
  '/:projectId/branches/:branchId/ai/conversations/:conversationId',
  aiPromptLimiter,
  asyncHandler(deleteAiConversationController)
);
