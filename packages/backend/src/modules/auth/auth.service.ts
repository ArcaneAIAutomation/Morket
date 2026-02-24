import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createUser, findByEmail, findById, updatePasswordHash, type User } from './user.repository';
import {
  createToken,
  findByTokenHash,
  revokeById,
  revokeAllForUser,
  countActiveForUser,
  findOldestActiveForUser,
  findRevokedByTokenHash,
} from './token.repository';
import { findFirstForUser } from '../workspace/membership.repository';
import { ConflictError, AuthenticationError, RateLimitError } from '../../shared/errors';
import { logAuthFailure } from '../../observability/logger';

export interface AuthConfig {
  jwtSecret: string;
  jwtAccessExpiry: string;
  jwtRefreshExpiry: string;
}

const BCRYPT_ROUNDS = 12;
const LOCKOUT_MAX_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ACTIVE_REFRESH_TOKENS = 10;
const SLIDING_WINDOW_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 1 day

interface LoginAttemptRecord {
  attempts: number;
  lockedUntil: number | null;
  timestamps: number[];
}

// In-memory account lockout tracking (lost on restart — acceptable for brute-force mitigation)
const loginAttempts = new Map<string, LoginAttemptRecord>();

/** Exported for testing — resets the in-memory lockout state */
export function _resetLockoutState(): void {
  loginAttempts.clear();
}

function recordFailedAttempt(email: string): void {
  const now = Date.now();
  const record = loginAttempts.get(email) || { attempts: 0, lockedUntil: null, timestamps: [] };

  // Prune timestamps outside the window
  record.timestamps = record.timestamps.filter((t) => now - t < LOCKOUT_WINDOW_MS);
  record.timestamps.push(now);
  record.attempts = record.timestamps.length;

  if (record.attempts >= LOCKOUT_MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_WINDOW_MS;
  }

  loginAttempts.set(email, record);
}

function isAccountLocked(email: string): boolean {
  const record = loginAttempts.get(email);
  if (!record || !record.lockedUntil) return false;

  if (Date.now() >= record.lockedUntil) {
    // Lockout expired — clear the record
    loginAttempts.delete(email);
    return false;
  }
  return true;
}

function clearFailedAttempts(email: string): void {
  loginAttempts.delete(email);
}

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

/**
 * Enforces the maximum active refresh token limit per user.
 * If the user has more than MAX_ACTIVE_REFRESH_TOKENS, revokes the oldest.
 */
async function enforceTokenLimit(userId: string): Promise<void> {
  const activeCount = await countActiveForUser(userId);
  if (activeCount > MAX_ACTIVE_REFRESH_TOKENS) {
    const oldest = await findOldestActiveForUser(userId);
    if (oldest) {
      await revokeById(oldest.id);
    }
  }
}

async function generateTokens(
  userId: string,
  config: AuthConfig,
): Promise<{ accessToken: string; refreshToken: string }> {
  // Look up the user's first workspace membership for role and workspaceId claims
  const membership = await findFirstForUser(userId);

  const accessToken = jwt.sign(
    {
      userId,
      jti: crypto.randomUUID(),
      role: membership?.role ?? 'member',
      workspaceId: membership?.workspaceId ?? '',
    },
    config.jwtSecret,
    {
      expiresIn: config.jwtAccessExpiry,
      issuer: 'morket',
      audience: 'morket-api',
    },
  );
  const refreshToken = crypto.randomBytes(40).toString('hex');
  return { accessToken, refreshToken };
}

export async function register(
  email: string,
  password: string,
  name: string,
  _config: AuthConfig,
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
  // Check account lockout before any DB lookup
  if (isAccountLocked(email)) {
    logAuthFailure({
      sourceIp: 'service-layer',
      email: email ? `***${email.slice(-4)}` : undefined,
      reason: 'Account locked due to too many failed attempts',
    });
    throw new RateLimitError('Too many failed login attempts. Please try again later.');
  }

  const user = await findByEmail(email);
  if (!user) {
    // Perform a dummy bcrypt compare to prevent timing-based user enumeration
    await bcrypt.compare(password, '$2b$12$000000000000000000000uGHJzMGDzEBBLmRMvhjOu5WAil1.FUyq');
    recordFailedAttempt(email);
    logAuthFailure({
      sourceIp: 'service-layer',
      email: email ? `***${email.slice(-4)}` : undefined,
      reason: 'Invalid credentials',
    });
    throw new AuthenticationError('Invalid credentials');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    recordFailedAttempt(email);
    logAuthFailure({
      sourceIp: 'service-layer',
      email: email ? `***${email.slice(-4)}` : undefined,
      reason: 'Invalid credentials',
    });
    throw new AuthenticationError('Invalid credentials');
  }

  // Successful login — clear any failed attempt tracking
  clearFailedAttempts(email);

  const { accessToken, refreshToken } = await generateTokens(user.id, config);

  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + parseExpiryToMs(config.jwtRefreshExpiry));
  await createToken(user.id, tokenHash, expiresAt);

  // Enforce max active refresh tokens per user
  await enforceTokenLimit(user.id);

  return { accessToken, refreshToken };
}

export async function refresh(
  refreshToken: string,
  config: AuthConfig,
): Promise<{ accessToken: string; refreshToken: string }> {
  const tokenHash = hashRefreshToken(refreshToken);
  const storedToken = await findByTokenHash(tokenHash);

  if (!storedToken) {
    // Replay detection: token not found — could be a replay attack.
    // Check if this token was previously revoked to identify the user.
    const revokedRecord = await findRevokedByTokenHash(tokenHash);
    if (revokedRecord) {
      // Token was already used and revoked — revoke ALL tokens for this user
      await revokeAllForUser(revokedRecord.userId);
    }
    throw new AuthenticationError('Invalid or expired refresh token');
  }

  // Revoke old token (rotation)
  await revokeById(storedToken.id);

  // Issue new access token always
  const newTokens = await generateTokens(storedToken.userId, config);

  // Sliding window: check if the stored token is within 1 day of expiry.
  // If so, issue a new refresh token with full expiry. Otherwise, reuse the existing expiry window.
  const timeUntilExpiry = storedToken.expiresAt.getTime() - Date.now();
  let newRefreshToken: string;
  let newExpiresAt: Date;

  if (timeUntilExpiry <= SLIDING_WINDOW_THRESHOLD_MS) {
    // Token is near expiry — issue a new refresh token with full expiry
    newRefreshToken = newTokens.refreshToken;
    newExpiresAt = new Date(Date.now() + parseExpiryToMs(config.jwtRefreshExpiry));
  } else {
    // Token still has plenty of time — issue new refresh token but keep original expiry
    newRefreshToken = newTokens.refreshToken;
    newExpiresAt = storedToken.expiresAt;
  }

  const newTokenHash = hashRefreshToken(newRefreshToken);
  await createToken(storedToken.userId, newTokenHash, newExpiresAt);

  // Enforce max active refresh tokens per user
  await enforceTokenLimit(storedToken.userId);

  return { accessToken: newTokens.accessToken, refreshToken: newRefreshToken };
}

export async function logout(refreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken);
  const storedToken = await findByTokenHash(tokenHash);

  if (storedToken) {
    await revokeById(storedToken.id);
  }
  // Always return void — controller handles 204 regardless of token validity
}


export async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string,
  _config: AuthConfig,
): Promise<void> {
  const user = await findById(userId);
  if (!user) {
    throw new AuthenticationError('Invalid credentials');
  }

  const valid = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!valid) {
    throw new AuthenticationError('Invalid credentials');
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await updatePasswordHash(userId, newHash);

  // Revoke all refresh tokens for this user on password change
  await revokeAllForUser(userId);
}
