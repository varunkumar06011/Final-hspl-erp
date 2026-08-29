import { prisma } from '../config/prisma';

/**
 * A20: Atomic sequential reference number generator.
 *
 * The previous generators read the max existing number and add 1, which
 * races under concurrent requests and causes unique-constraint violations.
 *
 * This helper wraps the read-compute-create cycle in `prisma.$transaction`
 * with a short retry loop. If two concurrent calls pick the same number,
 * the unique constraint on the reference column rejects one of them; the
 * rejected call retries and picks the next available number.
 *
 * Usage:
 *   const poNumber = await generateSequenceNumber(
 *     'purchaseOrder', 'poNumber', 'VGH-PO', 3, { projectId },
 *   );
 */
export async function generateSequenceNumber(
  model: keyof typeof prisma,
  field: string,
  prefix: string,
  padLength: number,
  whereFilter: Record<string, unknown> = {},
  maxRetries = 5,
): Promise<string> {
  const modelDelegate = prisma[model] as unknown as {
    findMany: (args: { where: Record<string, unknown>; select: Record<string, boolean> }) => Promise<Record<string, unknown>[]>;
  };

  const regex = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Read inside a transaction so the read is part of the serializable snapshot.
    const rows = await prisma.$transaction(async (tx) => {
      const txDelegate = (tx as unknown as Record<string, unknown>)[model as string] as {
        findMany: (args: { where: Record<string, unknown>; select: Record<string, boolean> }) => Promise<Record<string, unknown>[]>;
      };
      return txDelegate.findMany({
        where: { [field]: { startsWith: prefix }, ...whereFilter },
        select: { [field]: true },
      });
    });

    const maxNum = rows.reduce((max, row) => {
      const value = String(row[field] ?? '');
      const match = value.match(regex);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);

    const nextNum = maxNum + 1 + attempt;
    const candidate = `${prefix}${String(nextNum).padStart(padLength, '0')}`;

    // Verify the candidate doesn't already exist (handles the race window).
    const conflicting = await modelDelegate.findMany({
      where: { [field]: candidate, ...whereFilter },
      select: { [field]: true },
    });
    if (conflicting.length === 0) {
      return candidate;
    }
  }

  throw new Error(`Failed to generate unique sequence number for ${prefix} after ${maxRetries} attempts`);
}
