import { describe, it, expect } from 'vitest';
import { successResponse, errorResponse, ApiResponse } from './envelope';

describe('successResponse', () => {
  it('wraps data with success envelope', () => {
    const result = successResponse({ id: '123', name: 'test' });
    expect(result).toEqual({
      success: true,
      data: { id: '123', name: 'test' },
      error: null,
    });
  });

  it('includes meta when provided', () => {
    const meta = { page: 1, limit: 10, total: 42 };
    const result = successResponse([1, 2, 3], meta);
    expect(result).toEqual({
      success: true,
      data: [1, 2, 3],
      error: null,
      meta: { page: 1, limit: 10, total: 42 },
    });
  });

  it('omits meta key when not provided', () => {
    const result = successResponse('hello');
    expect(result).not.toHaveProperty('meta');
  });

  it('handles null data', () => {
    const result = successResponse(null);
    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
  });
});

describe('errorResponse', () => {
  it('wraps error code and message with failure envelope', () => {
    const result = errorResponse('VALIDATION_ERROR', 'email is required');
    expect(result).toEqual({
      success: false,
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'email is required' },
    });
  });

  it('always sets success to false and data to null', () => {
    const result = errorResponse('NOT_FOUND', 'resource missing');
    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
  });
});
