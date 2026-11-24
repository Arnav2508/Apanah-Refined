import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download } from 'lucide-react';
import type {
  AuditEntry,
  InventoryItem,
  PhysicalCountInput,
} from '../core/types';
import { roundMoney, roundQty } from '../core/engine';
import { formatDateShort, formatInr, formatQty } from '../utils/format';

interface AuditExportViewProps {
  inventory: InventoryItem[];
  audits: AuditEntry[];
  onCommitAudit: (counts: PhysicalCountInput[], reason: string) => Promise<void>;
}

export const AuditExportView: React.FC<AuditExportViewProps> = ({
  inventory,
  audits,
  onCommitAudit,
}) => {
  const rawCommodities = inventory.filter((i) => i.tier === 'raw');
  const [physicalInputs, setPhysicalInputs] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('Weekly physical count — spillage & evaporation');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [auditSuccess, setAuditSuccess] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  const [tallyXmlPreview, setTallyXmlPreview] = useState<string>('');
  const [loadingXml, setLoadingXml] = useState(false);

  useEffect(() => {
    const defaults: Record<string, string> = {};
    for (const item of rawCommodities) {
      defaults[item.id] = String(item.currentStock);
    }
    setPhysicalInputs(defaults);
  }, [inventory]);

  const fetchXmlPreview = async () => {
    setLoadingXml(true);
    try {
      const res = await fetch('/api/exports/tally-xml');
      const data = (await res.json()) as { xml?: string };
      if (data.xml) {
        setTallyXmlPreview(data.xml);
      }
    } finally {
      setLoadingXml(false);
    }
  };

  useEffect(() => {
    fetchXmlPreview();
  }, [audits.length]);

  const pendingVariances = rawCommodities
    .map((item) => {
      const rawVal = physicalInputs[item.id];
      const physical = rawVal !== undefined ? parseFloat(rawVal) : item.currentStock;
      const validPhysical = Number.isNaN(physical) ? item.currentStock : physical;
      const variance = roundQty(validPhysical - item.currentStock);
      const monetaryImpact = roundMoney(variance * item.unitCost);
      return { item, physical: validPhysical, variance, monetaryImpact };
    })
    .filter((row) => Math.abs(row.variance) >= 0.0001);

  const handleCommit = async () => {
    if (isSubmitting) return;
    setAuditError(null);
    setAuditSuccess(null);

    if (pendingVariances.length === 0) {
      setAuditError('Adjust at least one weighed physical stock value to log a variance.');
      return;
    }

    setIsSubmitting(true);
    try {
      const counts: PhysicalCountInput[] = pendingVariances.map((v) => ({
        inventoryId: v.item.id,
        physicalStock: v.physical,
      }));
      await onCommitAudit(counts, reason);
      setAuditSuccess(
        `Physical audit committed for ${counts.length} item(s). Book stock and shrinkage ledger recalibrated.`
      );
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Failed to commit audit');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Section 1: Weekly Physical Count Audit & Shrinkage Modeling */}
      <section
        aria-label="Weekly physical count audit and shrinkage reconciliation"
        className="bg-white border border-[#DCD6CA] rounded-[2px] p-4 sm:p-5 space-y-4"
      >
        <div className="pb-3 border-b border-[#DCD6CA] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-ledger text-xl font-medium text-[#141923]">
              Weekly Physical Count Audit & Shrinkage Isolation
            </h2>
            <p className="text-xs text-[#525B6C] mt-0.5">
              Enter weighed physical stock of volatile staples to isolate evaporation, kitchen spillage, and unrecorded waste in ₹.
            </p>
          </div>
          <div className="text-xs font-sans-tabular text-[#525B6C]">
            Pending variances: <span className="font-semibold text-[#141923]">{pendingVariances.length}</span>
          </div>
        </div>

        {auditError && (
          <div
            role="alert"
            className="p-3 border border-[#FCA5A5] bg-[#FEF2F2] text-xs text-[#991B1B] rounded-[2px]"
          >
            {auditError}
          </div>
        )}

        {auditSuccess && (
          <div
            role="status"
            className="p-3 border border-[#86EFAC] bg-[#F0FDF4] text-xs text-[#166534] rounded-[2px] flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{auditSuccess}</span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#DCD6CA] text-xs font-semibold text-[#525B6C]">
                <th className="py-2.5 pr-3">Volatile Commodity</th>
                <th className="py-2.5 pr-3 text-right">Theoretical Book Stock</th>
                <th className="py-2.5 pr-3 text-right">Weighed Physical Stock</th>
                <th className="py-2.5 pr-3 text-right">Variance (Δ)</th>
                <th className="py-2.5 pr-3 text-right">Unit Cost (₹)</th>
                <th className="py-2.5 text-right">Shrinkage Impact (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCD6CA] font-sans-tabular">
              {rawCommodities.map((item) => {
                const valStr = physicalInputs[item.id] ?? String(item.currentStock);
                const parsed = parseFloat(valStr);
                const physical = Number.isNaN(parsed) ? item.currentStock : parsed;
                const variance = roundQty(physical - item.currentStock);
                const impact = roundMoney(variance * item.unitCost);

                return (
                  <tr key={item.id} className="hover:bg-[#F7F5F0]">
                    <td className="py-2.5 pr-3 font-medium text-[#141923]">
                      {item.name}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-[#525B6C]">
                      {formatQty(item.currentStock, item.unit)}
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        aria-label={`Weighed physical stock for ${item.name}`}
                        value={valStr}
                        onChange={(e) =>
                          setPhysicalInputs((prev) => ({
                            ...prev,
                            [item.id]: e.target.value,
                          }))
                        }
                        className="w-24 px-2 py-1 text-right text-xs border border-[#DCD6CA] rounded-[2px] bg-white text-[#141923]"
                      />
                      <span className="inline-block w-9 text-left ml-1.5 text-xs text-[#525B6C]">{item.unit}</span>
                    </td>
                    <td
                      className={`py-2.5 pr-3 text-right font-medium ${
                        variance < 0
                          ? 'text-[#991B1B]'
                          : variance > 0
                            ? 'text-[#166534]'
                            : 'text-[#525B6C]'
                      }`}
                    >
                      {variance > 0 ? '+' : ''}
                      {variance} {item.unit}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-[#525B6C]">
                      {formatInr(item.unitCost)}
                    </td>
                    <td
                      className={`py-2.5 text-right font-semibold ${
                        impact < 0
                          ? 'text-[#991B1B]'
                          : impact > 0
                            ? 'text-[#166534]'
                            : 'text-[#525B6C]'
                      }`}
                    >
                      {impact < 0
                        ? `Loss ${formatInr(Math.abs(impact))}`
                        : impact > 0
                          ? `Gain +${formatInr(impact)}`
                          : 'Balanced ₹0.00'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#DCD6CA]">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-xs font-medium text-[#525B6C] mb-1">
              Audit Note / Spillage Reason
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-[#DCD6CA] rounded-[2px] bg-white text-[#141923]"
            />
          </div>
          <button
            type="button"
            onClick={handleCommit}
            disabled={isSubmitting}
            className="self-end py-2.5 px-5 bg-[#C8511B] hover:bg-[#AD4314] text-white text-sm font-semibold rounded-[2px] whitespace-nowrap cursor-pointer"
          >
            {isSubmitting ? 'Recalibrating...' : 'Commit Physical Audit'}
          </button>
        </div>

        {/* Historical Audit Log */}
        <div className="pt-4">
          <h3 className="text-sm font-semibold text-[#141923] mb-2">
            Shrinkage & Spillage Audit Log
          </h3>
          <div className="overflow-x-auto border border-[#DCD6CA] rounded-[2px]">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#EFECE4] border-b border-[#DCD6CA] text-[#525B6C] font-semibold">
                  <th className="py-2 px-3">Date</th>
                  <th className="py-2 px-3">Commodity</th>
                  <th className="py-2 px-3 text-right">Book</th>
                  <th className="py-2 px-3 text-right">Physical</th>
                  <th className="py-2 px-3 text-right">Variance</th>
                  <th className="py-2 px-3">Reason</th>
                  <th className="py-2 px-3 text-right">Monetary Impact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DCD6CA] font-sans-tabular">
                {audits.map((aud) => (
                  <tr key={aud.id}>
                    <td className="py-2 px-3 text-[#525B6C] whitespace-nowrap">
                      {formatDateShort(aud.timestamp)}
                    </td>
                    <td className="py-2 px-3 font-medium text-[#141923]">
                      {aud.itemName}
                    </td>
                    <td className="py-2 px-3 text-right text-[#525B6C]">
                      {formatQty(aud.theoreticalStock, aud.unit)}
                    </td>
                    <td className="py-2 px-3 text-right text-[#141923]">
                      {formatQty(aud.physicalStock, aud.unit)}
                    </td>
                    <td className="py-2 px-3 text-right font-medium text-[#991B1B]">
                      {aud.variance > 0 ? '+' : ''}
                      {aud.variance} {aud.unit}
                    </td>
                    <td className="py-2 px-3 text-[#525B6C]">{aud.reason}</td>
                    <td
                      className={`py-2 px-3 text-right font-semibold ${
                        aud.monetaryImpactInr < 0 ? 'text-[#991B1B]' : 'text-[#166534]'
                      }`}
                    >
                      {aud.monetaryImpactInr < 0
                        ? `-${formatInr(Math.abs(aud.monetaryImpactInr))}`
                        : `+${formatInr(aud.monetaryImpactInr)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Section 2: Accounting Interoperability (Tally Prime XML + Vyapar/Busy CSV) */}
      <section
        aria-label="India-specific accounting exports"
        className="bg-white border border-[#DCD6CA] rounded-[2px] p-4 sm:p-5 space-y-4"
      >
        <div className="pb-3 border-b border-[#DCD6CA] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-ledger text-xl font-medium text-[#141923]">
              Accounting Interoperability (Tally Prime · Vyapar · Busy)
            </h2>
            <p className="text-xs text-[#525B6C] mt-0.5">
              Zero vendor lock-in. Export compliant Tally XML Day Book vouchers (Debit Payment Ledger / Credit Sales Ledger) or standardized Vyapar CSVs.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="/api/exports/tally-xml?download=1"
              download="apanah-tally-daybook.xml"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#141923] hover:bg-[#232B3B] text-white text-xs font-semibold rounded-[2px] whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Export Tally Prime XML
            </a>
            <a
              href="/api/exports/vyapar-sales-csv?download=1"
              download="apanah-vyapar-sales.csv"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-[#DCD6CA] bg-white hover:bg-[#F7F5F0] text-[#141923] text-xs font-semibold rounded-[2px] whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Vyapar / Busy Sales CSV
            </a>
            <a
              href="/api/exports/vyapar-purchases-csv?download=1"
              download="apanah-vyapar-purchases.csv"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-[#DCD6CA] bg-white hover:bg-[#F7F5F0] text-[#141923] text-xs font-semibold rounded-[2px] whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Vyapar Purchases CSV
            </a>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs text-[#525B6C] mb-1.5">
            <span>Live Tally Prime / ERP 9 Day Book XML Preview</span>
            <button
              type="button"
              onClick={fetchXmlPreview}
              className="underline hover:text-[#141923] cursor-pointer"
            >
              {loadingXml ? 'Refreshing...' : 'Refresh Preview'}
            </button>
          </div>
          <pre className="p-3 bg-[#F7F5F0] border border-[#DCD6CA] rounded-[2px] text-[11px] font-mono-tabular text-[#141923] overflow-x-auto max-h-64 leading-relaxed">
            {tallyXmlPreview || 'Loading Tally Day Book XML...'}
          </pre>
        </div>
      </section>
    </div>
  );
};
