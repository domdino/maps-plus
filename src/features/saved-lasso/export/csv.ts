import { COLUMNS, row, type ExportPlace } from './common';

function cell(v: string): string {
  // Neutralise spreadsheet formula injection (=, +, -, @, tab, CR at the start of a cell).
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** UTF-8 CSV with BOM so Excel detects the encoding. */
export function toCsv(places: ExportPlace[]): string {
  const lines = [COLUMNS.join(',')];
  for (const p of places) {
    const r = row(p);
    lines.push(COLUMNS.map((c) => cell(r[c])).join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
