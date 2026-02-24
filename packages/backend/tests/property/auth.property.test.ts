import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { AuthConfig } from '../../src/modules/auth/auth.service';
import type { User } from '../../src/modules/auth/user.repository';
import type { RefreshToken } from '../../src/modules/auth/token.repository';

// ── In-memory token store used by mocks ──
let tokenStore: Map<string, RefreshToken>;

// ── Mock user.repository ──
vi.mock('../../src/modules/auth/user.repository', () => ({
  createUser: vi.fn(),
  findByEmail: vi.fn(),
  findById: vi.fn(),
}));

// ── Mock token.repository ──
vi.mock('../../src/modules/auth/token.repository', () => ({
  createToken: vi.fn(),
  findByTokenHash: vi.fn(),
  revokeById: vi.fn(),
  revokeAllForUser: vi.fn(),
  countActiveForUser: vi.fn().mockResolvedValue(0),
  findOldestActiveForUser: vi.fn().mockResolvedValue(null),
  findRevokedByTokenHash: vi.fn().mockResolvedValue(null),
}));

// ── Mock db module to prevent real connections ──
vi.mock('../../src/shared/db', () => ({
  query: vi.fn(),
  getPool: vi.fn(),
}));

// ── Mock membership.repository to prevent real DB calls from generateTokens ──
vi.mock('../../src/modules/workspace/membership.repository', () => ({
  findFirstForUser: vi.fn().mockResolvedValue(null),
}));

import { login, refresh, logout, _resetLockoutState } from '../../src/modules/auth/auth.service';
import { findByEmail } from '../../src/modules/auth/user.repository';
import { createToken, findByTokenHash, revokeById } from '../../src/modules/auth/token.repository';
import { AuthenticationError } from '../../src/shared/errors';

// ── Helpers ──
const TEST_JWT_SECRET = 'test-secret-key-for-property-tests';
const AUTH_CONFIG: AuthConfig = {
  jwtSecret: TEST_JWT_SECRET,
  jwtAccessExpiry: '15m',
  jwtRefreshExpiry: '7d',
};

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    email: overrides.email ?? 'test@example.com',
    passwordHash: overrides.passwordHash ?? '',
    name: overrides.name ?? 'Test User',
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Set up in-memory token store mocks before each test */
function setupTokenMocks(): void {
  tokenStore = new Map();

  vi.mocked(createToken).mockImplementation(
    async (userId: string, tokenHash: string, expiresAt: Date): Promise<RefreshToken> => {
      const token: RefreshToken = {
        id: crypto.randomUUID(),
        userId,
        tokenHash,
        expiresAt,
        revokedAt: null,
        createdAt: new Date(),
      };
      tokenStore.set(tokenHash, token);
      return token;
    },
  );

  vi.mocked(findByTokenHash).mockImplementation(async (tokenHash: string) => {
    const token = tokenStore.get(tokenHash);
    if (!token || token.revokedAt !== null || token.expiresAt <= new Date()) {
      return null;
    }
    return token;
  });

  vi.mocked(revokeById).mockImplementation(async (id: string) => {
    for (const [hash, token] of tokenStore.entries()) {
      if (token.id === id) {
        tokenStore.set(hash, { ...token, revokedAt: new Date() });
        break;
      }
    }
  });
}

// ── Generators ──
const passwordArb = fc.string({ minLength: 1, maxLength: 72 });

const emailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
    fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/),
    fc.constantFrom('com', 'org', 'net', 'io'),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

describe('Feature: core-backend-foundation, Auth Properties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLockoutState();
  });

  /**
   * Property 1: Password hashing round-trip
   * For any password, bcrypt hash then compare returns true.
   * **Validates: Requirements 2.1**
   */
  it('Property 1: Password hashing round-trip', async () => {
    await fc.assert(
      fc.asyncProperty(passwordArb, async (password) => {
        const hash = await bcrypt.hash(password, 12);
        const matches = await bcrypt.compare(password, hash);
        expect(matches).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  /**
   * Property 2: Login token structure
   * For any valid user, login returns access token with correct userId and ~15min expiry.
   * **Validates: Requirements 2.3**
   */
  it('Property 2: Login token structure', async () => {
    await fc.assert(
      fc.asyncProperty(emailArb, passwordArb, async (email, password) => {
        _resetLockoutState();
        setupTokenMocks();

        const passwordHash = await bcrypt.hash(password, 4); // low rounds for speed in tests
        const user = makeUser({ email, passwordHash });

        vi.mocked(findByEmail).mockResolvedValue(user);

        const beforeLogin = Math.floor(Date.now() / 1000);
        const result = await login(email, password, AUTH_CONFIG);
        const afterLogin = Math.floor(Date.now() / 1000);

        // Access token should be a valid JWT
        const decoded = jwt.verify(result.accessToken, TEST_JWT_SECRET) as jwt.JwtPayload;
        expect(decoded.userId).toBe(user.id);

        // Expiry should be ~15 minutes (900 seconds) from now
        expect(decoded.exp).toBeDefined();
        const expectedExpMin = beforeLogin + 900 - 2; // 2s tolerance
        const expectedExpMax = afterLogin + 900 + 2;
        expect(decoded.exp!).toBeGreaterThanOrEqual(expectedExpMin);
        expect(decoded.exp!).toBeLessThanOrEqual(expectedExpMax);

        // Refresh token should be a non-empty string
        expect(result.refreshToken).toBeTruthy();
        expect(typeof result.refreshToken).toBe('string');
        expect(result.refreshToken.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 3: Invalid credentials uniform error
   * For any wrong email or wrong password, response is identical 401.
   * **Validates: Requirements 2.4**
   */
  it('Property 3: Invalid credentials uniform error', async () => {
    await fc.assert(
      fc.asyncProperty(emailArb, passwordArb, passwordArb, async (email, correctPassword, wrongPassword) => {
        fc.pre(correctPassword !== wrongPassword);
        _resetLockoutState();
        setupTokenMocks();

        const passwordHash = await bcrypt.hash(correctPassword, 4);
        const user = makeUser({ email, passwordHash });

        // Case 1: Wrong email (user not found)
        vi.mocked(findByEmail).mockResolvedValue(null);
        let wrongEmailError: AuthenticationError | null = null;
        try {
          await login('nonexistent@example.com', correctPassword, AUTH_CONFIG);
        } catch (e) {
          wrongEmailError = e as AuthenticationError;
        }

        // Case 2: Wrong password (user found, password mismatch)
        vi.mocked(findByEmail).mockResolvedValue(user);
        let wrongPasswordError: AuthenticationError | null = null;
        try {
          await login(email, wrongPassword, AUTH_CONFIG);
        } catch (e) {
          wrongPasswordError = e as AuthenticationError;
        }

        // Both should be AuthenticationError with identical status and message
        expect(wrongEmailError).toBeInstanceOf(AuthenticationError);
        expect(wrongPasswordError).toBeInstanceOf(AuthenticationError);
        expect(wrongEmailError!.statusCode).toBe(401);
        expect(wrongPasswordError!.statusCode).toBe(401);
        expect(wrongEmailError!.message).toBe(wrongPasswordError!.message);
        expect(wrongEmailError!.code).toBe(wrongPasswordError!.code);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 4: Refresh token rotation
   * For any valid refresh token, refresh returns new tokens and old token is rejected.
   * **Validates: Requirements 2.5**
   */
  it('Property 4: Refresh token rotation', async () => {
    await fc.assert(
      fc.asyncProperty(emailArb, passwordArb, async (email, password) => {
        _resetLockoutState();
        setupTokenMocks();

        const passwordHash = await bcrypt.hash(password, 4);
        const user = makeUser({ email, passwordHash });

        vi.mocked(findByEmail).mockResolvedValue(user);

        // Login to get initial tokens
        const loginResult = await login(email, password, AUTH_CONFIG);
        const originalRefreshToken = loginResult.refreshToken;

        // Refresh to get new tokens
        const refreshResult = await refresh(originalRefreshToken, AUTH_CONFIG);

        // New tokens should be different from original
        expect(refreshResult.accessToken).toBeTruthy();
        expect(refreshResult.refreshToken).toBeTruthy();
        expect(refreshResult.refreshToken).not.toBe(originalRefreshToken);

        // New access token should be valid
        const decoded = jwt.verify(refreshResult.accessToken, TEST_JWT_SECRET) as jwt.JwtPayload;
        expect(decoded.userId).toBe(user.id);

        // Old refresh token should now be rejected
        await expect(refresh(originalRefreshToken, AUTH_CONFIG)).rejects.toThrow(AuthenticationError);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 5: Logout invalidates token
   * For any valid refresh token, after logout it is rejected.
   * **Validates: Requirements 2.7**
   */
  it('Property 5: Logout invalidates token', async () => {
    await fc.assert(
      fc.asyncProperty(emailArb, passwordArb, async (email, password) => {
        _resetLockoutState();
        setupTokenMocks();

        const passwordHash = await bcrypt.hash(password, 4);
        const user = makeUser({ email, passwordHash });

        vi.mocked(findByEmail).mockResolvedValue(user);

        // Login to get tokens
        const loginResult = await login(email, password, AUTH_CONFIG);
        const refreshToken = loginResult.refreshToken;

        // Logout with the refresh token
        await logout(refreshToken);

        // Attempting to refresh with the logged-out token should fail
        await expect(refresh(refreshToken, AUTH_CONFIG)).rejects.toThrow(AuthenticationError);
      }),
      { numRuns: 100 },
    );
  });
});
