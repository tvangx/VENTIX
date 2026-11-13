export interface InvoiceInput {
  id: string;
  order_id: string;
  items: { category: string; amount_vnd: string; vat_rate: string }[];
}

/** Adapter thật phải bảo đảm cùng idempotency key không phát hành thêm sau timeout/restart. */
export interface IInvoiceAdapter {
  issue(invoice: InvoiceInput, signal: AbortSignal): Promise<{ invoice_no: string }>;
}

/** Chỉ minh họa lần mua gốc, không phải hóa đơn thuế hoặc số do MISA cấp. */
export class MockAdapter implements IInvoiceAdapter {
  async issue(invoice: InvoiceInput, signal: AbortSignal): Promise<{ invoice_no: string }> {
    signal.throwIfAborted();
    return { invoice_no: `MOCK-${invoice.id}` };
  }
}
