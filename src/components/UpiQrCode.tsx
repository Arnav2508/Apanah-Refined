import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Maximize2, Pencil, X } from 'lucide-react';
import { buildUpiPaymentUri, isValidUpiId } from '../core/upi';

interface UpiQrCodeProps {
  upiId: string;
  shopName: string;
  merchantCode?: string;
  amount: number;
  transactionRef: string;
  billNote: string;
  onUpdateOwnerUpi: (payload: {
    upiId: string;
    shopName: string;
    merchantCode?: string;
  }) => Promise<void>;
  onRecordSale?: () => Promise<void>;
}

export const UpiQrCode: React.FC<UpiQrCodeProps> = ({
  upiId,
  shopName,
  merchantCode,
  amount,
  transactionRef,
  billNote,
  onUpdateOwnerUpi,
  onRecordSale,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [largeQrDataUrl, setLargeQrDataUrl] = useState<string>('');
  const [showLargeModal, setShowLargeModal] = useState(false);

  const [isEditingOwner, setIsEditingOwner] = useState(false);
  const [draftUpiId, setDraftUpiId] = useState(upiId);
  const [draftShopName, setDraftShopName] = useState(shopName);
  const [draftMcc, setDraftMcc] = useState(merchantCode ?? '');
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [isSavingOwner, setIsSavingOwner] = useState(false);

  useEffect(() => {
    setDraftUpiId(upiId);
    setDraftShopName(shopName);
    setDraftMcc(merchantCode ?? '');
  }, [upiId, shopName, merchantCode]);

  const upiUri = useMemo(() => {
    try {
      return buildUpiPaymentUri({
        upiId,
        shopName,
        amount,
        transactionRef,
        note: billNote,
        merchantCode,
      });
    } catch {
      return '';
    }
  }, [upiId, shopName, amount, transactionRef, billNote, merchantCode]);

  useEffect(() => {
    let active = true;
    if (!upiUri) {
      setQrDataUrl('');
      setLargeQrDataUrl('');
      return;
    }

    QRCode.toDataURL(upiUri, {
      width: 192,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#141923', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });

    QRCode.toDataURL(upiUri, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#141923', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setLargeQrDataUrl(url);
      })
      .catch(() => {
        if (active) setLargeQrDataUrl('');
      });

    return () => {
      active = false;
    };
  }, [upiUri]);

  const handleSaveOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    setOwnerError(null);
    if (!isValidUpiId(draftUpiId)) {
      setOwnerError('Enter a valid UPI ID (e.g. yourname@okaxis or 9822xxxxxx@ybl).');
      return;
    }
    if (!draftShopName.trim()) {
      setOwnerError('Payee / shop name is required.');
      return;
    }
    setIsSavingOwner(true);
    try {
      await onUpdateOwnerUpi({
        upiId: draftUpiId.trim(),
        shopName: draftShopName.trim(),
        merchantCode: draftMcc.trim() || undefined,
      });
      setIsEditingOwner(false);
    } catch (err) {
      setOwnerError(err instanceof Error ? err.message : 'Failed to save owner UPI ID');
    } finally {
      setIsSavingOwner(false);
    }
  };

  return (
    <div className="border border-[#DCD6CA] bg-[#F7F5F0] rounded-[2px] p-3 space-y-2.5">
      <div className="flex items-start gap-3">
        <div className="w-24 h-24 bg-white border border-[#DCD6CA] rounded-[2px] p-1 shrink-0 flex items-center justify-center">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`Scannable UPI Payment QR for ${amount.toFixed(2)} INR to ${upiId}`}
              className="w-full h-full object-contain"
            />
          ) : (
            <span className="text-[10px] text-[#525B6C] text-center">Invalid UPI ID</span>
          )}
        </div>

        <div className="min-w-0 flex-1 text-xs space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-[#141923]">Dynamic Bill UPI QR</span>
            <button
              type="button"
              onClick={() => setIsEditingOwner((prev) => !prev)}
              aria-label="Edit owner UPI ID"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#525B6C] hover:text-[#141923] underline underline-offset-2 cursor-pointer"
            >
              <Pencil className="w-3 h-3" aria-hidden="true" />
              {isEditingOwner ? 'Cancel' : 'Owner UPI'}
            </button>
          </div>

          <div className="text-[#525B6C]">
            Payee: <span className="font-medium text-[#141923]">{shopName}</span>
          </div>
          <div className="font-mono-tabular text-[#525B6C] truncate" title={upiId}>
            {upiId}
          </div>
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="font-ledger text-base font-medium text-[#141923]">
              Locked: ₹{amount.toFixed(2)}
            </span>
            <button
              type="button"
              onClick={() => setShowLargeModal(true)}
              disabled={!largeQrDataUrl}
              className="inline-flex items-center gap-1 px-2 py-1 border border-[#DCD6CA] bg-white hover:bg-[#EFECE4] text-[11px] font-semibold text-[#141923] rounded-[2px] whitespace-nowrap cursor-pointer"
            >
              <Maximize2 className="w-3 h-3" aria-hidden="true" />
              Customer QR
            </button>
          </div>
          <div className="text-[11px] font-mono-tabular text-[#525B6C] truncate">
            Ref {transactionRef}
          </div>
        </div>
      </div>

      {isEditingOwner && (
        <form
          onSubmit={handleSaveOwner}
          className="pt-2.5 border-t border-[#DCD6CA] space-y-2"
        >
          <div className="text-[11px] font-semibold text-[#141923]">
            Route All Counter Payments to Owner Bank Account
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-[#525B6C] mb-0.5">
                Owner UPI ID (VPA)
              </label>
              <input
                type="text"
                required
                value={draftUpiId}
                onChange={(e) => setDraftUpiId(e.target.value)}
                placeholder="e.g. owner@okaxis"
                aria-label="Owner UPI ID"
                className="w-full px-2 py-1.5 text-xs font-mono-tabular border border-[#DCD6CA] bg-white rounded-[2px] text-[#141923]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#525B6C] mb-0.5">
                Owner / Shop Display Name
              </label>
              <input
                type="text"
                required
                value={draftShopName}
                onChange={(e) => setDraftShopName(e.target.value)}
                aria-label="Owner Display Name"
                className="w-full px-2 py-1.5 text-xs border border-[#DCD6CA] bg-white rounded-[2px] text-[#141923]"
              />
            </div>
          </div>
          <div className="flex items-end justify-between gap-2">
            <div className="w-36">
              <label className="block text-[11px] text-[#525B6C] mb-0.5">
                Merchant MCC (optional)
              </label>
              <input
                type="text"
                maxLength={4}
                value={draftMcc}
                onChange={(e) => setDraftMcc(e.target.value)}
                placeholder="e.g. 5814"
                aria-label="Merchant Category Code"
                className="w-full px-2 py-1 text-xs font-mono-tabular border border-[#DCD6CA] bg-white rounded-[2px] text-[#141923]"
              />
            </div>
            <button
              type="submit"
              disabled={isSavingOwner}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#141923] hover:bg-[#232B3B] text-white text-xs font-semibold rounded-[2px] cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              {isSavingOwner ? 'Saving...' : 'Save Owner UPI'}
            </button>
          </div>
          {ownerError && (
            <div role="alert" className="text-[11px] text-[#991B1B]">
              {ownerError}
            </div>
          )}
        </form>
      )}

      {showLargeModal && largeQrDataUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Customer Counter UPI Payment QR"
          className="fixed inset-0 z-50 bg-[#141923]/60 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-[#DCD6CA] rounded-[2px] max-w-sm w-full p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#DCD6CA]">
              <div>
                <h3 className="font-ledger text-xl font-medium text-[#141923]">
                  Scan to Pay Owner
                </h3>
                <p className="text-xs text-[#525B6C]">{shopName}</p>
              </div>
              <button
                type="button"
                aria-label="Close customer QR modal"
                onClick={() => setShowLargeModal(false)}
                className="p-1.5 border border-[#DCD6CA] rounded-[2px] text-[#525B6C] hover:text-[#141923] cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="bg-[#F7F5F0] border border-[#DCD6CA] rounded-[2px] p-4 flex flex-col items-center">
              <img
                src={largeQrDataUrl}
                alt={`Large scannable UPI QR for ${amount.toFixed(2)} INR`}
                className="w-64 h-64 bg-white p-2 border border-[#DCD6CA]"
              />
              <div className="mt-3 text-center">
                <div className="font-ledger text-3xl font-medium text-[#141923]">
                  ₹{amount.toFixed(2)}
                </div>
                <div className="text-xs font-mono-tabular text-[#525B6C] mt-1">
                  To: {upiId}
                </div>
                <div className="text-[11px] text-[#525B6C] mt-0.5">
                  Ref {transactionRef} · GPay / PhonePe / Paytm / BHIM
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowLargeModal(false)}
                className="flex-1 py-2.5 px-3 border border-[#DCD6CA] bg-white hover:bg-[#F7F5F0] text-xs font-semibold text-[#141923] rounded-[2px] cursor-pointer"
              >
                Close
              </button>
              {onRecordSale && (
                <button
                  type="button"
                  onClick={async () => {
                    await onRecordSale();
                    setShowLargeModal(false);
                  }}
                  className="flex-1 py-2.5 px-3 bg-[#C8511B] hover:bg-[#AD4314] text-white text-xs font-semibold rounded-[2px] cursor-pointer"
                >
                  Confirm Paid & Record
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
