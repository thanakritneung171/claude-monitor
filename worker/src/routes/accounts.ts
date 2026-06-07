import type { Env, SessionUser } from '../types';
import { fetchAccountsList } from '../db/queries';
import { renderAccounts, type AccountsRenderInput } from '../views/accounts';

type Period = AccountsRenderInput['period'];

function periodToRange(period: Period, dateFrom?: string, dateTo?: string): { fromMs: number; toMs: number } {
	if (period === 'custom' && dateFrom && dateTo) {
		return {
			fromMs: new Date(dateFrom + 'T00:00:00+07:00').getTime(),
			toMs:   new Date(dateTo   + 'T23:59:59+07:00').getTime(),
		};
	}
	const toMs = Date.now();
	const day = 86400000;
	if (period === '7d')  return { fromMs: toMs - 7 * day,  toMs };
	if (period === '90d') return { fromMs: toMs - 90 * day, toMs };
	if (period === 'all') return { fromMs: 0, toMs };
	return { fromMs: toMs - 30 * day, toMs };
}

export async function handleAccounts(url: URL, env: Env, user?: SessionUser): Promise<Response> {
	const dateFrom = url.searchParams.get('date_from') ?? '';
	const dateTo   = url.searchParams.get('date_to')   ?? '';

	let period: Period;
	if (dateFrom && dateTo) {
		period = 'custom';
	} else {
		const periodRaw = url.searchParams.get('period') || '30d';
		period = (['7d', '30d', '90d', 'all'] as const).includes(periodRaw as Exclude<Period, 'custom'>)
			? (periodRaw as Exclude<Period, 'custom'>) : '30d';
	}

	const { fromMs, toMs } = periodToRange(period, dateFrom || undefined, dateTo || undefined);
	const data = await fetchAccountsList(env, fromMs, toMs);
	const html = renderAccounts({
		data, period,
		dateFrom: dateFrom || undefined,
		dateTo:   dateTo   || undefined,
		user,
	});
	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
