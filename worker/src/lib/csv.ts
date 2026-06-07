import type { ApiLog } from '../types';
import { fmtBkk } from './format';

export function toCsv(rows: ApiLog[]): string {
	const cols = ['time_bkk','client','account_email','client_ip','machine_name','model',
		'prompt','prompt_chars','response_chars',
		'input_tokens','output_tokens','cache_creation_tokens','cache_read_tokens','total_tokens','cost_usd'];
	const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
	const line = (r: ApiLog) => [
		fmtBkk(r.ts), r.client, r.account_email, r.client_ip, r.machine_name, r.model,
		r.prompt.replace(/\r?\n/g, ' '),
		r.prompt_chars, r.response_chars,
		r.input_tokens, r.output_tokens, r.cache_creation_tokens, r.cache_read_tokens, r.total_tokens, r.cost_usd,
	].map(cell).join(',');
	return [cols.join(','), ...rows.map(line)].join('\r\n');
}

export interface ExportMeta {
	dateFrom: string;
	dateTo:   string;
	account:  string;
	model:    string;
	client:   string;
	exportedAt: string; // formatted string e.g. "2026-06-07 14:30 (BKK)"
}

export function toExportCsv(rows: ApiLog[], meta: ExportMeta): string {
	const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
	const kv   = (k: string, v: unknown) => `${cell(k)},${cell(v)}`;
	const blank = '';

	// ── aggregate ────────────────────────────────────────────────
	const totalCalls        = rows.length;
	const totalInput        = rows.reduce((s, r) => s + (r.input_tokens          ?? 0), 0);
	const totalOutput       = rows.reduce((s, r) => s + (r.output_tokens         ?? 0), 0);
	const totalCacheCreate  = rows.reduce((s, r) => s + (r.cache_creation_tokens ?? 0), 0);
	const totalCacheRead    = rows.reduce((s, r) => s + (r.cache_read_tokens     ?? 0), 0);
	const totalTokens       = rows.reduce((s, r) => s + (r.total_tokens          ?? 0), 0);
	const totalCost         = rows.reduce((s, r) => s + (r.cost_usd              ?? 0), 0);

	// ── by-model breakdown ───────────────────────────────────────
	const byModel = new Map<string, { calls: number; tokens: number; cost: number }>();
	for (const r of rows) {
		const m   = r.model || '(unknown)';
		const cur = byModel.get(m) ?? { calls: 0, tokens: 0, cost: 0 };
		byModel.set(m, {
			calls:  cur.calls  + 1,
			tokens: cur.tokens + (r.total_tokens ?? 0),
			cost:   cur.cost   + (r.cost_usd    ?? 0),
		});
	}
	const modelRows = Array.from(byModel.entries())
		.sort((a, b) => b[1].cost - a[1].cost)
		.map(([m, s]) => [cell(m), cell(s.calls), cell(s.tokens), cell(s.cost.toFixed(4))].join(','));

	// ── summary block ─────────────────────────────────────────────
	const summary: string[] = [
		kv('SDB AI Insight — Export Summary', ''),
		kv('Exported at',  meta.exportedAt),
		kv('Date From',    meta.dateFrom),
		kv('Date To',      meta.dateTo),
		kv('Account',      meta.account || 'All'),
		kv('Model',        meta.model   || 'All'),
		kv('Client',       meta.client  || 'All'),
		blank,
		kv('Total Calls',             totalCalls),
		kv('Input Tokens',            totalInput),
		kv('Output Tokens',           totalOutput),
		kv('Cache Creation Tokens',   totalCacheCreate),
		kv('Cache Read Tokens',       totalCacheRead),
		kv('Total Tokens',            totalTokens),
		kv('Est. Cost (USD)',          totalCost.toFixed(4)),
		blank,
		[cell('By Model'), cell('Calls'), cell('Total Tokens'), cell('Cost (USD)')].join(','),
		...modelRows,
		blank,
		kv('=== Log Detail ===', ''),
	];

	return summary.join('\r\n') + '\r\n' + toCsv(rows);
}
