// ═══════════════════════════════════════════════════════════
// Socket.IO event name constants — used by both frontend and backend
// Never use raw strings for event names; always import from here
// ═══════════════════════════════════════════════════════════

export const SocketEvents = {
  // Vendor
  VENDOR_CREATED: 'vendor:created',
  VENDOR_UPDATED: 'vendor:updated',
  VENDOR_DELETED: 'vendor:deleted',

  // Quotation
  QUOTATION_CREATED: 'quotation:created',
  QUOTATION_UPDATED: 'quotation:updated',
  QUOTATION_APPROVED: 'quotation:approved',
  QUOTATION_REJECTED: 'quotation:rejected',

  // Purchase Order
  PO_CREATED: 'po:created',
  PO_UPDATED: 'po:updated',
  PO_APPROVED: 'po:approved',

  // Invoice
  INVOICE_CREATED: 'invoice:created',
  INVOICE_VERIFIED: 'invoice:verified',

  // Payment
  PAYMENT_REQUEST_CREATED: 'payment:request:created',
  PAYMENT_APPROVED: 'payment:approved',
  PAYMENT_REJECTED: 'payment:rejected',
  PAYMENT_PAID: 'payment:paid',

  // Budget
  BUDGET_CHANGED: 'budget:changed',

  // Gate Pass
  GATE_PASS_CREATED: 'gate-pass:created',
  GATE_PASS_APPROVED: 'gate-pass:approved',

  // Inventory
  INVENTORY_UPDATED: 'inventory:updated',
  LOW_STOCK_ALERT: 'inventory:low-stock',

  // Phase / Activity
  PHASE_UPDATED: 'phase:updated',
  ACTIVITY_UPDATED: 'activity:updated',

  // Issues
  ISSUE_CREATED: 'issue:created',
  ISSUE_UPDATED: 'issue:updated',

  // Inspection
  INSPECTION_UPDATED: 'inspection:updated',

  // Approval
  APPROVAL_STEP_UPDATED: 'approval:step:updated',

  // Notifications
  NOTIFICATION: 'notification',
} as const;

export type SocketEventName = (typeof SocketEvents)[keyof typeof SocketEvents];
