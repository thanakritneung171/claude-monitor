import type { Env } from '../types';

// ─── Timeseries / cost trends ────────────────────────────────────────────────
export interface BucketPoint {
	bucket: string;        // ISO day or hour key
	bucketTs: number;      // ms at bucket start
	cost: number;
	calls: number;
	inputTokens: number;
	outputTokens: number;
	cacheRead: number;
	cacheWrite: number;
}

const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

function bkkDayKey(ts: number): string {
	const d = new Date(ts + BKK_OFFSET_MS);
	return d.toISOString().slice(0, 10);
}

function bkkHourKey(ts: number): string {
	const d = new Date(ts + BKK_OFFSET_MS);
	return d.toISOString().slice(0, 13);
}

function dayKeyToTs(key: string): number {
	return new Date(key + 'T00:00:00+07:00').getTime();
}

function hourKeyToTs(key: string): number {
	return new Date(key + ':00:00+07:00').getTime();
}

export async function fetchCostTimeseries(
	env: Env,
	fromMs: number,
	toMs: number,
	groupBy: 'hour' | 'day' = 'day',
): Promise<BucketPoint[]> {
	const res = await env.DB.prepare(
		`SELECT ts, cost_usd as cost, input_tokens as iin, output_tokens as oout, cache_read_tokens as cr, cache_creation_tokens as cw
		 FROM api_logs WHERE ts >= ? AND ts <= ?`
	).bind(fromMs, toMs).all<{ ts: number; cost: number; iin: number; oout: number; cr: number; cw: number }>();

	const map = new Map<string, BucketPoint>();
	for (const r of res.results) {
		const key = groupBy === 'hour' ? bkkHourKey(r.ts) : bkkDayKey(r.ts);
		const existing = map.get(key) ?? {
			bucket: key,
			bucketTs: groupBy === 'hour' ? hourKeyToTs(key) : dayKeyToTs(key),
			cost: 0, calls: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
		};
		existing.cost += r.cost ?? 0;
		existing.calls += 1;
		existing.inputTokens += r.iin ?? 0;
		existing.outputTokens += r.oout ?? 0;
		existing.cacheRead += r.cr ?? 0;
		existing.cacheWrite += r.cw ?? 0;
		map.set(key, existing);
	}
	return Array.from(map.values()).sort((a, b) => a.bucketTs - b.bucketTs);
}

// ─── Hour-of-day × day-of-week heatmap ───────────────────────────────────────
export interface HeatmapCell { dow: number; hour: number; n: number; }

export async function fetchHourOfDayHeatmap(env: Env, fromMs: number, toMs: number): Promise<HeatmapCell[]> {
	const res = await env.DB.prepare(
		`SELECT ts FROM api_logs WHERE ts >= ? AND ts <= ?`
	).bind(fromMs, toMs).all<{ ts: number }>();

	const counts = new Map<string, number>();
	for (const r of res.results) {
		const d = new Date(r.ts + BKK_OFFSET_MS);
		const dow = (d.getUTCDay() + 6) % 7;
		const hour = d.getUTCHours();
		const key = `${dow}-${hour}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	const cells: HeatmapCell[] = [];
	for (let d = 0; d < 7; d++)
		for (let h = 0; h < 24; h++)
			cells.push({ dow: d, hour: h, n: counts.get(`${d}-${h}`) ?? 0 });
	return cells;
}

// ─── Top-N expensive prompts ─────────────────────────────────────────────────
export interface TopPromptRow {
	prompt: string;
	calls: number;
	totalCost: number;
	avgCost: number;
	model: string;
	lastSeen: number;
}

export async function fetchTopExpensivePrompts(
	env: Env,
	fromMs: number,
	toMs: number,
	limit = 5,
): Promise<TopPromptRow[]> {
	const res = await env.DB.prepare(
		`SELECT prompt, COUNT(*) as calls, SUM(cost_usd) as totalCost, AVG(cost_usd) as avgCost,
		        MAX(model) as model, MAX(ts) as lastSeen
		 FROM api_logs
		 WHERE ts >= ? AND ts <= ? AND prompt != ''
		 GROUP BY prompt
		 ORDER BY totalCost DESC
		 LIMIT ?`
	).bind(fromMs, toMs, limit).all<{ prompt: string; calls: number; totalCost: number; avgCost: number; model: string; lastSeen: number }>();
	return res.results.map(r => ({
		prompt: r.prompt,
		calls: r.calls,
		totalCost: r.totalCost ?? 0,
		avgCost: r.avgCost ?? 0,
		model: r.model ?? '',
		lastSeen: r.lastSeen ?? 0,
	}));
}

// ─── Anomalies (daily cost spike vs 7-day rolling avg) ───────────────────────
export interface AnomalyDay { day: string; cost: number; rollingAvg: number; ratio: number; }

export async function fetchAnomalies(env: Env, days = 30): Promise<AnomalyDay[]> {
	const since = Date.now() - days * 86400000;
	const res = await env.DB.prepare(
		`SELECT ts, cost_usd as cost FROM api_logs WHERE ts >= ?`
	).bind(since).all<{ ts: number; cost: number }>();

	const byDay = new Map<string, number>();
	for (const r of res.results) {
		const k = bkkDayKey(r.ts);
		byDay.set(k, (byDay.get(k) ?? 0) + (r.cost ?? 0));
	}
	const days7 = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));
	const out: AnomalyDay[] = [];
	for (let i = 7; i < days7.length; i++) {
		const window = days7.slice(i - 7, i).map(([, c]) => c);
		const avg = window.reduce((s, c) => s + c, 0) / 7;
		const [day, cost] = days7[i];
		if (avg > 0 && cost > 2 * avg) {
			out.push({ day, cost, rollingAvg: avg, ratio: cost / avg });
		}
	}
	return out.sort((a, b) => b.ratio - a.ratio);
}

// ─── Cache ratio by account ──────────────────────────────────────────────────
export interface CacheRatioRow {
	email: string;
	calls: number;
	cacheRead: number;
	totalIn: number;
	ratio: number;
}

export async function fetchCacheRatioByAccount(env: Env, fromMs: number, toMs: number): Promise<CacheRatioRow[]> {
	const res = await env.DB.prepare(
		`SELECT account_email as email, COUNT(*) as calls,
		        SUM(cache_read_tokens) as cacheRead, SUM(input_tokens + cache_read_tokens) as totalIn
		 FROM api_logs WHERE ts >= ? AND ts <= ? AND account_email != ''
		 GROUP BY account_email
		 HAVING totalIn > 0
		 ORDER BY ratio ASC`
	).bind(fromMs, toMs).all<{ email: string; calls: number; cacheRead: number; totalIn: number }>();
	return res.results.map(r => ({
		email: r.email,
		calls: r.calls,
		cacheRead: r.cacheRead ?? 0,
		totalIn: r.totalIn ?? 0,
		ratio: r.totalIn ? (r.cacheRead ?? 0) / r.totalIn : 0,
	})).sort((a, b) => a.ratio - b.ratio);
}

// ─── Error rate (proxy: rows with cost=0 and output=0) ───────────────────────
export interface ErrorRatePoint { bucket: string; bucketTs: number; total: number; errors: number; rate: number; }

export async function fetchErrorRate(env: Env, fromMs: number, toMs: number): Promise<ErrorRatePoint[]> {
	const res = await env.DB.prepare(
		`SELECT ts, output_tokens as o, cost_usd as c FROM api_logs WHERE ts >= ? AND ts <= ?`
	).bind(fromMs, toMs).all<{ ts: number; o: number; c: number }>();

	const map = new Map<string, { total: number; errors: number }>();
	for (const r of res.results) {
		const k = bkkHourKey(r.ts);
		const e = map.get(k) ?? { total: 0, errors: 0 };
		e.total += 1;
		if ((r.o ?? 0) === 0 && (r.c ?? 0) === 0) e.errors += 1;
		map.set(k, e);
	}
	return Array.from(map.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => ({
			bucket: k,
			bucketTs: hourKeyToTs(k),
			total: v.total,
			errors: v.errors,
			rate: v.total ? v.errors / v.total : 0,
		}));
}

// ─── Throughput per minute (last 24h) ────────────────────────────────────────
export interface ThroughputPoint { minuteStart: number; n: number; }

export async function fetchThroughput(env: Env, sinceMs: number): Promise<ThroughputPoint[]> {
	const res = await env.DB.prepare(
		`SELECT ts FROM api_logs WHERE ts >= ?`
	).bind(sinceMs).all<{ ts: number }>();

	const map = new Map<number, number>();
	for (const r of res.results) {
		const m = Math.floor(r.ts / 60000) * 60000;
		map.set(m, (map.get(m) ?? 0) + 1);
	}
	return Array.from(map.entries())
		.sort((a, b) => a[0] - b[0])
		.map(([minuteStart, n]) => ({ minuteStart, n }));
}

// ─── Active sessions (distinct client+identity in last N min) ────────────────
export interface ActiveSession {
	client: string;
	account_email: string;   // identity = account email
	calls: number;
	lastSeen: number;
	lastModel: string;
}

export async function fetchActiveSessions(env: Env, withinMs = 5 * 60 * 1000): Promise<ActiveSession[]> {
	const since = Date.now() - withinMs;
	// Group by (client, account email). Rows without an email have no identity → excluded.
	const res = await env.DB.prepare(
		`SELECT client, account_email, COUNT(*) as calls, MAX(ts) as lastSeen,
		        (SELECT model FROM api_logs a2
		         WHERE a2.client = a1.client
		           AND a2.account_email = a1.account_email
		           AND a2.ts >= ?
		         ORDER BY a2.ts DESC LIMIT 1) as lastModel
		 FROM api_logs a1
		 WHERE ts >= ? AND account_email != ''
		 GROUP BY client, 2
		 ORDER BY lastSeen DESC`
	).bind(since, since).all<{ client: string; account_email: string; calls: number; lastSeen: number; lastModel: string }>();
	return res.results.map(r => ({
		client: r.client,
		account_email: r.account_email,
		calls: r.calls,
		lastSeen: r.lastSeen,
		lastModel: r.lastModel ?? '',
	}));
}

// ─── Ingest stats (for Data Sources page) ────────────────────────────────────
export interface IngestStats {
	totalRows: number;
	oldestTs: number;
	newestTs: number;
	rowsToday: number;
	approxBytes: number;
}

export async function fetchIngestStats(env: Env): Promise<IngestStats> {
	const todayKey = bkkDayKey(Date.now());
	const todayStartMs = dayKeyToTs(todayKey);

	const [summary, todayRow] = await Promise.all([
		env.DB.prepare(
			`SELECT COUNT(*) as totalRows, MIN(ts) as oldestTs, MAX(ts) as newestTs,
			        SUM(LENGTH(prompt)) as bytesPrompt
			 FROM api_logs`
		).first<{ totalRows: number; oldestTs: number; newestTs: number; bytesPrompt: number }>(),
		env.DB.prepare(
			`SELECT COUNT(*) as n FROM api_logs WHERE ts >= ?`
		).bind(todayStartMs).first<{ n: number }>(),
	]);

	return {
		totalRows: summary?.totalRows ?? 0,
		oldestTs: summary?.oldestTs ?? 0,
		newestTs: summary?.newestTs ?? 0,
		rowsToday: todayRow?.n ?? 0,
		// Rough estimate: prompt bytes + ~200B fixed metadata per row
		approxBytes: (summary?.bytesPrompt ?? 0) + (summary?.totalRows ?? 0) * 200,
	};
}

// ─── Top error groups (by client/model) ──────────────────────────────────────
export interface ErrorGroup { client: string; model: string; total: number; errors: number; rate: number; }

export async function fetchTopErrorGroups(env: Env, fromMs: number, toMs: number, limit = 8): Promise<ErrorGroup[]> {
	const res = await env.DB.prepare(
		`SELECT client, model,
		        COUNT(*) as total,
		        SUM(CASE WHEN output_tokens = 0 AND cost_usd = 0 THEN 1 ELSE 0 END) as errors
		 FROM api_logs WHERE ts >= ? AND ts <= ?
		 GROUP BY client, model
		 HAVING errors > 0
		 ORDER BY errors DESC, total DESC
		 LIMIT ?`
	).bind(fromMs, toMs, limit).all<{ client: string; model: string; total: number; errors: number }>();
	return res.results.map(r => ({
		client: r.client,
		model: r.model,
		total: r.total,
		errors: r.errors,
		rate: r.total ? r.errors / r.total : 0,
	}));
}
