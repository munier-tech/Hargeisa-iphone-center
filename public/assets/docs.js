/* HARGEISA IPHONE CENTER — professional documents: invoices, receipts, repair reports (print / Save as PDF).
   Shared by the staff app and the customer portal. Depends on core.js only. */
const Docs = (() => {
  const b = () => S.br || {}, pad = n => String(n).padStart(5, '0'), thermal = () => (b().doc_paper || 'A4') === 'thermal';
  const css = () => docCss() + `
    .meta{display:flex;justify-content:space-between;gap:20px;margin:18px 0 6px;font-size:13px}.meta div{flex:1}.meta b{display:block;color:#64748b;font-size:11px;letter-spacing:.8px;text-transform:uppercase;margin-bottom:2px}
    .docno{font-size:13px;color:#475569;text-align:right;margin-top:-6px}.docno b{color:var(--p);font-size:16px}
    table.items{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}table.items th{background:var(--p);color:#fff;padding:9px 10px;text-align:left}table.items td{padding:9px 10px;border-bottom:1px solid #d6deea}
    .r{text-align:right}table.tot{margin-left:auto;margin-top:12px;border-collapse:collapse;min-width:270px;font-size:13.5px}table.tot td{padding:6px 10px}table.tot tr.g td{border-top:2px solid var(--p);font-weight:800;font-size:15px}
    .stamp{position:absolute;right:60px;top:210px;transform:rotate(-14deg);border:4px solid #16a34a;color:#16a34a;font-weight:900;letter-spacing:3px;font-size:34px;padding:2px 16px;border-radius:8px;opacity:.28}
    .stamp.due{border-color:#d97706;color:#d97706}
    .terms{margin-top:22px;font-size:11.5px;color:#475569;line-height:1.55;border-top:1px dashed #cbd5e1;padding-top:10px}.terms b{color:#0f1b33}
    .sec{margin:20px 0 6px;font-size:13px;font-weight:800;color:var(--p);text-transform:uppercase;letter-spacing:1px}
    .tl2 div{padding:5px 0 5px 14px;border-left:3px solid var(--p);margin-left:4px;font-size:12.5px}.tl2 small{color:#64748b}
    body.thermal .sheet{padding:6px 4px;min-height:auto}body.thermal .lh img{width:44px;height:44px}body.thermal .lh h1{font-size:15px}body.thermal .lh p,body.thermal .lh small{font-size:9.5px}
    body.thermal{font-size:11.5px;width:76mm}body.thermal h2.dt{font-size:14px;margin:12px 0 8px}body.thermal .meta{flex-direction:column;gap:6px}body.thermal table.items th,body.thermal table.items td{padding:4px 3px;font-size:11px}
    body.thermal table.tot{min-width:100%}body.thermal .sig{margin-top:26px}body.thermal .stamp{top:130px;right:6px;font-size:18px}body.thermal .ft{position:static;margin-top:14px}body.thermal .band{height:3px}
    ${thermal() ? '@page{size:80mm auto;margin:2mm}' : '@page{margin:10mm}'}`;
  const parts = list => list.map(p => `<tr><td>${esc(p.name)}</td><td class="r">${p.qty}</td><td class="r">${p.unit_price !== undefined ? money(p.unit_price) : ''}</td><td class="r">${p.unit_price !== undefined ? money(p.qty * p.unit_price) : 'included'}</td></tr>`).join('');
  const stampOf = (bal, total) => total > 0.005 ? bal <= 0.005 : undefined;   // no stamp on a zero-value document
  const page = (title, no, inner, paid) => `<div class="sheet">${letterhead()}<h2 class="dt">${esc(title)}</h2><div class="docno">No. <b>${esc(no)}</b></div>${paid === true ? '<div class="stamp">PAID</div>' : paid === false ? '<div class="stamp due">BALANCE DUE</div>' : ''}${inner}
    <div class="terms">${b().doc_terms ? `<b>Terms & conditions:</b> ${esc(b().doc_terms)}<br>` : ''}${b().doc_note ? `${esc(b().doc_note)}` : ''}</div><div class="ft">${esc(b().footer || '')}</div></div>`;
  const shell = (title, html) => printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css()}</style></head><body class="${thermal() ? 'thermal' : ''}">${html}</body></html>`);
  const meta = (cust, phone, extra, label = 'Billed to') => `<div class="meta"><div><b>${label}</b>${esc(cust || 'Walk-in customer')}${phone ? `<br>${esc(phone)}` : ''}</div>${extra.map(e => `<div><b>${esc(e[0])}</b>${esc(e[1])}</div>`).join('')}</div>`;
  const totals = (charge, discount, paid) => { const bal = Math.max(0, charge - paid); return { bal, html: `<table class="tot"><tr><td>Subtotal</td><td class="r">${money(charge + discount)}</td></tr>${discount ? `<tr><td>Discount</td><td class="r">-${money(discount)}</td></tr>` : ''}<tr class="g"><td>Total</td><td class="r">${money(charge)}</td></tr><tr><td>Paid</td><td class="r">${money(paid)}</td></tr><tr><td><b>Balance</b></td><td class="r"><b>${money(bal)}</b></td></tr></table>` }; };
  const payRows = pays => pays.length ? `<div class="sec">Payments received</div><table class="items"><tr><th>Date</th><th>Method</th><th class="r">Amount</th></tr>${pays.map(p => `<tr><td>${fdate(p.date)}</td><td>${esc(p.method || '')}</td><td class="r">${money(p.amount)}</td></tr>`).join('')}</table>` : '';

  /* ---- normalise the three record types into one shape */
  const fromRepair = d => { const r = d.repair; return { kind: 'Hardware repair', no: `RP-${pad(r.id)}`, cust: r.customer_name, phone: r.phone, device: r.device, imei: r.imei, ts: r.received_at, expected: r.expected_date, problem: r.problem, diagnosis: r.diagnosis, status: r.status,
    lines: [{ name: `Repair service — ${r.device}`, qty: 1, unit_price: r.price }], parts: d.parts.map(p => ({ name: p.product, qty: p.qty })), discount: r.discount, charge: r.price - r.discount, pays: d.payments, events: d.events, by: r.created_name, tech: r.tech }; };
  const fromSoft = d => { const j = d.job, lab = { repair: 'Software repair', unlock: 'Apple Unlock', newid: 'New Apple ID' }[j.kind] || 'Software service'; return { kind: lab, no: `SW-${pad(j.id)}`, cust: j.customer_name, phone: j.phone, device: j.device, imei: j.imei || j.serial, ts: j.received_at, expected: j.expected_date, problem: j.problem, diagnosis: j.diagnosis, status: j.status,
    lines: [{ name: `${lab} — ${j.device}`, qty: 1, unit_price: j.price }], parts: d.parts.map(p => ({ name: p.product, qty: p.qty })), discount: j.discount, charge: j.price - j.discount, pays: d.payments, events: d.events, by: j.created_name, tech: j.tech }; };
  const fromSale = d => { const s = d.sale, prefix = b().doc_prefix || 'INV'; return { kind: 'Sale', no: `${prefix}-${pad(s.id)}`, cust: s.customer_name, phone: s.phone, ts: s.ts, date: s.date, lines: d.items.map(i => ({ name: i.name + (i.kind === 'service' ? ' (service)' : ''), qty: i.qty, unit_price: i.unit_price })), parts: [], discount: s.discount || 0, charge: s.total, pays: s.paid > 0 ? [{ date: s.date, method: s.method || 'Payment', amount: s.paid }] : [], by: s.by_name }; };
  const norm = (kind, d) => kind === 'repair' ? fromRepair(d) : kind === 'soft' ? fromSoft(d) : fromSale(d);

  const invoice = (kind, d, title = 'Invoice') => { const x = norm(kind, d), paid = x.pays.reduce((a, p) => a + p.amount, 0), t = totals(x.charge, x.discount, paid);
    const inner = meta(x.cust, x.phone, [['Date', fdate(x.date || x.ts)], ['Type', x.kind], ...(x.device ? [['Device', x.device + (x.imei ? ` • ${x.imei}` : '')]] : [])]) +
      `<table class="items"><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr>${parts(x.lines)}</table>` +
      (x.parts.length ? `<div class="sec">Parts used (included)</div><table class="items"><tr><th>Part</th><th class="r">Qty</th><th></th><th></th></tr>${parts(x.parts)}</table>` : '') + t.html + payRows(x.pays) +
      `<div class="sig"><div>Customer signature</div><div>Authorised by ${esc(x.by || b().company_name || '')}</div></div>`;
    shell(`${title} ${x.no}`, page(title, x.no, inner, stampOf(t.bal, x.charge))); };

  const receipt = (kind, d) => { const x = norm(kind, d), paid = x.pays.reduce((a, p) => a + p.amount, 0), last = x.pays[x.pays.length - 1], t = totals(x.charge, x.discount, paid);
    const inner = meta(x.cust, x.phone, [['Date', fdate(last?.date || x.date || x.ts)], ['For', x.kind + (x.device ? ' — ' + x.device : '')]]) +
      `<table class="items"><tr><th>Payment received</th><th>Method</th><th class="r">Amount</th></tr>${x.pays.map(p => `<tr><td>${fdate(p.date)}</td><td>${esc(p.method || '')}</td><td class="r">${money(p.amount)}</td></tr>`).join('') || '<tr><td colspan="3">No payment recorded yet.</td></tr>'}</table>` + t.html +
      `<div class="sig"><div>Customer signature</div><div>Received by ${esc(x.by || '')}</div></div>`;
    shell(`Receipt ${x.no}`, page('Payment Receipt', x.no.replace(/^(RP|SW|INV)/, 'RC'), inner, stampOf(t.bal, x.charge))); };

  /* device intake acknowledgement given to the customer when the phone is handed in */
  const intake = (kind, d) => { const x = norm(kind, d), inner = meta(x.cust, x.phone, [['Received', fdt(x.ts)], ['Expected ready', x.expected ? fdate(x.expected) : 'To be confirmed']]) +
    `<table class="kv" style="margin-top:14px"><tr><td>Device</td><td>${esc(x.device || '—')}</td></tr><tr><td>IMEI / Serial</td><td>${esc(x.imei || '—')}</td></tr><tr><td>Service</td><td>${esc(x.kind)}</td></tr><tr><td>Reported problem</td><td>${esc(x.problem || '—')}</td></tr><tr><td>Estimated charge</td><td>${x.lines[0]?.unit_price ? money(x.lines[0].unit_price) : 'To be confirmed'}</td></tr></table>
    <div class="warn">Please keep this slip. It is required to collect your device. ${esc(b().phone ? 'Call ' + b().phone + ' for progress updates, or track it in our customer portal.' : '')}</div>
    <div class="sig"><div>Customer signature</div><div>Received by ${esc(x.by || '')}</div></div>`;
    shell(`Intake ${x.no}`, page('Device Receipt', x.no, inner)); };

  /* full technical report (staff) */
  const report = (kind, d) => { const x = norm(kind, d), paid = x.pays.reduce((a, p) => a + p.amount, 0), t = totals(x.charge, x.discount, paid);
    const inner = meta(x.cust, x.phone, [['Received', fdt(x.ts)], ['Status', stLabel(x.status)], ['Technician', x.tech || '—']]) +
      `<table class="kv" style="margin-top:12px"><tr><td>Device</td><td>${esc(x.device)}${x.imei ? ' • ' + esc(x.imei) : ''}</td></tr><tr><td>Problem reported</td><td>${esc(x.problem || '—')}</td></tr><tr><td>Diagnosis</td><td>${esc(x.diagnosis || '—')}</td></tr></table>` +
      (x.parts.length ? `<div class="sec">Parts used</div><table class="items"><tr><th>Part</th><th class="r">Qty</th><th></th><th></th></tr>${parts(x.parts)}</table>` : '') +
      `<div class="sec">Progress history</div><div class="tl2">${[...(x.events || [])].reverse().map(e => `<div><b>${esc(stLabel(e.status))}</b> <small>${fdt(e.ts)}${e.by_name ? ' • ' + esc(e.by_name) : ''}</small>${e.note ? `<br>${esc(e.note)}` : ''}</div>`).join('')}</div>` + t.html;
    shell(`Report ${x.no}`, page('Repair Report', x.no, inner, stampOf(t.bal, x.charge))); };

  /* customer portal: a bill row from portal_bills */
  const portalBill = (bill, name, pays) => { const x = { paid: bill.paid }, t = totals(bill.total, 0, bill.paid);
    const inner = meta(name, '', [['Date', bill.date ? fdate(bill.date) : fdate(bill.ts)], ['Type', bill.kind]]) + `<table class="items"><tr><th>Description</th><th class="r">Amount</th></tr><tr><td>${esc(bill.kind)} — ${esc(bill.device || '')}</td><td class="r">${money(bill.total)}</td></tr></table>` + t.html + payRows(pays);
    shell(`Invoice ${bill.no}`, page('Invoice', bill.no, inner, stampOf(t.bal, bill.total))); };

  /* ---- accounting documents: quotation / invoice / payment receipt (from sdoc_get) and store bill (from bill_get) */
  const lineRows = ls => ls.map(l => ({ name: (l.item || l.description || '') + (l.item && l.description && l.description !== l.item ? ' — ' + l.description : ''), qty: +l.qty, unit_price: +(l.rate ?? l.cost) }));
  const voidStamp = st => st === 'void' ? '<div class="stamp due" style="border-color:#dc2626;color:#dc2626">VOID</div>' : '';
  const accTotals = (x, withPaid) => `<table class="tot"><tr><td>Subtotal</td><td class="r">${money(x.subtotal ?? x.total)}</td></tr>${+x.discount ? `<tr><td>Discount</td><td class="r">-${money(x.discount)}</td></tr>` : ''}${+x.tax ? `<tr><td>Tax (${+x.tax_rate}%)</td><td class="r">${money(x.tax)}</td></tr>` : ''}<tr class="g"><td>Total</td><td class="r">${money(x.total)}</td></tr>${withPaid ? `<tr><td>Paid</td><td class="r">${money(x.paid)}</td></tr><tr><td><b>Balance due</b></td><td class="r"><b>${money(Math.max(0, x.total - x.paid))}</b></td></tr>` : ''}</table>`;
  const itemsTbl = ls => `<table class="items"><tr><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr>${parts(lineRows(ls))}</table>`;
  const notes = t => t ? `<div class="sec">Notes</div><div style="font-size:12.5px;white-space:pre-wrap">${esc(t)}</div>` : '';
  const sdoc = d => { const x = d.doc, q = x.kind === 'quote', rc = x.kind === 'receipt', title = q ? 'Quotation' : rc ? 'Sales Receipt' : 'Invoice', p0 = d.payments[0];
    const inner = voidStamp(x.status) + meta(x.customer_name, x.phone || x.cphone, [['Date', fdate(x.date)], rc ? ['Paid by', p0 ? p0.method + (p0.ref ? ' • ' + p0.ref : '') : '—'] : [q ? 'Valid until' : 'Due date', x.due_date ? fdate(x.due_date) : (q ? '—' : 'On receipt')], ...(x.terms ? [['Terms', x.terms]] : []), ...(x.by_name ? [['Prepared by', x.by_name]] : [])], rc ? 'Sold to' : q ? 'Prepared for' : 'Billed to') +
      itemsTbl(d.lines) + accTotals(x, !q) + (q ? `<p style="font-size:12px;color:#475569;margin-top:14px">This quotation is not an invoice. Prices are valid until the date shown${x.due_date ? '' : ' by the shop'}.</p>` : rc ? '<p style="font-size:12px;color:#475569;margin-top:14px">Paid in full — thank you for your purchase.</p>' : payRows(d.payments)) + notes(x.notes) +
      `<div class="sig"><div>Customer signature</div><div>Authorised by ${esc(x.by_name || b().company_name || '')}</div></div>`;
    shell(`${title} ${x.number}`, page(title, x.number, inner, q || x.status === 'void' ? undefined : stampOf(Math.max(0, x.total - x.paid), x.total))); };
  const sdocReceipt = d => { const x = d.doc, last = d.payments[d.payments.length - 1];
    const inner = meta(x.customer_name, x.phone || x.cphone, [['Date', fdate(last?.date || x.date)], ['For invoice', x.number]]) +
      `<table class="items"><tr><th>Payment received</th><th>Method</th><th>Reference</th><th class="r">Amount</th></tr>${d.payments.map(p => `<tr><td>${fdate(p.date)}</td><td>${esc(p.method || '')}</td><td>${esc(p.ref || '')}</td><td class="r">${money(p.amount)}</td></tr>`).join('') || '<tr><td colspan="4">No payment recorded yet.</td></tr>'}</table>` + accTotals(x, true) +
      `<div class="sig"><div>Customer signature</div><div>Received by ${esc(last?.by_name || x.by_name || '')}</div></div>`;
    shell(`Receipt ${x.number}`, page('Payment Receipt', x.number.replace(/^[A-Z]+/, 'RC'), inner, stampOf(Math.max(0, x.total - x.paid), x.total))); };
  const bill = d => { const x = d.bill;
    const inner = voidStamp(x.status) + `<div class="meta"><div><b>Supplier / store</b>${esc(x.vendor)}${x.vendor_phone ? `<br>${esc(x.vendor_phone)}` : ''}</div><div><b>Date</b>${fdate(x.date)}</div><div><b>Due date</b>${x.due_date ? fdate(x.due_date) : '—'}</div><div><b>Store reference</b>${esc(x.ref || '—')}</div></div>` +
      itemsTbl(d.lines) + accTotals({ ...x, subtotal: x.total }, true) + payRows(d.payments) + notes(x.notes) + `<div class="sig"><div>Received by ${esc(x.by_name || '')}</div><div>Supplier signature</div></div>`;
    shell(`Bill ${x.number}`, page('Purchase Bill', x.number, inner, x.status === 'void' ? undefined : stampOf(Math.max(0, x.total - x.paid), x.total))); };

  return { invoice, receipt, intake, report, portalBill, sdoc, sdocReceipt, bill, chooser: (kind, d, opts = {}) => {
    const m = modal({ title: `${ic('file')} Documents`, size: 'sm', body: `<p class="muted" style="margin-top:0">Choose a document. It opens the print dialog — pick <b>Save as PDF</b> to make a PDF.</p><div class="docs-list">
      ${opts.noIntake ? '' : `<button class="btn" data-dk="intake">${ic('mobile')} Device receipt (intake slip)</button>`}<button class="btn" data-dk="invoice">${ic('file')} Invoice</button><button class="btn" data-dk="receipt">${ic('dollar')} Payment receipt</button>${opts.noReport ? '' : `<button class="btn" data-dk="report">${ic('tool')} Full repair report</button>`}</div>`, footer: '<button class="btn" data-close>Close</button>' });
    $$('[data-dk]', m.el).forEach(bt => bt.onclick = () => { ({ intake, invoice, receipt, report })[bt.dataset.dk](kind, d); }); } };
})();
