import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './sanitize';

describe('sanitizeHtml', () => {
  it('escapes ampersands', () => {
    expect(sanitizeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than signs', () => {
    expect(sanitizeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes greater-than signs', () => {
    expect(sanitizeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quotes', () => {
    expect(sanitizeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(sanitizeHtml("it's")).toBe("it&#x27;s");
  });

  it('escapes all dangerous characters in a mixed string', () => {
    expect(sanitizeHtml('<img src="x" onerror=\'alert(1)\'>&')).toBe(
      '&lt;img src=&quot;x&quot; onerror=&#x27;alert(1)&#x27;&gt;&amp;'
    );
  });

  it('returns the same string when no dangerous characters are present', () => {
    expect(sanitizeHtml('hello world 123')).toBe('hello world 123');
  });

  it('handles empty string', () => {
    expect(sanitizeHtml('')).toBe('');
  });
});
