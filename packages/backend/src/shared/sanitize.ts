import dns from 'dns';
import { URL } from 'url';

/**
 * HTML entity encodes dangerous characters to prevent XSS.
 * Encodes: & < > " '
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Detects CSV formula injection patterns.
 * Returns true if the trimmed value starts with =, +, -, or @.
 */
export function isFormulaInjection(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  const firstChar = trimmed[0];
  return firstChar === '=' || firstChar === '+' || firstChar === '-' || firstChar === '@';
}

/**
 * Checks if an IPv4 address falls within private/reserved ranges.
 * Rejects: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }

  const [a, b] = parts;

  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 10.0.0.0/8 — private
  if (a === 10) return true;
  // 172.16.0.0/12 — private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 — link-local
  if (a === 169 && b === 254) return true;

  return false;
}

/**
 * Checks if an IPv6 address is loopback (::1) or in the fc00::/7 range (unique local).
 */
function isPrivateIPv6(ip: string): boolean {
  // Normalize by removing brackets if present
  const normalized = ip.replace(/^\[|\]$/g, '');

  // ::1 — loopback
  if (normalized === '::1') return true;

  // fc00::/7 — unique local addresses (fc00:: through fdff::)
  const firstSegment = normalized.split(':')[0].toLowerCase();
  if (firstSegment.startsWith('fc') || firstSegment.startsWith('fd')) return true;

  return false;
}

/**
 * Validates that a URL is safe from SSRF attacks.
 * - Rejects non-http/https schemes
 * - Resolves hostname via DNS
 * - Rejects private/loopback/link-local IP ranges
 * Returns true for safe public URLs, false otherwise.
 */
export async function validateUrlSafety(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);

    // Only allow http and https schemes
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    const hostname = parsed.hostname;

    // Resolve hostname to IP address
    const { address, family } = await dns.promises.lookup(hostname);

    // Check IPv4 private ranges
    if (family === 4 && isPrivateIPv4(address)) {
      return false;
    }

    // Check IPv6 private ranges
    if (family === 6 && isPrivateIPv6(address)) {
      return false;
    }

    return true;
  } catch {
    // DNS failure, invalid URL, or any other error → reject
    return false;
  }
}
