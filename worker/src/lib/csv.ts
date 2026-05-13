import type { ApiLog } from '../types';
import { fmtBkk } from './format';

export function toCsv(rows: ApiLog[]): string {
	const cols = ['time_bkk','client','account_email','machine_name','model',
		'prompt','prompt_chars','response_chars',
		'input_tokens','output_tokens','cache_creation_tokens','cache_read_tokens','total_tokens','cost_usd'];
	const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
	const line = (r: ApiLog) => [
		fmtBkk(r.ts), r.client, r.account_email, r.machine_name, r.model,
		r.prompt.replace(/\r?\n/g, ' '),
		r.prompt_chars, r.response_chars,
		r.input_tokens, r.output_tokens, r.cache_creation_tokens, r.cache_read_tokens, r.total_tokens, r.cost_usd,
	].map(cell).join(',');
	return [cols.join(','), ...rows.map(line)].join('\r\n');
}
