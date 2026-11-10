import { User } from './user';

/**
 * Standard response payload for authenticated endpoints.
 * The JWT itself lives securely in an HttpOnly cookie, not in the JSON body.
 */
export interface AuthResponse {
  user: User;
}
