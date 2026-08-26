/**
 * Shared types for the OCR pipeline.
 *
 * Kept in a separate file so the regex parser (ocr-parser.ts) and the
 * orchestrator (ocr.service.ts) can both import them without creating a
 * circular dependency.
 */

export type OcrDocumentType = 'QUOTATION' | 'INVOICE';

export interface OcrLineItem {
  materialName: string;
  quantity: number;
  unitPrice: number;
  unit?: string;
}

export interface OcrQuotationResult {
  vendorName: string | null;
  quotationNumber: string | null;
  date: string | null;
  lineItems: OcrLineItem[];
  gstAmount: number | null;
  totalAmount: number | null;
  grandTotal: number | null;
}

export interface OcrInvoiceResult {
  vendorName: string | null;
  invoiceNumber: string | null;
  date: string | null;
  amount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  deliveryDate: string | null;
}

export type OcrResult = OcrQuotationResult | OcrInvoiceResult;
