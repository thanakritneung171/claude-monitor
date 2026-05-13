import type { Env, Filters } from '../types';
import { todayBkk } from '../lib/date';
import { fetchExportRows } from '../db/queries';
import { toCsv } from '../lib/csv';

export async function handleExport(url: URL, env: Env): Promise<Response> {
	const todayStr = todayBkk();
	const dateFrom = url.searchParams.get('date_from') || todayStr;
	const dateTo   = url.searchParams.get('date_to')   || todayStr;
	const model    = url.searchParams.get('model')     || '';
	const account  = url.searchParams.get('account')   || '';
	const client   = url.searchParams.get('client')    || '';

	const filters: Filters = { period: '', dateFrom, dateTo, model, account, client, page: 1, perPage: null };
	const rows = await fetchExportRows(env, filters);

	const csv = toCsv(rows);
	const filename = `claude-monitor-${dateFrom}-to-${dateTo}.csv`;
	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv;charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Access-Control-Allow-Origin': '*',
		},
	});
}
