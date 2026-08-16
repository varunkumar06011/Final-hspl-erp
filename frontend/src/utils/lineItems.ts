export interface LineItemInput {
  description: string;
  quantity: number;
  unit: string;
  rate: number;
}

export function parseLineItems(text: string): LineItemInput[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [description, quantity, unit, rate] = line.split('|').map((s) => s.trim());
      return {
        description: description || 'Item',
        quantity: Number(quantity) || 1,
        unit: unit || 'nos',
        rate: Number(rate) || 0,
      };
    });
}

export function lineItemsToText(items: { description: string; quantity: unknown; unit: string; rate: unknown }[]): string {
  return items.map((i) => `${i.description} | ${i.quantity} | ${i.unit} | ${i.rate}`).join('\n');
}

export const LINE_ITEMS_HINT = 'One item per line: Description | Qty | Unit | Rate';
