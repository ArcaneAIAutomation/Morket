# Requirements — Module 8.1: AI/ML Intelligence (Backend Integration)

## Overview
Backend APIs that expose AI/ML capabilities: data quality scoring, smart field mapping suggestions, duplicate detection, and natural language queries. The actual ML models run in a separate Python service (planned) — this module provides the backend API layer, data preparation, and result storage.

## Functional Requirements

### 8.1.1 Data Quality Scoring
- Score enrichment records on confidence (0-100) and freshness (days since last enrichment)
- Compute per-field quality indicators (present, stale, conflicting across providers)
- Aggregate quality score per workspace
- Store scores in a dedicated table, recompute on demand or after enrichment

### 8.1.2 Smart Field Mapping
- Given CSV headers, suggest mappings to known enrichment fields
- Uses string similarity (Levenshtein) + known alias dictionary
- Returns ranked suggestions per header with confidence score

### 8.1.3 Duplicate Detection
- Find potential duplicates using fuzzy matching on configurable fields
- Similarity threshold configurable (default 0.8)
- Return duplicate pairs with similarity score
- Leverages existing dedup scan from data-ops but adds fuzzy matching

### 8.1.4 Natural Language Query (Placeholder)
- Accept a natural language query string
- Return structured filter criteria that can be applied to enrichment records
- Initial implementation: keyword extraction + field matching (no LLM)

## Non-Functional Requirements
- All endpoints workspace-scoped under /api/v1/workspaces/:id/ai/
- Zod validation on all inputs
- RBAC: member+ for all endpoints
- Quality scoring is compute-intensive — runs async, returns job ID
