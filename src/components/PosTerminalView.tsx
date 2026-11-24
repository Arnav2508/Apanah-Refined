import React, { useMemo, useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import type {
  CartItemInput,
  InventoryItem,
  MenuDish,
  OrderRecord,
  PaymentMethod,
  StoreMeta,
} from '../core/types';
import { calculateDishUnitCost, roundMoney } from '../core/engine';
import { formatInr, formatQty, formatTimeShort } from '../utils/format';
import { UpiQrCode } from './UpiQrCode';

interface PosTerminalViewProps {
  meta: StoreMeta;
  menu: MenuDish[];
  inventory: InventoryItem[];
  orders: OrderRecord[];
  onSubmitOrder: (items: CartItemInput[], paymentMethod: PaymentMethod) => Promise<void>;
  onUpdateOwnerUpi: (payload: {
    upiId: string;
    shopName: string;
    merchantCode?: string;
  }) => Promise<void>;
}

type CategoryFilter = 'All' | MenuDish['category'];

export const PosTerminalView: React.FC<PosTerminalViewProps> = ({
  meta,
  menu,
  inventory,
  orders,
  onSubmitOrder,
  onUpdateOwnerUpi,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastOrderReceipt, setLastOrderReceipt] = useState<OrderRecord | null>(null);

  const inventoryMap = useMemo(
    () => new Map(inventory.map((item) => [item.id, item])),
    [inventory]
  );

  const filteredMenu = useMemo(() => {
    if (categoryFilter === 'All') return menu;
    return menu.filter((m) => m.category === categoryFilter);
  }, [menu, categoryFilter]);

  const cartLines = useMemo(() => {
    return menu
      .filter((dish) => (cart[dish.id] ?? 0) > 0)
      .map((dish) => {
        const qty = cart[dish.id] ?? 0;
        const unitCogs = calculateDishUnitCost(dish, inventoryMap);
        return {
          dish,
          qty,
          unitCogs,
          lineTotal: roundMoney(dish.sellingPrice * qty),
          lineCogs: roundMoney(unitCogs * qty),
        };
      });
  }, [menu, cart, inventoryMap]);

  const ticketTotals = useMemo(() => {
    const gross = roundMoney(cartLines.reduce((s, l) => s + l.lineTotal, 0));
    const cogs = roundMoney(cartLines.reduce((s, l) => s + l.lineCogs, 0));
    const profit = roundMoney(gross - cogs);
    const margin = gross > 0 ? roundMoney((profit / gross) * 100) : 0;
    return { gross, cogs, profit, margin };
  }, [cartLines]);

  const addOne = (dishId: string) => {
    setErrorMsg(null);
    setCart((prev) => ({ ...prev, [dishId]: (prev[dishId] ?? 0) + 1 }));
  };

  const setDishQty = (dishId: string, nextQty: number) => {
    setErrorMsg(null);
    setCart((prev) => {
      if (nextQty <= 0) {
        const copy = { ...prev };
        delete copy[dishId];
        return copy;
      }
      return { ...prev, [dishId]: nextQty };
    });
  };

  const handleCheckout = async () => {
    if (cartLines.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const payload: CartItemInput[] = cartLines.map((l) => ({
        dishId: l.dish.id,
        quantity: l.qty,
      }));
      await onSubmitOrder(payload, paymentMethod);
      setCart({});
      setLastOrderReceipt(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to record sale');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 cols: Zero-Typing Counter Tap Grid */}
        <section
          aria-label="Quick-tap menu and retail catalog"
          className="lg:col-span-7 bg-white border border-[#DCD6CA] rounded-[2px] p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#DCD6CA]">
            <div>
              <h2 className="font-ledger text-xl font-medium text-[#141923]">
                Counter Quick-Tap Catalog
              </h2>
              <p className="text-xs text-[#525B6C] mt-0.5">
                Single tap adds item · Automatic BOM raw ingredient depletion on checkout
              </p>
            </div>
            <div
              role="tablist"
              aria-label="Filter catalog by category"
              className="flex items-center gap-1 bg-[#F7F5F0] border border-[#DCD6CA] p-1 rounded-[2px] overflow-x-auto max-w-full"
            >
              {(['All', 'QSR Dish', 'Beverage', 'Retail SKU'] as CategoryFilter[]).map(
                (cat) => (
                  <button
                    key={cat}
                    type="button"
                    role="tab"
                    aria-selected={categoryFilter === cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-[2px] whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      categoryFilter === cat
                        ? 'bg-[#141923] text-white'
                        : 'text-[#525B6C] hover:text-[#141923]'
                    }`}
                  >
                    {cat}
                  </button>
                )
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredMenu.map((dish) => {
              const unitCogs = calculateDishUnitCost(dish, inventoryMap);
              const marginPct =
                dish.sellingPrice > 0
                  ? Math.round(((dish.sellingPrice - unitCogs) / dish.sellingPrice) * 100)
                  : 0;
              const qtyInCart = cart[dish.id] ?? 0;

              return (
                <button
                  key={dish.id}
                  type="button"
                  onClick={() => addOne(dish.id)}
                  aria-label={`Add ${dish.name} to ticket (${formatInr(dish.sellingPrice)})`}
                  className={`text-left p-3.5 border rounded-[2px] transition-colors min-h-[76px] flex items-center justify-between gap-3 cursor-pointer ${
                    qtyInCart > 0
                      ? 'bg-[#FDF5F1] border-[#C8511B]'
                      : 'bg-white border-[#DCD6CA] hover:bg-[#F7F5F0]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-[#141923] truncate">
                      {dish.name}
                    </div>
                    <div className="text-xs text-[#525B6C] mt-1 font-sans-tabular">
                      {dish.category} · Cost {formatInr(unitCogs)} · {marginPct}% margin
                    </div>
                    <div className="text-xs text-[#525B6C] mt-0.5 font-sans-tabular truncate">
                      {dish.bom.length === 1 && dish.category === 'Retail SKU'
                        ? '1:1 SKU depletion'
                        : `BOM: ${dish.bom.length} ingredients`}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-ledger text-lg font-medium text-[#141923]">
                      ₹{dish.sellingPrice}
                    </div>
                    {qtyInCart > 0 && (
                      <div className="text-xs font-semibold text-[#C8511B] font-sans-tabular mt-0.5">
                        In ticket: ×{qtyInCart}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Right 5 cols: Order Ticket & Atomic Checkout */}
        <section
          aria-label="Current order ticket"
          className="lg:col-span-5 bg-white border border-[#DCD6CA] rounded-[2px] p-4 sm:p-5"
        >
          <div className="flex items-center justify-between pb-3 border-b border-[#DCD6CA]">
            <h2 className="font-ledger text-xl font-medium text-[#141923]">
              Counter Order Ticket
            </h2>
            {cartLines.length > 0 && (
              <button
                type="button"
                onClick={() => setCart({})}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#525B6C] hover:text-[#991B1B] whitespace-nowrap cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                Clear Ticket
              </button>
            )}
          </div>

          {cartLines.length === 0 ? (
            <div className="py-10 text-center border-b border-[#DCD6CA]">
              <p className="text-sm font-medium text-[#141923]">No items on current ticket</p>
              <p className="text-xs text-[#525B6C] mt-1">
                Tap any dish or retail item on the left to build a bill without typing.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#DCD6CA] border-b border-[#DCD6CA]">
              {cartLines.map(({ dish, qty, lineTotal, lineCogs }) => (
                <div
                  key={dish.id}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[#141923] truncate">
                      {dish.name}
                    </div>
                    <div className="text-xs text-[#525B6C] font-sans-tabular">
                      ₹{dish.sellingPrice} × {qty} · COGS {formatInr(lineCogs)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="inline-flex items-center border border-[#DCD6CA] rounded-[2px] bg-[#F7F5F0]">
                      <button
                        type="button"
                        aria-label={`Decrease quantity of ${dish.name}`}
                        onClick={() => setDishQty(dish.id, qty - 1)}
                        className="w-8 h-8 flex items-center justify-center text-[#141923] hover:bg-[#EFECE4] cursor-pointer"
                      >
                        <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <span className="w-8 text-center text-xs font-semibold font-sans-tabular">
                        {qty}
                      </span>
                      <button
                        type="button"
                        aria-label={`Increase quantity of ${dish.name}`}
                        onClick={() => setDishQty(dish.id, qty + 1)}
                        className="w-8 h-8 flex items-center justify-center text-[#141923] hover:bg-[#EFECE4] cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    <div className="w-20 text-right font-ledger text-base font-medium text-[#141923]">
                      {formatInr(lineTotal)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Real-time Profit Breakdown */}
          <div className="py-3.5 space-y-1.5 border-b border-[#DCD6CA] text-sm">
            <div className="flex justify-between text-[#525B6C]">
              <span>Estimated Real COGS (BOM)</span>
              <span className="font-sans-tabular">{formatInr(ticketTotals.cogs)}</span>
            </div>
            <div className="flex justify-between text-[#166534] font-medium">
              <span>Net Order Profit ({ticketTotals.margin.toFixed(1)}%)</span>
              <span className="font-sans-tabular">{formatInr(ticketTotals.profit)}</span>
            </div>
            <div className="flex justify-between items-baseline pt-1">
              <span className="font-semibold text-[#141923]">Payable Bill Total</span>
              <span className="font-ledger text-2xl font-medium text-[#141923]">
                {formatInr(ticketTotals.gross)}
              </span>
            </div>
          </div>

          {/* Payment Split Mode */}
          <div className="pt-4 space-y-3">
            <div className="text-xs font-medium text-[#525B6C]">Payment Mode</div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'UPI', label: 'UPI QR' },
                  { id: 'CASH', label: 'Cash Counter' },
                  { id: 'CARD', label: 'Card' },
                ] as { id: PaymentMethod; label: string }[]
              ).map((pm) => (
                <button
                  key={pm.id}
                  type="button"
                  onClick={() => setPaymentMethod(pm.id)}
                  className={`py-2.5 px-3 text-xs font-semibold border rounded-[2px] whitespace-nowrap transition-colors cursor-pointer ${
                    paymentMethod === pm.id
                      ? 'bg-[#141923] text-white border-[#141923]'
                      : 'bg-white text-[#141923] border-[#DCD6CA] hover:bg-[#F7F5F0]'
                  }`}
                >
                  {pm.label}
                </button>
              ))}
            </div>

            {paymentMethod === 'UPI' && ticketTotals.gross > 0 && (
              <UpiQrCode
                upiId={meta.upiId}
                shopName={meta.shopName}
                merchantCode={meta.merchantCode}
                amount={ticketTotals.gross}
                transactionRef={`APN${1041 + orders.length}A${Math.round(ticketTotals.gross * 100)}`}
                billNote={`Bill APN-${1041 + orders.length}`}
                onUpdateOwnerUpi={onUpdateOwnerUpi}
                onRecordSale={handleCheckout}
              />
            )}

            {errorMsg && (
              <div
                role="alert"
                className="text-xs text-[#991B1B] bg-[#FEF2F2] border border-[#FCA5A5] rounded-[2px] px-3 py-2"
              >
                {errorMsg}
              </div>
            )}

            <button
              type="button"
              disabled={cartLines.length === 0 || isSubmitting}
              onClick={handleCheckout}
              className="w-full py-3 px-4 bg-[#C8511B] hover:bg-[#AD4314] disabled:bg-[#DCD6CA] disabled:text-[#525B6C] text-white text-sm font-semibold rounded-[2px] transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {isSubmitting
                ? 'Recording Sale & Depleting Stock...'
                : cartLines.length === 0
                  ? 'Select Items to Record Sale'
                  : `Record Sale · ${formatInr(ticketTotals.gross)}`}
            </button>
          </div>
        </section>
      </div>

      {/* Live Transaction & Atomic Depletion Stream */}
      <section
        aria-label="Live transaction and recipe depletion ledger"
        className="bg-white border border-[#DCD6CA] rounded-[2px] p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#DCD6CA]">
          <div>
            <h2 className="font-ledger text-xl font-medium text-[#141923]">
              Live Day Book & Atomic BOM Depletion Stream
            </h2>
            <p className="text-xs text-[#525B6C]">
              Every recorded sale atomically updates cash/UPI ledger, raw commodity balances, and true operating profit.
            </p>
          </div>
          <span className="text-xs font-sans-tabular text-[#525B6C]">
            Showing {orders.length} orders
          </span>
        </div>

        <div className="overflow-x-auto mt-2">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#DCD6CA] text-xs font-semibold text-[#525B6C]">
                <th className="py-2.5 pr-3 whitespace-nowrap">Order #</th>
                <th className="py-2.5 pr-3 whitespace-nowrap">Time</th>
                <th className="py-2.5 pr-3">Items Sold</th>
                <th className="py-2.5 pr-3">Atomic Stock Depleted</th>
                <th className="py-2.5 pr-3 whitespace-nowrap">Mode</th>
                <th className="py-2.5 pr-3 text-right whitespace-nowrap">Gross (₹)</th>
                <th className="py-2.5 pr-3 text-right whitespace-nowrap">COGS (₹)</th>
                <th className="py-2.5 text-right whitespace-nowrap">Net Profit (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCD6CA] font-sans-tabular">
              {orders.map((ord) => (
                <tr
                  key={ord.id}
                  onClick={() => setLastOrderReceipt(lastOrderReceipt?.id === ord.id ? null : ord)}
                  className="hover:bg-[#F7F5F0] transition-colors cursor-pointer"
                >
                  <td className="py-2.5 pr-3 font-mono-tabular text-xs font-medium text-[#141923] whitespace-nowrap">
                    {ord.orderNumber}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-[#525B6C] whitespace-nowrap">
                    {formatTimeShort(ord.timestamp)}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-[#141923]">
                    {ord.items.map((i) => `${i.dishName} ×${i.quantity}`).join(', ')}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-[#525B6C]">
                    {ord.depletions
                      .map((d) => `${d.itemName} −${formatQty(d.quantityUsed, d.unit)}`)
                      .join(' · ')}
                  </td>
                  <td className="py-2.5 pr-3 text-xs font-medium text-[#141923] whitespace-nowrap">
                    {ord.paymentMethod}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-medium text-[#141923] whitespace-nowrap">
                    {formatInr(ord.grossTotal)}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-[#525B6C] whitespace-nowrap">
                    {formatInr(ord.totalCogs)}
                  </td>
                  <td className="py-2.5 text-right font-semibold text-[#166534] whitespace-nowrap">
                    {formatInr(ord.netProfit)} ({ord.grossMarginPct.toFixed(0)}%)
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
