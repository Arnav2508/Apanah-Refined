import React, { useMemo, useRef, useState } from 'react';
import { Camera, CheckCircle2, FileText, Upload } from 'lucide-react';
import type {
  ConfirmInvoiceInput,
  ConfirmInvoiceLineInput,
  ConfirmedInvoiceRecord,
  InventoryItem,
  InventoryTier,
  InvoiceParseResult,
  UnitType,
} from '../core/types';
import { calculateBlendedUnitCost, roundMoney } from '../core/engine';
import { formatDateShort, formatInr, formatQty } from '../utils/format';

interface BillScanViewProps {
  inventory: InventoryItem[];
  invoices: ConfirmedInvoiceRecord[];
  onConfirmInvoice: (payload: ConfirmInvoiceInput) => Promise<void>;
}

const SAMPLE_BILLS = [
  {
    id: 'mandi',
    title: 'Gultekdi Market Yard Bill',
    subtitle: 'Handwritten wholesale grain & oil bill',
    imagePath: '/src/assets/images/sample_mandi_invoice_1795494676608.jpg',
    fileName: 'sample_mandi_invoice_1795494676608.jpg',
  },
  {
    id: 'dairy',
    title: 'Pune Dairy Route Slip',
    subtitle: 'Thermal printed daily milk & paneer slip',
    imagePath: '/src/assets/images/sample_dairy_slip_1795494677375.jpg',
    fileName: 'sample_dairy_slip_1795494677375.jpg',
  },
];

interface DraftLineState {
  rawName: string;
  quantity: number;
  unit: UnitType;
  unitCost: number;
  matchedInventoryId: string | 'NEW';
  newItemTier: InventoryTier;
  matchConfidence: 'exact' | 'fuzzy' | 'unmatched';
}

export const BillScanView: React.FC<BillScanViewProps> = ({
  inventory,
  invoices,
  onConfirmInvoice,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string>(SAMPLE_BILLS[0].imagePath);
  const [selectedSampleFile, setSelectedSampleFile] = useState<string | null>(
    SAMPLE_BILLS[0].fileName
  );
  const [uploadedBase64, setUploadedBase64] = useState<string | null>(null);
  const [uploadedMime, setUploadedMime] = useState<string>('image/jpeg');

  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const [vendorName, setVendorName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [taxAmount, setTaxAmount] = useState<number>(0);
  const [draftLines, setDraftLines] = useState<DraftLineState[] | null>(null);

  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmSuccess, setConfirmSuccess] = useState<string | null>(null);

  const inventoryMap = useMemo(
    () => new Map(inventory.map((i) => [i.id, i])),
    [inventory]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setConfirmSuccess(null);
    setSelectedSampleFile(null);
    setUploadedMime(file.type || 'image/jpeg');

    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      setPreviewUrl(result);
      setUploadedBase64(result);
    };
    reader.readAsDataURL(file);
  };

  const handleSelectSample = (sample: (typeof SAMPLE_BILLS)[number]) => {
    setParseError(null);
    setConfirmSuccess(null);
    setUploadedBase64(null);
    setPreviewUrl(sample.imagePath);
    setSelectedSampleFile(sample.fileName);
  };

  const handleExtractBill = async () => {
    if (isParsing) return;
    setIsParsing(true);
    setParseError(null);
    setConfirmSuccess(null);

    try {
      const res = await fetch('/api/invoices/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          uploadedBase64
            ? { imageBase64: uploadedBase64, mimeType: uploadedMime }
            : { samplePath: selectedSampleFile }
        ),
      });

      const data = (await res.json()) as {
        parsed?: InvoiceParseResult;
        error?: string;
      };

      if (!res.ok || !data.parsed) {
        throw new Error(data.error || 'Vision extraction failed');
      }

      const p = data.parsed;
      setVendorName(p.vendorName);
      setInvoiceNumber(p.invoiceNumber);
      setInvoiceDate(p.invoiceDate);
      setTaxAmount(p.taxAmount || 0);
      setDraftLines(
        p.lineItems.map((line) => ({
          rawName: line.rawName,
          quantity: line.quantity,
          unit: line.unit,
          unitCost: line.unitCost,
          matchedInventoryId: line.matchedInventoryId ?? 'NEW',
          newItemTier: 'raw',
          matchConfidence: line.matchConfidence,
        }))
      );
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : 'Unable to extract invoice details'
      );
    } finally {
      setIsParsing(false);
    }
  };

  const updateLine = (index: number, patch: Partial<DraftLineState>) => {
    setDraftLines((prev) => {
      if (!prev) return prev;
      return prev.map((line, i) => (i === index ? { ...line, ...patch } : line));
    });
  };

  const handleConfirmStock = async () => {
    if (!draftLines || draftLines.length === 0 || isConfirming) return;
    setIsConfirming(true);
    setParseError(null);
    try {
      const linesPayload: ConfirmInvoiceLineInput[] = draftLines.map((l) => ({
        rawName: l.rawName,
        quantity: Number(l.quantity),
        unit: l.unit,
        unitCost: Number(l.unitCost),
        matchedInventoryId: l.matchedInventoryId,
        newItemTier: l.newItemTier,
      }));

      await onConfirmInvoice({
        vendorName,
        invoiceNumber,
        invoiceDate,
        taxAmount: Number(taxAmount) || 0,
        lineItems: linesPayload,
      });

      setConfirmSuccess(
        `Confirmed ${invoiceNumber || 'bill'} from ${vendorName}: ${draftLines.length} items restocked with blended unit costs.`
      );
      setDraftLines(null);
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : 'Failed to confirm invoice into stock'
      );
    } finally {
      setIsConfirming(false);
    }
  };

  const draftTotal = useMemo(() => {
    if (!draftLines) return 0;
    const sub = draftLines.reduce(
      (s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0),
      0
    );
    return roundMoney(sub + (Number(taxAmount) || 0));
  }, [draftLines, taxAmount]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 5 cols: Invoice Upload & Sample Bills */}
        <section
          aria-label="Supplier invoice capture"
          className="lg:col-span-5 bg-white border border-[#DCD6CA] rounded-[2px] p-4 sm:p-5 space-y-4"
        >
          <div className="pb-3 border-b border-[#DCD6CA]">
            <h2 className="font-ledger text-xl font-medium text-[#141923]">
              Zero-Typing Bill Capture
            </h2>
            <p className="text-xs text-[#525B6C] mt-0.5">
              Snap handwritten mandi bills or thermal dairy slips to extract quantities and recalibrate blended unit costs.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
              aria-label="Upload supplier invoice image"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-3 border border-[#DCD6CA] bg-[#F7F5F0] hover:bg-[#EFECE4] text-xs font-semibold text-[#141923] rounded-[2px] whitespace-nowrap cursor-pointer"
            >
              <Upload className="w-4 h-4" aria-hidden="true" />
              Upload Photo / Bill
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-2 py-2.5 px-3 border border-[#DCD6CA] bg-white hover:bg-[#F7F5F0] text-xs font-semibold text-[#141923] rounded-[2px] whitespace-nowrap cursor-pointer"
            >
              <Camera className="w-4 h-4" aria-hidden="true" />
              Camera
            </button>
          </div>

          <div>
            <div className="text-xs font-medium text-[#525B6C] mb-2">
              Or test with Pune wholesale bills:
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SAMPLE_BILLS.map((sample) => {
                const isSelected = !uploadedBase64 && selectedSampleFile === sample.fileName;
                return (
                  <button
                    key={sample.id}
                    type="button"
                    onClick={() => handleSelectSample(sample)}
                    className={`text-left p-2.5 border rounded-[2px] transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-[#141923] bg-[#F7F5F0]'
                        : 'border-[#DCD6CA] bg-white hover:bg-[#F7F5F0]'
                    }`}
                  >
                    <div className="text-xs font-semibold text-[#141923] truncate">
                      {sample.title}
                    </div>
                    <div className="text-[11px] text-[#525B6C] truncate mt-0.5">
                      {sample.subtitle}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border border-[#DCD6CA] bg-[#F7F5F0] rounded-[2px] p-2">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Selected supplier invoice preview"
                referrerPolicy="no-referrer"
                className="w-full max-h-[270px] object-contain bg-white rounded-[2px]"
              />
            ) : (
              <div className="h-56 flex flex-col items-center justify-center text-[#525B6C] text-xs">
                <FileText className="w-8 h-8 mb-2" aria-hidden="true" />
                No bill image selected
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleExtractBill}
            disabled={isParsing}
            className={`w-full py-3 px-4 text-sm font-semibold rounded-[2px] transition-colors cursor-pointer disabled:cursor-not-allowed ${
              draftLines
                ? 'bg-[#141923] hover:bg-[#232B3B] text-white'
                : 'bg-[#C8511B] hover:bg-[#AD4314] text-white'
            }`}
          >
            {isParsing ? 'Extracting Line Items via Gemini Vision...' : 'Extract Bill via Vision AI'}
          </button>
        </section>

        {/* Right 7 cols: Structured Review & Blended Cost Recalculation */}
        <section
          aria-label="Extracted bill verification and blended costing"
          className="lg:col-span-7 bg-white border border-[#DCD6CA] rounded-[2px] p-4 sm:p-5 space-y-4"
        >
          <div className="pb-3 border-b border-[#DCD6CA] flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-ledger text-xl font-medium text-[#141923]">
                1-Tap Verification & Blended Costing
              </h2>
              <p className="text-xs text-[#525B6C] mt-0.5">
                Formula: NewUnitCost = [(OldStock × OldCost) + (Incoming × Rate)] ÷ TotalNewStock
              </p>
            </div>
          </div>

          {parseError && (
            <div
              role="alert"
              className="p-3 border border-[#FCA5A5] bg-[#FEF2F2] text-xs text-[#991B1B] rounded-[2px]"
            >
              {parseError}
            </div>
          )}

          {confirmSuccess && (
            <div
              role="status"
              className="p-3 border border-[#86EFAC] bg-[#F0FDF4] text-xs text-[#166534] rounded-[2px] flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{confirmSuccess}</span>
            </div>
          )}

          {isParsing && (
            <div className="space-y-3 py-6" aria-live="polite">
              <div className="h-8 bg-[#EFECE4] rounded-[2px] animate-pulse" />
              <div className="h-32 bg-[#EFECE4] rounded-[2px] animate-pulse" />
              <div className="text-xs text-[#525B6C]">
                Reading supplier header, line quantities, units, and wholesale rates...
              </div>
            </div>
          )}

          {!isParsing && !draftLines && (
            <div className="py-12 text-center border border-dashed border-[#DCD6CA] rounded-[2px] px-6">
              <p className="text-sm font-medium text-[#141923]">
                Ready to parse supplier invoice
              </p>
              <p className="text-xs text-[#525B6C] mt-1 max-w-md mx-auto">
                Click &ldquo;Extract Bill via Vision AI&rdquo; on the left to run structured OCR extraction against the active Gultekdi Mandi or Pune Dairy bill, or upload your own bill image.
              </p>
            </div>
          )}

          {!isParsing && draftLines && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[#525B6C] mb-1">
                    Vendor Name
                  </label>
                  <input
                    type="text"
                    value={vendorName}
                    onChange={(e) => setVendorName(e.target.value)}
                    className="w-full px-2.5 py-2 text-sm border border-[#DCD6CA] rounded-[2px] bg-white text-[#141923]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#525B6C] mb-1">
                    Bill / Slip No.
                  </label>
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    className="w-full px-2.5 py-2 text-sm font-mono-tabular border border-[#DCD6CA] rounded-[2px] bg-white text-[#141923]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#525B6C] mb-1">
                    Bill Date
                  </label>
                  <input
                    type="text"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className="w-full px-2.5 py-2 text-sm font-sans-tabular border border-[#DCD6CA] rounded-[2px] bg-white text-[#141923]"
                  />
                </div>
              </div>

              <div className="overflow-x-auto border border-[#DCD6CA] rounded-[2px]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#EFECE4] border-b border-[#DCD6CA] text-[#525B6C] font-semibold">
                      <th className="py-2 px-2.5">Extracted Item</th>
                      <th className="py-2 px-2.5">Match to Inventory</th>
                      <th className="py-2 px-2.5 text-right">Qty</th>
                      <th className="py-2 px-2.5">Unit</th>
                      <th className="py-2 px-2.5 text-right">Rate (₹)</th>
                      <th className="py-2 px-2.5 text-right">Blended Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#DCD6CA] font-sans-tabular">
                    {draftLines.map((line, idx) => {
                      const matched =
                        line.matchedInventoryId !== 'NEW'
                          ? inventoryMap.get(line.matchedInventoryId)
                          : undefined;
                      const blended = matched
                        ? calculateBlendedUnitCost(
                            matched.currentStock,
                            matched.unitCost,
                            Number(line.quantity) || 0,
                            Number(line.unitCost) || 0
                          )
                        : Number(line.unitCost) || 0;

                      return (
                        <tr key={idx}>
                          <td className="py-2 px-2.5">
                            <input
                              type="text"
                              aria-label={`Item name row ${idx + 1}`}
                              value={line.rawName}
                              onChange={(e) =>
                                updateLine(idx, { rawName: e.target.value })
                              }
                              className="w-32 px-2 py-1 border border-[#DCD6CA] rounded-[2px] text-xs text-[#141923]"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <select
                              aria-label={`Matched inventory for ${line.rawName}`}
                              value={line.matchedInventoryId}
                              onChange={(e) =>
                                updateLine(idx, {
                                  matchedInventoryId: e.target.value,
                                })
                              }
                              className="w-40 px-2 py-1 border border-[#DCD6CA] rounded-[2px] text-xs bg-white text-[#141923]"
                            >
                              {inventory.map((inv) => (
                                <option key={inv.id} value={inv.id}>
                                  {inv.name} ({inv.unit})
                                </option>
                              ))}
                              <option value="NEW">+ Create New Commodity</option>
                            </select>
                          </td>
                          <td className="py-2 px-2.5 text-right">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              aria-label={`Quantity for ${line.rawName}`}
                              value={line.quantity}
                              onChange={(e) =>
                                updateLine(idx, {
                                  quantity: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-16 px-2 py-1 border border-[#DCD6CA] rounded-[2px] text-right text-xs"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <select
                              aria-label={`Unit for ${line.rawName}`}
                              value={line.unit}
                              onChange={(e) =>
                                updateLine(idx, {
                                  unit: e.target.value as UnitType,
                                })
                              }
                              className="px-1.5 py-1 border border-[#DCD6CA] rounded-[2px] text-xs bg-white"
                            >
                              <option value="kg">kg</option>
                              <option value="litre">litre</option>
                              <option value="pcs">pcs</option>
                              <option value="pack">pack</option>
                            </select>
                          </td>
                          <td className="py-2 px-2.5 text-right">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              aria-label={`Unit cost for ${line.rawName}`}
                              value={line.unitCost}
                              onChange={(e) =>
                                updateLine(idx, {
                                  unitCost: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-20 px-2 py-1 border border-[#DCD6CA] rounded-[2px] text-right text-xs"
                            />
                          </td>
                          <td className="py-2 px-2.5 text-right whitespace-nowrap">
                            {matched ? (
                              <span>
                                <span className="text-[#525B6C]">
                                  ₹{matched.unitCost.toFixed(0)} →{' '}
                                </span>
                                <span className="font-semibold text-[#141923]">
                                  ₹{blended.toFixed(2)}/{matched.unit}
                                </span>
                              </span>
                            ) : (
                              <span className="font-semibold text-[#166534]">
                                New ₹{blended.toFixed(2)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <div className="flex items-center gap-3 text-xs text-[#525B6C]">
                  <label className="flex items-center gap-1.5">
                    <span>Tax / GST (₹):</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={taxAmount}
                      onChange={(e) => setTaxAmount(parseFloat(e.target.value) || 0)}
                      className="w-20 px-2 py-1 border border-[#DCD6CA] rounded-[2px] text-right text-xs text-[#141923]"
                    />
                  </label>
                  <span>·</span>
                  <span className="font-semibold text-[#141923]">
                    Bill Total: <span className="font-ledger text-base">{formatInr(draftTotal)}</span>
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleConfirmStock}
                  disabled={isConfirming}
                  className="py-2.5 px-5 bg-[#C8511B] hover:bg-[#AD4314] text-white text-sm font-semibold rounded-[2px] whitespace-nowrap cursor-pointer"
                >
                  {isConfirming ? 'Updating Stock...' : 'Confirm & Update Stock'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Confirmed Supplier Bills History */}
      <section
        aria-label="Confirmed supplier purchase ledger"
        className="bg-white border border-[#DCD6CA] rounded-[2px] p-4 sm:p-5"
      >
        <div className="pb-3 border-b border-[#DCD6CA] flex items-center justify-between">
          <h2 className="font-ledger text-xl font-medium text-[#141923]">
            Confirmed Supplier Bills & Cost Recalibrations
          </h2>
          <span className="text-xs text-[#525B6C] font-sans-tabular">
            {invoices.length} bills ingested
          </span>
        </div>

        <div className="overflow-x-auto mt-2">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#DCD6CA] text-xs font-semibold text-[#525B6C]">
                <th className="py-2.5 pr-3 whitespace-nowrap">Bill No.</th>
                <th className="py-2.5 pr-3 whitespace-nowrap">Date</th>
                <th className="py-2.5 pr-3">Vendor</th>
                <th className="py-2.5 pr-3">Restocked Commodities & Blended Cost</th>
                <th className="py-2.5 text-right whitespace-nowrap">Bill Total (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCD6CA] font-sans-tabular">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-[#F7F5F0]">
                  <td className="py-2.5 pr-3 font-mono-tabular text-xs font-medium text-[#141923] whitespace-nowrap">
                    {inv.invoiceNumber}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-[#525B6C] whitespace-nowrap">
                    {formatDateShort(inv.invoiceDate)}
                  </td>
                  <td className="py-2.5 pr-3 text-xs font-medium text-[#141923]">
                    {inv.vendorName}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-[#525B6C]">
                    {inv.lines
                      .map(
                        (l) =>
                          `${l.itemName} +${formatQty(l.quantity, l.unit)} @ ₹${l.incomingUnitCost.toFixed(0)} (blended ₹${l.blendedUnitCost.toFixed(2)})`
                      )
                      .join(' · ')}
                  </td>
                  <td className="py-2.5 text-right font-medium text-[#141923] whitespace-nowrap">
                    {formatInr(inv.totalAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
