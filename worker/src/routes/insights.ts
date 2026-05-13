import type { Env, User, ByClient } from '../types';
import {
	fetchTopExpensivePrompts,
	fetchAnomalies,
	fetchCacheRatioByAccount,
} from '../db/queries-extra';
import { renderInsights } from '../views/insights';

export async function handleInsights(url: URL, env: Env, user?: User): Promise<Response> {
	const now = Date.now();
	const periodDays = 7;
	const fromMs = now - periodDays * 86400000;

	const [topPrompts, anomalies, lowCacheAccounts, topUserRow, topClientRow] = await Promise.all([
		fetchTopExpensivePrompts(env, fromMs, now, 5),
		fetchAnomalies(env, 30),
		fetchCacheRatioByAccount(env, fromMs, now),
		env.DB.prepare(
			`SELECT account_email as email, SUM(cost_usd) as cost, COUNT(*) as calls
			 FROM api_logs WHERE ts >= ? AND ts <= ? AND account_email != ''
			 GROUP BY account_email ORDER BY cost DESC LIMIT 1`
		).bind(fromMs, now).first<{ email: string; cost: number; calls: number }>(),
		env.DB.prepare(
			`SELECT CASE WHEN client IN ('claude-code-cli','claude-desktop') THEN 'client' ELSE client END as client,
			        COUNT(*) as n, SUM(cost_usd) as cost
			 FROM api_logs WHERE ts >= ? AND ts <= ?
			 GROUP BY 1 ORDER BY n DESC LIMIT 1`
		).bind(fromMs, now).first<ByClient>(),
	]);

	const lowCache = lowCacheAccounts.filter(c => c.ratio < 0.2 && c.calls >= 5);

	const html = renderInsights({
		user,
		topPrompts,
		highestCostUser: topUserRow ? { email: topUserRow.email, cost: topUserRow.cost ?? 0, calls: topUserRow.calls } : null,
		anomalies,
		topClient: topClientRow,
		lowCacheAccounts: lowCache,
		periodDays,
	});
	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
