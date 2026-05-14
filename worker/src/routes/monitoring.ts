import type { Env, SessionUser } from '../types';
import {
	fetchErrorRate,
	fetchThroughput,
	fetchActiveSessions,
	fetchTopErrorGroups,
} from '../db/queries-extra';
import { renderMonitoring } from '../views/monitoring';

export async function handleMonitoring(url: URL, env: Env, user?: SessionUser): Promise<Response> {
	const now = Date.now();
	const since24h = now - 24 * 60 * 60 * 1000;

	const [errorRate, throughput, activeSessions, topErrors, totalsRow] = await Promise.all([
		fetchErrorRate(env, since24h, now),
		fetchThroughput(env, since24h),
		fetchActiveSessions(env, 5 * 60 * 1000),
		fetchTopErrorGroups(env, since24h, now, 8),
		env.DB.prepare(
			`SELECT COUNT(*) as totalCalls,
			        SUM(CASE WHEN output_tokens = 0 AND cost_usd = 0 THEN 1 ELSE 0 END) as errorCount
			 FROM api_logs WHERE ts >= ?`
		).bind(since24h).first<{ totalCalls: number; errorCount: number }>(),
	]);

	const totals = {
		totalCalls: totalsRow?.totalCalls ?? 0,
		errorCount: totalsRow?.errorCount ?? 0,
		avgErrorRate: (totalsRow?.totalCalls ?? 0) > 0 ? (totalsRow!.errorCount ?? 0) / totalsRow!.totalCalls : 0,
		activeNow: activeSessions.length,
	};

	const html = renderMonitoring({ user, errorRate, throughput, activeSessions, topErrors, totals });
	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
