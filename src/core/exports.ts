import type { PaymentMethod, StoreState } from './types';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatTallyDate(isoDateOrTimestamp: string): string {
  const datePart = isoDateOrTimestamp.slice(0, 10); // YYYY-MM-DD
  return datePart.replace(/-/g, '');
}

function ledgerNameForPayment(method: PaymentMethod): string {
  switch (method) {
    case 'UPI':
      return 'UPI Bank Account';
    case 'CASH':
      return 'Cash-in-Hand';
    case 'CARD':
      return 'Card Settlement Ledger';
  }
}

export function generateTallyDayBookXml(state: StoreState): string {
  const companyName = escapeXml(state.meta.shopName);

  const salesMessages = state.orders
    .map((order) => {
      const tallyDate = formatTallyDate(order.timestamp);
      const debitLedger = escapeXml(ledgerNameForPayment(order.paymentMethod));
      const amountStr = order.grossTotal.toFixed(2);
      const narration = escapeXml(
        `Apanah POS ${order.orderNumber} (${order.paymentMethod}) | ${order.items
          .map((i) => `${i.dishName} x${i.quantity}`)
          .join(', ')} | COGS INR ${order.totalCogs.toFixed(2)}`
      );

      return `      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="Sales" ACTION="Create">
          <DATE>${tallyDate}</DATE>
          <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${escapeXml(order.orderNumber)}</VOUCHERNUMBER>
          <PARTYLEDGERNAME>${debitLedger}</PARTYLEDGERNAME>
          <NARRATION>${narration}</NARRATION>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${debitLedger}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${amountStr}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Counter Sales</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${amountStr}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </TALLYMESSAGE>`;
    })
    .join('\n');

  const purchaseMessages = state.invoices
    .map((inv) => {
      const tallyDate = formatTallyDate(inv.invoiceDate || inv.confirmedAt);
      const vendorLedger = escapeXml(inv.vendorName);
      const totalStr = inv.totalAmount.toFixed(2);
      const narration = escapeXml(
        `Apanah Purchase ${inv.invoiceNumber} | ${inv.lines
          .map((l) => `${l.itemName} ${l.quantity}${l.unit}`)
          .join(', ')}`
      );

      return `      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="Purchase" ACTION="Create">
          <DATE>${tallyDate}</DATE>
          <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${escapeXml(inv.invoiceNumber)}</VOUCHERNUMBER>
          <PARTYLEDGERNAME>${vendorLedger}</PARTYLEDGERNAME>
          <NARRATION>${narration}</NARRATION>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Raw Material Purchases</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${totalStr}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${vendorLedger}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${totalStr}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </TALLYMESSAGE>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
${salesMessages}${purchaseMessages ? '\n' + purchaseMessages : ''}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function escapeCsvCell(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateVyaparSalesCsv(state: StoreState): string {
  const headers = [
    'Date',
    'Invoice No',
    'Party Name',
    'Payment Mode',
    'Item Name',
    'Qty',
    'Unit Price (INR)',
    'Line Total (INR)',
    'Real COGS (INR)',
    'Net Profit (INR)',
  ];

  const rows: string[] = [headers.map(escapeCsvCell).join(',')];

  for (const order of state.orders) {
    const dateStr = order.timestamp.slice(0, 10);
    for (const item of order.items) {
      const lineProfit = Math.round((item.lineTotal - item.lineCogs) * 100) / 100;
      rows.push(
        [
          dateStr,
          order.orderNumber,
          'Walk-in Counter Customer',
          order.paymentMethod,
          item.dishName,
          item.quantity,
          item.unitPrice.toFixed(2),
          item.lineTotal.toFixed(2),
          item.lineCogs.toFixed(2),
          lineProfit.toFixed(2),
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
  }

  return rows.join('\n');
}

export function generateVyaparPurchasesCsv(state: StoreState): string {
  const headers = [
    'Invoice Date',
    'Supplier Bill No',
    'Supplier Name',
    'Item Name',
    'Qty',
    'Unit',
    'Purchase Rate (INR)',
    'Blended New Rate (INR)',
    'Line Total (INR)',
  ];

  const rows: string[] = [headers.map(escapeCsvCell).join(',')];

  for (const inv of state.invoices) {
    for (const line of inv.lines) {
      const lineTotal = Math.round(line.quantity * line.incomingUnitCost * 100) / 100;
      rows.push(
        [
          inv.invoiceDate,
          inv.invoiceNumber,
          inv.vendorName,
          line.itemName,
          line.quantity,
          line.unit,
          line.incomingUnitCost.toFixed(2),
          line.blendedUnitCost.toFixed(2),
          lineTotal.toFixed(2),
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
  }

  return rows.join('\n');
}
