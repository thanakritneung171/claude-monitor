import type { Env, User } from '../types';
import { fetchAccountsList } from '../db/queries';
import { renderAccounts, type AccountsRenderInput } from '../views/accounts';

type Period = AccountsRenderInput['period'];

function periodToRange(period: Period): { fromMs: number; toMs: number } {
	const toMs = Date.now();
	const day = 86400000;
	if (period === '7d')  return { fromMs: toMs - 7 * day,  toMs };
	if (period === '90d') return { fromMs: toMs - 90 * day, toMs };
	if (period === 'all') return { fromMs: 0, toMs };
	return { fromMs: toMs - 30 * day, toMs };
}

export async function handleAccounts(url: URL, env: Env, user?: User): Promise<Response> {
	const periodRaw = url.searchParams.get('period') || '30d';
	const period: Period = (['7d', '30d', '90d', 'all'] as const).includes(periodRaw as Period)
		? (periodRaw as Period) : '30d';
	const { fromMs, toMs } = periodToRange(period);

	const data = await fetchAccountsList(env, fromMs, toMs);
	const html = renderAccounts({ data, period, user });
	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
