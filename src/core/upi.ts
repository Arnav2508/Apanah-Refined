export interface UpiPaymentUriParams {
  upiId: string;
  shopName: string;
  amount: number;
  transactionRef: string;
  note?: string;
  merchantCode?: string;
}

const UPI_VPA_REGEX = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;

export function isValidUpiId(upiId: string): boolean {
  return UPI_VPA_REGEX.test(upiId.trim());
}

export function buildUpiPaymentUri(params: UpiPaymentUriParams): string {
  const pa = params.upiId.trim();
  if (!isValidUpiId(pa)) {
    throw new Error('Invalid owner UPI ID format (expected e.g. shopname@okaxis).');
  }
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error('Bill amount must be greater than zero to generate a payment QR.');
  }

  const query = new URLSearchParams();
  query.set('pa', pa);
  query.set('pn', params.shopName.trim() || 'Merchant');
  query.set('am', params.amount.toFixed(2));
  query.set('cu', 'INR');
  if (params.transactionRef.trim()) {
    query.set('tr', params.transactionRef.trim());
  }
  if (params.note && params.note.trim()) {
    query.set('tn', params.note.trim().slice(0, 50));
  }
  if (params.merchantCode && /^\d{4}$/.test(params.merchantCode.trim())) {
    query.set('mc', params.merchantCode.trim());
  }

  return `upi://pay?${query.toString()}`;
}
