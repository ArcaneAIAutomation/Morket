import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createUser, findByEmail, type User } from './user.repository';
import { createToken, findByTokenHash, revokeById } from './token.repository';
import { ConflictError, AuthenticationError } from '../../shared/errors';

export interface AuthConfig {
  jwtSecret: string;
  jwtAccessExpiry: string;
  jwtRefreshExpiry: string;
}

const BCRYPT_ROUNDS = 12;

function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseExpiryToMs(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid expiry format: ${expiry}`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * multipliers[unit];
}

function generateTokens(userId: string, config: AuthConfig): { accessToken: string; refreshToken: string } {
  const accessToken = jwt.sign({ userId }, config.jwtSecret, {
    expiresIn: config.jwtAccessExpiry,
  });
  const refreshToken = crypto.randomBytes(40).toString('hex');
  return { accessToken, refreshToken };
}

export async function register(
  email: string,
  password: string,
  name: string,
  config: AuthConfig,
): Promise<User> {
  const existing = await findByEmail(email);
  if (existing) {
    throw new ConflictError('Email already registered');
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  return createUser(email, passwordHash, name);
}

export async function login(
  email: string,
  password: string,
  config: AuthConfig,
): Promise<{ accessToken: string; refreshToken: string }> {
  const user = await findByEmail(email);
  if (!user) {
    throw new AuthenticationError('Invalid credentials');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new AuthenticationError('Invalid credentials');
  }

  const { accessToken, refreshToken } = generateTokens(user.id, config);

  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + parseExpiryToMs(config.jwtRefreshExpiry));
  await createToken(user.id, tokenHash, expiresAt);

  return { accessToken, refreshToken };
}

export async function refresh(
  refreshToken: string,
  config: AuthConfig,
): Promise<{ accessToken: string; refreshToken: string }> {
  const tokenHash = hashRefreshToken(refreshToken);
  const storedToken = await findByTokenHash(tokenHash);

  if (!storedToken) {
    throw new AuthenticationError('Invalid or expired refresh token');
  }

  // Revoke old token (rotation)
  await revokeById(storedToken.id);

  // Issue new tokens
  const newTokens = generateTokens(storedToken.userId, config);
  const newTokenHash = hashRefreshToken(newTokens.refreshToken);
  const expiresAt = new Date(Date.now() + parseExpiryToMs(config.jwtRefreshExpiry));
  await createToken(storedToken.userId, newTokenHash, expiresAt);

  return newTokens;
}

export async function logout(refreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken);
  const storedToken = await findByTokenHash(tokenHash);

  if (storedToken) {
    await revokeById(storedToken.id);
  }
}
