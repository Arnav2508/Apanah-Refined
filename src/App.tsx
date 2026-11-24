import React, { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type {
  BomComponent,
  CartItemInput,
  ConfirmInvoiceInput,
  FinancialTelemetry,
  InventoryTier,
  PaymentMethod,
  PhysicalCountInput,
  StoreState,
  UnitType,
} from './core/types';
import { TelemetryStrip } from './components/TelemetryStrip';
import { PosTerminalView } from './components/PosTerminalView';
import { BillScanView } from './components/BillScanView';
import { StockBomView } from './components/StockBomView';
import { AuditExportView } from './components/AuditExportView';

type ActiveTab = 'pos' | 'scan' | 'stock' | 'audit';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('pos');
  const [storeState, setStoreState] = useState<StoreState | null>(null);
  const [telemetry, setTelemetry] = useState<FinancialTelemetry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      setLoadError(null);
      const res = await fetch('/api/state');
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        state: StoreState;
        telemetry: FinancialTelemetry;
      };
      setStoreState(data.state);
      setTelemetry(data.telemetry);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Unable to connect to Apanah ledger server'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const handleSubmitOrder = async (
    items: CartItemInput[],
    paymentMethod: PaymentMethod
  ) => {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, paymentMethod }),
    });
    const data = (await res.json()) as {
      state?: StoreState;
      telemetry?: FinancialTelemetry;
      error?: string;
    };
    if (!res.ok || !data.state || !data.telemetry) {
      throw new Error(data.error || 'Order submission failed');
    }
    setStoreState(data.state);
    setTelemetry(data.telemetry);
  };

  const handleConfirmInvoice = async (payload: ConfirmInvoiceInput) => {
    const res = await fetch('/api/invoices/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as {
      state?: StoreState;
      telemetry?: FinancialTelemetry;
      error?: string;
    };
    if (!res.ok || !data.state || !data.telemetry) {
      throw new Error(data.error || 'Invoice confirmation failed');
    }
    setStoreState(data.state);
    setTelemetry(data.telemetry);
  };

  const handleAddInventoryItem = async (item: {
    name: string;
    tier: InventoryTier;
    unit: UnitType;
    currentStock: number;
    minThreshold: number;
    unitCost: number;
  }) => {
    const res = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    const data = (await res.json()) as {
      state?: StoreState;
      telemetry?: FinancialTelemetry;
      error?: string;
    };
    if (!res.ok || !data.state || !data.telemetry) {
      throw new Error(data.error || 'Failed to add inventory item');
    }
    setStoreState(data.state);
    setTelemetry(data.telemetry);
  };

  const handleUpdateThreshold = async (
    inventoryId: string,
    minThreshold: number
  ) => {
    const res = await fetch('/api/inventory/threshold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventoryId, minThreshold }),
    });
    const data = (await res.json()) as {
      state?: StoreState;
      telemetry?: FinancialTelemetry;
    };
    if (res.ok && data.state && data.telemetry) {
      setStoreState(data.state);
      setTelemetry(data.telemetry);
    }
  };

  const handleUpdateDishBom = async (dishId: string, bom: BomComponent[]) => {
    const res = await fetch(`/api/menu/${encodeURIComponent(dishId)}/bom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bom }),
    });
    const data = (await res.json()) as {
      state?: StoreState;
      telemetry?: FinancialTelemetry;
      error?: string;
    };
    if (!res.ok || !data.state || !data.telemetry) {
      throw new Error(data.error || 'Failed to update recipe BOM');
    }
    setStoreState(data.state);
    setTelemetry(data.telemetry);
  };

  const handleCommitAudit = async (
    counts: PhysicalCountInput[],
    reason: string
  ) => {
    const res = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ counts, reason }),
    });
    const data = (await res.json()) as {
      state?: StoreState;
      telemetry?: FinancialTelemetry;
      error?: string;
    };
    if (!res.ok || !data.state || !data.telemetry) {
      throw new Error(data.error || 'Failed to commit physical audit');
    }
    setStoreState(data.state);
    setTelemetry(data.telemetry);
  };

  const handleUpdateOwnerUpi = async (payload: {
    upiId: string;
    shopName: string;
    merchantCode?: string;
  }) => {
    const res = await fetch('/api/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as {
      state?: StoreState;
      telemetry?: FinancialTelemetry;
      error?: string;
    };
    if (!res.ok || !data.state || !data.telemetry) {
      throw new Error(data.error || 'Failed to update owner UPI settings');
    }
    setStoreState(data.state);
    setTelemetry(data.telemetry);
  };

  const handleResetDemo = async () => {
    if (isResetting) return;
    setIsResetting(true);
    try {
      const res = await fetch('/api/reset', { method: 'POST' });
      const data = (await res.json()) as {
        state?: StoreState;
        telemetry?: FinancialTelemetry;
      };
      if (res.ok && data.state && data.telemetry) {
        setStoreState(data.state);
        setTelemetry(data.telemetry);
      }
    } finally {
      setIsResetting(false);
    }
  };

  const navItems: { id: ActiveTab; label: string }[] = [
    { id: 'pos', label: 'Counter POS' },
    { id: 'scan', label: 'Bill Scan' },
    { id: 'stock', label: 'Stock & BOM' },
    { id: 'audit', label: 'Audit & Export' },
  ];

  return (
    <div className="min-h-screen bg-[#F7F5F0] text-[#141923] flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="bg-white border-b border-[#DCD6CA]">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-8">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('pos');
            }}
            className="font-ledger text-2xl font-semibold tracking-tight text-[#141923] whitespace-nowrap shrink-0"
          >
            Apanah
          </a>

          <nav
            aria-label="Primary workspace navigation"
            className="hidden md:flex items-center gap-6"
          >
            {navItems.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'border-[#C8511B] text-[#141923]'
                      : 'border-transparent text-[#525B6C] hover:text-[#141923]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center shrink-0">
            <a
              href="/api/exports/tally-xml?download=1"
              download="apanah-tally-daybook.xml"
              className="px-3.5 py-2 text-xs font-semibold text-white bg-[#141923] hover:bg-[#232B3B] rounded-[2px] whitespace-nowrap shrink-0 transition-colors"
            >
              Export Tally XML
            </a>
          </div>
        </div>

        {/* Mobile navigation row */}
        <nav
          aria-label="Mobile workspace navigation"
          className="md:hidden border-t border-[#DCD6CA] px-4 flex items-center gap-4 overflow-x-auto"
        >
          {navItems.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`py-2.5 text-xs font-medium border-b-2 whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'border-[#C8511B] text-[#141923]'
                    : 'border-transparent text-[#525B6C]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5 space-y-5">
        {loading && (
          <div className="space-y-4">
            <div className="h-24 bg-white border border-[#DCD6CA] rounded-[2px] animate-pulse" />
            <div className="h-96 bg-white border border-[#DCD6CA] rounded-[2px] animate-pulse" />
          </div>
        )}

        {!loading && loadError && (
          <div
            role="alert"
            className="bg-white border border-[#FCA5A5] rounded-[2px] p-6 space-y-3"
          >
            <h1 className="font-ledger text-xl font-medium text-[#991B1B]">
              Unable to load commercial ledger
            </h1>
            <p className="text-sm text-[#525B6C]">{loadError}</p>
            <button
              type="button"
              onClick={fetchState}
              className="px-4 py-2 bg-[#C8511B] text-white text-xs font-semibold rounded-[2px] cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        )}

        {!loading && !loadError && storeState && telemetry && (
          <>
            {/* Merchant Context Strip */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="font-ledger text-2xl font-medium text-[#141923]">
                  {storeState.meta.shopName}
                </h1>
                <p className="text-xs text-[#525B6C] mt-0.5">
                  {storeState.meta.location} · GSTIN {storeState.meta.gstin} · Owner UPI <span className="font-mono-tabular text-[#141923]">{storeState.meta.upiId}</span> · Every sale updates payments, stock and profit. No typing.
                </p>
              </div>
              <button
                type="button"
                onClick={handleResetDemo}
                disabled={isResetting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#DCD6CA] bg-white hover:bg-[#EFECE4] text-xs font-medium text-[#525B6C] hover:text-[#141923] rounded-[2px] whitespace-nowrap cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                {isResetting ? 'Resetting...' : 'Reset Seed Ledger'}
              </button>
            </div>

            {/* Live Financial Telemetry & Low-Stock Banner */}
            <TelemetryStrip
              telemetry={telemetry}
              inventoryCount={storeState.inventory.length}
              onGoToBillScan={() => setActiveTab('scan')}
            />

            {/* Active Workspace View */}
            {activeTab === 'pos' && (
              <PosTerminalView
                meta={storeState.meta}
                menu={storeState.menu}
                inventory={storeState.inventory}
                orders={storeState.orders}
                onSubmitOrder={handleSubmitOrder}
                onUpdateOwnerUpi={handleUpdateOwnerUpi}
              />
            )}

            {activeTab === 'scan' && (
              <BillScanView
                inventory={storeState.inventory}
                invoices={storeState.invoices}
                onConfirmInvoice={handleConfirmInvoice}
              />
            )}

            {activeTab === 'stock' && (
              <StockBomView
                inventory={storeState.inventory}
                menu={storeState.menu}
                onAddInventoryItem={handleAddInventoryItem}
                onUpdateThreshold={handleUpdateThreshold}
                onUpdateDishBom={handleUpdateDishBom}
              />
            )}

            {activeTab === 'audit' && (
              <AuditExportView
                inventory={storeState.inventory}
                audits={storeState.audits}
                onCommitAudit={handleCommitAudit}
              />
            )}
          </>
        )}
      </main>

      <footer className="border-t border-[#DCD6CA] bg-white mt-8">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[#525B6C]">
          <span>
            Apanah · Autonomous Commercial Back Office for Indian Retail & QSRs
          </span>
          <span>
            Supported by President&apos;s Innovation Fund, VIT Pune · Zero-Lock-In Tally & Vyapar Exports
          </span>
        </div>
      </footer>
    </div>
  );
}
