// CSV Web Worker — handles parse and generate operations off the main thread

type CSVWorkerRequest =
  | { type: 'parse'; payload: { fileContent: string; columnMappings: Record<string, string> } }
  | { type: 'generate'; payload: { rows: Record<string, unknown>[]; columns: string[] } };

type CSVWorkerResponse =
  | { type: 'parse_result'; payload: { rows: Record<string, unknown>[]; skipped: Array<{ row: number; reason: string }> } }
  | { type: 'generate_result'; payload: { csvContent: string } }
  | { type: 'progress'; payload: { percent: number } }
  | { type: 'error'; payload: { message: string } };

function post(msg: CSVWorkerResponse) {
  self.postMessage(msg);
}

function reportProgress(current: number, total: number) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  post({ type: 'progress', payload: { percent } });
}

function escapeCSVField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

function handleParse(fileContent: string, columnMappings: Record<string, string>) {
  const lines = fileContent.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) {
    post({ type: 'parse_result', payload: { rows: [], skipped: [] } });
    return;
  }

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, unknown>[] = [];
  const skipped: Array<{ row: number; reason: string }> = [];
  const totalDataRows = lines.length - 1;
  const progressInterval = Math.max(1, Math.floor(totalDataRows / 20));

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const row: Record<string, unknown> = {};
    let skipReason = '';

    for (let h = 0; h < headers.length; h++) {
      const sourceCol = headers[h];
      const targetCol = columnMappings[sourceCol];
      if (targetCol) {
        const value = h < fields.length ? fields[h].trim() : '';
        if (!value) {
          skipReason = `Missing value for mapped field "${targetCol}" (source: "${sourceCol}")`;
        }
        row[targetCol] = value;
      }
    }

    if (skipReason) {
      skipped.push({ row: i + 1, reason: skipReason });
    } else {
      rows.push(row);
    }

    if ((i - 1) % progressInterval === 0 || i === lines.length - 1) {
      reportProgress(i, totalDataRows);
    }
  }

  post({ type: 'parse_result', payload: { rows, skipped } });
}

function handleGenerate(rows: Record<string, unknown>[], columns: string[]) {
  const headerLine = columns.map(escapeCSVField).join(',');
  const dataLines: string[] = [];
  const total = rows.length;
  const progressInterval = Math.max(1, Math.floor(total / 20));

  for (let i = 0; i < total; i++) {
    const row = rows[i];
    const line = columns.map((col) => {
      const val = row[col];
      return escapeCSVField(val == null ? '' : String(val));
    }).join(',');
    dataLines.push(line);

    if (i % progressInterval === 0 || i === total - 1) {
      reportProgress(i + 1, total);
    }
  }

  const csvContent = [headerLine, ...dataLines].join('\n');
  post({ type: 'generate_result', payload: { csvContent } });
}

self.onmessage = (e: MessageEvent<CSVWorkerRequest>) => {
  try {
    const { type, payload } = e.data;
    if (type === 'parse') {
      handleParse(payload.fileContent, payload.columnMappings);
    } else if (type === 'generate') {
      handleGenerate(payload.rows, payload.columns);
    }
  } catch (err) {
    post({ type: 'error', payload: { message: err instanceof Error ? err.message : 'Unknown worker error' } });
  }
};
