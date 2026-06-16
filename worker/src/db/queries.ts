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
		env.DB.prepare(`SELECT CASE WHEN client IN ('claude-code-cli','claude-desktop') THEN 'claude-code-cli, claude-desktop' ELSE client END as client, COUNT(*) as n, SUM(cost_usd) as cost FROM api_logs ${clause} GROUP BY 1 ORDER BY cost DESC`)
			.bind(...params).all<ByClient>(),
		env.DB.prepare(`SELECT account_email as account_email, COUNT(*) as n, SUM(cost_usd) as cost FROM api_logs ${clause} GROUP BY 1 ORDER BY cost DESC`)
			.bind(...params).all<ByAccount>(),
		env.DB.prepare(`SELECT DISTINCT model FROM api_logs WHERE model != '' ORDER BY model`).all<{ model: string }>(),
		env.DB.prepare(`SELECT DISTINCT account_email as account_email FROM api_logs WHERE account_email != '' ORDER BY 1`).all<{ account_email: string }>(),
		env.DB.prepare(`SELECT DISTINCT CASE WHEN client IN ('claude-code-cli','claude-desktop') THEN 'claude-code-cli, claude-desktop' ELSE client END as client FROM api_logs WHERE client != '' ORDER BY client`).all<{ client: string }>(),
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

// ─── Logs page (full-field table) ─────────────────────────────────────────────
export interface LogsPageData {
	rows: ApiLog[];
	totalCount: number;
	allModels: string[];
	allAccounts: string[];
	allClients: string[];
}

export async function fetchLogsData(env: Env, filters: Filters): Promise<LogsPageData> {
	const { clause, params } = buildWhere(filters);
	const offset = filters.perPage === null ? 0 : (filters.page - 1) * filters.perPage;
	const limitClause = filters.perPage === null ? '' : `LIMIT ${filters.perPage} OFFSET ${offset}`;

	const [rows, countRow, allModelsRes, allAccountsRes, allClientsRes] = await Promise.all([
		env.DB.prepare(`SELECT * FROM api_logs ${clause} ORDER BY ts DESC ${limitClause}`)
			.bind(...params).all<ApiLog>(),
		env.DB.prepare(`SELECT COUNT(*) as n FROM api_logs ${clause}`)
			.bind(...params).first<{ n: number }>(),
		env.DB.prepare(`SELECT DISTINCT model FROM api_logs WHERE model != '' ORDER BY model`).all<{ model: string }>(),
		env.DB.prepare(`SELECT DISTINCT account_email as account_email FROM api_logs WHERE account_email != '' ORDER BY 1`).all<{ account_email: string }>(),
		env.DB.prepare(`SELECT DISTINCT client FROM api_logs WHERE client != '' ORDER BY client`).all<{ client: string }>(),
	]);

	return {
		rows: rows.results,
		totalCount: countRow?.n ?? 0,
		allModels: allModelsRes.results.map(r => r.model),
		allAccounts: allAccountsRes.results.map(r => r.account_email),
		allClients: allClientsRes.results.map(r => r.client),
	};
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
	// Identity = account email. Rows with empty email have no identity → filtered out.
	const haveIdent = `account_email != ''`;
	const [aggs, modelCounts, summary, active] = await Promise.all([
		env.DB.prepare(
			`SELECT account_email as account_email, COUNT(*) as calls, SUM(total_tokens) as tokens, SUM(cost_usd) as cost, MAX(ts) as last_seen
			 FROM api_logs WHERE ${haveIdent} AND ts >= ? AND ts <= ?
			 GROUP BY 1 ORDER BY cost DESC`
		).bind(fromMs, toMs).all<AccountAggRow>(),
		env.DB.prepare(
			`SELECT account_email as account_email, model, COUNT(*) as n
			 FROM api_logs WHERE ${haveIdent} AND model != '' AND ts >= ? AND ts <= ?
			 GROUP BY 1, model`
		).bind(fromMs, toMs).all<{ account_email: string; model: string; n: number }>(),
		env.DB.prepare(
			`SELECT SUM(cost_usd) as totalSpend, COUNT(*) as totalCalls, COUNT(DISTINCT account_email) as totalAccounts
			 FROM api_logs WHERE ${haveIdent} AND ts >= ? AND ts <= ?`
		).bind(fromMs, toMs).first<{ totalSpend: number; totalCalls: number; totalAccounts: number }>(),
		env.DB.prepare(
			`SELECT COUNT(DISTINCT account_email) as n FROM api_logs WHERE ${haveIdent} AND ts >= ?`
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
	identity: string,
	fromMs: number,
	toMs: number,
	clientFilter: string,
	modelFilter: string,
): Promise<AccountDetailData> {
	// identity is an account email (identity = email only now).
	const identCond  = 'account_email = ?';
	const identParam: string = identity;

	const conds = [identCond, 'ts >= ?', 'ts <= ?'];
	const params: (string | number)[] = [identParam, fromMs, toMs];
	if (clientFilter) {
		if (clientFilter === 'claude-code-cli, claude-desktop') {
			conds.push("client IN ('claude-code-cli','claude-desktop')");
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
		env.DB.prepare(`SELECT MIN(ts) as firstSeen, MAX(ts) as lastSeen FROM api_logs WHERE ${identCond}`)
			.bind(identParam).first<{ firstSeen: number | null; lastSeen: number | null }>(),
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
			`SELECT CASE WHEN client IN ('claude-code-cli','claude-desktop') THEN 'claude-code-cli, claude-desktop' ELSE client END as client,
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
			`SELECT ts, cost_usd as cost FROM api_logs WHERE ${identCond} AND ts >= ?`
		).bind(identParam, trendSince).all<{ ts: number; cost: number }>(),
		env.DB.prepare(
			`SELECT ts FROM api_logs WHERE ${identCond} AND ts >= ?`
		).bind(identParam, heatmapSince).all<{ ts: number }>(),
		env.DB.prepare(
			`SELECT DISTINCT CASE WHEN client IN ('claude-code-cli','claude-desktop') THEN 'claude-code-cli, claude-desktop' ELSE client END as client
			 FROM api_logs WHERE ${identCond} AND client != '' ORDER BY client`
		).bind(identParam).all<{ client: string }>(),
		env.DB.prepare(
			`SELECT DISTINCT model FROM api_logs WHERE ${identCond} AND model != '' ORDER BY model`
		).bind(identParam).all<{ model: string }>(),
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
		email: identity,
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
		   (id, ts, client, account_email, client_ip, machine_name, model, prompt, prompt_chars, response_chars,
		    input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
		    total_tokens, cost_usd,
		    app_version, os_type, os_version, host_arch, terminal, device_id, mac_address, anon_id)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
	).bind(
		b.id ?? crypto.randomUUID(),
		b.ts ?? Date.now(),
		b.client        ?? 'unknown',
		b.account_email ?? '',
		b.client_ip     ?? '',
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
		b.app_version ?? '',
		b.os_type     ?? '',
		b.os_version  ?? '',
		b.host_arch   ?? '',
		b.terminal    ?? '',
		b.device_id   ?? '',
		b.mac_address ?? '',
		b.anon_id     ?? '',
	).run();
}

// ─── ip_identity_backup (frozen snapshot) — read-only, powers the /identity page ──
export interface IdentityListRow {
	ip: string;
	email: string;
	name: string;
	uuid: string;
	account_id: string;
	org_id: string;
	anon_id: string;
	updated_ms: number;
	calls: number;
}

export async function fetchIdentityBackup(env: Env): Promise<IdentityListRow[]> {
	const res = await env.DB.prepare(
		`SELECT b.ip, b.email, b.name, b.uuid, b.account_id, b.org_id, b.anon_id, b.updated_ms,
		        COUNT(l.id) AS calls
		   FROM ip_identity_backup b
		   LEFT JOIN api_logs l ON l.client_ip = b.ip
		  GROUP BY b.ip
		  ORDER BY b.updated_ms DESC`
	).all<IdentityListRow>();
	return res.results ?? [];
}

// ─── email_identity — canonical person record (keyed by email) ────────────────
export interface EmailIdentityInput {
	email: string;
	name?: string;
	accountId?: string;
	uuid?: string;
	orgId?: string;
	anonId?: string;
	osType?: string;
	osVersion?: string;
	hostArch?: string;
	appVersion?: string;
	terminal?: string;
	clientType?: string;  // appended to the client_types list
	ts?: number;          // becomes first_seen (set-once) + updated_ms
}

export async function upsertEmailIdentity(env: Env, d: EmailIdentityInput): Promise<void> {
	if (!d.email) return;
	const now = Date.now();
	await env.DB.prepare(
		`INSERT INTO email_identity
		   (email, name, account_id, uuid, org_id, anon_id,
		    os_type, os_version, host_arch, app_version, terminal,
		    client_types, first_seen, updated_ms)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(email) DO UPDATE SET
		   name        = CASE WHEN excluded.name        != '' THEN excluded.name        ELSE email_identity.name        END,
		   account_id  = CASE WHEN excluded.account_id  != '' THEN excluded.account_id  ELSE email_identity.account_id  END,
		   uuid        = CASE WHEN excluded.uuid        != '' THEN excluded.uuid        ELSE email_identity.uuid        END,
		   org_id      = CASE WHEN excluded.org_id      != '' THEN excluded.org_id      ELSE email_identity.org_id      END,
		   anon_id     = CASE WHEN excluded.anon_id     != '' THEN excluded.anon_id     ELSE email_identity.anon_id     END,
		   os_type     = CASE WHEN excluded.os_type     != '' THEN excluded.os_type     ELSE email_identity.os_type     END,
		   os_version  = CASE WHEN excluded.os_version  != '' THEN excluded.os_version  ELSE email_identity.os_version  END,
		   host_arch   = CASE WHEN excluded.host_arch   != '' THEN excluded.host_arch   ELSE email_identity.host_arch   END,
		   app_version = CASE WHEN excluded.app_version != '' THEN excluded.app_version ELSE email_identity.app_version END,
		   terminal    = CASE WHEN excluded.terminal    != '' THEN excluded.terminal    ELSE email_identity.terminal    END,
		   client_types = CASE
		     WHEN excluded.client_types = '' THEN email_identity.client_types
		     WHEN email_identity.client_types = '' THEN excluded.client_types
		     WHEN (',' || email_identity.client_types || ',') LIKE ('%,' || excluded.client_types || ',%') THEN email_identity.client_types
		     ELSE email_identity.client_types || ',' || excluded.client_types
		   END,
		   first_seen  = CASE WHEN email_identity.first_seen = 0 THEN excluded.first_seen ELSE email_identity.first_seen END,
		   updated_ms  = excluded.updated_ms`
	).bind(
		d.email,
		d.name ?? '', d.accountId ?? '', d.uuid ?? '', d.orgId ?? '', d.anonId ?? '',
		d.osType ?? '', d.osVersion ?? '', d.hostArch ?? '', d.appVersion ?? '', d.terminal ?? '',
		d.clientType ?? '',
		d.ts || now, now,
	).run();
}

export interface EmailIdentityRow {
	email: string;
	name: string;
	account_id: string;
	uuid: string;
	org_id: string;
	anon_id: string;
	os_type: string;
	os_version: string;
	host_arch: string;
	app_version: string;
	terminal: string;
	ips: string;
	client_types: string;
	first_seen: number;
	updated_ms: number;
	calls: number;
}

export async function fetchEmailIdentityList(env: Env): Promise<EmailIdentityRow[]> {
	const res = await env.DB.prepare(
		`SELECT e.email, e.name, e.account_id, e.uuid, e.org_id, e.anon_id,
		        e.os_type, e.os_version, e.host_arch, e.app_version, e.terminal,
		        e.ips, e.client_types, e.first_seen, e.updated_ms,
		        COUNT(l.id) AS calls
		   FROM email_identity e
		   LEFT JOIN api_logs l ON l.account_email = e.email
		  GROUP BY e.email
		  ORDER BY e.updated_ms DESC`
	).all<EmailIdentityRow>();
	return res.results ?? [];
}
