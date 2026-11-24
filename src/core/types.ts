export type InventoryTier = 'raw' | 'retail';

export type UnitType = 'kg' | 'litre' | 'pcs' | 'pack';

export type PaymentMethod = 'UPI' | 'CASH' | 'CARD';

export interface InventoryItem {
  id: string;
  name: string;
  tier: InventoryTier;
  unit: UnitType;
  currentStock: number;
  minThreshold: number;
  unitCost: number; // Weighted-average unit cost in INR
  lastUpdated: string;
}

export interface BomComponent {
  inventoryId: string;
  quantity: number; // In the inventory item's base unit (kg, litre, pcs, pack)
}

export interface MenuDish {
  id: string;
  name: string;
  category: 'QSR Dish' | 'Beverage' | 'Retail SKU';
  sellingPrice: number; // INR
  bom: BomComponent[];
}

export interface CartItemInput {
  dishId: string;
  quantity: number;
}

export interface OrderDepletion {
  inventoryId: string;
  itemName: string;
  quantityUsed: number;
  unit: UnitType;
  costValue: number;
}

export interface OrderLineItem {
  dishId: string;
  dishName: string;
  quantity: number;
  unitPrice: number;
  unitCogs: number;
  lineTotal: number;
  lineCogs: number;
}

export interface OrderRecord {
  id: string;
  orderNumber: string;
  timestamp: string;
  paymentMethod: PaymentMethod;
  items: OrderLineItem[];
  grossTotal: number;
  totalCogs: number;
  netProfit: number;
  grossMarginPct: number;
  depletions: OrderDepletion[];
}

export interface ExtractedInvoiceLine {
  rawName: string;
  quantity: number;
  unit: UnitType;
  unitCost: number;
  lineTotal: number;
  matchedInventoryId: string | null;
  matchConfidence: 'exact' | 'fuzzy' | 'unmatched';
}

export interface InvoiceParseResult {
  vendorName: string;
  invoiceNumber: string;
  invoiceDate: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  lineItems: ExtractedInvoiceLine[];
}

export interface ConfirmInvoiceLineInput {
  rawName: string;
  quantity: number;
  unit: UnitType;
  unitCost: number;
  matchedInventoryId: string | 'NEW';
  newItemTier?: InventoryTier;
  newItemMinThreshold?: number;
}

export interface ConfirmInvoiceInput {
  vendorName: string;
  invoiceNumber: string;
  invoiceDate: string;
  taxAmount: number;
  lineItems: ConfirmInvoiceLineInput[];
}

export interface ConfirmedInvoiceRecord {
  id: string;
  vendorName: string;
  invoiceNumber: string;
  invoiceDate: string;
  confirmedAt: string;
  taxAmount: number;
  totalAmount: number;
  itemsCount: number;
  lines: {
    inventoryId: string;
    itemName: string;
    quantity: number;
    unit: UnitType;
    incomingUnitCost: number;
    previousUnitCost: number;
    blendedUnitCost: number;
  }[];
}

export interface PhysicalCountInput {
  inventoryId: string;
  physicalStock: number;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  inventoryId: string;
  itemName: string;
  unit: UnitType;
  theoreticalStock: number;
  physicalStock: number;
  variance: number; // physical - theoretical
  unitCostAtAudit: number;
  monetaryImpactInr: number; // variance * unitCost
  reason: string;
}

export interface StoreMeta {
  shopName: string;
  location: string;
  gstin: string;
  upiId: string;
  merchantCode?: string;
}

export interface StoreState {
  meta: StoreMeta;
  inventory: InventoryItem[];
  menu: MenuDish[];
  orders: OrderRecord[];
  invoices: ConfirmedInvoiceRecord[];
  audits: AuditEntry[];
}

export interface PaymentMethodSummary {
  method: PaymentMethod;
  total: number;
  count: number;
  sharePct: number;
}

export interface FinancialTelemetry {
  grossSales: number;
  orderCount: number;
  aov: number;
  totalCogs: number;
  netOperatingProfit: number;
  grossMarginPct: number;
  onHandStockValuation: number;
  totalShrinkageLossInr: number;
  paymentSplit: PaymentMethodSummary[];
  lowStockItems: InventoryItem[];
}
