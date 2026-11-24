import { GoogleGenAI, Type } from '@google/genai';
import type { InventoryItem, InvoiceParseResult, UnitType } from '../core/types';
import { matchInvoiceLineToInventory, roundMoney } from '../core/engine';

function normalizeUnit(rawUnit: string): UnitType {
  const u = (rawUnit || '').toLowerCase().trim();
  if (u.includes('kg') || u.includes('kilo') || u === 'g' || u === 'gm') {
    return 'kg';
  }
  if (u.includes('lit') || u.includes('ltr') || u === 'l' || u === 'ml') {
    return 'litre';
  }
  if (u.includes('pack') || u.includes('pkt') || u.includes('box') || u.includes('tin')) {
    return 'pack';
  }
  return 'pcs';
}

interface RawGeminiInvoice {
  vendorName: string;
  invoiceNumber: string;
  invoiceDate: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  lineItems: {
    rawName: string;
    quantity: number;
    unit: string;
    unitCost: number;
    lineTotal: number;
  }[];
}

export async function parseInvoiceWithGemini(
  imageBase64: string,
  mimeType: string,
  inventory: InventoryItem[]
): Promise<InvoiceParseResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error(
      'GEMINI_API_KEY is not configured in environment secrets. Please configure it in Settings > Secrets.'
    );
    (err as Error & { statusCode?: number }).statusCode = 503;
    throw err;
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const knownInventoryList = inventory
    .map((item) => `${item.name} (${item.unit})`)
    .join(', ');

  const prompt = `You are a precision Indian MSME procurement invoice parser.
Inspect this supplier bill, mandi wholesale receipt, or dairy delivery route slip carefully.
Extract the vendor name, invoice/bill number, date (convert to YYYY-MM-DD format if possible, otherwise use today's date), subtotal, tax/GST amount (0 if none), total amount, and every line item.
For each line item:
- rawName: clear item name in English (for matching against shop inventory such as: ${knownInventoryList}).
- quantity: numeric quantity purchased (if expressed in grams or ml, convert to kg or litre; e.g. 500g = 0.5 kg).
- unit: normalize strictly to one of "kg", "litre", "pcs", or "pack". (Note: if a tin/jar is explicitly billed as e.g. "15 Ltr (Tin)", extract quantity 15 and unit "litre").
- unitCost: unit price per 1 normalized unit in INR.
- lineTotal: total price for that line in INR.`;

  const generateWithRetry = async () => {
    const maxAttempts = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: mimeType || 'image/jpeg',
                  data: imageBase64,
                },
              },
              { text: prompt },
            ],
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                vendorName: {
                  type: Type.STRING,
                  description: 'Name of the wholesale supplier, mandi trader, or dairy vendor.',
                },
                invoiceNumber: {
                  type: Type.STRING,
                  description: 'Invoice, bill, or slip number.',
                },
                invoiceDate: {
                  type: Type.STRING,
                  description: 'Invoice date in YYYY-MM-DD format.',
                },
                subtotal: {
                  type: Type.NUMBER,
                  description: 'Pre-tax subtotal in INR.',
                },
                taxAmount: {
                  type: Type.NUMBER,
                  description: 'GST or tax amount in INR, 0 if none.',
                },
                totalAmount: {
                  type: Type.NUMBER,
                  description: 'Grand total amount in INR.',
                },
                lineItems: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      rawName: { type: Type.STRING },
                      quantity: { type: Type.NUMBER },
                      unit: { type: Type.STRING },
                      unitCost: { type: Type.NUMBER },
                      lineTotal: { type: Type.NUMBER },
                    },
                    required: ['rawName', 'quantity', 'unit', 'unitCost', 'lineTotal'],
                  },
                },
              },
              required: ['vendorName', 'invoiceNumber', 'invoiceDate', 'lineItems'],
            },
          },
        });
      } catch (err) {
        lastErr = err;
        const rawMsg = err instanceof Error ? err.message : String(err);
        const status = (err as { status?: number })?.status;
        const isTransient =
          status === 503 ||
          status === 429 ||
          rawMsg.includes('503') ||
          rawMsg.includes('UNAVAILABLE') ||
          rawMsg.includes('high demand');
        if (isTransient && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, attempt * 900));
          continue;
        }
        // Normalize raw JSON error payloads into a clean human-readable message
        let cleanMsg = rawMsg;
        try {
          const parsedErr = JSON.parse(rawMsg) as { error?: { message?: string; code?: number } };
          if (parsedErr?.error?.message) {
            cleanMsg = parsedErr.error.message;
          }
        } catch {
          // Keep original message if not JSON
        }
        const wrapped = new Error(cleanMsg);
        (wrapped as Error & { statusCode?: number }).statusCode = status || (isTransient ? 503 : 500);
        throw wrapped;
      }
    }
    throw lastErr;
  };

  const response = await generateWithRetry();

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Vision model returned an empty response for this bill image.');
  }

  let parsed: RawGeminiInvoice;
  try {
    parsed = JSON.parse(text) as RawGeminiInvoice;
  } catch {
    throw new Error('Could not parse structured JSON from vision output.');
  }

  const lineItems = (parsed.lineItems || []).map((line) => {
    const qty = Number(line.quantity) > 0 ? Number(line.quantity) : 1;
    const unitCost =
      Number(line.unitCost) >= 0
        ? roundMoney(Number(line.unitCost))
        : roundMoney((Number(line.lineTotal) || 0) / qty);
    const lineTotal =
      Number(line.lineTotal) > 0
        ? roundMoney(Number(line.lineTotal))
        : roundMoney(qty * unitCost);
    const unit = normalizeUnit(line.unit);
    const match = matchInvoiceLineToInventory(line.rawName || '', inventory);

    return {
      rawName: (line.rawName || 'Unnamed Item').trim(),
      quantity: qty,
      unit,
      unitCost,
      lineTotal,
      matchedInventoryId: match.matchedInventoryId,
      matchConfidence: match.matchConfidence,
    };
  });

  const computedSubtotal = roundMoney(
    lineItems.reduce((sum, l) => sum + l.lineTotal, 0)
  );
  const taxAmount = roundMoney(Number(parsed.taxAmount) || 0);
  const subtotal =
    Number(parsed.subtotal) > 0 ? roundMoney(Number(parsed.subtotal)) : computedSubtotal;
  const totalAmount =
    Number(parsed.totalAmount) > 0
      ? roundMoney(Number(parsed.totalAmount))
      : roundMoney(subtotal + taxAmount);

  return {
    vendorName: (parsed.vendorName || 'Unknown Wholesale Vendor').trim(),
    invoiceNumber: (parsed.invoiceNumber || 'UNNUMBERED').trim(),
    invoiceDate: (parsed.invoiceDate || new Date().toISOString().slice(0, 10)).trim(),
    subtotal,
    taxAmount,
    totalAmount,
    lineItems,
  };
}
