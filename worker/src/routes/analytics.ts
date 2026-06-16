import type { Env, SessionUser } from '../types';
import { fetchCostTimeseries, fetchHourOfDayHeatmap, type BucketPoint } from '../db/queries-extra';
import { renderAnalytics } from '../views/analytics';

type Period = '24h' | '7d' | '30d' | '90d' | 'custom';

function rangeFor(p: Exclude<Period, 'custom'>): { fromMs: number; toMs: number; groupBy: 'day' | 'hour' } {
	const now = Date.now();
	const day = 86400000;
	if (p === '24h') return { fromMs: now - day,      toMs: now, groupBy: 'hour' };
	if (p === '7d')  return { fromMs: now - 7 * day,  toMs: now, groupBy: 'day' };
	if (p === '90d') return { fromMs: now - 90 * day, toMs: now, groupBy: 'day' };
	return { fromMs: now - 30 * day, toMs: now, groupBy: 'day' };
}

// Parse YYYY-MM-DD as a Bangkok-local day boundary (UTC+7).
function bkkDayMs(date: string, endOfDay: boolean): number {
	const suffix = endOfDay ? 'T23:59:59.999+07:00' : 'T00:00:00.000+07:00';
	return new Date(date + suffix).getTime();
}

export async function handleAnalytics(url: URL, env: Env, user?: SessionUser): Promise<Response> {
	const dateFrom = url.searchParams.get('date_from') ?? '';
	const dateTo   = url.searchParams.get('date_to')   ?? '';

	let period: Period;
	let fromMs: number, toMs: number, groupBy: 'day' | 'hour';
	if (dateFrom && dateTo) {
		period = 'custom';
		fromMs = bkkDayMs(dateFrom, false);
		toMs   = bkkDayMs(dateTo, true);
		groupBy = 'day';
	} else {
		const periodRaw = url.searchParams.get('period') ?? '30d';
		const p: Exclude<Period, 'custom'> = (['24h', '7d', '30d', '90d'] as const).includes(periodRaw as Exclude<Period, 'custom'>)
			? (periodRaw as Exclude<Period, 'custom'>) : '30d';
		period = p;
		({ fromMs, toMs, groupBy } = rangeFor(p));
	}

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
			const key = groupBy === 'hour' ? d.toISOString().slice(0, 13) : d.toISOString().slice(0, 10);
			const bucketTs = groupBy === 'hour'
				? new Date(key + ':00:00+07:00').getTime()
				: new Date(key + 'T00:00:00+07:00').getTime();
			const e = map.get(key) ?? { bucket: key, bucketTs, cost: 0, calls: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
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

	const html = renderAnalytics({ user, period, fromMs, toMs, dateFrom, dateTo, timeseries, heatmap, perModelSeries, totals });
	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
