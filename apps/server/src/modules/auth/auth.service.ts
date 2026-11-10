import bcrypt from 'bcryptjs';
import {
  Prisma,
  User as DbUser,
  prisma,
} from '@codecollab/database';
import { LoginInput, RegisterInput, User } from '@codecollab/shared';
import { AppError } from '../../utils/AppError';
import { signAccessToken } from '../../utils/jwt';

const BCRYPT_SALT_ROUNDS = 12;

// Real cost-12 bcrypt hash used to keep failed-login response timing uniform
// when the user does not exist or is an OAuth-only account with passwordHash = null.
const DUMMY_PASSWORD_HASH =
  '$2b$12$qjD4DggasUMzpfCdibGx6OTbnzQm7SnqD2kXjdx0iErxi6E468po.';

/**
 * Converts a raw Prisma User row into the safe public @codecollab/shared User shape.
 * Explicitly strips passwordHash and normalizes enum/date formats.
 */
export const toPublicUser = (dbUser: DbUser): User => ({
  id: dbUser.id,
  email: dbUser.email,
  username: dbUser.username,
  ...(dbUser.avatarUrl ? { avatarUrl: dbUser.avatarUrl } : {}),
  role: dbUser.role === 'ADMIN' ? 'admin' : 'user',
  createdAt: dbUser.createdAt.toISOString(),
  updatedAt: dbUser.updatedAt.toISOString(),
});

export const registerUser = async (
  input: RegisterInput
): Promise<{ user: User; token: string }> => {
  const existingEmail = await prisma.user.findUnique({
    where: { email: input.email },
  });
  if (existingEmail) {
    throw new AppError(
      409,
      'EMAIL_EXISTS',
      'An account with this email already exists'
    );
  }

  const existingUsername = await prisma.user.findUnique({
    where: { username: input.username },
  });
  if (existingUsername) {
    throw new AppError(
      409,
      'USERNAME_EXISTS',
      'This username is already taken'
    );
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);

  try {
    const dbUser = await prisma.user.create({
      data: {
        email: input.email,
        username: input.username,
        passwordHash,
      },
    });

    const token = signAccessToken({ sub: dbUser.id, role: dbUser.role });
    return { user: toPublicUser(dbUser), token };
  } catch (err) {
    // Handle concurrent race condition where two identical signups arrive together
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const targets = Array.isArray(err.meta?.target)
        ? err.meta.target.map(String)
        : [];
      if (targets.includes('email')) {
        throw new AppError(
          409,
          'EMAIL_EXISTS',
          'An account with this email already exists'
        );
      }
      if (targets.includes('username')) {
        throw new AppError(
          409,
          'USERNAME_EXISTS',
          'This username is already taken'
        );
      }
      throw new AppError(
        409,
        'USER_ALREADY_EXISTS',
        'An account with these credentials already exists'
      );
    }
    throw err;
  }
};

export const loginUser = async (
  input: LoginInput
): Promise<{ user: User; token: string }> => {
  const dbUser = input.identifier.includes('@')
    ? await prisma.user.findUnique({ where: { email: input.identifier } })
    : await prisma.user.findUnique({ where: { username: input.identifier } });

  if (!dbUser || !dbUser.passwordHash) {
    await bcrypt.compare(input.password, DUMMY_PASSWORD_HASH);
    throw new AppError(
      401,
      'INVALID_CREDENTIALS',
      'Invalid email/username or password'
    );
  }

  const isPasswordValid = await bcrypt.compare(
    input.password,
    dbUser.passwordHash
  );
  if (!isPasswordValid) {
    throw new AppError(
      401,
      'INVALID_CREDENTIALS',
      'Invalid email/username or password'
    );
  }

  const token = signAccessToken({ sub: dbUser.id, role: dbUser.role });
  return { user: toPublicUser(dbUser), token };
};

export const getUserById = async (userId: string): Promise<User | null> => {
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
  });
  return dbUser ? toPublicUser(dbUser) : null;
};
