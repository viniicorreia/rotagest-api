import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { CellValue, Report, ReportColumn } from './report.types';

const REGIME: Record<Report['regime'], string> = {
  CASH: 'Regime de caixa (data efetiva de pagamentos e recebimentos)',
  ACCRUAL: 'Competência gerencial (mês a que o lançamento pertence)',
  DUE: 'Pelo vencimento',
  OPERATIONAL: 'Dados operacionais',
};

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

export function monthLabel(m: string) {
  const [y, mm] = m.split('-');
  return `${mm}/${y}`;
}

function periodLabel(r: Report) {
  return r.from === r.to ? monthLabel(r.from) : `${monthLabel(r.from)} a ${monthLabel(r.to)}`;
}

/** Texto do valor como aparece no PDF (pt-BR). */
export function formatCell(type: ReportColumn['type'], v: CellValue): string {
  if (v === null || v === undefined || v === '') return '—';
  switch (type) {
    case 'money':
      return brl.format(Number(v));
    case 'number':
      return num.format(Number(v));
    case 'percent':
      return `${num.format(Number(v))}%`;
    case 'date': {
      const [y, m, d] = String(v).split('-');
      return `${d}/${m}/${y}`;
    }
    case 'month':
      return /^\d{4}-\d{2}$/.test(String(v)) ? monthLabel(String(v)) : String(v);
    default:
      return String(v);
  }
}

export async function toXlsx(r: Report, companyName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RotaGest';
  wb.created = new Date();
  r.sections.forEach((s, i) => {
    const name = (s.title || r.title).replace(/[\\/*?:[\]]/g, ' ').slice(0, 28) || `Planilha ${i + 1}`;
    const ws = wb.addWorksheet(r.sections.filter((x) => x.title === s.title).length > 1 ? `${name} ${i + 1}` : name);
    ws.addRow([r.title]).font = { bold: true, size: 14 };
    ws.addRow([`${companyName} · ${periodLabel(r)}`]);
    ws.addRow([REGIME[r.regime]]).font = { italic: true, color: { argb: 'FF64748B' } };
    for (const [k, v] of Object.entries(r.filters)) ws.addRow([`${k}: ${v}`]);
    ws.addRow([]);
    if (r.sections.length > 1) ws.addRow([s.title]).font = { bold: true };
    const header = ws.addRow(s.columns.map((c) => c.label));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
    });
    const value = (c: ReportColumn, v: CellValue) => {
      if (v === null || v === undefined) return null;
      if (c.type === 'money' || c.type === 'number') return Number(v);
      if (c.type === 'percent') return Number(v) / 100;
      if (c.type === 'date') return new Date(`${v}T00:00:00Z`);
      if (c.type === 'month' && /^\d{4}-\d{2}$/.test(String(v))) return monthLabel(String(v));
      return v;
    };
    for (const row of s.rows) ws.addRow(s.columns.map((c) => value(c, row[c.key])));
    if (s.totals) ws.addRow(s.columns.map((c) => value(c, s.totals![c.key] ?? null))).font = { bold: true };
    s.columns.forEach((c, idx) => {
      const col = ws.getColumn(idx + 1);
      col.width = c.type === 'text' ? 32 : 16;
      if (c.type === 'money') col.numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
      if (c.type === 'percent') col.numFmt = '0.00%';
      if (c.type === 'date') col.numFmt = 'dd/mm/yyyy';
    });
  });
  if (r.notes.length) {
    const ws = wb.addWorksheet('Notas');
    r.notes.forEach((n) => ws.addRow([n]));
    ws.getColumn(1).width = 120;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toPdf(r: Report, companyName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: r.title, Author: 'RotaGest' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 24;

    doc.font('Helvetica-Bold').fontSize(16).fillColor('#0F172A').text(r.title);
    doc.font('Helvetica').fontSize(10).fillColor('#64748B').text(`${companyName} · ${periodLabel(r)} · ${REGIME[r.regime]}`);
    const filters = Object.entries(r.filters).map(([k, v]) => `${k}: ${v}`).join(' · ');
    if (filters) doc.text(filters);
    doc.moveDown(0.8);

    for (const s of r.sections) {
      const weights = s.columns.map((c) => (c.type === 'text' ? 2.4 : 1));
      const totalW = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map((w) => (w / totalW) * width);
      const drawRow = (cells: string[], opts: { bold?: boolean; fill?: string }) => {
        doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
        const heights = cells.map((t, i) => doc.heightOfString(t, { width: widths[i] - 8 }));
        const h = Math.max(...heights) + 8;
        if (doc.y + h > bottom()) doc.addPage();
        const y = doc.y;
        if (opts.fill) doc.rect(left, y, width, h).fill(opts.fill);
        let x = left;
        cells.forEach((t, i) => {
          const right = s.columns[i].type !== 'text';
          doc.fillColor('#0F172A').text(t, x + 4, y + 4, { width: widths[i] - 8, align: right ? 'right' : 'left' });
          x += widths[i];
        });
        doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.5).strokeColor('#E2E8F0').stroke();
        doc.x = left;
        doc.y = y + h;
      };
      if (r.sections.length > 1 || s.title !== r.title) {
        if (doc.y + 40 > bottom()) doc.addPage();
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#0F172A').text(s.title, left, doc.y);
        doc.moveDown(0.3);
      }
      drawRow(s.columns.map((c) => c.label), { bold: true, fill: '#F1F5F9' });
      if (s.rows.length === 0) {
        doc.font('Helvetica').fontSize(9).fillColor('#64748B').text('Sem dados no período.', left + 4, doc.y + 4);
        doc.moveDown(0.5);
      }
      for (const row of s.rows) drawRow(s.columns.map((c) => formatCell(c.type, row[c.key])), {});
      if (s.totals) drawRow(s.columns.map((c) => (s.totals![c.key] === undefined ? '' : formatCell(c.type, s.totals![c.key]))), { bold: true, fill: '#F8FAFC' });
      doc.moveDown(1);
    }
    if (r.comparison) {
      const first = r.sections[0];
      const parts = first.columns.filter((c) => c.sum && r.comparison!.totals[c.key] != null).map((c) => `${c.label}: ${formatCell(c.type, r.comparison!.totals[c.key])}`);
      doc.font('Helvetica').fontSize(9).fillColor('#64748B').text(`Período anterior (${monthLabel(r.comparison.from)} a ${monthLabel(r.comparison.to)}): ${parts.join(' · ')}`, left, doc.y);
      doc.moveDown(0.5);
    }
    for (const n of r.notes) doc.font('Helvetica').fontSize(8.5).fillColor('#64748B').text(n, left, doc.y);

    const range = doc.bufferedPageRange();
    const stamp = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date());
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(8).fillColor('#94A3B8').text(`RotaGest · gerado em ${stamp} · página ${i + 1} de ${range.count}`, left, doc.page.height - doc.page.margins.bottom - 10, { width, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}
