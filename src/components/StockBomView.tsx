import React, { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type {
  BomComponent,
  InventoryItem,
  InventoryTier,
  MenuDish,
  UnitType,
} from '../core/types';
import { calculateDishUnitCost, roundMoney } from '../core/engine';
import { formatInr, formatQty } from '../utils/format';

interface StockBomViewProps {
  inventory: InventoryItem[];
  menu: MenuDish[];
  onAddInventoryItem: (item: {
    name: string;
    tier: InventoryTier;
    unit: UnitType;
    currentStock: number;
    minThreshold: number;
    unitCost: number;
  }) => Promise<void>;
  onUpdateThreshold: (inventoryId: string, minThreshold: number) => Promise<void>;
  onUpdateDishBom: (dishId: string, bom: BomComponent[]) => Promise<void>;
}

type TierFilter = 'all' | 'raw' | 'retail';

export const StockBomView: React.FC<StockBomViewProps> = ({
  inventory,
  menu,
  onAddInventoryItem,
  onUpdateThreshold,
  onUpdateDishBom,
}) => {
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDishId, setSelectedDishId] = useState<string>(menu[0]?.id ?? '');
  const [editingBom, setEditingBom] = useState<BomComponent[] | null>(null);
  const [bomSaving, setBomSaving] = useState(false);
  const [bomStatus, setBomStatus] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTier, setNewTier] = useState<InventoryTier>('raw');
  const [newUnit, setNewUnit] = useState<UnitType>('kg');
  const [newStock, setNewStock] = useState('5');
  const [newThreshold, setNewThreshold] = useState('2');
  const [newCost, setNewCost] = useState('100');
  const [addError, setAddError] = useState<string | null>(null);

  const inventoryMap = useMemo(
    () => new Map(inventory.map((i) => [i.id, i])),
    [inventory]
  );

  const filteredInventory = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return inventory.filter((item) => {
      if (tierFilter !== 'all' && item.tier !== tierFilter) return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [inventory, tierFilter, searchQuery]);

  const selectedDish = useMemo(
    () => menu.find((m) => m.id === selectedDishId) ?? menu[0],
    [menu, selectedDishId]
  );

  const activeBom = editingBom ?? selectedDish?.bom ?? [];

  const handleSelectDish = (dishId: string) => {
    setSelectedDishId(dishId);
    setEditingBom(null);
    setBomStatus(null);
  };

  const handleBomQtyChange = (idx: number, qty: number) => {
    const base = [...activeBom];
    base[idx] = { ...base[idx], quantity: Math.max(0, qty) };
    setEditingBom(base);
    setBomStatus(null);
  };

  const handleSaveBom = async () => {
    if (!selectedDish || !editingBom || bomSaving) return;
    setBomSaving(true);
    setBomStatus(null);
    try {
      await onUpdateDishBom(selectedDish.id, editingBom);
      setEditingBom(null);
      setBomStatus(`Saved recipe BOM for ${selectedDish.name}.`);
    } finally {
      setBomSaving(false);
    }
  };

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    if (!newName.trim()) {
      setAddError('Item name is required.');
      return;
    }
    try {
      await onAddInventoryItem({
        name: newName.trim(),
        tier: newTier,
        unit: newUnit,
        currentStock: parseFloat(newStock) || 0,
        minThreshold: parseFloat(newThreshold) || 0,
        unitCost: parseFloat(newCost) || 0,
      });
      setNewName('');
      setShowAddForm(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add item');
    }
  };

  return (
    <div className="space-y-6">
      {/* Dual-Tier Inventory Ledger */}
      <section
        aria-label="Dual-tier inventory ledger"
        className="bg-white border border-[#DCD6CA] rounded-[2px] p-4 sm:p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#DCD6CA]">
          <div>
            <h2 className="font-ledger text-xl font-medium text-[#141923]">
              Dual-Tier Commodity & Retail SKU Ledger
            </h2>
            <p className="text-xs text-[#525B6C] mt-0.5">
              Simultaneous tracking of raw culinary commodities (fractional BOM depletion) and direct 1-to-1 retail SKUs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-[#525B6C] absolute left-2.5 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search stock..."
                aria-label="Search inventory items"
                className="pl-8 pr-3 py-1.5 text-xs border border-[#DCD6CA] rounded-[2px] bg-[#F7F5F0] text-[#141923] w-44"
              />
            </div>

            <div
              role="tablist"
              aria-label="Filter inventory tier"
              className="flex items-center gap-1 bg-[#F7F5F0] border border-[#DCD6CA] p-1 rounded-[2px]"
            >
              {(
                [
                  { id: 'all', label: 'All Tiers' },
                  { id: 'raw', label: 'Raw Commodities' },
                  { id: 'retail', label: 'Retail SKUs' },
                ] as { id: TierFilter; label: string }[]
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tierFilter === t.id}
                  onClick={() => setTierFilter(t.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-[2px] whitespace-nowrap cursor-pointer ${
                    tierFilter === t.id
                      ? 'bg-[#141923] text-white'
                      : 'text-[#525B6C] hover:text-[#141923]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowAddForm(!showAddForm)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#C8511B] hover:bg-[#AD4314] text-white text-xs font-semibold rounded-[2px] whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Add Stock Item
            </button>
          </div>
        </div>

        {showAddForm && (
          <form
            onSubmit={handleCreateItem}
            className="p-4 bg-[#F7F5F0] border border-[#DCD6CA] rounded-[2px] grid grid-cols-1 sm:grid-cols-6 gap-3 items-end"
          >
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-[#525B6C] mb-1">
                Commodity / SKU Name
              </label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Besan Flour"
                className="w-full px-2.5 py-1.5 text-xs border border-[#DCD6CA] rounded-[2px] bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#525B6C] mb-1">
                Tier
              </label>
              <select
                value={newTier}
                onChange={(e) => setNewTier(e.target.value as InventoryTier)}
                className="w-full px-2 py-1.5 text-xs border border-[#DCD6CA] rounded-[2px] bg-white"
              >
                <option value="raw">Raw Commodity</option>
                <option value="retail">Retail SKU</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#525B6C] mb-1">
                Unit
              </label>
              <select
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value as UnitType)}
                className="w-full px-2 py-1.5 text-xs border border-[#DCD6CA] rounded-[2px] bg-white"
              >
                <option value="kg">kg</option>
                <option value="litre">litre</option>
                <option value="pcs">pcs</option>
                <option value="pack">pack</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-[#525B6C] mb-1">
                  Qty
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={newStock}
                  onChange={(e) => setNewStock(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-[#DCD6CA] rounded-[2px] bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#525B6C] mb-1">
                  Rate ₹
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={newCost}
                  onChange={(e) => setNewCost(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-[#DCD6CA] rounded-[2px] bg-white"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 py-1.5 px-3 bg-[#141923] text-white text-xs font-semibold rounded-[2px] cursor-pointer"
              >
                Save Item
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="py-1.5 px-2.5 border border-[#DCD6CA] bg-white text-xs rounded-[2px] cursor-pointer"
              >
                Cancel
              </button>
            </div>
            {addError && (
              <div className="sm:col-span-6 text-xs text-[#991B1B]">{addError}</div>
            )}
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#DCD6CA] text-xs font-semibold text-[#525B6C]">
                <th className="py-2.5 pr-3">Item Name</th>
                <th className="py-2.5 pr-3">Tier</th>
                <th className="py-2.5 pr-3 text-right">On-Hand Stock</th>
                <th className="py-2.5 pr-3 text-right">Min Alert Level</th>
                <th className="py-2.5 pr-3 text-right">Weighted Unit Cost</th>
                <th className="py-2.5 pr-3 text-right">Stock Valuation</th>
                <th className="py-2.5 text-right">Stock State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCD6CA] font-sans-tabular">
              {filteredInventory.map((item) => {
                const isLow = item.currentStock <= item.minThreshold;
                const stockValue = roundMoney(item.currentStock * item.unitCost);
                return (
                  <tr key={item.id} className="hover:bg-[#F7F5F0]">
                    <td className="py-2.5 pr-3 font-medium text-[#141923]">
                      {item.name}
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-[#525B6C]">
                      {item.tier === 'raw' ? 'Raw Commodity' : 'Retail SKU'}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-[#141923]">
                      {formatQty(item.currentStock, item.unit)}
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        aria-label={`Minimum threshold for ${item.name}`}
                        defaultValue={item.minThreshold}
                        onBlur={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!Number.isNaN(val) && val !== item.minThreshold && val >= 0) {
                            onUpdateThreshold(item.id, val);
                          }
                        }}
                        className="w-16 px-1.5 py-0.5 text-right text-xs border border-[#DCD6CA] rounded-[2px] bg-white"
                      />
                      <span className="inline-block w-9 text-left text-xs text-[#525B6C] ml-1.5">{item.unit}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-[#141923]">
                      {formatInr(item.unitCost)}/{item.unit}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-medium text-[#141923]">
                      {formatInr(stockValue)}
                    </td>
                    <td className="py-2.5 text-right text-xs font-semibold">
                      {isLow ? (
                        <span className="text-[#9A3412]">Low Stock · Reorder</span>
                      ) : (
                        <span className="text-[#166534]">Nominal</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Multi-Echelon Culinary BOM Inspector */}
      <section
        aria-label="Culinary Bill of Materials recipe matrix"
        className="bg-white border border-[#DCD6CA] rounded-[2px] p-4 sm:p-5 space-y-4"
      >
        <div className="pb-3 border-b border-[#DCD6CA]">
          <h2 className="font-ledger text-xl font-medium text-[#141923]">
            Multi-Echelon Culinary Recipe BOM Matrix
          </h2>
          <p className="text-xs text-[#525B6C] mt-0.5">
            Select any dish or SKU to inspect component consumption weights and live weighted-average COGS.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-5 divide-y divide-[#DCD6CA] border border-[#DCD6CA] rounded-[2px]">
            {menu.map((dish) => {
              const cogs = calculateDishUnitCost(dish, inventoryMap);
              const active = dish.id === selectedDish?.id;
              return (
                <button
                  key={dish.id}
                  type="button"
                  onClick={() => handleSelectDish(dish.id)}
                  className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                    active ? 'bg-[#F7F5F0]' : 'bg-white hover:bg-[#F7F5F0]'
                  }`}
                >
                  <div>
                    <div className="text-sm font-semibold text-[#141923]">
                      {dish.name}
                    </div>
                    <div className="text-xs text-[#525B6C]">
                      {dish.category} · {dish.bom.length} components
                    </div>
                  </div>
                  <div className="text-right font-sans-tabular">
                    <div className="text-sm font-semibold text-[#141923]">
                      Sell ₹{dish.sellingPrice}
                    </div>
                    <div className="text-xs text-[#525B6C]">
                      COGS {formatInr(cogs)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedDish && (
            <div className="lg:col-span-7 border border-[#DCD6CA] rounded-[2px] p-4 space-y-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3 border-b border-[#DCD6CA]">
                <div>
                  <h3 className="font-ledger text-lg font-medium text-[#141923]">
                    {selectedDish.name} — Recipe Formula
                  </h3>
                  <div className="text-xs text-[#525B6C]">
                    Selling Price ₹{selectedDish.sellingPrice.toFixed(2)} · Real Unit COGS{' '}
                    {formatInr(
                      calculateDishUnitCost(
                        { ...selectedDish, bom: activeBom },
                        inventoryMap
                      )
                    )}
                  </div>
                </div>
                {editingBom && (
                  <button
                    type="button"
                    onClick={handleSaveBom}
                    disabled={bomSaving}
                    className="px-3.5 py-1.5 bg-[#141923] text-white text-xs font-semibold rounded-[2px] cursor-pointer"
                  >
                    {bomSaving ? 'Saving...' : 'Save Recipe BOM'}
                  </button>
                )}
              </div>

              {bomStatus && (
                <div className="text-xs text-[#166534] bg-[#F0FDF4] border border-[#86EFAC] rounded-[2px] px-3 py-2">
                  {bomStatus}
                </div>
              )}

              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#DCD6CA] text-[#525B6C] font-semibold">
                    <th className="py-2 pr-3">Component Ingredient / SKU</th>
                    <th className="py-2 pr-3 text-right">Qty per Serving</th>
                    <th className="py-2 pr-3 text-right">Unit Cost</th>
                    <th className="py-2 text-right">Line COGS (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DCD6CA] font-sans-tabular">
                  {activeBom.map((comp, idx) => {
                    const item = inventoryMap.get(comp.inventoryId);
                    if (!item) return null;
                    const lineCost = roundMoney(comp.quantity * item.unitCost);
                    return (
                      <tr key={comp.inventoryId}>
                        <td className="py-2.5 pr-3 font-medium text-[#141923]">
                          {item.name}
                        </td>
                        <td className="py-2.5 pr-3 text-right">
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            aria-label={`Recipe quantity of ${item.name} for ${selectedDish.name}`}
                            value={comp.quantity}
                            onChange={(e) =>
                              handleBomQtyChange(idx, parseFloat(e.target.value) || 0)
                            }
                            className="w-20 px-2 py-1 border border-[#DCD6CA] rounded-[2px] text-right"
                          />
                          <span className="ml-1.5 text-[#525B6C]">{item.unit}</span>
                        </td>
                        <td className="py-2.5 pr-3 text-right text-[#525B6C]">
                          {formatInr(item.unitCost)}/{item.unit}
                        </td>
                        <td className="py-2.5 text-right font-semibold text-[#141923]">
                          {formatInr(lineCost)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
