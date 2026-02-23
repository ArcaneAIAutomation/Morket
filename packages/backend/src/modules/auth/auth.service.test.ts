import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from './user.repository';
import type { RefreshToken } from './token.repository';

// Mock dependencies
vi.mock('./user.repository', () => ({
  createUser: vi.fn(),
  findByEmail: vi.fn(),
  findById: vi.fn(),
  updatePasswordHash: vi.fn(),
}));

vi.mock('./token.repository', () => ({
  createToken: vi.fn(),
  findByTokenHash: vi.fn(),
  revokeById: vi.fn(),
  revokeAllForUser: vi.fn(),
  countActiveForUser: vi.fn(),
  findOldestActiveForUser: vi.fn(),
  findRevokedByTokenHash: vi.fn(),
}));

vi.mock('../workspace/membership.repository', () => ({
  findFirstForUser: vi.fn(),
}));

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(),
    compare: vi.fn(),
  },
}));

vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn(),
    verify: vi.fn(),
  },
}));

import { register, login, refresh, logout, changePassword, _resetLockoutState, type AuthConfig } from './auth.service';
import { createUser, findByEmail, findById, updatePasswordHash } from './user.repository';
import { createToken, findByTokenHash, revokeById, revokeAllForUser, countActiveForUser, findOldestActiveForUser, findRevokedByTokenHash } from './token.repository';
import { findFirstForUser } from '../workspace/membership.repository';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { ConflictError, AuthenticationError, RateLimitError } from '../../shared/errors';

const mockConfig: AuthConfig = {
  jwtSecret: 'test-secret-that-is-at-least-32-chars-long',
  jwtAccessExpiry: '15m',
  jwtRefreshExpiry: '7d',
};

const mockUser: User = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  passwordHash: '$2b$12$hashedpassword',
  name: 'Test User',
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('auth.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLockoutState();
    // Default: user has a workspace membership
    vi.mocked(findFirstForUser).mockResolvedValue({
      userId: mockUser.id,
      workspaceId: 'ws-uuid-1',
      role: 'member',
      invitedAt: new Date(),
      acceptedAt: new Date(),
    });
    // Default: token limit not exceeded
    vi.mocked(countActiveForUser).mockResolvedValue(1);
    vi.mocked(findRevokedByTokenHash).mockResolvedValue(null);
  });

  describe('register', () => {
    it('should create a user with bcrypt-hashed password (12 rounds)', async () => {
      vi.mocked(findByEmail).mockResolvedValue(null);
      vi.mocked(bcrypt.hash).mockResolvedValue('$2b$12$hashed' as never);
      vi.mocked(createUser).mockResolvedValue(mockUser);

      const result = await register('test@example.com', 'Password123!', 'Test User', mockConfig);

      expect(findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(bcrypt.hash).toHaveBeenCalledWith('Password123!', 12);
      expect(createUser).toHaveBeenCalledWith('test@example.com', '$2b$12$hashed', 'Test User');
      expect(result).toEqual(mockUser);
    });

    it('should throw ConflictError (409) when email already exists', async () => {
      vi.mocked(findByEmail).mockResolvedValue(mockUser);

      await expect(
        register('test@example.com', 'Password123!', 'Test User', mockConfig),
      ).rejects.toThrow(ConflictError);

      expect(createUser).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('should return access and refresh tokens for valid credentials', async () => {
      vi.mocked(findByEmail).mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      vi.mocked(jwt.sign).mockReturnValue('mock-access-token' as never);
      vi.mocked(createToken).mockResolvedValue({
        id: 'token-id',
        userId: mockUser.id,
        tokenHash: 'hashed',
        expiresAt: new Date(),
        revokedAt: null,
        createdAt: new Date(),
      });

      const result = await login('test@example.com', 'Password123!', mockConfig);

      expect(findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(bcrypt.compare).toHaveBeenCalledWith('Password123!', mockUser.passwordHash);
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUser.id,
          jti: expect.any(String),
          role: 'member',
          workspaceId: 'ws-uuid-1',
        }),
        mockConfig.jwtSecret,
        { expiresIn: '15m', issuer: 'morket', audience: 'morket-api' },
      );
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeTruthy();
      expect(typeof result.refreshToken).toBe('string');
      expect(createToken).toHaveBeenCalled();
    });

    it('should throw AuthenticationError for non-existent email', async () => {
      vi.mocked(findByEmail).mockResolvedValue(null);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(
        login('wrong@example.com', 'Password123!', mockConfig),
      ).rejects.toThrow(AuthenticationError);

      // bcrypt.compare should still be called (timing attack prevention)
      expect(bcrypt.compare).toHaveBeenCalled();
    });

    it('should throw AuthenticationError with same message for wrong password', async () => {
      vi.mocked(findByEmail).mockResolvedValue(null);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
      const wrongEmailErr = await login('wrong@example.com', 'x', mockConfig).catch((e) => e);

      vi.mocked(findByEmail).mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
      const wrongPassErr = await login('test@example.com', 'wrong', mockConfig).catch((e) => e);

      // Both should be AuthenticationError with identical message (Req 1.1)
      expect(wrongEmailErr).toBeInstanceOf(AuthenticationError);
      expect(wrongPassErr).toBeInstanceOf(AuthenticationError);
      expect(wrongEmailErr.message).toBe(wrongPassErr.message);
    });

    it('should lock account after 5 failed attempts within 15 minutes', async () => {
      vi.mocked(findByEmail).mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      // 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await login('test@example.com', 'wrong', mockConfig).catch(() => {});
      }

      // 6th attempt should throw RateLimitError
      await expect(
        login('test@example.com', 'wrong', mockConfig),
      ).rejects.toThrow(RateLimitError);
    });

    it('should clear lockout after successful login', async () => {
      vi.mocked(findByEmail).mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      // 3 failed attempts (below threshold)
      for (let i = 0; i < 3; i++) {
        await login('test@example.com', 'wrong', mockConfig).catch(() => {});
      }

      // Successful login
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      vi.mocked(jwt.sign).mockReturnValue('token' as never);
      vi.mocked(createToken).mockResolvedValue({
        id: 'token-id', userId: mockUser.id, tokenHash: 'h',
        expiresAt: new Date(), revokedAt: null, createdAt: new Date(),
      });

      await login('test@example.com', 'Password123!', mockConfig);

      // Now fail again — should start fresh, not be locked
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
      const err = await login('test@example.com', 'wrong', mockConfig).catch((e) => e);
      expect(err).toBeInstanceOf(AuthenticationError);
      expect(err).not.toBeInstanceOf(RateLimitError);
    });

    it('should include role and workspaceId from membership in JWT', async () => {
      vi.mocked(findFirstForUser).mockResolvedValue({
        userId: mockUser.id,
        workspaceId: 'ws-special',
        role: 'admin',
        invitedAt: new Date(),
        acceptedAt: new Date(),
      });
      vi.mocked(findByEmail).mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      vi.mocked(jwt.sign).mockReturnValue('token' as never);
      vi.mocked(createToken).mockResolvedValue({
        id: 'token-id', userId: mockUser.id, tokenHash: 'h',
        expiresAt: new Date(), revokedAt: null, createdAt: new Date(),
      });

      await login('test@example.com', 'Password123!', mockConfig);

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'admin', workspaceId: 'ws-special' }),
        mockConfig.jwtSecret,
        expect.objectContaining({ issuer: 'morket', audience: 'morket-api' }),
      );
    });

    it('should default to member role and empty workspaceId when no membership exists', async () => {
      vi.mocked(findFirstForUser).mockResolvedValue(null);
      vi.mocked(findByEmail).mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      vi.mocked(jwt.sign).mockReturnValue('token' as never);
      vi.mocked(createToken).mockResolvedValue({
        id: 'token-id', userId: mockUser.id, tokenHash: 'h',
        expiresAt: new Date(), revokedAt: null, createdAt: new Date(),
      });

      await login('test@example.com', 'Password123!', mockConfig);

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'member', workspaceId: '' }),
        mockConfig.jwtSecret,
        expect.any(Object),
      );
    });
  });

  describe('refresh', () => {
    const mockStoredToken: RefreshToken = {
      id: 'token-id-1',
      userId: mockUser.id,
      tokenHash: 'stored-hash',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      createdAt: new Date(),
    };

    it('should revoke old token and issue new tokens (rotation)', async () => {
      vi.mocked(findByTokenHash).mockResolvedValue(mockStoredToken);
      vi.mocked(revokeById).mockResolvedValue(undefined);
      vi.mocked(jwt.sign).mockReturnValue('new-access-token' as never);
      vi.mocked(createToken).mockResolvedValue({
        ...mockStoredToken,
        id: 'token-id-2',
        tokenHash: 'new-hash',
      });

      const result = await refresh('raw-refresh-token', mockConfig);

      expect(findByTokenHash).toHaveBeenCalled();
      expect(revokeById).toHaveBeenCalledWith(mockStoredToken.id);
      expect(createToken).toHaveBeenCalled();
      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBeTruthy();
    });

    it('should throw AuthenticationError for invalid refresh token', async () => {
      vi.mocked(findByTokenHash).mockResolvedValue(null);

      await expect(refresh('invalid-token', mockConfig)).rejects.toThrow(AuthenticationError);

      expect(revokeById).not.toHaveBeenCalled();
      expect(createToken).not.toHaveBeenCalled();
    });

    it('should revoke all user tokens on replay detection (Req 1.4, 10.6)', async () => {
      vi.mocked(findByTokenHash).mockResolvedValue(null);
      vi.mocked(findRevokedByTokenHash).mockResolvedValue({ userId: mockUser.id });
      vi.mocked(revokeAllForUser).mockResolvedValue(undefined);

      await expect(refresh('replayed-token', mockConfig)).rejects.toThrow(AuthenticationError);

      expect(findRevokedByTokenHash).toHaveBeenCalled();
      expect(revokeAllForUser).toHaveBeenCalledWith(mockUser.id);
    });

    it('should not revoke all tokens when token is simply unknown (not a replay)', async () => {
      vi.mocked(findByTokenHash).mockResolvedValue(null);
      vi.mocked(findRevokedByTokenHash).mockResolvedValue(null);

      await expect(refresh('unknown-token', mockConfig)).rejects.toThrow(AuthenticationError);

      expect(revokeAllForUser).not.toHaveBeenCalled();
    });

    it('should issue new refresh token with full expiry when within 1 day of expiry (sliding window, Req 10.2)', async () => {
      const nearExpiryToken: RefreshToken = {
        ...mockStoredToken,
        // Expires in 12 hours — within the 1-day sliding window threshold
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      };
      vi.mocked(findByTokenHash).mockResolvedValue(nearExpiryToken);
      vi.mocked(revokeById).mockResolvedValue(undefined);
      vi.mocked(jwt.sign).mockReturnValue('new-access-token' as never);
      vi.mocked(createToken).mockResolvedValue({
        ...mockStoredToken,
        id: 'token-id-2',
        tokenHash: 'new-hash',
      });

      await refresh('raw-refresh-token', mockConfig);

      // createToken should be called with a new expiry ~7 days from now
      const createTokenCall = vi.mocked(createToken).mock.calls[0];
      const newExpiresAt = createTokenCall[2] as Date;
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const diff = Math.abs(newExpiresAt.getTime() - (Date.now() + sevenDaysMs));
      expect(diff).toBeLessThan(5000); // within 5s tolerance
    });

    it('should keep original expiry when token has plenty of time left (Req 10.2)', async () => {
      const farExpiryToken: RefreshToken = {
        ...mockStoredToken,
        // Expires in 5 days — well outside the 1-day threshold
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      };
      vi.mocked(findByTokenHash).mockResolvedValue(farExpiryToken);
      vi.mocked(revokeById).mockResolvedValue(undefined);
      vi.mocked(jwt.sign).mockReturnValue('new-access-token' as never);
      vi.mocked(createToken).mockResolvedValue({
        ...mockStoredToken,
        id: 'token-id-2',
        tokenHash: 'new-hash',
      });

      await refresh('raw-refresh-token', mockConfig);

      // createToken should be called with the original expiry
      const createTokenCall = vi.mocked(createToken).mock.calls[0];
      const newExpiresAt = createTokenCall[2] as Date;
      expect(newExpiresAt.getTime()).toBe(farExpiryToken.expiresAt.getTime());
    });

    it('should enforce token limit after refresh (Req 10.3)', async () => {
      vi.mocked(findByTokenHash).mockResolvedValue(mockStoredToken);
      vi.mocked(revokeById).mockResolvedValue(undefined);
      vi.mocked(jwt.sign).mockReturnValue('new-access-token' as never);
      vi.mocked(createToken).mockResolvedValue({
        ...mockStoredToken,
        id: 'token-id-2',
        tokenHash: 'new-hash',
      });
      vi.mocked(countActiveForUser).mockResolvedValue(11);
      vi.mocked(findOldestActiveForUser).mockResolvedValue({ id: 'oldest-token-id' });

      await refresh('raw-refresh-token', mockConfig);

      expect(countActiveForUser).toHaveBeenCalledWith(mockUser.id);
      expect(findOldestActiveForUser).toHaveBeenCalledWith(mockUser.id);
      expect(revokeById).toHaveBeenCalledWith('oldest-token-id');
    });
  });

  describe('logout', () => {
    it('should revoke the refresh token', async () => {
      const mockStoredToken: RefreshToken = {
        id: 'token-id-1',
        userId: mockUser.id,
        tokenHash: 'stored-hash',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        revokedAt: null,
        createdAt: new Date(),
      };

      vi.mocked(findByTokenHash).mockResolvedValue(mockStoredToken);
      vi.mocked(revokeById).mockResolvedValue(undefined);

      await logout('raw-refresh-token');

      expect(findByTokenHash).toHaveBeenCalled();
      expect(revokeById).toHaveBeenCalledWith(mockStoredToken.id);
    });

    it('should not throw when token is not found', async () => {
      vi.mocked(findByTokenHash).mockResolvedValue(null);

      await expect(logout('unknown-token')).resolves.toBeUndefined();
      expect(revokeById).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('should update password hash and revoke all refresh tokens (Req 1.6)', async () => {
      vi.mocked(findById).mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      vi.mocked(bcrypt.hash).mockResolvedValue('$2b$12$newhash' as never);
      vi.mocked(updatePasswordHash).mockResolvedValue(undefined);
      vi.mocked(revokeAllForUser).mockResolvedValue(undefined);

      await changePassword(mockUser.id, 'OldPassword123!', 'NewPassword456!', mockConfig);

      expect(findById).toHaveBeenCalledWith(mockUser.id);
      expect(bcrypt.compare).toHaveBeenCalledWith('OldPassword123!', mockUser.passwordHash);
      expect(bcrypt.hash).toHaveBeenCalledWith('NewPassword456!', 12);
      expect(updatePasswordHash).toHaveBeenCalledWith(mockUser.id, '$2b$12$newhash');
      expect(revokeAllForUser).toHaveBeenCalledWith(mockUser.id);
    });

    it('should throw AuthenticationError when user not found', async () => {
      vi.mocked(findById).mockResolvedValue(null);

      await expect(
        changePassword('nonexistent-id', 'old', 'new12345', mockConfig),
      ).rejects.toThrow(AuthenticationError);

      expect(updatePasswordHash).not.toHaveBeenCalled();
      expect(revokeAllForUser).not.toHaveBeenCalled();
    });

    it('should throw AuthenticationError when old password is wrong', async () => {
      vi.mocked(findById).mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(
        changePassword(mockUser.id, 'WrongOld!', 'NewPassword456!', mockConfig),
      ).rejects.toThrow(AuthenticationError);

      expect(updatePasswordHash).not.toHaveBeenCalled();
      expect(revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('login token limit', () => {
    it('should enforce token limit after login (Req 10.3)', async () => {
      vi.mocked(findByEmail).mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      vi.mocked(jwt.sign).mockReturnValue('token' as never);
      vi.mocked(createToken).mockResolvedValue({
        id: 'token-id', userId: mockUser.id, tokenHash: 'h',
        expiresAt: new Date(), revokedAt: null, createdAt: new Date(),
      });
      vi.mocked(countActiveForUser).mockResolvedValue(11);
      vi.mocked(findOldestActiveForUser).mockResolvedValue({ id: 'oldest-token-id' });

      await login('test@example.com', 'Password123!', mockConfig);

      expect(countActiveForUser).toHaveBeenCalledWith(mockUser.id);
      expect(findOldestActiveForUser).toHaveBeenCalledWith(mockUser.id);
      expect(revokeById).toHaveBeenCalledWith('oldest-token-id');
    });
  });
});
