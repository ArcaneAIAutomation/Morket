import { describe, it, expect } from 'vitest';
import { isValidUUID, isValidSlug, validateRouteParams } from './validateParams';

describe('isValidUUID', () => {
  it('accepts a valid UUID v4', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects a non-UUID string', () => {
    expect(isValidUUID('not-a-uuid')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidUUID('')).toBe(false);
  });

  it('rejects a UUID with wrong version digit', () => {
    // version byte must be 4
    expect(isValidUUID('550e8400-e29b-31d4-a716-446655440000')).toBe(false);
  });

  it('rejects SQL injection attempt', () => {
    expect(isValidUUID("'; DROP TABLE users; --")).toBe(false);
  });

  it('rejects path traversal', () => {
    expect(isValidUUID('../../etc/passwd')).toBe(false);
  });
});

describe('isValidSlug', () => {
  it('accepts a simple alphanumeric slug', () => {
    expect(isValidSlug('my-workspace')).toBe(true);
  });

  it('accepts a single character', () => {
    expect(isValidSlug('a')).toBe(true);
  });

  it('rejects a slug starting with a dash', () => {
    expect(isValidSlug('-bad')).toBe(false);
  });

  it('rejects a slug ending with a dash', () => {
    expect(isValidSlug('bad-')).toBe(false);
  });

  it('rejects a slug with special characters', () => {
    expect(isValidSlug('bad<script>')).toBe(false);
  });

  it('rejects a slug longer than 100 characters', () => {
    expect(isValidSlug('a'.repeat(101))).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidSlug('')).toBe(false);
  });
});

describe('validateRouteParams', () => {
  it('accepts valid workspaceId UUID', () => {
    expect(validateRouteParams({ workspaceId: '550e8400-e29b-41d4-a716-446655440000' })).toBe(true);
  });

  it('rejects invalid workspaceId', () => {
    expect(validateRouteParams({ workspaceId: 'not-a-uuid-at-all' })).toBe(false);
  });

  it('accepts params with Id suffix as UUID', () => {
    expect(validateRouteParams({ jobId: '550e8400-e29b-41d4-a716-446655440000' })).toBe(true);
  });

  it('rejects params with Id suffix that are not UUID', () => {
    expect(validateRouteParams({ jobId: 'injection-attempt' })).toBe(false);
  });

  it('accepts non-ID params as slugs', () => {
    expect(validateRouteParams({ tab: 'workspace' })).toBe(true);
  });

  it('skips undefined values', () => {
    expect(validateRouteParams({ workspaceId: undefined })).toBe(true);
  });

  it('rejects if any param is invalid', () => {
    expect(validateRouteParams({
      workspaceId: '550e8400-e29b-41d4-a716-446655440000',
      tab: '<script>alert(1)</script>',
    })).toBe(false);
  });
});
