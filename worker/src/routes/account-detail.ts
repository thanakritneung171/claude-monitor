import type { Env, SessionUser } from '../types';
import { fetchAccountDetail } from '../db/queries';
import { renderAccountDetail, type AccountDetailRenderInput } from '../views/account-detail';
import { json } from '../lib/format';

type Period = AccountDetailRenderInput['period'];

function periodToRange(period: Period): { fromMs: number; toMs: number } {
	const toMs = Date.now();
	const day = 86400000;
	if (period === '24h') return { fromMs: toMs - day, toMs };
	if (period === '7d')  return { fromMs: toMs - 7 * day, toMs };
	if (period === '90d') return { fromMs: toMs - 90 * day, toMs };
	if (period === 'all') return { fromMs: 0, toMs };
	return { fromMs: toMs - 30 * day, toMs };
}

export async function handleAccountDetail(url: URL, env: Env, user?: SessionUser): Promise<Response> {
	// New canonical param is `identity` (an email or `ip:<ip>`).
	// Legacy `?email=` links still resolve — older bookmarks keep working.
	const identity = url.searchParams.get('identity') || url.searchParams.get('email') || '';
	if (!identity) return json({ ok: false, error: 'Missing identity param' }, 400);

	const periodRaw = url.searchParams.get('period') || '30d';
	const period: Period = (['24h', '7d', '30d', '90d', 'all'] as const).includes(periodRaw as Period)
		? (periodRaw as Period) : '30d';
	const clientFilter = url.searchParams.get('client') || '';
	const modelFilter  = url.searchParams.get('model')  || '';

	const { fromMs, toMs } = periodToRange(period);
	const data = await fetchAccountDetail(env, identity, fromMs, toMs, clientFilter, modelFilter);

	const html = renderAccountDetail({ data, period, clientFilter, modelFilter, user });
	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
