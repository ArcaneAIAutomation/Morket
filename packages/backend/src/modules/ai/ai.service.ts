import * as aiRepo from './ai.repository';
import { suggestFieldMappings } from './field-mapper';
import { similarity } from './similarity';

// --- Quality Scoring ---

export async function computeQualityScores(workspaceId: string) {
  const records = await aiRepo.fetchRecordsForQualityScoring(workspaceId, 5000);
  let scored = 0;

  for (const record of records) {
    const now = Date.now();
    const updatedAt = new Date(record.updatedAt).getTime();
    const freshnessDays = Math.floor((now - updatedAt) / (1000 * 60 * 60 * 24));

    // Confidence: based on how many output fields are non-null/non-empty
    let filledFields = 0;
    let totalFields = 0;
    if (record.outputData && typeof record.outputData === 'object') {
      for (const [, value] of Object.entries(record.outputData)) {
        totalFields++;
        if (value !== null && value !== undefined && value !== '') filledFields++;
      }
    }
    const confidenceScore = totalFields > 0 ? Math.round((filledFields / totalFields) * 100) : 0;

    // Per-field scores
    const fieldScores: Record<string, string> = {};
    if (record.outputData && typeof record.outputData === 'object') {
      for (const [key, value] of Object.entries(record.outputData)) {
        if (value === null || value === undefined || value === '') {
          fieldScores[key] = 'missing';
        } else if (freshnessDays > 90) {
          fieldScores[key] = 'stale';
        } else {
          fieldScores[key] = 'good';
        }
      }
    }

    await aiRepo.upsertQualityScore(workspaceId, record.id, confidenceScore, freshnessDays, fieldScores);
    scored++;
  }

  return { scored, total: records.length };
}

export async function getQualitySummary(workspaceId: string) {
  return aiRepo.getQualitySummary(workspaceId);
}

export async function getRecordQuality(workspaceId: string, recordId: string) {
  return aiRepo.getQualityScore(workspaceId, recordId);
}

// --- Field Mapping ---

export function suggestMappings(headers: string[]) {
  return suggestFieldMappings(headers);
}

// --- Duplicate Detection ---

export async function detectDuplicates(
  workspaceId: string,
  fields: string[],
  threshold: number,
  limit: number,
) {
  const records = await aiRepo.fetchRecordsForDuplicateDetection(workspaceId, fields, limit);
  const pairs: Array<{ recordA: string; recordB: string; similarity: number }> = [];

  // O(n^2) comparison — acceptable for limit <= 500
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i];
      const b = records[j];

      // Compute average similarity across all fields
      let totalSim = 0;
      for (const field of fields) {
        const valA = a.values[field] || '';
        const valB = b.values[field] || '';
        if (valA === '' && valB === '') continue;
        totalSim += similarity(valA, valB);
      }
      const avgSim = totalSim / fields.length;

      if (avgSim >= threshold) {
        pairs.push({
          recordA: a.id,
          recordB: b.id,
          similarity: Math.round(avgSim * 100) / 100,
        });
      }
    }
  }

  pairs.sort((a, b) => b.similarity - a.similarity);
  return pairs.slice(0, 200);
}

// --- Natural Language Query (keyword-based) ---

const FIELD_KEYWORDS: Record<string, string[]> = {
  email: ['email', 'mail', 'contact'],
  first_name: ['first', 'name', 'given'],
  last_name: ['last', 'surname', 'family'],
  company: ['company', 'org', 'organization', 'business', 'employer'],
  title: ['title', 'role', 'position', 'job'],
  phone: ['phone', 'tel', 'mobile', 'cell', 'number'],
  location: ['location', 'city', 'address', 'where'],
  industry: ['industry', 'sector', 'vertical'],
  status: ['status', 'state', 'completed', 'failed', 'pending'],
};

const STATUS_KEYWORDS: Record<string, string> = {
  completed: 'completed',
  done: 'completed',
  success: 'completed',
  failed: 'failed',
  error: 'failed',
  pending: 'pending',
  waiting: 'pending',
};

export function parseNaturalLanguageQuery(queryStr: string): {
  filters: Record<string, string>;
  interpretation: string;
} {
  const words = queryStr.toLowerCase().split(/\s+/);
  const filters: Record<string, string> = {};
  const interpretations: string[] = [];

  // Check for status keywords
  for (const word of words) {
    if (STATUS_KEYWORDS[word]) {
      filters.status = STATUS_KEYWORDS[word];
      interpretations.push(`status = ${filters.status}`);
      break;
    }
  }

  // Check for field mentions (for future filtering)
  for (const [field, keywords] of Object.entries(FIELD_KEYWORDS)) {
    for (const word of words) {
      if (keywords.includes(word) && !filters[field]) {
        // Extract the word after the keyword as a potential value
        const idx = words.indexOf(word);
        if (idx < words.length - 1) {
          const nextWord = words[idx + 1];
          if (!Object.keys(FIELD_KEYWORDS).some((f) => FIELD_KEYWORDS[f].includes(nextWord))) {
            filters[field] = nextWord;
            interpretations.push(`${field} contains "${nextWord}"`);
          }
        }
      }
    }
  }

  return {
    filters,
    interpretation: interpretations.length > 0
      ? `Searching for records where ${interpretations.join(' and ')}`
      : 'No specific filters detected from query',
  };
}
