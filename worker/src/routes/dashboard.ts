import type { Env, Filters, SessionUser } from '../types';
import { todayBkk, firstOfMonthBkk, firstOfYearBkk } from '../lib/date';
import { fetchDashboardData } from '../db/queries';
import { renderDashboard } from '../views/dashboard';

export async function handleDashboard(url: URL, env: Env, user?: SessionUser): Promise<Response> {
	const todayStr      = todayBkk();
	const firstMonthStr = firstOfMonthBkk();
	const firstYearStr  = firstOfYearBkk();

	const period   = url.searchParams.get('period')    || 'daily';
	const dateFrom = url.searchParams.get('date_from') || todayStr;
	const dateTo   = url.searchParams.get('date_to')   || todayStr;
	const model    = url.searchParams.get('model')     || '';
	const account  = url.searchParams.get('account')   || '';
	const client   = url.searchParams.get('client')    || '';

	const perPageRaw = url.searchParams.get('per_page') || '10';
	const perPage: number | null = perPageRaw === 'all' ? null : Math.max(1, parseInt(perPageRaw) || 10);
	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));

	const filters: Filters = { period, dateFrom, dateTo, model, account, client, page, perPage };
	const data = await fetchDashboardData(env, filters);

	const html = renderDashboard({
		...data,
		filters,
		todayStr,
		firstMonthStr,
		firstYearStr,
		user,
	});

	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
