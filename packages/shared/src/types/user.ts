/**
 * User permission roles within CodeCollab.
 */
export type UserRole = 'admin' | 'user';

/**
 * Safe public user representation.
 * Never includes passwords or sensitive authentication secrets.
 */
export interface User {
  id: string;
  email: string;
  username: string;
  avatarUrl?: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}
