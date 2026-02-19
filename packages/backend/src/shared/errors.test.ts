import { describe, it, expect } from 'vitest';
import {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  InsufficientCreditsError,
  RateLimitError,
} from './errors';

describe('AppError', () => {
  it('sets statusCode, code, and message', () => {
    const err = new AppError(500, 'TEST_ERROR', 'something broke');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('TEST_ERROR');
    expect(err.message).toBe('something broke');
    expect(err.name).toBe('AppError');
  });

  it('is an instance of Error', () => {
    const err = new AppError(500, 'TEST', 'msg');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });
});

describe('Error subclasses', () => {
  const cases: Array<{
    Class: new (msg: string) => AppError;
    expectedStatus: number;
    expectedCode: string;
    expectedName: string;
  }> = [
    { Class: ValidationError, expectedStatus: 400, expectedCode: 'VALIDATION_ERROR', expectedName: 'ValidationError' },
    { Class: AuthenticationError, expectedStatus: 401, expectedCode: 'AUTHENTICATION_ERROR', expectedName: 'AuthenticationError' },
    { Class: AuthorizationError, expectedStatus: 403, expectedCode: 'AUTHORIZATION_ERROR', expectedName: 'AuthorizationError' },
    { Class: NotFoundError, expectedStatus: 404, expectedCode: 'NOT_FOUND', expectedName: 'NotFoundError' },
    { Class: ConflictError, expectedStatus: 409, expectedCode: 'CONFLICT', expectedName: 'ConflictError' },
    { Class: InsufficientCreditsError, expectedStatus: 402, expectedCode: 'INSUFFICIENT_CREDITS', expectedName: 'InsufficientCreditsError' },
    { Class: RateLimitError, expectedStatus: 429, expectedCode: 'RATE_LIMIT_EXCEEDED', expectedName: 'RateLimitError' },
  ];

  cases.forEach(({ Class, expectedStatus, expectedCode, expectedName }) => {
    describe(expectedName, () => {
      it(`has status ${expectedStatus} and code ${expectedCode}`, () => {
        const err = new Class('test message');
        expect(err.statusCode).toBe(expectedStatus);
        expect(err.code).toBe(expectedCode);
        expect(err.message).toBe('test message');
        expect(err.name).toBe(expectedName);
      });

      it('is an instance of AppError and Error', () => {
        const err = new Class('test');
        expect(err).toBeInstanceOf(AppError);
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(Class);
      });
    });
  });
});
