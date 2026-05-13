import type { Env, ApiLog, Filters, Totals, ByModel, ByClient, ByAccount } from '../types';
import { buildWhere } from './filters';

export interface DashboardData {
	rows: ApiLog[];
	totalCount: number;
	totals: Totals;
	byModel: ByModel[];
	byClient: ByClient[];
	byAccount: ByAccount[];
	allModels: string[];
	allAccounts: string[];
	allClients: string[];
}

export async function fetchDashboardData(env: Env, filters: Filters): Promise<DashboardData> {
	const { clause, params } = buildWhere(filters);
	const offset = filters.perPage === null ? 0 : (filters.page - 1) * filters.perPage;
	const limitClause = filters.perPage === null ? '' : `LIMIT ${filters.perPage} OFFSET ${offset}`;

	const [rows, countRow, totals, byModel, byClient, byAccount, allModelsRes, allAccountsRes, allClientsRes] = await Promise.all([
		env.DB.prepare(`SELECT * FROM api_logs ${clause} ORDER BY ts DESC ${limitClause}`)
			.bind(...params).all<ApiLog>(),
		env.DB.prepare(`SELECT COUNT(*) as n FROM api_logs ${clause}`)
			.bind(...params).first<{ n: number }>(),
		env.DB.prepare(
			`SELECT COUNT(*) as total, SUM(input_tokens) as totalInput, SUM(output_tokens) as totalOutput,
			        SUM(cache_read_tokens) as totalCacheRead, SUM(cache_creation_tokens) as totalCacheCreate,
			        SUM(cost_usd) as totalCost FROM api_logs ${clause}`
		).bind(...params).first<Totals>(),
		env.DB.prepare(`SELECT model, COUNT(*) as n, SUM(total_tokens) as tokens, SUM(cost_usd) as cost FROM api_logs ${clause} GROUP BY model ORDER BY cost DESC`)
			.bind(...params).all<ByModel>(),
		env.DB.prepare(`SELECT CASE WHEN client IN ('claude-code-cli','claude-desktop') THEN 'client' ELSE client END as client, COUNT(*) as n, SUM(cost_usd) as cost FROM api_logs ${clause} GROUP BY 1 ORDER BY cost DESC`)
			.bind(...params).all<ByClient>(),
		env.DB.prepare(`SELECT account_email, COUNT(*) as n, SUM(cost_usd) as cost FROM api_logs ${clause} GROUP BY account_email ORDER BY cost DESC`)
			.bind(...params).all<ByAccount>(),
		env.DB.prepare(`SELECT DISTINCT model FROM api_logs WHERE model != '' ORDER BY model`).all<{ model: string }>(),
		env.DB.prepare(`SELECT DISTINCT account_email FROM api_logs WHERE account_email != '' ORDER BY account_email`).all<{ account_email: string }>(),
		env.DB.prepare(`SELECT DISTINCT CASE WHEN client IN ('claude-code-cli','claude-desktop') THEN 'client' ELSE client END as client FROM api_logs WHERE client != '' ORDER BY client`).all<{ client: string }>(),
	]);

	return {
		rows: rows.results,
		totalCount: countRow?.n ?? 0,
		totals: {
			total: totals?.total ?? 0,
			totalInput: totals?.totalInput ?? 0,
			totalOutput: totals?.totalOutput ?? 0,
			totalCacheRead: totals?.totalCacheRead ?? 0,
			totalCacheCreate: totals?.totalCacheCreate ?? 0,
			totalCost: totals?.totalCost ?? 0,
		},
		byModel: byModel.results,
		byClient: byClient.results,
		byAccount: byAccount.results,
		allModels: allModelsRes.results.map(r => r.model),
		allAccounts: allAccountsRes.results.map(r => r.account_email),
		allClients: allClientsRes.results.map(r => r.client),
	};
}

export async function fetchExportRows(env: Env, filters: Filters): Promise<ApiLog[]> {
	const { clause, params } = buildWhere(filters);
	const rows = await env.DB.prepare(
		`SELECT * FROM api_logs ${clause} ORDER BY ts DESC`
	).bind(...params).all<ApiLog>();
	return rows.results;
}

// ─── Accounts list ────────────────────────────────────────────────────────────
export interface AccountAggRow {
	account_email: string;
	calls: number;
	tokens: number;
	cost: number;
	last_seen: number;
}

export interface AccountsListData {
	accounts: {
		email: string;
		calls: number;
		tokens: number;
		cost: number;
		lastSeen: number;
		topModels: string[];
	}[];
	totalSpend: number;
	totalCalls: number;
	totalAccounts: number;
	activeAccounts: number;
}

export async function fetchAccountsList(env: Env, fromMs: number, toMs: number): Promise<AccountsListData> {
	const activeSince = Date.now() - 24 * 60 * 60 * 1000;
	const [aggs, modelCounts, summary, active] = await Promise.all([
		env.DB.prepare(
			`SELECT account_email, COUNT(*) as calls, SUM(total_tokens) as tokens, SUM(cost_usd) as cost, MAX(ts) as last_seen
			 FROM api_logs WHERE account_email != '' AND ts >= ? AND ts <= ?
			 GROUP BY account_email ORDER BY cost DESC`
		).bind(fromMs, toMs).all<AccountAggRow>(),
		env.DB.prepare(
			`SELECT account_email, model, COUNT(*) as n
			 FROM api_logs WHERE account_email != '' AND model != '' AND ts >= ? AND ts <= ?
			 GROUP BY account_email, model`
		).bind(fromMs, toMs).all<{ account_email: string; model: string; n: number }>(),
		env.DB.prepare(
			`SELECT SUM(cost_usd) as totalSpend, COUNT(*) as totalCalls, COUNT(DISTINCT account_email) as totalAccounts
			 FROM api_logs WHERE account_email != '' AND ts >= ? AND ts <= ?`
		).bind(fromMs, toMs).first<{ totalSpend: number; totalCalls: number; totalAccounts: number }>(),
		env.DB.prepare(
			`SELECT COUNT(DISTINCT account_email) as n FROM api_logs WHERE account_email != '' AND ts >= ?`
		).bind(activeSince).first<{ n: number }>(),
	]);

	const topByEmail = new Map<string, { model: string; n: number }[]>();
	for (const r of modelCounts.results) {
		const arr = topByEmail.get(r.account_email) ?? [];
		arr.push({ model: r.model, n: r.n });
		topByEmail.set(r.account_email, arr);
	}

	const accounts = aggs.results.map(a => {
		const models = (topByEmail.get(a.account_email) ?? []).sort((x, y) => y.n - x.n).slice(0, 3).map(m => m.model);
		return {
			email: a.account_email,
			calls: a.calls,
			tokens: a.tokens ?? 0,
			cost: a.cost ?? 0,
			lastSeen: a.last_seen,
			topModels: models,
		};
	});

	return {
		accounts,
		totalSpend: summary?.totalSpend ?? 0,
		totalCalls: summary?.totalCalls ?? 0,
		totalAccounts: summary?.totalAccounts ?? 0,
		activeAccounts: active?.n ?? 0,
	};
}

// ─── Account detail ───────────────────────────────────────────────────────────
export interface AccountDetailData {
	email: string;
	exists: boolean;
	firstSeen: number;
	lastSeen: number;
	calls: number;
	totalIn: number;
	totalOut: number;
	totalCW: number;
	totalCR: number;
	totalTokens: number;
	totalCost: number;
	byModel: ByModel[];
	byClient: ByClient[];
	topPrompts: { prompt: string; n: number; avgCost: number; models: string[] }[];
	recentRows: ApiLog[];
	costTrend: { day: string; cost: number }[];
	heatmap: { dow: number; hour: number; n: number }[];
	allClients: string[];
	allModels: string[];
}

export async function fetchAccountDetail(
	env: Env,
	email: string,
	fromMs: number,
	toMs: number,
	clientFilter: string,
	modelFilter: string,
): Promise<AccountDetailData> {
	const conds = ['account_email = ?', 'ts >= ?', 'ts <= ?'];
	const params: (string | number)[] = [email, fromMs, toMs];
	if (clientFilter) {
		if (clientFilter === 'client') {
			conds.push("client IN ('client','claude-code-cli','claude-desktop')");
		} else {
			conds.push('client = ?');
			params.push(clientFilter);
		}
	}
	if (modelFilter) {
		conds.push('model = ?');
		params.push(modelFilter);
	}
	const where = 'WHERE ' + conds.join(' AND ');

	const heatmapSince = Math.max(fromMs, Date.now() - 7 * 24 * 60 * 60 * 1000);
	const trendSince = Math.max(fromMs, Date.now() - 30 * 24 * 60 * 60 * 1000);

	const [exists, summary, byModel, byClient, recentRes, topPromptsRes, trendTsRes, heatmapTsRes, allClients, allModels] = await Promise.all([
		env.DB.prepare(`SELECT MIN(ts) as firstSeen, MAX(ts) as lastSeen FROM api_logs WHERE account_email = ?`)
			.bind(email).first<{ firstSeen: number | null; lastSeen: number | null }>(),
		env.DB.prepare(
			`SELECT COUNT(*) as calls, SUM(input_tokens) as totalIn, SUM(output_tokens) as totalOut,
			        SUM(cache_creation_tokens) as totalCW, SUM(cache_read_tokens) as totalCR,
			        SUM(total_tokens) as totalTokens, SUM(cost_usd) as totalCost
			 FROM api_logs ${where}`
		).bind(...params).first<{ calls: number; totalIn: number; totalOut: number; totalCW: number; totalCR: number; totalTokens: number; totalCost: number }>(),
		env.DB.prepare(
			`SELECT model, COUNT(*) as n, SUM(total_tokens) as tokens, SUM(cost_usd) as cost
			 FROM api_logs ${where} GROUP BY model ORDER BY cost DESC`
		).bind(...params).all<ByModel>(),
		env.DB.prepare(
			`SELECT CASE WHEN client IN ('claude-code-cli','claude-desktop') THEN 'client' ELSE client END as client,
			        COUNT(*) as n, SUM(cost_usd) as cost
			 FROM api_logs ${where} GROUP BY 1 ORDER BY cost DESC`
		).bind(...params).all<ByClient>(),
		env.DB.prepare(
			`SELECT * FROM api_logs ${where} ORDER BY ts DESC LIMIT 50`
		).bind(...params).all<ApiLog>(),
		env.DB.prepare(
			`SELECT prompt, COUNT(*) as n, AVG(cost_usd) as avgCost, GROUP_CONCAT(DISTINCT model) as modelList
			 FROM api_logs ${where} GROUP BY prompt ORDER BY n DESC, avgCost DESC LIMIT 5`
		).bind(...params).all<{ prompt: string; n: number; avgCost: number; modelList: string }>(),
		env.DB.prepare(
			`SELECT ts, cost_usd as cost FROM api_logs WHERE account_email = ? AND ts >= ?`
		).bind(email, trendSince).all<{ ts: number; cost: number }>(),
		env.DB.prepare(
			`SELECT ts FROM api_logs WHERE account_email = ? AND ts >= ?`
		).bind(email, heatmapSince).all<{ ts: number }>(),
		env.DB.prepare(
			`SELECT DISTINCT CASE WHEN client IN ('claude-code-cli','claude-desktop') THEN 'client' ELSE client END as client
			 FROM api_logs WHERE account_email = ? AND client != '' ORDER BY client`
		).bind(email).all<{ client: string }>(),
		env.DB.prepare(
			`SELECT DISTINCT model FROM api_logs WHERE account_email = ? AND model != '' ORDER BY model`
		).bind(email).all<{ model: string }>(),
	]);

	// Daily cost trend in Bangkok time
	const trendByDay = new Map<string, number>();
	for (const r of trendTsRes.results) {
		const d = new Date(r.ts);
		const bkk = new Date(d.getTime() + 7 * 60 * 60 * 1000);
		const key = bkk.toISOString().slice(0, 10);
		trendByDay.set(key, (trendByDay.get(key) ?? 0) + (r.cost ?? 0));
	}
	const costTrend = Array.from(trendByDay.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([day, cost]) => ({ day, cost }));

	// Heatmap (7d × 24h) in Bangkok time, Monday-first
	const heatmapCounts = new Map<string, number>();
	for (const r of heatmapTsRes.results) {
		const d = new Date(r.ts);
		const bkk = new Date(d.getTime() + 7 * 60 * 60 * 1000);
		const dow = (bkk.getUTCDay() + 6) % 7; // Mon=0..Sun=6
		const hour = bkk.getUTCHours();
		const key = `${dow}-${hour}`;
		heatmapCounts.set(key, (heatmapCounts.get(key) ?? 0) + 1);
	}
	const heatmap: { dow: number; hour: number; n: number }[] = [];
	for (let d = 0; d < 7; d++) {
		for (let h = 0; h < 24; h++) {
			heatmap.push({ dow: d, hour: h, n: heatmapCounts.get(`${d}-${h}`) ?? 0 });
		}
	}

	return {
		email,
		exists: (exists?.firstSeen ?? null) !== null,
		firstSeen: exists?.firstSeen ?? 0,
		lastSeen: exists?.lastSeen ?? 0,
		calls: summary?.calls ?? 0,
		totalIn: summary?.totalIn ?? 0,
		totalOut: summary?.totalOut ?? 0,
		totalCW: summary?.totalCW ?? 0,
		totalCR: summary?.totalCR ?? 0,
		totalTokens: summary?.totalTokens ?? 0,
		totalCost: summary?.totalCost ?? 0,
		byModel: byModel.results,
		byClient: byClient.results,
		topPrompts: topPromptsRes.results.map(p => ({
			prompt: p.prompt,
			n: p.n,
			avgCost: p.avgCost ?? 0,
			models: (p.modelList ?? '').split(',').filter(Boolean),
		})),
		recentRows: recentRes.results,
		costTrend,
		heatmap,
		allClients: allClients.results.map(r => r.client),
		allModels: allModels.results.map(r => r.model),
	};
}

export async function insertLog(env: Env, b: Partial<ApiLog>): Promise<void> {
	await env.DB.prepare(
		`INSERT OR IGNORE INTO api_logs
		   (id, ts, client, account_email, machine_name, model, prompt, prompt_chars, response_chars,
		    input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
		    total_tokens, cost_usd)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
	).bind(
		b.id ?? crypto.randomUUID(),
		b.ts ?? Date.now(),
		b.client        ?? 'unknown',
		b.account_email ?? '',
		b.machine_name  ?? '',
		b.model         ?? '',
		b.prompt        ?? '',
		b.prompt_chars  ?? 0,
		b.response_chars ?? 0,
		b.input_tokens          ?? 0,
		b.output_tokens         ?? 0,
		b.cache_creation_tokens ?? 0,
		b.cache_read_tokens     ?? 0,
		b.total_tokens          ?? 0,
		b.cost_usd              ?? 0,
	).run();
}
