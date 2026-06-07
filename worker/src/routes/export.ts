import type { Env, Filters, ApiLog } from '../types';
import { todayBkk } from '../lib/date';
import { fetchExportRows } from '../db/queries';
import { buildXlsx, S, type XRow, type XSheet } from '../lib/xlsx';
import { fmtBkk } from '../lib/format';

export async function handleExport(url: URL, env: Env): Promise<Response> {
	const todayStr = todayBkk();
	const dateFrom = url.searchParams.get('date_from') || todayStr;
	const dateTo   = url.searchParams.get('date_to')   || todayStr;
	const model    = url.searchParams.get('model')     || '';
	const account  = url.searchParams.get('account')   || '';
	const client   = url.searchParams.get('client')    || '';

	const filters: Filters = { period: '', dateFrom, dateTo, model, account, client, page: 1, perPage: null };
	const rows = await fetchExportRows(env, filters);

	const exportedAt = new Date().toLocaleString('sv-SE', {
		timeZone: 'Asia/Bangkok',
		year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit',
	}).replace('T', ' ') + ' (BKK)';

	const sheets: XSheet[] = [
		buildSummarySheet(rows, { dateFrom, dateTo, account, model, client, exportedAt }),
		buildLogSheet(rows),
	];

	const buffer = buildXlsx(sheets);
	const acctSlug = account ? '-' + account.replace(/@.+/, '') : '';
	const filename = `sdb-ai-insight-${dateFrom}-to-${dateTo}${acctSlug}.xlsx`;

	return new Response(buffer, {
		headers: {
			'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Access-Control-Allow-Origin': '*',
		},
	});
}

// ─── Sheet 1: Summary ─────────────────────────────────────────────────────────

interface Meta {
	dateFrom: string; dateTo: string;
	account: string; model: string; client: string;
	exportedAt: string;
}

function buildSummarySheet(logs: ApiLog[], meta: Meta): XSheet {
	// Aggregate
	const totalCalls       = logs.length;
	const totalInput       = logs.reduce((s, r) => s + (r.input_tokens          ?? 0), 0);
	const totalOutput      = logs.reduce((s, r) => s + (r.output_tokens         ?? 0), 0);
	const totalCacheCreate = logs.reduce((s, r) => s + (r.cache_creation_tokens ?? 0), 0);
	const totalCacheRead   = logs.reduce((s, r) => s + (r.cache_read_tokens     ?? 0), 0);
	const totalTokens      = logs.reduce((s, r) => s + (r.total_tokens          ?? 0), 0);
	const totalCost        = logs.reduce((s, r) => s + (r.cost_usd              ?? 0), 0);

	// By-model breakdown
	const byModel = new Map<string, { calls: number; tokens: number; cost: number }>();
	for (const r of logs) {
		const m   = r.model || '(unknown)';
		const cur = byModel.get(m) ?? { calls: 0, tokens: 0, cost: 0 };
		byModel.set(m, { calls: cur.calls + 1, tokens: cur.tokens + (r.total_tokens ?? 0), cost: cur.cost + (r.cost_usd ?? 0) });
	}
	const byModelSorted = [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost);

	// Helpers
	const blank     = (): XRow => [{ v: null }];
	const secTitle  = (t: string): XRow => [{ v: t, s: S.SEC_TITLE }, { v: null, s: S.SEC_TITLE }, { v: null, s: S.SEC_TITLE }, { v: null, s: S.SEC_TITLE }];
	const subTitle  = (t: string): XRow => [{ v: t, s: S.BOLD }];
	const kv        = (k: string, v: string): XRow => [{ v: k, s: S.STAT_LABEL }, { v }];
	const statRow   = (k: string, v: number, numStyle: number): XRow => [{ v: k, s: S.STAT_LABEL }, { v, s: numStyle }];
	const colHdr    = (...labels: string[]): XRow => labels.map(l => ({ v: l, s: S.COL_HDR }));

	const rows: XRow[] = [
		// ── Header ────────────────────────────────────────────────
		secTitle('SDB AI Insight — Export Summary'),
		blank(),
		// ── Filter Info ───────────────────────────────────────────
		subTitle('📋 Filter Information'),
		kv('Exported at',  meta.exportedAt),
		kv('Date From',    meta.dateFrom),
		kv('Date To',      meta.dateTo),
		kv('Account',      meta.account || 'All'),
		kv('Model',        meta.model   || 'All'),
		kv('Client',       meta.client  || 'All'),
		blank(),
		// ── Stats ─────────────────────────────────────────────────
		subTitle('📊 Summary Statistics'),
		statRow('Total API Calls',          totalCalls,       S.NUM_INT),
		statRow('Input Tokens',             totalInput,       S.NUM_INT),
		statRow('Output Tokens',            totalOutput,      S.NUM_INT),
		statRow('Cache Creation Tokens',    totalCacheCreate, S.NUM_INT),
		statRow('Cache Read Tokens',        totalCacheRead,   S.NUM_INT),
		statRow('Total Tokens',             totalTokens,      S.NUM_INT),
		statRow('Est. Cost (USD)',          totalCost,        S.NUM_COST),
		blank(),
		// ── By Model ──────────────────────────────────────────────
		subTitle('🤖 Usage by Model'),
		colHdr('Model', 'API Calls', 'Total Tokens', 'Cost (USD)'),
		...byModelSorted.map(([m, s]): XRow => [
			{ v: m },
			{ v: s.calls,  s: S.NUM_INT },
			{ v: s.tokens, s: S.NUM_INT },
			{ v: s.cost,   s: S.NUM_COST },
		]),
	];

	return {
		name: 'Summary',
		rows,
		colWidths: [30, 36, 18, 15],
	};
}

// ─── Sheet 2: Log Detail ──────────────────────────────────────────────────────

function buildLogSheet(logs: ApiLog[]): XSheet {
	const n = (v: number): XRow[number] => ({ v, s: S.NUM_INT });
	const $ = (v: number): XRow[number] => ({ v, s: S.NUM_COST });

	const header: XRow = [
		'time_bkk','client','account_email','client_ip','machine_name','model',
		'prompt','prompt_chars','response_chars',
		'input_tokens','output_tokens','cache_creation_tokens','cache_read_tokens',
		'total_tokens','cost_usd',
	].map(l => ({ v: l, s: S.COL_HDR }));

	const dataRows: XRow[] = logs.map(r => [
		{ v: fmtBkk(r.ts) },
		{ v: r.client },
		{ v: r.account_email },
		{ v: r.client_ip },
		{ v: r.machine_name },
		{ v: r.model },
		{ v: r.prompt },
		n(r.prompt_chars),
		n(r.response_chars),
		n(r.input_tokens),
		n(r.output_tokens),
		n(r.cache_creation_tokens),
		n(r.cache_read_tokens),
		n(r.total_tokens),
		$(r.cost_usd),
	]);

	return {
		name: 'Log Detail',
		rows: [header, ...dataRows],
		colWidths: [20, 22, 32, 16, 20, 28, 60, 14, 15, 14, 14, 20, 16, 14, 14],
		freezeRows: 1,
		autoFilter: true,
	};
}
