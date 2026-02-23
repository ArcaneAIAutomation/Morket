import { describe, it, expect } from 'vitest';
import {
  ALLOWED_FILTER_FIELDS,
  ALLOWED_FILTER_OPERATORS,
  validateFilters,
  validateFilterOperator,
  parseNaturalLanguageQuery,
} from './ai.service';

describe('AI Filter Whitelist Validation', () => {
  describe('ALLOWED_FILTER_FIELDS', () => {
    it('contains all expected field names from FIELD_KEYWORDS', () => {
      const expected = ['email', 'first_name', 'last_name', 'company', 'title', 'phone', 'location', 'industry', 'status'];
      for (const field of expected) {
        expect(ALLOWED_FILTER_FIELDS.has(field)).toBe(true);
      }
      expect(ALLOWED_FILTER_FIELDS.size).toBe(expected.length);
    });
  });

  describe('ALLOWED_FILTER_OPERATORS', () => {
    it('contains all expected operators', () => {
      const expected = ['equals', 'contains', 'starts_with', 'ends_with', 'gt', 'lt', 'gte', 'lte'];
      for (const op of expected) {
        expect(ALLOWED_FILTER_OPERATORS.has(op)).toBe(true);
      }
      expect(ALLOWED_FILTER_OPERATORS.size).toBe(expected.length);
    });
  });

  describe('validateFilters', () => {
    it('returns valid for allowed fields', () => {
      const result = validateFilters({ email: 'test', company: 'acme' });
      expect(result).toEqual({ valid: true, invalidFields: [] });
    });

    it('returns invalid with list of bad fields', () => {
      const result = validateFilters({ email: 'test', ssn: 'x', malicious: 'drop' });
      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain('ssn');
      expect(result.invalidFields).toContain('malicious');
    });

    it('returns valid for empty filters', () => {
      const result = validateFilters({});
      expect(result).toEqual({ valid: true, invalidFields: [] });
    });
  });

  describe('validateFilterOperator', () => {
    it('accepts allowed operators', () => {
      expect(validateFilterOperator('equals')).toBe(true);
      expect(validateFilterOperator('contains')).toBe(true);
      expect(validateFilterOperator('gte')).toBe(true);
    });

    it('rejects disallowed operators', () => {
      expect(validateFilterOperator('DROP TABLE')).toBe(false);
      expect(validateFilterOperator('')).toBe(false);
      expect(validateFilterOperator('like')).toBe(false);
    });
  });

  describe('parseNaturalLanguageQuery strips invalid fields', () => {
    it('returns only whitelisted fields in filters', () => {
      const result = parseNaturalLanguageQuery('email john');
      expect(result.filters).toBeDefined();
      for (const key of Object.keys(result.filters)) {
        expect(ALLOWED_FILTER_FIELDS.has(key)).toBe(true);
      }
    });

    it('parses a valid status keyword', () => {
      const result = parseNaturalLanguageQuery('completed');
      expect(result.filters.status).toBe('completed');
    });
  });
});
