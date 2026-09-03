/**
 * CSV export utility — converts an array of records into a CSV string and
 * triggers a browser download. No external dependency.
 *
 * Values containing commas, quotes, or newlines are RFC 4180 quoted.
 */

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Quote if it contains comma, quote, newline, or leading/trailing whitespace.
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export interface CsvColumn {
  key: string;
  label: string;
  /** Optional formatter — e.g. to render a Date or nested field. */
  format?: (row: Record<string, unknown>) => string;
}

/**
 * Build a CSV string from rows + column definitions.
 */
export function buildCsv(rows: Record<string, unknown>[], columns: CsvColumn[]): string {
  const header = columns.map((c) => escapeCsvValue(c.label)).join(',');
  const body = rows
    .map((row) =>
      columns
        .map((c) => escapeCsvValue(c.format ? c.format(row) : row[c.key]))
        .join(','),
    )
    .join('\n');
  return `${header}\n${body}`;
}

/**
 * Trigger a CSV file download in the browser.
 */
export function downloadCsv(filename: string, csv: string): void {
  // Prepend BOM so Excel detects UTF-8 encoding correctly.
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export the current page's rows to CSV.
 *
 * @param endpoint  API list endpoint (e.g. '/pos') — used to fetch all rows.
 * @param columns   Column definitions for the CSV.
 * @param filename  Download filename (without extension).
 * @param search    Current search term (optional — exported rows respect it).
 */
export async function exportToCsv(
  endpoint: string,
  columns: CsvColumn[],
  filename: string,
  search?: string,
): Promise<void> {
  const api = (await import('../config/api')).default;
  const params: Record<string, unknown> = { page: 1, pageSize: 9999 };
  if (search) params.search = search;
  const response = await api.get(endpoint, { params });
  const rows: Record<string, unknown>[] = response.data?.data ?? [];
  if (rows.length === 0) return;
  const csv = buildCsv(rows, columns);
  const stamp = new Date().toISOString().split('T')[0];
  downloadCsv(`${filename}-${stamp}.csv`, csv);
}
