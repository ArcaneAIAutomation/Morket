/**
 * OpenSearch index mapping definition for workspace indexes (v1).
 *
 * Each workspace gets its own index named `morket-workspace-{workspaceId}`.
 * The mapping uses a custom `morket_analyzer` with edge_ngram for autocomplete
 * on text fields, while keyword fields support exact-match filtering and aggregations.
 */

export const WORKSPACE_INDEX_PREFIX = 'morket-workspace-';

/**
 * Returns the OpenSearch index name for a given workspace.
 * Deterministic: same workspaceId always produces the same index name.
 */
export function getWorkspaceIndexName(workspaceId: string): string {
  return `${WORKSPACE_INDEX_PREFIX}${workspaceId}`;
}

/**
 * v1 index mapping for workspace documents.
 *
 * Settings:
 *  - 1 shard, 1 replica (suitable for single-node dev; adjust for production)
 *  - `morket_analyzer`: standard tokenizer → lowercase → asciifolding → edge_ngram (2–15)
 *
 * Field strategy:
 *  - Text fields (`name`, `email`, `company`, `job_title`, `location`):
 *      index-time `morket_analyzer` for autocomplete, search-time `standard` for precision,
 *      plus a `.keyword` sub-field for exact match / aggregations.
 *  - Keyword fields: exact match, filtering, and aggregations.
 *  - Date fields: ISO-8601 date parsing.
 *  - `raw_data`: stored but not indexed (enabled: false).
 */
export const WORKSPACE_INDEX_MAPPING_V1 = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 1,
    analysis: {
      filter: {
        edge_ngram_filter: {
          type: 'edge_ngram',
          min_gram: 2,
          max_gram: 15,
        },
      },
      analyzer: {
        morket_analyzer: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'asciifolding', 'edge_ngram_filter'],
        },
      },
    },
  },
  mappings: {
    properties: {
      document_type:      { type: 'keyword' },
      record_id:          { type: 'keyword' },
      workspace_id:       { type: 'keyword' },
      name:               { type: 'text', analyzer: 'morket_analyzer', search_analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
      email:              { type: 'text', analyzer: 'morket_analyzer', search_analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
      company:            { type: 'text', analyzer: 'morket_analyzer', search_analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
      job_title:          { type: 'text', analyzer: 'morket_analyzer', search_analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
      location:           { type: 'text', analyzer: 'morket_analyzer', search_analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
      phone:              { type: 'keyword' },
      domain:             { type: 'keyword' },
      provider_slug:      { type: 'keyword' },
      enrichment_status:  { type: 'keyword' },
      enrichment_fields:  { type: 'keyword' },
      raw_data:           { type: 'object', enabled: false },
      tags:               { type: 'keyword' },
      source_url:         { type: 'keyword' },
      scrape_target_type: { type: 'keyword' },
      created_at:         { type: 'date' },
      updated_at:         { type: 'date' },
    },
  },
} as const;
