import api from '../config/api';

// The server caps one page at 500 rows.
const PAGE_SIZE = 500;

/**
 * Every ledger of the project, fetched page by page. Ledger pickers filter on
 * the client, so loading only the first page hid ledgers late in the sort
 * order (group, then name), e.g. Unsecured Loans, even when searched for.
 * Returns the list response shape (`{ data }`) the pages already read; the rows
 * are untyped like the raw API response they replace, unless `T` is given.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllLedgers<T = any>(
  params: Record<string, unknown> = {},
): Promise<{ data: T[] }> {
  const all: T[] = [];
  for (let page = 1; ; page++) {
    const response = await api.get('/ledgers', { params: { ...params, page, pageSize: PAGE_SIZE } });
    const rows: T[] = response.data?.data ?? [];
    all.push(...rows);
    const totalPages = Number(response.data?.pagination?.totalPages ?? 1);
    if (rows.length < PAGE_SIZE || page >= totalPages) break;
  }
  return { data: all };
}
