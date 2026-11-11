import { z } from 'zod';

/**
 * Validation rules for new user registration.
 * Shared between our React signup form and Express /api/auth/register route.
 */
export const RegisterSchema = z.object({
  // Normalize case/whitespace at the validation boundary so lookups never miss "User@Mail.com" vs "user@mail.com"
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Please enter a valid email address'),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Username must be at least 3 characters')
    .max(20, 'Username cannot exceed 20 characters')
    .regex(
      /^[a-z0-9_]+$/,
      'Username can only contain letters, numbers, and underscores'
    ),
  // Bcrypt silently truncates UTF-8 inputs beyond 72 bytes, so cap length explicitly at 72 chars
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password cannot exceed 72 characters'),
});

/**
 * Validation rules for login using either email or username.
 */
export const LoginSchema = z.object({
  // Single `identifier` field supports signing in with either email or username
  identifier: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Email or username is required'),
  password: z.string().min(1, 'Password is required'),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
