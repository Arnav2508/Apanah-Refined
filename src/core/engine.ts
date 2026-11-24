import type {
  AuditEntry,
  CartItemInput,
  ConfirmInvoiceInput,
  ConfirmedInvoiceRecord,
  ExtractedInvoiceLine,
  FinancialTelemetry,
  InventoryItem,
  MenuDish,
  OrderDepletion,
  OrderLineItem,
  OrderRecord,
  PaymentMethod,
  PhysicalCountInput,
  StoreState,
} from './types';

export function roundQty(val: number): number {
  return Math.round(val * 10000) / 10000;
}

export function roundMoney(val: number): number {
  return Math.round(val * 100) / 100;
}

export function calculateBlendedUnitCost(
  oldStock: number,
  oldCost: number,
  incomingStock: number,
  incomingCost: number
): number {
  if (incomingStock <= 0) {
    return roundMoney(oldCost);
  }
  if (oldStock <= 0) {
    return roundMoney(incomingCost);
  }
  const totalStock = oldStock + incomingStock;
  if (totalStock <= 0) {
    return roundMoney(incomingCost);
  }
  const blended = (oldStock * oldCost + incomingStock * incomingCost) / totalStock;
  return roundMoney(blended);
}

export function calculateDishUnitCost(
  dish: MenuDish,
  inventoryMap: Map<string, InventoryItem>
): number {
  let cogs = 0;
  for (const comp of dish.bom) {
    const item = inventoryMap.get(comp.inventoryId);
    if (item) {
      cogs += comp.quantity * item.unitCost;
    }
  }
  return roundMoney(cogs);
}

export function processOrder(
  state: StoreState,
  cartItems: CartItemInput[],
  paymentMethod: PaymentMethod,
  timestamp: string = new Date().toISOString()
): {
  nextState: StoreState;
  order: OrderRecord;
  lowStockAlerts: InventoryItem[];
} {
  const validItems = cartItems.filter((c) => c.quantity > 0);
  if (validItems.length === 0) {
    throw new Error('Cannot process an empty order.');
  }

  const menuMap = new Map<string, MenuDish>(state.menu.map((m) => [m.id, m]));
  const workingInventory: InventoryItem[] = state.inventory.map((item) => ({ ...item }));
  const inventoryMap = new Map<string, InventoryItem>(
    workingInventory.map((item) => [item.id, item])
  );

  const orderLines: OrderLineItem[] = [];
  const depletionAggregator = new Map<string, number>();

  let grossTotal = 0;
  let totalCogs = 0;

  for (const cartItem of validItems) {
    const dish = menuMap.get(cartItem.dishId);
    if (!dish) {
      throw new Error(`Unknown menu item: ${cartItem.dishId}`);
    }

    const unitCogs = calculateDishUnitCost(dish, inventoryMap);
    const lineTotal = roundMoney(dish.sellingPrice * cartItem.quantity);
    const lineCogs = roundMoney(unitCogs * cartItem.quantity);

    grossTotal = roundMoney(grossTotal + lineTotal);
    totalCogs = roundMoney(totalCogs + lineCogs);

    orderLines.push({
      dishId: dish.id,
      dishName: dish.name,
      quantity: cartItem.quantity,
      unitPrice: dish.sellingPrice,
      unitCogs,
      lineTotal,
      lineCogs,
    });

    for (const comp of dish.bom) {
      const prevUsed = depletionAggregator.get(comp.inventoryId) ?? 0;
      depletionAggregator.set(
        comp.inventoryId,
        roundQty(prevUsed + comp.quantity * cartItem.quantity)
      );
    }
  }

  const depletions: OrderDepletion[] = [];
  for (const [inventoryId, quantityUsed] of depletionAggregator.entries()) {
    const item = inventoryMap.get(inventoryId);
    if (!item) continue;

    const costValue = roundMoney(quantityUsed * item.unitCost);
    item.currentStock = Math.max(0, roundQty(item.currentStock - quantityUsed));
    item.lastUpdated = timestamp;

    depletions.push({
      inventoryId: item.id,
      itemName: item.name,
      quantityUsed,
      unit: item.unit,
      costValue,
    });
  }

  const netProfit = roundMoney(grossTotal - totalCogs);
  const grossMarginPct =
    grossTotal > 0 ? roundMoney((netProfit / grossTotal) * 100) : 0;

  const nextOrderNum = 1041 + state.orders.length;
  const order: OrderRecord = {
    id: `ord_${Date.now()}_${state.orders.length + 1}`,
    orderNumber: `APN-${nextOrderNum}`,
    timestamp,
    paymentMethod,
    items: orderLines,
    grossTotal,
    totalCogs,
    netProfit,
    grossMarginPct,
    depletions,
  };

  const lowStockAlerts = workingInventory.filter(
    (item) => item.currentStock <= item.minThreshold
  );

  const nextState: StoreState = {
    ...state,
    inventory: workingInventory,
    orders: [order, ...state.orders],
  };

  return { nextState, order, lowStockAlerts };
}

function normalizeName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchInvoiceLineToInventory(
  rawName: string,
  inventory: InventoryItem[]
): {
  matchedInventoryId: string | null;
  matchConfidence: ExtractedInvoiceLine['matchConfidence'];
} {
  const norm = normalizeName(rawName);
  if (!norm) {
    return { matchedInventoryId: null, matchConfidence: 'unmatched' };
  }

  for (const item of inventory) {
    if (normalizeName(item.name) === norm) {
      return { matchedInventoryId: item.id, matchConfidence: 'exact' };
    }
  }

  const rawTokens = new Set(norm.split(' ').filter((t) => t.length > 1));
  let bestId: string | null = null;
  let bestScore = 0;

  for (const item of inventory) {
    const itemNorm = normalizeName(item.name);
    if (itemNorm.includes(norm) || norm.includes(itemNorm)) {
      return { matchedInventoryId: item.id, matchConfidence: 'fuzzy' };
    }

    const itemTokens = itemNorm.split(' ').filter((t) => t.length > 1);
    let overlap = 0;
    for (const token of itemTokens) {
      if (rawTokens.has(token)) {
        overlap += 1;
      }
    }
    const score = itemTokens.length > 0 ? overlap / itemTokens.length : 0;
    if (score > bestScore && score >= 0.45) {
      bestScore = score;
      bestId = item.id;
    }
  }

  if (bestId) {
    return { matchedInventoryId: bestId, matchConfidence: 'fuzzy' };
  }

  return { matchedInventoryId: null, matchConfidence: 'unmatched' };
}

export function confirmInvoiceIngestion(
  state: StoreState,
  input: ConfirmInvoiceInput,
  confirmedAt: string = new Date().toISOString()
): {
  nextState: StoreState;
  invoice: ConfirmedInvoiceRecord;
} {
  if (!input.vendorName.trim()) {
    throw new Error('Vendor name is required.');
  }
  const validLines = input.lineItems.filter(
    (line) => line.quantity > 0 && line.unitCost >= 0 && line.rawName.trim().length > 0
  );
  if (validLines.length === 0) {
    throw new Error('At least one valid invoice line item is required.');
  }

  const workingInventory: InventoryItem[] = state.inventory.map((item) => ({ ...item }));
  const inventoryMap = new Map<string, InventoryItem>(
    workingInventory.map((item) => [item.id, item])
  );

  const invoiceLines: ConfirmedInvoiceRecord['lines'] = [];
  let lineSubtotal = 0;

  for (const line of validLines) {
    lineSubtotal = roundMoney(lineSubtotal + line.quantity * line.unitCost);

    if (line.matchedInventoryId === 'NEW') {
      const slug = normalizeName(line.rawName).replace(/\s+/g, '_').slice(0, 24);
      const newId = `inv_${slug || 'item'}_${Date.now().toString(36)}`;
      const newItem: InventoryItem = {
        id: newId,
        name: line.rawName.trim(),
        tier: line.newItemTier ?? 'raw',
        unit: line.unit,
        currentStock: roundQty(line.quantity),
        minThreshold: line.newItemMinThreshold ?? 2,
        unitCost: roundMoney(line.unitCost),
        lastUpdated: confirmedAt,
      };
      workingInventory.push(newItem);
      inventoryMap.set(newId, newItem);

      invoiceLines.push({
        inventoryId: newId,
        itemName: newItem.name,
        quantity: roundQty(line.quantity),
        unit: line.unit,
        incomingUnitCost: roundMoney(line.unitCost),
        previousUnitCost: 0,
        blendedUnitCost: roundMoney(line.unitCost),
      });
    } else {
      const existing = inventoryMap.get(line.matchedInventoryId);
      if (!existing) {
        throw new Error(`Matched inventory ID not found: ${line.matchedInventoryId}`);
      }

      const previousUnitCost = existing.unitCost;
      const blendedUnitCost = calculateBlendedUnitCost(
        existing.currentStock,
        existing.unitCost,
        line.quantity,
        line.unitCost
      );

      existing.currentStock = roundQty(existing.currentStock + line.quantity);
      existing.unitCost = blendedUnitCost;
      existing.lastUpdated = confirmedAt;

      invoiceLines.push({
        inventoryId: existing.id,
        itemName: existing.name,
        quantity: roundQty(line.quantity),
        unit: existing.unit,
        incomingUnitCost: roundMoney(line.unitCost),
        previousUnitCost,
        blendedUnitCost,
      });
    }
  }

  const taxAmount = roundMoney(input.taxAmount || 0);
  const totalAmount = roundMoney(lineSubtotal + taxAmount);

  const invoice: ConfirmedInvoiceRecord = {
    id: `inv_${Date.now()}`,
    vendorName: input.vendorName.trim(),
    invoiceNumber: input.invoiceNumber.trim() || `BILL-${state.invoices.length + 101}`,
    invoiceDate: input.invoiceDate || confirmedAt.slice(0, 10),
    confirmedAt,
    taxAmount,
    totalAmount,
    itemsCount: invoiceLines.length,
    lines: invoiceLines,
  };

  return {
    nextState: {
      ...state,
      inventory: workingInventory,
      invoices: [invoice, ...state.invoices],
    },
    invoice,
  };
}

export function commitPhysicalAudit(
  state: StoreState,
  counts: PhysicalCountInput[],
  reason: string = 'Weekly physical stock audit',
  timestamp: string = new Date().toISOString()
): {
  nextState: StoreState;
  newEntries: AuditEntry[];
} {
  if (counts.length === 0) {
    throw new Error('Provide at least one physical count measurement.');
  }

  const workingInventory: InventoryItem[] = state.inventory.map((item) => ({ ...item }));
  const inventoryMap = new Map<string, InventoryItem>(
    workingInventory.map((item) => [item.id, item])
  );

  const newEntries: AuditEntry[] = [];

  for (const count of counts) {
    if (Number.isNaN(count.physicalStock) || count.physicalStock < 0) {
      throw new Error('Physical stock cannot be negative.');
    }

    const item = inventoryMap.get(count.inventoryId);
    if (!item) {
      throw new Error(`Unknown inventory item: ${count.inventoryId}`);
    }

    const theoreticalStock = item.currentStock;
    const physicalStock = roundQty(count.physicalStock);
    const variance = roundQty(physicalStock - theoreticalStock);

    if (Math.abs(variance) < 0.0001) {
      continue;
    }

    const monetaryImpactInr = roundMoney(variance * item.unitCost);
    item.currentStock = physicalStock;
    item.lastUpdated = timestamp;

    newEntries.push({
      id: `aud_${Date.now()}_${newEntries.length + 1}`,
      timestamp,
      inventoryId: item.id,
      itemName: item.name,
      unit: item.unit,
      theoreticalStock,
      physicalStock,
      variance,
      unitCostAtAudit: item.unitCost,
      monetaryImpactInr,
      reason: reason.trim() || 'Physical count reconciliation',
    });
  }

  return {
    nextState: {
      ...state,
      inventory: workingInventory,
      audits: [...newEntries, ...state.audits],
    },
    newEntries,
  };
}

export function computeFinancialTelemetry(state: StoreState): FinancialTelemetry {
  let grossSales = 0;
  let totalCogs = 0;

  const splitMap: Record<PaymentMethod, { total: number; count: number }> = {
    UPI: { total: 0, count: 0 },
    CASH: { total: 0, count: 0 },
    CARD: { total: 0, count: 0 },
  };

  for (const order of state.orders) {
    grossSales = roundMoney(grossSales + order.grossTotal);
    totalCogs = roundMoney(totalCogs + order.totalCogs);
    splitMap[order.paymentMethod].total = roundMoney(
      splitMap[order.paymentMethod].total + order.grossTotal
    );
    splitMap[order.paymentMethod].count += 1;
  }

  const orderCount = state.orders.length;
  const aov = orderCount > 0 ? roundMoney(grossSales / orderCount) : 0;
  const netOperatingProfit = roundMoney(grossSales - totalCogs);
  const grossMarginPct =
    grossSales > 0 ? roundMoney((netOperatingProfit / grossSales) * 100) : 0;

  const onHandStockValuation = roundMoney(
    state.inventory.reduce(
      (sum, item) => sum + item.currentStock * item.unitCost,
      0
    )
  );

  const totalShrinkageLossInr = roundMoney(
    state.audits.reduce(
      (sum, aud) => (aud.monetaryImpactInr < 0 ? sum + Math.abs(aud.monetaryImpactInr) : sum),
      0
    )
  );

  const paymentSplit = (['UPI', 'CASH', 'CARD'] as PaymentMethod[]).map((method) => {
    const entry = splitMap[method];
    return {
      method,
      total: entry.total,
      count: entry.count,
      sharePct: grossSales > 0 ? roundMoney((entry.total / grossSales) * 100) : 0,
    };
  });

  const lowStockItems = state.inventory.filter(
    (item) => item.currentStock <= item.minThreshold
  );

  return {
    grossSales,
    orderCount,
    aov,
    totalCogs,
    netOperatingProfit,
    grossMarginPct,
    onHandStockValuation,
    totalShrinkageLossInr,
    paymentSplit,
    lowStockItems,
  };
}
