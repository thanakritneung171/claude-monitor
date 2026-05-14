import type { Env, SessionUser } from '../types';
import { fetchCostTimeseries, fetchHourOfDayHeatmap, type BucketPoint } from '../db/queries-extra';
import { renderAnalytics } from '../views/analytics';

type Period = '7d' | '30d' | '90d';

function rangeFor(p: Period): { fromMs: number; toMs: number; groupBy: 'day' | 'hour' } {
	const now = Date.now();
	const day = 86400000;
	if (p === '7d')  return { fromMs: now - 7 * day,  toMs: now, groupBy: 'day' };
	if (p === '90d') return { fromMs: now - 90 * day, toMs: now, groupBy: 'day' };
	return { fromMs: now - 30 * day, toMs: now, groupBy: 'day' };
}

export async function handleAnalytics(url: URL, env: Env, user?: SessionUser): Promise<Response> {
	const periodRaw = url.searchParams.get('period') ?? '30d';
	const period: Period = (['7d', '30d', '90d'] as const).includes(periodRaw as Period) ? (periodRaw as Period) : '30d';
	const { fromMs, toMs, groupBy } = rangeFor(period);

	const [timeseries, heatmap, modelRows] = await Promise.all([
		fetchCostTimeseries(env, fromMs, toMs, groupBy),
		fetchHourOfDayHeatmap(env, fromMs, toMs),
		env.DB.prepare(
			`SELECT model, SUM(cost_usd) as totalCost FROM api_logs WHERE ts >= ? AND ts <= ? AND model != '' GROUP BY model ORDER BY totalCost DESC LIMIT 7`
		).bind(fromMs, toMs).all<{ model: string; totalCost: number }>(),
	]);

	// Per-model timeseries (sequential lightweight queries)
	const perModelSeries: { model: string; points: BucketPoint[]; totalCost: number }[] = [];
	for (const m of modelRows.results) {
		const rows = await env.DB.prepare(
			`SELECT ts, cost_usd as cost, input_tokens as iin, output_tokens as oout, cache_read_tokens as cr, cache_creation_tokens as cw
			 FROM api_logs WHERE ts >= ? AND ts <= ? AND model = ?`
		).bind(fromMs, toMs, m.model).all<{ ts: number; cost: number; iin: number; oout: number; cr: number; cw: number }>();
		const map = new Map<string, BucketPoint>();
		for (const r of rows.results) {
			const d = new Date(r.ts + 7 * 60 * 60 * 1000);
			const key = d.toISOString().slice(0, 10);
			const e = map.get(key) ?? { bucket: key, bucketTs: new Date(key + 'T00:00:00+07:00').getTime(), cost: 0, calls: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
			e.cost += r.cost ?? 0;
			e.calls += 1;
			e.inputTokens += r.iin ?? 0;
			e.outputTokens += r.oout ?? 0;
			e.cacheRead += r.cr ?? 0;
			e.cacheWrite += r.cw ?? 0;
			map.set(key, e);
		}
		perModelSeries.push({
			model: m.model,
			points: Array.from(map.values()).sort((a, b) => a.bucketTs - b.bucketTs),
			totalCost: m.totalCost ?? 0,
		});
	}

	const totalCost = timeseries.reduce((s, p) => s + p.cost, 0);
	const totalCalls = timeseries.reduce((s, p) => s + p.calls, 0);
	const totals = {
		cost: totalCost,
		calls: totalCalls,
		avgCostCall: totalCalls ? totalCost / totalCalls : 0,
		tokensIn: timeseries.reduce((s, p) => s + p.inputTokens, 0),
		tokensOut: timeseries.reduce((s, p) => s + p.outputTokens, 0),
		cacheRead: timeseries.reduce((s, p) => s + p.cacheRead, 0),
		cacheWrite: timeseries.reduce((s, p) => s + p.cacheWrite, 0),
	};

	const html = renderAnalytics({ user, period, fromMs, toMs, timeseries, heatmap, perModelSeries, totals });
	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
