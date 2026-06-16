import type { Env, Filters, SessionUser } from '../types';
import { todayBkk } from '../lib/date';
import { fetchLogsData } from '../db/queries';
import { renderLogs } from '../views/logs';

export async function handleLogs(url: URL, env: Env, user?: SessionUser): Promise<Response> {
	const todayStr = todayBkk();

	const period   = url.searchParams.get('period')    || 'daily';
	const dateFrom = url.searchParams.get('date_from') || todayStr;
	const dateTo   = url.searchParams.get('date_to')   || todayStr;
	const model    = url.searchParams.get('model')     || '';
	const account  = url.searchParams.get('account')   || '';
	const client   = url.searchParams.get('client')    || '';

	const perPageRaw = url.searchParams.get('per_page') || '50';
	const perPage: number | null = perPageRaw === 'all' ? null : Math.max(1, parseInt(perPageRaw) || 50);
	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));

	const filters: Filters = { period, dateFrom, dateTo, model, account, client, page, perPage };
	const data = await fetchLogsData(env, filters);

	const html = renderLogs({ ...data, filters, todayStr, user });

	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
