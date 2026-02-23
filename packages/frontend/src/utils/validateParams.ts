/**
 * Validate route parameters to prevent injection via deep links.
 */

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;

export function isValidUUID(value: string): boolean {
  return UUID_V4_REGEX.test(value);
}

export function isValidSlug(value: string): boolean {
  return SLUG_REGEX.test(value) && value.length <= 100;
}

export function validateRouteParams(params: Record<string, string | undefined>): boolean {
  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;

    // Keys ending in 'Id' or equal to 'id' should be UUIDs
    if (key === 'id' || key.endsWith('Id') || key === 'workspaceId') {
      if (!isValidUUID(value)) return false;
    }
    // Other params should be valid slugs
    else {
      if (!isValidSlug(value)) return false;
    }
  }
  return true;
}
