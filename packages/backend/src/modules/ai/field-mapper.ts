import { similarity } from './similarity';

// Known enrichment field aliases
const FIELD_ALIASES: Record<string, string[]> = {
  email: ['email', 'email_address', 'e-mail', 'mail', 'contact_email', 'work_email'],
  first_name: ['first_name', 'firstname', 'first', 'given_name', 'fname'],
  last_name: ['last_name', 'lastname', 'last', 'surname', 'family_name', 'lname'],
  full_name: ['full_name', 'fullname', 'name', 'contact_name', 'person_name'],
  company: ['company', 'company_name', 'organization', 'org', 'employer', 'business'],
  title: ['title', 'job_title', 'position', 'role', 'designation'],
  phone: ['phone', 'phone_number', 'telephone', 'tel', 'mobile', 'cell', 'contact_number'],
  linkedin_url: ['linkedin', 'linkedin_url', 'linkedin_profile', 'li_url'],
  website: ['website', 'url', 'web', 'homepage', 'company_url', 'domain'],
  location: ['location', 'city', 'address', 'region', 'geo', 'place'],
  industry: ['industry', 'sector', 'vertical', 'business_type'],
  revenue: ['revenue', 'annual_revenue', 'arr', 'company_revenue'],
  employees: ['employees', 'employee_count', 'headcount', 'company_size', 'size'],
  country: ['country', 'nation', 'country_code'],
  state: ['state', 'province', 'region'],
};

export interface FieldSuggestion {
  header: string;
  suggestions: Array<{ field: string; confidence: number }>;
}

/**
 * Suggest field mappings for a list of CSV headers.
 * Returns ranked suggestions per header with confidence scores.
 */
export function suggestFieldMappings(headers: string[]): FieldSuggestion[] {
  return headers.map((header) => {
    const normalized = header.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const suggestions: Array<{ field: string; confidence: number }> = [];

    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      let bestScore = 0;
      for (const alias of aliases) {
        const score = similarity(normalized, alias);
        if (score > bestScore) bestScore = score;
      }
      if (bestScore >= 0.5) {
        suggestions.push({ field, confidence: Math.round(bestScore * 100) });
      }
    }

    suggestions.sort((a, b) => b.confidence - a.confidence);
    return { header, suggestions: suggestions.slice(0, 3) };
  });
}
