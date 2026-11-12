import { z } from 'zod';
import { COLLAB_LIMITS } from '../types/project';

export const SupportedLanguageSchema = z.enum([
  'javascript',
  'typescript',
  'python',
  'cpp',
  'java',
]);

export const ProjectRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export const AssignableProjectRoleSchema = z.enum(['editor', 'viewer']);
export const FileNodeTypeSchema = z.enum(['file', 'folder']);
export const FileAccessPermissionSchema = z.enum([
  'edit',
  'read_only',
  'denied',
]);

const hasControlCharacters = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
};

/**
 * Validates a single file or folder node name.
 * Rejects path separators, "." / "..", and control characters to block path traversal.
 */
export const SafeNodeNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(100, 'Name cannot exceed 100 characters')
  .refine((value) => !value.includes('/') && !value.includes('\\'), {
    message: 'Name cannot contain "/" or "\\"',
  })
  .refine((value) => !hasControlCharacters(value), {
    message: 'Name cannot contain control characters',
  })
  .refine((value) => value !== '.' && value !== '..', {
    message: 'Name cannot be "." or ".."',
  });

/**
 * Validates Git-style workspace branch names (e.g., "main", "feat/auth-v2").
 */
export const BranchNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Branch name is required')
  .max(64, 'Branch name cannot exceed 64 characters')
  .regex(
    /^[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?$/,
    'Branch name must start and end with alphanumeric characters and contain only letters, numbers, ., _, /, or -'
  )
  .refine((value) => !value.includes('..') && !value.includes('//'), {
    message: 'Branch name cannot contain ".." or "//"',
  });

export const CreateProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Project name must be at least 2 characters')
    .max(60, 'Project name cannot exceed 60 characters'),
  description: z
    .string()
    .trim()
    .max(300, 'Description cannot exceed 300 characters')
    .optional(),
  language: SupportedLanguageSchema.default('typescript'),
  isPublic: z.boolean().default(false),
  maxConcurrentEditors: z
    .number()
    .int('Concurrent editor limit must be a whole number')
    .min(
      COLLAB_LIMITS.MIN_CONCURRENT_EDITORS,
      `Editor limit must be at least ${COLLAB_LIMITS.MIN_CONCURRENT_EDITORS}`
    )
    .max(
      COLLAB_LIMITS.MAX_CONCURRENT_EDITORS,
      `Editor limit cannot exceed ${COLLAB_LIMITS.MAX_CONCURRENT_EDITORS}`
    )
    .default(COLLAB_LIMITS.DEFAULT_CONCURRENT_EDITORS),
  preventSameLineEdit: z.boolean().default(false),
});

export const UpdateProjectSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Project name must be at least 2 characters')
      .max(60, 'Project name cannot exceed 60 characters')
      .optional(),
    description: z
      .string()
      .trim()
      .max(300, 'Description cannot exceed 300 characters')
      .nullable()
      .optional(),
    isPublic: z.boolean().optional(),
    maxConcurrentEditors: z
      .number()
      .int('Concurrent editor limit must be a whole number')
      .min(COLLAB_LIMITS.MIN_CONCURRENT_EDITORS)
      .max(COLLAB_LIMITS.MAX_CONCURRENT_EDITORS)
      .optional(),
    preventSameLineEdit: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one project setting must be provided',
  });

export const CreateBranchSchema = z.object({
  name: BranchNameSchema,
  sourceBranchId: z.string().uuid('Invalid source branch ID').optional(),
});

export const UpdateBranchSchema = z
  .object({
    name: BranchNameSchema.optional(),
    isProtected: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one branch field must be provided',
  });

export const CreateFileNodeSchema = z
  .object({
    name: SafeNodeNameSchema,
    nodeType: FileNodeTypeSchema,
    parentId: z.string().uuid('Invalid parent folder ID').nullable().optional(),
    content: z
      .string()
      .max(
        COLLAB_LIMITS.MAX_FILE_CONTENT_CHARS,
        `File content cannot exceed ${COLLAB_LIMITS.MAX_FILE_CONTENT_CHARS} characters`
      )
      .optional(),
  })
  .refine(
    (data) =>
      !(data.nodeType === 'folder' && data.content && data.content.length > 0),
    {
      message: 'Folders cannot contain file content',
      path: ['content'],
    }
  );

export const UpdateFileNodeSchema = z
  .object({
    name: SafeNodeNameSchema.optional(),
    parentId: z.string().uuid('Invalid parent folder ID').nullable().optional(),
    content: z
      .string()
      .max(
        COLLAB_LIMITS.MAX_FILE_CONTENT_CHARS,
        `File content cannot exceed ${COLLAB_LIMITS.MAX_FILE_CONTENT_CHARS} characters`
      )
      .optional(),
    // Optional optimistic concurrency version checked atomically via CAS on REST save
    expectedVersion: z
      .number()
      .int('Version must be a whole number')
      .min(1, 'Version must be at least 1')
      .optional(),
  })
  .refine(
    // Require at least one actual mutation so clients don't bump file `version` with empty PATCHes
    (data) =>
      data.name !== undefined ||
      data.parentId !== undefined ||
      data.content !== undefined,
    {
      message: 'At least one update field (name, parentId, or content) is required',
    }
  );

export const AddProjectMemberSchema = z.object({
  identifier: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Enter a valid username or email address'),
  role: AssignableProjectRoleSchema.default('editor'),
});

export const UpdateProjectMemberRoleSchema = z.object({
  role: AssignableProjectRoleSchema,
});

export const SetFileAccessSchema = z.object({
  userId: z.string().uuid('Invalid collaborator user ID'),
  permission: FileAccessPermissionSchema,
});

export const BranchMergeResolutionSchema = z.enum([
  'take_source',
  'keep_target',
  'custom',
]);

export const MergeBranchSchema = z.object({
  sourceBranchId: z.string().uuid('Invalid source branch ID'),
  resolutions: z.record(z.string(), BranchMergeResolutionSchema).optional(),
  customContents: z
    .record(
      z.string(),
      z.string().max(
        COLLAB_LIMITS.MAX_FILE_CONTENT_CHARS,
        `File content cannot exceed ${COLLAB_LIMITS.MAX_FILE_CONTENT_CHARS} characters`
      )
    )
    .optional(),
  deleteSourceBranch: z.boolean().optional().default(false),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
export type CreateBranchInput = z.infer<typeof CreateBranchSchema>;
export type UpdateBranchInput = z.infer<typeof UpdateBranchSchema>;
export type CreateFileNodeInput = z.infer<typeof CreateFileNodeSchema>;
export type UpdateFileNodeInput = z.infer<typeof UpdateFileNodeSchema>;
export type AddProjectMemberInput = z.infer<typeof AddProjectMemberSchema>;
export type UpdateProjectMemberRoleInput = z.infer<
  typeof UpdateProjectMemberRoleSchema
>;
export type SetFileAccessInput = z.infer<typeof SetFileAccessSchema>;
export type MergeBranchInput = z.infer<typeof MergeBranchSchema>;
