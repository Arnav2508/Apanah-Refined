import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  commitPhysicalAudit,
  computeFinancialTelemetry,
  confirmInvoiceIngestion,
  processOrder,
} from './src/core/engine';
import {
  generateTallyDayBookXml,
  generateVyaparPurchasesCsv,
  generateVyaparSalesCsv,
} from './src/core/exports';
import { isValidUpiId } from './src/core/upi';
import type {
  BomComponent,
  CartItemInput,
  ConfirmInvoiceInput,
  InventoryItem,
  PaymentMethod,
  PhysicalCountInput,
} from './src/core/types';
import { parseInvoiceWithGemini } from './src/server/gemini';
import {
  loadStoreState,
  mutateStoreState,
  resetStoreState,
} from './src/server/storage';

export const app = express();

app.use(express.json({ limit: '15mb' }));

app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    const state = await loadStoreState();
    res.json({
      status: 'ok',
      shop: state.meta.shopName,
      inventoryCount: state.inventory.length,
      ordersCount: state.orders.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      error: err instanceof Error ? err.message : 'Health check failed',
    });
  }
});

app.get('/api/state', async (_req: Request, res: Response) => {
  try {
    const state = await loadStoreState();
    const telemetry = computeFinancialTelemetry(state);
    res.json({ state, telemetry });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load store state',
    });
  }
});

app.post('/api/orders', async (req: Request, res: Response) => {
  try {
    const { items, paymentMethod } = req.body as {
      items?: CartItemInput[];
      paymentMethod?: PaymentMethod;
    };

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Order must contain at least one item.' });
      return;
    }

    const validPaymentMethods: PaymentMethod[] = ['UPI', 'CASH', 'CARD'];
    const method: PaymentMethod = validPaymentMethods.includes(
      paymentMethod as PaymentMethod
    )
      ? (paymentMethod as PaymentMethod)
      : 'UPI';

    const { state, result } = await mutateStoreState((current) => {
      const { nextState, order, lowStockAlerts } = processOrder(
        current,
        items,
        method
      );
      return {
        nextState,
        result: { order, lowStockAlerts },
      };
    });

    const telemetry = computeFinancialTelemetry(state);
    res.status(201).json({
      order: result.order,
      lowStockAlerts: result.lowStockAlerts,
      state,
      telemetry,
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Order processing failed',
    });
  }
});

app.post('/api/invoices/parse', async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType, samplePath } = req.body as {
      imageBase64?: string;
      mimeType?: string;
      samplePath?: string;
    };

    let base64Payload = imageBase64 || '';
    let resolvedMime = mimeType || 'image/jpeg';

    if (!base64Payload && samplePath) {
      const safeName = path.basename(samplePath);
      const candidates = [
        path.resolve(process.cwd(), 'src', 'assets', 'images', safeName),
        path.resolve(process.cwd(), 'dist', 'src', 'assets', 'images', safeName),
      ];
      let fileBuffer: Buffer | null = null;
      for (const candidate of candidates) {
        try {
          fileBuffer = await fs.readFile(candidate);
          break;
        } catch {
          // Try next candidate
        }
      }
      if (!fileBuffer) {
        res.status(404).json({ error: 'Sample invoice image not found on server.' });
        return;
      }
      base64Payload = fileBuffer.toString('base64');
      resolvedMime = safeName.endsWith('.png') ? 'image/png' : 'image/jpeg';
    }

    if (!base64Payload) {
      res.status(400).json({ error: 'Please upload or capture an invoice image.' });
      return;
    }

    // Strip data URL prefix if present
    const cleanedBase64 = base64Payload.replace(/^data:[^;]+;base64,/, '');
    const state = await loadStoreState();
    const parsed = await parseInvoiceWithGemini(
      cleanedBase64,
      resolvedMime,
      state.inventory
    );

    res.json({ parsed });
  } catch (err) {
    const status =
      (err as Error & { statusCode?: number })?.statusCode || 500;
    res.status(status).json({
      error:
        err instanceof Error
          ? err.message
          : 'Failed to parse supplier invoice via vision AI',
    });
  }
});

app.post('/api/invoices/confirm', async (req: Request, res: Response) => {
  try {
    const payload = req.body as ConfirmInvoiceInput;
    if (!payload || !Array.isArray(payload.lineItems)) {
      res.status(400).json({ error: 'Invalid invoice confirmation payload.' });
      return;
    }

    const { state, result } = await mutateStoreState((current) => {
      const { nextState, invoice } = confirmInvoiceIngestion(current, payload);
      return { nextState, result: invoice };
    });

    const telemetry = computeFinancialTelemetry(state);
    res.status(201).json({
      invoice: result,
      state,
      telemetry,
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to confirm invoice',
    });
  }
});

app.post('/api/audit', async (req: Request, res: Response) => {
  try {
    const { counts, reason } = req.body as {
      counts?: PhysicalCountInput[];
      reason?: string;
    };

    if (!Array.isArray(counts) || counts.length === 0) {
      res.status(400).json({ error: 'Provide at least one physical stock count.' });
      return;
    }

    const { state, result } = await mutateStoreState((current) => {
      const { nextState, newEntries } = commitPhysicalAudit(
        current,
        counts,
        reason
      );
      return { nextState, result: newEntries };
    });

    const telemetry = computeFinancialTelemetry(state);
    res.status(201).json({
      newEntries: result,
      state,
      telemetry,
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Physical audit failed',
    });
  }
});

app.post('/api/inventory/threshold', async (req: Request, res: Response) => {
  try {
    const { inventoryId, minThreshold } = req.body as {
      inventoryId?: string;
      minThreshold?: number;
    };
    if (!inventoryId || typeof minThreshold !== 'number' || minThreshold < 0) {
      res.status(400).json({ error: 'Valid inventoryId and non-negative minThreshold required.' });
      return;
    }

    const { state } = await mutateStoreState((current) => {
      const updated = current.inventory.map((item) =>
        item.id === inventoryId
          ? { ...item, minThreshold, lastUpdated: new Date().toISOString() }
          : item
      );
      return {
        nextState: { ...current, inventory: updated },
        result: true,
      };
    });

    const telemetry = computeFinancialTelemetry(state);
    res.json({ state, telemetry });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to update threshold',
    });
  }
});

app.post('/api/inventory', async (req: Request, res: Response) => {
  try {
    const { name, tier, unit, currentStock, minThreshold, unitCost } =
      req.body as Partial<InventoryItem>;

    if (!name || !name.trim() || typeof currentStock !== 'number' || typeof unitCost !== 'number') {
      res.status(400).json({ error: 'Name, currentStock, and unitCost are required.' });
      return;
    }

    const newItem: InventoryItem = {
      id: `inv_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 20)}_${Date.now().toString(36)}`,
      name: name.trim(),
      tier: tier === 'retail' ? 'retail' : 'raw',
      unit: unit || 'kg',
      currentStock: Math.max(0, currentStock),
      minThreshold: Math.max(0, minThreshold ?? 2),
      unitCost: Math.max(0, unitCost),
      lastUpdated: new Date().toISOString(),
    };

    const { state } = await mutateStoreState((current) => ({
      nextState: { ...current, inventory: [...current.inventory, newItem] },
      result: newItem,
    }));

    const telemetry = computeFinancialTelemetry(state);
    res.status(201).json({ item: newItem, state, telemetry });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to add inventory item',
    });
  }
});

app.post('/api/menu/:id/bom', async (req: Request, res: Response) => {
  try {
    const dishId = req.params.id;
    const { bom } = req.body as { bom?: BomComponent[] };
    if (!Array.isArray(bom) || bom.length === 0) {
      res.status(400).json({ error: 'Recipe BOM must contain at least one ingredient.' });
      return;
    }

    const { state } = await mutateStoreState((current) => {
      const exists = current.menu.some((m) => m.id === dishId);
      if (!exists) {
        throw new Error(`Menu item ${dishId} not found`);
      }
      const nextMenu = current.menu.map((m) =>
        m.id === dishId ? { ...m, bom } : m
      );
      return { nextState: { ...current, menu: nextMenu }, result: true };
    });

    const telemetry = computeFinancialTelemetry(state);
    res.json({ state, telemetry });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to update recipe BOM',
    });
  }
});

app.post('/api/meta', async (req: Request, res: Response) => {
  try {
    const { shopName, location, gstin, upiId, merchantCode } = req.body as {
      shopName?: string;
      location?: string;
      gstin?: string;
      upiId?: string;
      merchantCode?: string;
    };

    if (!upiId || !isValidUpiId(upiId)) {
      res.status(400).json({
        error: 'Enter a valid owner UPI ID (e.g. shopname@okaxis or 9822xxxxxx@ybl).',
      });
      return;
    }

    const { state } = await mutateStoreState((current) => ({
      nextState: {
        ...current,
        meta: {
          shopName: shopName?.trim() || current.meta.shopName,
          location: location?.trim() || current.meta.location,
          gstin: gstin?.trim() || current.meta.gstin,
          upiId: upiId.trim(),
          merchantCode: merchantCode?.trim() || undefined,
        },
      },
      result: true,
    }));

    const telemetry = computeFinancialTelemetry(state);
    res.json({ state, telemetry });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to update owner payment details',
    });
  }
});

app.post('/api/reset', async (_req: Request, res: Response) => {
  try {
    const state = await resetStoreState();
    const telemetry = computeFinancialTelemetry(state);
    res.json({ state, telemetry });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to reset store',
    });
  }
});

app.get('/api/exports/tally-xml', async (req: Request, res: Response) => {
  try {
    const state = await loadStoreState();
    const xml = generateTallyDayBookXml(state);
    if (req.query.download === '1') {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="apanah-tally-daybook.xml"'
      );
      res.send(xml);
      return;
    }
    res.json({ xml });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to generate Tally XML',
    });
  }
});

app.get('/api/exports/vyapar-sales-csv', async (req: Request, res: Response) => {
  try {
    const state = await loadStoreState();
    const csv = generateVyaparSalesCsv(state);
    if (req.query.download === '1') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="apanah-vyapar-sales.csv"'
      );
      res.send(csv);
      return;
    }
    res.json({ csv });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to generate Vyapar sales CSV',
    });
  }
});

app.get('/api/exports/vyapar-purchases-csv', async (req: Request, res: Response) => {
  try {
    const state = await loadStoreState();
    const csv = generateVyaparPurchasesCsv(state);
    if (req.query.download === '1') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="apanah-vyapar-purchases.csv"'
      );
      res.send(csv);
      return;
    }
    res.json({ csv });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to generate Vyapar purchases CSV',
    });
  }
});

export async function configureFrontendMiddleware() {
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }
}

export async function startServer(port: number = Number(process.env.PORT) || 3000) {
  await configureFrontendMiddleware();
  return app.listen(port, '0.0.0.0', () => {
    console.log(`Apanah server listening on http://0.0.0.0:${port}`);
  });
}

const isServerless = Boolean(
  process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.APANAH_NO_LISTEN
);

if (!isServerless) {
  startServer().catch((err) => {
    console.error('Failed to start Apanah server:', err);
    process.exit(1);
  });
}

export default app;
