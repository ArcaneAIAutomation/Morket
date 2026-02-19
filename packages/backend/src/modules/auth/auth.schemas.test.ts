import { describe, it, expect } from 'vitest';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  authTokensResponseSchema,
  userResponseSchema,
} from './auth.schemas';

describe('registerSchema', () => {
  it('accepts valid input', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'password123',
      name: 'John',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = registerSchema.safeParse({
      email: 'not-an-email',
      password: 'password123',
      name: 'John',
    });
    expect(result.success).toBe(false);
  });

  it('rejects short password (< 8 chars)', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'short',
      name: 'John',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'password123',
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing fields', () => {
    const result = registerSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('accepts valid input', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'x',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = loginSchema.safeParse({
      email: 'bad',
      password: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty password', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('refreshSchema', () => {
  it('accepts valid input', () => {
    const result = refreshSchema.safeParse({ refreshToken: 'abc123' });
    expect(result.success).toBe(true);
  });

  it('rejects empty refreshToken', () => {
    const result = refreshSchema.safeParse({ refreshToken: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing refreshToken', () => {
    const result = refreshSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('authTokensResponseSchema', () => {
  it('accepts valid tokens', () => {
    const result = authTokensResponseSchema.safeParse({
      accessToken: 'eyJhbGciOiJIUzI1NiJ9.test.sig',
      refreshToken: 'abc123hex',
    });
    expect(result.success).toBe(true);
  });
});

describe('userResponseSchema', () => {
  it('accepts valid user response', () => {
    const result = userResponseSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'user@example.com',
      name: 'John',
      avatarUrl: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts user with avatarUrl', () => {
    const result = userResponseSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'user@example.com',
      name: 'John',
      avatarUrl: 'https://example.com/avatar.png',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
});
