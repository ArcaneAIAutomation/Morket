import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from './user.repository';
import type { RefreshToken } from './token.repository';

// Mock dependencies
vi.mock('./user.repository', () => ({
  createUser: vi.fn(),
  findByEmail: vi.fn(),
  findById: vi.fn(),
}));

vi.mock('./token.repository', () => ({
  createToken: vi.fn(),
  findByTokenHash: vi.fn(),
  revokeById: vi.fn(),
  revokeAllForUser: vi.fn(),
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

import { register, login, refresh, logout, type AuthConfig } from './auth.service';
import { createUser, findByEmail } from './user.repository';
import { createToken, findByTokenHash, revokeById } from './token.repository';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { ConflictError, AuthenticationError } from '../../shared/errors';

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
        { userId: mockUser.id },
        mockConfig.jwtSecret,
        { expiresIn: '15m' },
      );
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeTruthy();
      expect(typeof result.refreshToken).toBe('string');
      expect(createToken).toHaveBeenCalled();
    });

    it('should throw AuthenticationError for non-existent email', async () => {
      vi.mocked(findByEmail).mockResolvedValue(null);

      await expect(
        login('wrong@example.com', 'Password123!', mockConfig),
      ).rejects.toThrow(AuthenticationError);

      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('should throw AuthenticationError with same message for wrong password', async () => {
      vi.mocked(findByEmail).mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      const wrongEmailErr = await login('wrong@example.com', 'x', mockConfig).catch((e) => e);
      vi.mocked(findByEmail).mockResolvedValue(mockUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
      const wrongPassErr = await login('test@example.com', 'wrong', mockConfig).catch((e) => e);

      // Both should be AuthenticationError with identical message (Req 2.4)
      expect(wrongEmailErr).toBeInstanceOf(AuthenticationError);
      expect(wrongPassErr).toBeInstanceOf(AuthenticationError);
      expect(wrongEmailErr.message).toBe(wrongPassErr.message);
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
});
