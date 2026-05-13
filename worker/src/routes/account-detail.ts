import type { Env } from '../types';
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

export async function handleAccountDetail(url: URL, env: Env): Promise<Response> {
	const email = url.searchParams.get('email') || '';
	if (!email) return json({ ok: false, error: 'Missing email param' }, 400);

	const periodRaw = url.searchParams.get('period') || '30d';
	const period: Period = (['24h', '7d', '30d', '90d', 'all'] as const).includes(periodRaw as Period)
		? (periodRaw as Period) : '30d';
	const clientFilter = url.searchParams.get('client') || '';
	const modelFilter  = url.searchParams.get('model')  || '';

	const { fromMs, toMs } = periodToRange(period);
	const data = await fetchAccountDetail(env, email, fromMs, toMs, clientFilter, modelFilter);

	const html = renderAccountDetail({ data, period, clientFilter, modelFilter });
	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
