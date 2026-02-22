import crypto from 'crypto';
import * as dataOpsRepo from './data-ops.repository';
import { NotFoundError, ValidationError } from '../../shared/errors';

// --- In-memory import session store ---

interface ImportSession {
  workspaceId: string;
  rows: Array<Record<string, string>>;
  headers: string[];
  validRows: number;
  invalidRows: number;
  errors: Array<{ row: number; message: string }>;
  expiresAt: number;
}

const importSessions = new Map<string, ImportSession>();

// Clean expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of importSessions) {
    if (val.expiresAt < now) importSessions.delete(key);
  }
}, 5 * 60 * 1000).unref();

// --- Import ---

export function previewImport(workspaceId: string, csvContent: string) {
  const lines = csvContent.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new ValidationError('CSV must have a header row and at least one data row');

  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows: Array<Record<string, string>> = [];
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    if (values.length !== headers.length) {
      errors.push({ row: i, message: `Expected ${headers.length} columns, got ${values.length}` });
      continue;
    }
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx]; });
    rows.push(row);
  }

  const sessionId = crypto.randomUUID();
  importSessions.set(sessionId, {
    workspaceId,
    rows,
    headers,
    validRows: rows.length,
    invalidRows: errors.length,
    errors,
    expiresAt: Date.now() + 15 * 60 * 1000, // 15 min TTL
  });

  return {
    sessionId,
    headers,
    preview: rows.slice(0, 10),
    totalRows: lines.length - 1,
    validRows: rows.length,
    invalidRows: errors.length,
    errors: errors.slice(0, 20),
  };
}

export function getImportSession(sessionId: string, workspaceId: string): ImportSession {
  const session = importSessions.get(sessionId);
  if (!session || session.workspaceId !== workspaceId || session.expiresAt < Date.now()) {
    throw new NotFoundError('Import session not found or expired');
  }
  return session;
}

export function clearImportSession(sessionId: string): void {
  importSessions.delete(sessionId);
}

// --- Export ---

export async function exportRecords(
  workspaceId: string,
  format: 'csv' | 'json',
  filters: { status?: string; providerSlug?: string; dateFrom?: string; dateTo?: string },
  limit: number,
) {
  const rows = await dataOpsRepo.queryRecordsForExport(workspaceId, filters, limit);

  if (format === 'json') {
    return { contentType: 'application/json', data: JSON.stringify(rows, null, 2) };
  }

  // CSV format
  if (rows.length === 0) {
    return { contentType: 'text/csv', data: '' };
  }
  const headers = Object.keys(rows[0]);
  const csvLines = [headers.join(',')];
  for (const row of rows) {
    const values = headers.map((h) => {
      const val = row[h];
      if (val === null || val === undefined) return '';
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
    });
    csvLines.push(values.join(','));
  }
  return { contentType: 'text/csv', data: csvLines.join('\n') };
}

// --- Dedup ---

export async function scanDuplicates(workspaceId: string, keyFields: string[]) {
  return dataOpsRepo.scanDuplicates(workspaceId, keyFields);
}

export async function mergeDuplicates(
  workspaceId: string,
  groups: Array<{ survivorId: string; duplicateIds: string[] }>,
  _strategy: string,
  performedBy?: string,
) {
  let totalMerged = 0;
  for (const group of groups) {
    const deleted = await dataOpsRepo.bulkDeleteRecords(workspaceId, group.duplicateIds);
    totalMerged += deleted;
    // Log activity on survivor
    await dataOpsRepo.createActivityEntry({
      workspaceId,
      recordId: group.survivorId,
      action: 'dedup_merge',
      fieldsChanged: { mergedIds: group.duplicateIds },
      performedBy,
    });
  }
  return { groupsProcessed: groups.length, recordsMerged: totalMerged };
}

// --- Hygiene ---

export async function getHygieneStats(workspaceId: string) {
  return dataOpsRepo.getHygieneStats(workspaceId);
}

// --- Bulk Ops ---

export async function bulkDelete(workspaceId: string, recordIds: string[], performedBy?: string) {
  const deleted = await dataOpsRepo.bulkDeleteRecords(workspaceId, recordIds);
  // Log activity for bulk delete
  if (performedBy) {
    for (const id of recordIds.slice(0, 100)) {
      await dataOpsRepo.createActivityEntry({
        workspaceId,
        recordId: id,
        action: 'bulk_delete',
        performedBy,
      });
    }
  }
  return { requested: recordIds.length, deleted };
}

// --- Saved Views ---

export async function listViews(workspaceId: string) {
  return dataOpsRepo.listViews(workspaceId);
}

export async function createView(
  workspaceId: string,
  createdBy: string,
  data: {
    name: string;
    filters: Record<string, unknown>;
    sortConfig: Record<string, unknown>;
    columnVisibility: Record<string, boolean>;
    isDefault: boolean;
  },
) {
  return dataOpsRepo.createView(workspaceId, createdBy, data);
}

export async function updateView(
  workspaceId: string,
  viewId: string,
  data: {
    name?: string;
    filters?: Record<string, unknown>;
    sortConfig?: Record<string, unknown>;
    columnVisibility?: Record<string, boolean>;
    isDefault?: boolean;
  },
) {
  return dataOpsRepo.updateView(workspaceId, viewId, data);
}

export async function deleteView(workspaceId: string, viewId: string) {
  return dataOpsRepo.deleteView(workspaceId, viewId);
}

// --- Activity Log ---

export async function getActivityLog(recordId: string, page: number, limit: number) {
  return dataOpsRepo.getActivityLog(recordId, page, limit);
}
