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
