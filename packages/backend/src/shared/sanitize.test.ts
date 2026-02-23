import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sanitizeString, isFormulaInjection, validateUrlSafety } from './sanitize';
import dns from 'dns';

describe('sanitizeString', () => {
  it('encodes ampersand', () => {
    expect(sanitizeString('a&b')).toBe('a&amp;b');
  });

  it('encodes less-than', () => {
    expect(sanitizeString('a<b')).toBe('a&lt;b');
  });

  it('encodes greater-than', () => {
    expect(sanitizeString('a>b')).toBe('a&gt;b');
  });

  it('encodes double quote', () => {
    expect(sanitizeString('a"b')).toBe('a&quot;b');
  });

  it('encodes single quote', () => {
    expect(sanitizeString("a'b")).toBe('a&#x27;b');
  });

  it('encodes all dangerous characters together', () => {
    expect(sanitizeString('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('returns empty string unchanged', () => {
    expect(sanitizeString('')).toBe('');
  });

  it('returns safe string unchanged', () => {
    expect(sanitizeString('hello world 123')).toBe('hello world 123');
  });

  it('encodes ampersand before other entities to avoid double-encoding', () => {
    // & must be replaced first so &lt; doesn't become &amp;lt;
    expect(sanitizeString('&<')).toBe('&amp;&lt;');
  });
});

describe('isFormulaInjection', () => {
  it('detects = prefix', () => {
    expect(isFormulaInjection('=SUM(A1:A10)')).toBe(true);
  });

  it('detects + prefix', () => {
    expect(isFormulaInjection('+1234')).toBe(true);
  });

  it('detects - prefix', () => {
    expect(isFormulaInjection('-1234')).toBe(true);
  });

  it('detects @ prefix', () => {
    expect(isFormulaInjection('@SUM(A1)')).toBe(true);
  });

  it('detects formula with leading whitespace', () => {
    expect(isFormulaInjection('  =SUM(A1)')).toBe(true);
  });

  it('returns false for normal text', () => {
    expect(isFormulaInjection('hello world')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isFormulaInjection('')).toBe(false);
  });

  it('returns false for whitespace-only string', () => {
    expect(isFormulaInjection('   ')).toBe(false);
  });

  it('returns false for number without sign prefix', () => {
    expect(isFormulaInjection('1234')).toBe(false);
  });
});

describe('validateUrlSafety', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects ftp:// scheme', async () => {
    expect(await validateUrlSafety('ftp://example.com/file')).toBe(false);
  });

  it('rejects file:// scheme', async () => {
    expect(await validateUrlSafety('file:///etc/passwd')).toBe(false);
  });

  it('rejects javascript: scheme', async () => {
    expect(await validateUrlSafety('javascript:alert(1)')).toBe(false);
  });

  it('rejects loopback address 127.0.0.1', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: '127.0.0.1', family: 4 });
    expect(await validateUrlSafety('http://localhost/path')).toBe(false);
  });

  it('rejects 10.x.x.x private range', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: '10.0.0.1', family: 4 });
    expect(await validateUrlSafety('http://internal.example.com')).toBe(false);
  });

  it('rejects 172.16.x.x private range', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: '172.16.0.1', family: 4 });
    expect(await validateUrlSafety('http://internal.example.com')).toBe(false);
  });

  it('rejects 192.168.x.x private range', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: '192.168.1.1', family: 4 });
    expect(await validateUrlSafety('http://internal.example.com')).toBe(false);
  });

  it('rejects 169.254.x.x link-local range', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: '169.254.169.254', family: 4 });
    expect(await validateUrlSafety('http://metadata.example.com')).toBe(false);
  });

  it('rejects IPv6 loopback ::1', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: '::1', family: 6 });
    expect(await validateUrlSafety('http://localhost6.example.com')).toBe(false);
  });

  it('rejects IPv6 unique local fc00::', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: 'fc00::1', family: 6 });
    expect(await validateUrlSafety('http://internal6.example.com')).toBe(false);
  });

  it('rejects IPv6 unique local fd00::', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: 'fd12::1', family: 6 });
    expect(await validateUrlSafety('http://internal6.example.com')).toBe(false);
  });

  it('accepts public IP address', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: '93.184.216.34', family: 4 });
    expect(await validateUrlSafety('https://example.com')).toBe(true);
  });

  it('returns false for invalid URL', async () => {
    expect(await validateUrlSafety('not-a-url')).toBe(false);
  });

  it('returns false on DNS resolution failure', async () => {
    vi.spyOn(dns.promises, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));
    expect(await validateUrlSafety('http://nonexistent.invalid')).toBe(false);
  });
});
