import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from './seed';
import {
  calculateBlendedUnitCost,
  commitPhysicalAudit,
  computeFinancialTelemetry,
  confirmInvoiceIngestion,
  matchInvoiceLineToInventory,
  processOrder,
} from './engine';
import {
  generateTallyDayBookXml,
  generateVyaparPurchasesCsv,
  generateVyaparSalesCsv,
} from './exports';
import { buildUpiPaymentUri, isValidUpiId } from './upi';

test('BOM atomic depletion decrements raw ingredients and computes real unit COGS', () => {
  const state = createSeedState();
  const initialDal = state.inventory.find((i) => i.id === 'ing_urad_dal')!.currentStock;
  const initialOil = state.inventory.find((i) => i.id === 'ing_oil')!.currentStock;
  const initialMilk = state.inventory.find((i) => i.id === 'ing_milk')!.currentStock;

  // 2 plates Medu Vada (0.10 kg dal + 0.03 L oil) + 2 Cutting Chai (0.16 L milk + 0.014 kg tea + 0.024 kg sugar)
  const { nextState, order } = processOrder(
    state,
    [
      { dishId: 'dish_medu_vada', quantity: 2 },
      { dishId: 'dish_cutting_chai', quantity: 2 },
    ],
    'UPI'
  );

  assert.equal(order.grossTotal, 120);
  // Medu Vada unit COGS = 0.05*112 + 0.015*130 = 5.6 + 1.95 = 7.55 (x2 = 15.10)
  // Cutting Chai unit COGS = 0.08*60 + 0.007*420 + 0.012*42 = 4.8 + 2.94 + 0.504 = 8.244 -> 8.24 (x2 = 16.48)
  assert.equal(order.totalCogs, 31.58);
  assert.equal(order.netProfit, 88.42);

  const nextDal = nextState.inventory.find((i) => i.id === 'ing_urad_dal')!.currentStock;
  const nextOil = nextState.inventory.find((i) => i.id === 'ing_oil')!.currentStock;
  const nextMilk = nextState.inventory.find((i) => i.id === 'ing_milk')!.currentStock;

  assert.equal(nextDal, Math.round((initialDal - 0.1) * 10000) / 10000);
  assert.equal(nextOil, Math.round((initialOil - 0.03) * 10000) / 10000);
  assert.equal(nextMilk, Math.round((initialMilk - 0.16) * 10000) / 10000);
});

test('Blended weighted-average unit cost computes accurately on invoice ingestion', () => {
  // Old: 10 kg @ ₹100; Incoming: 30 kg @ ₹140 -> (1000 + 4200) / 40 = 130.00
  const blended = calculateBlendedUnitCost(10, 100, 30, 140);
  assert.equal(blended, 130);

  const state = createSeedState();
  const uradBefore = state.inventory.find((i) => i.id === 'ing_urad_dal')!;
  const expectedBlended = calculateBlendedUnitCost(
    uradBefore.currentStock,
    uradBefore.unitCost,
    25,
    118
  );

  const { nextState, invoice } = confirmInvoiceIngestion(state, {
    vendorName: 'Shri Laxmi Kirana & Grains Wholesale',
    invoiceNumber: 'B-1478',
    invoiceDate: '2026-11-23',
    taxAmount: 147.5,
    lineItems: [
      {
        rawName: 'Urad Dal',
        quantity: 25,
        unit: 'kg',
        unitCost: 118,
        matchedInventoryId: 'ing_urad_dal',
      },
    ],
  });

  const uradAfter = nextState.inventory.find((i) => i.id === 'ing_urad_dal')!;
  assert.equal(uradAfter.currentStock, uradBefore.currentStock + 25);
  assert.equal(uradAfter.unitCost, expectedBlended);
  assert.equal(invoice.totalAmount, 25 * 118 + 147.5);
});

test('Invoice line auto-matcher recognizes exact and fuzzy Indian commodity names', () => {
  const state = createSeedState();
  const exact = matchInvoiceLineToInventory('Urad Dal', state.inventory);
  assert.equal(exact.matchedInventoryId, 'ing_urad_dal');
  assert.equal(exact.matchConfidence, 'exact');

  const fuzzy = matchInvoiceLineToInventory('Full Cream Milk 24L', state.inventory);
  assert.equal(fuzzy.matchedInventoryId, 'ing_milk');
  assert.equal(fuzzy.matchConfidence, 'fuzzy');
});

test('Physical audit calculates shrinkage variance and monetary loss accurately', () => {
  const state = createSeedState();
  const milk = state.inventory.find((i) => i.id === 'ing_milk')!;
  const physicalMilk = Math.round((milk.currentStock - 0.5) * 10000) / 10000;

  const { nextState, newEntries } = commitPhysicalAudit(
    state,
    [{ inventoryId: 'ing_milk', physicalStock: physicalMilk }],
    'Morning vessel spillage'
  );

  assert.equal(newEntries.length, 1);
  assert.equal(newEntries[0].variance, -0.5);
  assert.equal(newEntries[0].monetaryImpactInr, -30); // -0.5 * 60 = -30
  assert.equal(
    nextState.inventory.find((i) => i.id === 'ing_milk')!.currentStock,
    physicalMilk
  );
});

test('Financial telemetry and accounting exports (Tally XML + Vyapar CSV) are valid', () => {
  const state = createSeedState();
  const telemetry = computeFinancialTelemetry(state);

  assert.equal(telemetry.orderCount, 3);
  assert.equal(telemetry.grossSales, 355);
  assert.ok(telemetry.onHandStockValuation > 0);
  assert.ok(telemetry.lowStockItems.some((i) => i.id === 'ing_paneer'));

  const xml = generateTallyDayBookXml(state);
  assert.ok(xml.includes('<ENVELOPE>'));
  assert.ok(xml.includes('<LEDGERNAME>UPI Bank Account</LEDGERNAME>'));
  assert.ok(xml.includes('<LEDGERNAME>Counter Sales</LEDGERNAME>'));
  assert.ok(xml.includes('VOUCHER VCHTYPE="Purchase"'));

  const salesCsv = generateVyaparSalesCsv(state);
  assert.ok(salesCsv.includes('Invoice No,Party Name,Payment Mode'));
  assert.ok(salesCsv.includes('APN-1041'));

  const purchCsv = generateVyaparPurchasesCsv(state);
  assert.ok(purchCsv.includes('GAT/2026/0892'));
});

test('Dynamic UPI payment URI validates owner VPA and updates whenever bill amount changes', () => {
  assert.equal(isValidUpiId('sahyadrinashta@okaxis'), true);
  assert.equal(isValidUpiId('9822001122@ybl'), true);
  assert.equal(isValidUpiId('not-a-upi-id'), false);

  const uriA = buildUpiPaymentUri({
    upiId: 'owner@okicici',
    shopName: 'Sahyadri Nashta',
    amount: 45,
    transactionRef: 'APN-1044-1',
    note: 'Bill APN-1044',
  });
  const uriB = buildUpiPaymentUri({
    upiId: 'owner@okicici',
    shopName: 'Sahyadri Nashta',
    amount: 105.5,
    transactionRef: 'APN-1044-2',
    note: 'Bill APN-1044',
  });

  assert.ok(uriA.startsWith('upi://pay?'));
  assert.ok(uriA.includes('pa=owner%40okicici'));
  assert.ok(uriA.includes('am=45.00'));
  assert.ok(uriB.includes('am=105.50'));
  assert.notEqual(uriA, uriB);
});

