import { RequestHandler } from 'express';
import {
  AddProjectMemberInput,
  ApiResponse,
  CreateBranchInput,
  CreateFileNodeInput,
  CreateProjectInput,
  Project,
  ProjectBranchDto,
  ProjectDetailResponse,
  ProjectFileAccessDto,
  ProjectFileDetailDto,
  ProjectFileNodeDto,
  ProjectMemberDto,
  SetFileAccessInput,
  UpdateBranchInput,
  UpdateFileNodeInput,
  UpdateProjectInput,
  UpdateProjectMemberRoleInput,
} from '@codecollab/shared';
import { AppError } from '../../utils/AppError';
import { assertValidUuid } from './project.auth';
import * as projectService from './project.service';

/**
 * HTTP request handlers for `/api/projects`.
 * Controllers stay thin: authenticate user, validate UUID path params, delegate
 * business rules to `projectService`, and wrap outputs in `ApiResponse<T>`.
 */
const requireUserId = (reqUser: Express.Request['user']): string => {
  if (!reqUser) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  return reqUser.id;
};

// --- Projects ---

export const listProjectsController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const projects = await projectService.listUserProjects(userId);
  const response: ApiResponse<{ projects: Project[] }> = {
    success: true,
    data: { projects },
  };
  res.status(200).json(response);
};

export const createProjectController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const input = req.body as CreateProjectInput;
  const detail = await projectService.createProject(userId, input);
  const response: ApiResponse<ProjectDetailResponse> = {
    success: true,
    data: detail,
  };
  res.status(201).json(response);
};

export const getProjectDetailController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const detail = await projectService.getProjectDetail(projectId, userId);
  const response: ApiResponse<ProjectDetailResponse> = {
    success: true,
    data: detail,
  };
  res.status(200).json(response);
};

export const updateProjectController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const input = req.body as UpdateProjectInput;
  const project = await projectService.updateProject(projectId, userId, input);
  const response: ApiResponse<{ project: Project }> = {
    success: true,
    data: { project },
  };
  res.status(200).json(response);
};

export const deleteProjectController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  await projectService.deleteProject(projectId, userId);
  const response: ApiResponse<{ message: string }> = {
    success: true,
    data: { message: 'Workspace deleted successfully' },
  };
  res.status(200).json(response);
};

// --- Collaborators ---

export const addMemberController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const input = req.body as AddProjectMemberInput;
  const member = await projectService.addProjectMember(
    projectId,
    userId,
    input
  );
  const response: ApiResponse<{ member: ProjectMemberDto }> = {
    success: true,
    data: { member },
  };
  res.status(201).json(response);
};

export const updateMemberRoleController: RequestHandler = async (req, res) => {
  const callerId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const targetUserId = assertValidUuid(req.params.userId, 'user');
  const input = req.body as UpdateProjectMemberRoleInput;
  const member = await projectService.updateProjectMemberRole(
    projectId,
    targetUserId,
    callerId,
    input
  );
  const response: ApiResponse<{ member: ProjectMemberDto }> = {
    success: true,
    data: { member },
  };
  res.status(200).json(response);
};

export const removeMemberController: RequestHandler = async (req, res) => {
  const callerId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const targetUserId = assertValidUuid(req.params.userId, 'user');
  await projectService.removeProjectMember(projectId, targetUserId, callerId);
  const response: ApiResponse<{ message: string }> = {
    success: true,
    data: { message: 'Collaborator removed' },
  };
  res.status(200).json(response);
};

// --- Branches ---

export const listBranchesController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const branches = await projectService.listBranches(projectId, userId);
  const response: ApiResponse<{ branches: ProjectBranchDto[] }> = {
    success: true,
    data: { branches },
  };
  res.status(200).json(response);
};

export const createBranchController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const input = req.body as CreateBranchInput;
  const branch = await projectService.createBranch(projectId, userId, input);
  const response: ApiResponse<{ branch: ProjectBranchDto }> = {
    success: true,
    data: { branch },
  };
  res.status(201).json(response);
};

export const updateBranchController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const branchId = assertValidUuid(req.params.branchId, 'branch');
  const input = req.body as UpdateBranchInput;
  const branch = await projectService.updateBranch(
    projectId,
    branchId,
    userId,
    input
  );
  const response: ApiResponse<{ branch: ProjectBranchDto }> = {
    success: true,
    data: { branch },
  };
  res.status(200).json(response);
};

export const deleteBranchController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const branchId = assertValidUuid(req.params.branchId, 'branch');
  await projectService.deleteBranch(projectId, branchId, userId);
  const response: ApiResponse<{ message: string }> = {
    success: true,
    data: { message: 'Branch deleted' },
  };
  res.status(200).json(response);
};

// --- Files, Folders & Locks ---

export const listBranchFilesController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const branchId = assertValidUuid(req.params.branchId, 'branch');
  const files = await projectService.listBranchFiles(
    projectId,
    branchId,
    userId
  );
  const response: ApiResponse<{ files: ProjectFileNodeDto[] }> = {
    success: true,
    data: { files },
  };
  res.status(200).json(response);
};

export const getFileDetailController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const branchId = assertValidUuid(req.params.branchId, 'branch');
  const fileId = assertValidUuid(req.params.fileId, 'file');
  const file = await projectService.getFileDetail(
    projectId,
    branchId,
    fileId,
    userId
  );
  const response: ApiResponse<{ file: ProjectFileDetailDto }> = {
    success: true,
    data: { file },
  };
  res.status(200).json(response);
};

export const createFileNodeController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const branchId = assertValidUuid(req.params.branchId, 'branch');
  const input = req.body as CreateFileNodeInput;
  const file = await projectService.createFileNode(
    projectId,
    branchId,
    userId,
    input
  );
  const response: ApiResponse<{ file: ProjectFileDetailDto }> = {
    success: true,
    data: { file },
  };
  res.status(201).json(response);
};

export const updateFileNodeController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const branchId = assertValidUuid(req.params.branchId, 'branch');
  const fileId = assertValidUuid(req.params.fileId, 'file');
  const input = req.body as UpdateFileNodeInput;
  const file = await projectService.updateFileNode(
    projectId,
    branchId,
    fileId,
    userId,
    input
  );
  const response: ApiResponse<{ file: ProjectFileDetailDto }> = {
    success: true,
    data: { file },
  };
  res.status(200).json(response);
};

export const deleteFileNodeController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const branchId = assertValidUuid(req.params.branchId, 'branch');
  const fileId = assertValidUuid(req.params.fileId, 'file');
  await projectService.deleteFileNode(projectId, branchId, fileId, userId);
  const response: ApiResponse<{ message: string }> = {
    success: true,
    data: { message: 'Deleted successfully' },
  };
  res.status(200).json(response);
};

export const lockFileNodeController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const branchId = assertValidUuid(req.params.branchId, 'branch');
  const fileId = assertValidUuid(req.params.fileId, 'file');
  const file = await projectService.lockFileNode(
    projectId,
    branchId,
    fileId,
    userId
  );
  const response: ApiResponse<{ file: ProjectFileNodeDto }> = {
    success: true,
    data: { file },
  };
  res.status(200).json(response);
};

export const unlockFileNodeController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const branchId = assertValidUuid(req.params.branchId, 'branch');
  const fileId = assertValidUuid(req.params.fileId, 'file');
  const file = await projectService.unlockFileNode(
    projectId,
    branchId,
    fileId,
    userId
  );
  const response: ApiResponse<{ file: ProjectFileNodeDto }> = {
    success: true,
    data: { file },
  };
  res.status(200).json(response);
};

// --- Per-File Collaborator ACLs ---

export const listFileAccessController: RequestHandler = async (req, res) => {
  const userId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const branchId = assertValidUuid(req.params.branchId, 'branch');
  const fileId = assertValidUuid(req.params.fileId, 'file');
  const rules = await projectService.listFileAccessRules(
    projectId,
    branchId,
    fileId,
    userId
  );
  const response: ApiResponse<{ rules: ProjectFileAccessDto[] }> = {
    success: true,
    data: { rules },
  };
  res.status(200).json(response);
};

export const setFileAccessController: RequestHandler = async (req, res) => {
  const callerId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const branchId = assertValidUuid(req.params.branchId, 'branch');
  const fileId = assertValidUuid(req.params.fileId, 'file');
  const input = req.body as SetFileAccessInput;
  const rule = await projectService.setFileAccessRule(
    projectId,
    branchId,
    fileId,
    callerId,
    input
  );
  const response: ApiResponse<{ rule: ProjectFileAccessDto }> = {
    success: true,
    data: { rule },
  };
  res.status(200).json(response);
};

export const removeFileAccessController: RequestHandler = async (req, res) => {
  const callerId = requireUserId(req.user);
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const branchId = assertValidUuid(req.params.branchId, 'branch');
  const fileId = assertValidUuid(req.params.fileId, 'file');
  const targetUserId = assertValidUuid(req.params.userId, 'user');
  await projectService.removeFileAccessRule(
    projectId,
    branchId,
    fileId,
    targetUserId,
    callerId
  );
  const response: ApiResponse<{ message: string }> = {
    success: true,
    data: { message: 'File access rule removed' },
  };
  res.status(200).json(response);
};
