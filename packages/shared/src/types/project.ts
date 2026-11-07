/**
 * Supported programming languages for Monaco syntax highlighting
 * and Docker sandbox execution.
 */
export type SupportedLanguage = 
  | 'javascript' 
  | 'typescript' 
  | 'python' 
  | 'cpp' 
  | 'java';

/**
 * Access levels for collaborators inside a project workspace.
 */
export type ProjectRole = 'owner' | 'editor' | 'viewer';

/**
 * Core project workspace model.
 */
export interface Project {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  language: SupportedLanguage;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}
