import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';

process.env.APANAH_NO_LISTEN = '1';
const tempStateFile = path.join(os.tmpdir(), `apanah-e2e-${Date.now()}.json`);
process.env.APANAH_STATE_FILE = tempStateFile;

const { app } = await import('../server');

test('End-to-end API flow: health, BOM depletion, invoice confirm, P&L, shrinkage audit, Tally XML', async () => {
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Health check
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { status: string; inventoryCount: number };
    assert.equal(healthJson.status, 'ok');
    assert.ok(healthJson.inventoryCount >= 10);

    // 2. Initial state & P&L check
    const stateRes = await fetch(`${baseUrl}/api/state`);
    assert.equal(stateRes.status, 200);
    const initialData = (await stateRes.json()) as {
      state: { inventory: { id: string; currentStock: number; unitCost: number }[] };
      telemetry: { grossSales: number; totalCogs: number; netOperatingProfit: number };
    };
    const initialGrossSales = initialData.telemetry.grossSales;
    const dalBefore = initialData.state.inventory.find((i) => i.id === 'ing_urad_dal')!.currentStock;

    // 3. Place POS order (4 plates Medu Vada -> 0.20 kg Urad Dal + 0.06 L Oil)
    const orderRes = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ dishId: 'dish_medu_vada', quantity: 4 }],
        paymentMethod: 'UPI',
      }),
    });
    assert.equal(orderRes.status, 201);
    const orderData = (await orderRes.json()) as {
      order: { orderNumber: string; grossTotal: number; totalCogs: number; netProfit: number };
      state: { inventory: { id: string; currentStock: number }[] };
      telemetry: { grossSales: number };
    };
    assert.equal(orderData.order.grossTotal, 180);
    assert.equal(orderData.telemetry.grossSales, initialGrossSales + 180);
    const dalAfterOrder = orderData.state.inventory.find((i) => i.id === 'ing_urad_dal')!.currentStock;
    assert.equal(dalAfterOrder, Math.round((dalBefore - 0.2) * 10000) / 10000);

    // 4. Confirm supplier invoice ingestion (25 kg Urad Dal @ ₹125/kg)
    const invRes = await fetch(`${baseUrl}/api/invoices/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendorName: 'Gultekdi Market Yard Traders',
        invoiceNumber: 'B-9910',
        invoiceDate: '2026-11-23',
        taxAmount: 156.25,
        lineItems: [
          {
            rawName: 'Urad Dal',
            quantity: 25,
            unit: 'kg',
            unitCost: 125,
            matchedInventoryId: 'ing_urad_dal',
          },
        ],
      }),
    });
    assert.equal(invRes.status, 201);
    const invData = (await invRes.json()) as {
      state: { inventory: { id: string; currentStock: number; unitCost: number }[] };
    };
    const dalAfterInv = invData.state.inventory.find((i) => i.id === 'ing_urad_dal')!;
    assert.equal(dalAfterInv.currentStock, Math.round((dalAfterOrder + 25) * 10000) / 10000);
    assert.ok(dalAfterInv.unitCost > 112); // Blended upward toward 125

    // 5. Commit physical count audit (1 kg shrinkage on Urad Dal)
    const targetPhysical = Math.round((dalAfterInv.currentStock - 1) * 10000) / 10000;
    const auditRes = await fetch(`${baseUrl}/api/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        counts: [{ inventoryId: 'ing_urad_dal', physicalStock: targetPhysical }],
        reason: 'Sack moisture & spillage audit',
      }),
    });
    assert.equal(auditRes.status, 201);
    const auditData = (await auditRes.json()) as {
      newEntries: { variance: number; monetaryImpactInr: number }[];
      telemetry: { totalShrinkageLossInr: number };
    };
    assert.equal(auditData.newEntries.length, 1);
    assert.equal(auditData.newEntries[0].variance, -1);
    assert.equal(auditData.newEntries[0].monetaryImpactInr, -dalAfterInv.unitCost);
    assert.ok(auditData.telemetry.totalShrinkageLossInr >= dalAfterInv.unitCost);

    // 6. Export Tally XML Day Book
    const xmlRes = await fetch(`${baseUrl}/api/exports/tally-xml`);
    assert.equal(xmlRes.status, 200);
    const xmlJson = (await xmlRes.json()) as { xml: string };
    assert.ok(xmlJson.xml.includes('<ENVELOPE>'));
    assert.ok(xmlJson.xml.includes(orderData.order.orderNumber));
    assert.ok(xmlJson.xml.includes('B-9910'));
  } finally {
    server.close();
    await fs.unlink(tempStateFile).catch(() => {});
  }
});
