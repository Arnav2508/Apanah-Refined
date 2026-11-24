import React from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { FinancialTelemetry } from '../core/types';
import { formatInr, formatQty } from '../utils/format';

interface TelemetryStripProps {
  telemetry: FinancialTelemetry;
  inventoryCount: number;
  onGoToBillScan: () => void;
}

export const TelemetryStrip: React.FC<TelemetryStripProps> = ({
  telemetry,
  inventoryCount,
  onGoToBillScan,
}) => {
  const upi = telemetry.paymentSplit.find((p) => p.method === 'UPI');
  const cash = telemetry.paymentSplit.find((p) => p.method === 'CASH');
  const card = telemetry.paymentSplit.find((p) => p.method === 'CARD');

  return (
    <section aria-label="Real-time financial ledger summary" className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-[#DCD6CA] border border-[#DCD6CA] rounded-[2px]">
        <div className="bg-white p-4">
          <div className="text-xs font-medium text-[#525B6C]">Gross Sales</div>
          <div className="mt-1 font-ledger text-2xl font-medium text-[#141923]">
            {formatInr(telemetry.grossSales)}
          </div>
          <div className="mt-1 text-xs text-[#525B6C] font-sans-tabular">
            {telemetry.orderCount} orders · AOV {formatInr(telemetry.aov)}
          </div>
        </div>

        <div className="bg-white p-4">
          <div className="text-xs font-medium text-[#525B6C]">Real Unit COGS</div>
          <div className="mt-1 font-ledger text-2xl font-medium text-[#141923]">
            {formatInr(telemetry.totalCogs)}
          </div>
          <div className="mt-1 text-xs text-[#525B6C] font-sans-tabular">
            BOM weighted-average cost
          </div>
        </div>

        <div className="bg-white p-4">
          <div className="text-xs font-medium text-[#525B6C]">Net Operating Profit</div>
          <div className="mt-1 font-ledger text-2xl font-medium text-[#166534]">
            {formatInr(telemetry.netOperatingProfit)}
          </div>
          <div className="mt-1 text-xs text-[#525B6C] font-sans-tabular">
            {telemetry.grossMarginPct.toFixed(1)}% gross margin
          </div>
        </div>

        <div className="bg-white p-4">
          <div className="text-xs font-medium text-[#525B6C]">Payment Split</div>
          <div className="mt-1 font-ledger text-xl font-medium text-[#141923]">
            UPI {upi?.sharePct.toFixed(0) ?? 0}% · Cash {cash?.sharePct.toFixed(0) ?? 0}%
          </div>
          <div className="mt-1.5 text-xs text-[#525B6C] font-sans-tabular truncate">
            UPI {formatInr(upi?.total ?? 0)} · Cash {formatInr(cash?.total ?? 0)} · Card {formatInr(card?.total ?? 0)}
          </div>
        </div>

        <div className="bg-white p-4 col-span-2 lg:col-span-1">
          <div className="text-xs font-medium text-[#525B6C]">On-Hand Stock Value</div>
          <div className="mt-1 font-ledger text-2xl font-medium text-[#141923]">
            {formatInr(telemetry.onHandStockValuation)}
          </div>
          <div className="mt-1 text-xs text-[#525B6C] font-sans-tabular">
            {inventoryCount} tracked items · Shrinkage {formatInr(telemetry.totalShrinkageLossInr)}
          </div>
        </div>
      </div>

      {telemetry.lowStockItems.length > 0 && (
        <div
          role="status"
          className="bg-[#FDF5F1] border border-[#C8511B]/45 rounded-[2px] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex flex-wrap items-center gap-2 text-sm text-[#141923]">
            <AlertTriangle className="w-4 h-4 text-[#C8511B] shrink-0" aria-hidden="true" />
            <span className="font-semibold text-[#9A3412]">Low Stock Alert:</span>
            <span className="font-sans-tabular text-[#141923]">
              {telemetry.lowStockItems
                .map(
                  (item) =>
                    `${item.name} (${formatQty(item.currentStock, item.unit)} left, min ${formatQty(item.minThreshold, item.unit)})`
                )
                .join(' · ')}
            </span>
          </div>
          <button
            type="button"
            onClick={onGoToBillScan}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#C8511B] hover:text-[#AD4314] underline underline-offset-4 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Restock via Bill Scan
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
};
