import type { Env, Filters } from '../types';
import { todayBkk } from '../lib/date';
import { fetchExportRows } from '../db/queries';
import { toExportCsv } from '../lib/csv';

export async function handleExport(url: URL, env: Env): Promise<Response> {
	const todayStr = todayBkk();
	const dateFrom = url.searchParams.get('date_from') || todayStr;
	const dateTo   = url.searchParams.get('date_to')   || todayStr;
	const model    = url.searchParams.get('model')     || '';
	const account  = url.searchParams.get('account')   || '';
	const client   = url.searchParams.get('client')    || '';

	const filters: Filters = { period: '', dateFrom, dateTo, model, account, client, page: 1, perPage: null };
	const rows = await fetchExportRows(env, filters);

	const exportedAt = new Date().toLocaleString('en-CA', {
		timeZone: 'Asia/Bangkok',
		year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', hour12: false,
	}).replace(',', '') + ' (BKK)';

	const csv = toExportCsv(rows, { dateFrom, dateTo, account, model, client, exportedAt });
	const filename = `claude-monitor-${dateFrom}-to-${dateTo}${account ? '-' + account.replace(/@.+/, '') : ''}.csv`;
	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv;charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Access-Control-Allow-Origin': '*',
		},
	});
}
