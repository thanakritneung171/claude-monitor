/// <reference types="@cloudflare/workers-types" />

export interface Env {
	DB: D1Database;
	API_KEY: string;
}

interface ApiLog {
	id: string;
	ts: number;
	client: string;
	account_email: string;
	machine_name: string;
	model: string;
	prompt: string;
	prompt_chars: number;
	response_chars: number;
	input_tokens: number;
	output_tokens: number;
	cache_creation_tokens: number;
	cache_read_tokens: number;
	total_tokens: number;
	cost_usd: number;
}

interface Filters {
	period: string;
	dateFrom: string;
	dateTo: string;
	model: string;
	account: string;
	client: string;
	page: number;
	perPage: number | null; // null = all
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
	});
}

function esc(s: unknown): string {
	return String(s ?? '')
		.replace(/&/g, '&amp;').replace(/</g, '&lt;')
		.replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function num(n: number | null | undefined, dec = 0): string {
	return (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtBkk(ms: number): string {
	return new Date(ms).toLocaleString('en-GB', {
		timeZone: 'Asia/Bangkok',
		day: '2-digit', month: '2-digit', year: '2-digit',
		hour: '2-digit', minute: '2-digit', second: '2-digit',
	});
}

function fmtBkkParts(ms: number): { time: string; date: string } {
	const d = new Date(ms);
	const date = d.toLocaleDateString('en-GB', {
		timeZone: 'Asia/Bangkok',
		day: '2-digit', month: '2-digit', year: '2-digit',
	});
	const time = d.toLocaleTimeString('en-GB', {
		timeZone: 'Asia/Bangkok',
		hour: '2-digit', minute: '2-digit', second: '2-digit',
	});
	return { time, date };
}

function todayBkk(): string {
	return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

function firstOfMonthBkk(): string {
	const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function firstOfYearBkk(): string {
	const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
	return `${d.getFullYear()}-01-01`;
}

function dateToMs(dateStr: string, endOfDay = false): number {
	const time = endOfDay ? 'T23:59:59.999+07:00' : 'T00:00:00+07:00';
	return new Date(dateStr + time).getTime();
}

function modelLabel(model: string): string {
	return model.replace('claude-', '').split('-20')[0] || model;
}

function modelBadge(model: string): string {
	return `<span class="chip model">${esc(modelLabel(model))}</span>`;
}

function normalizeClient(raw: string): string {
	if (raw === 'claude-code-cli' || raw === 'claude-desktop') return 'client';
	return raw;
}

function clientBadge(client: string): string {
	const n = normalizeClient(client);
	const colors: Record<string, [string, string]> = {
		'claude-code':         ['#F1ECFF', '#7C3AED'],
		'claude-code-vscode':  ['#E6F1FB', '#0078D4'],
		'vscode':              ['#E6F1FB', '#0078D4'],
		'desktop':             ['#FFF1E0', '#D97706'],
		'api':                 ['#E8F5EC', '#2F8F4A'],
		'client':              ['#EEF4FF', '#4B6FBF'],
	};
	const [bg, fg] = colors[n] ?? ['#EEF4FF', '#4B6FBF'];
	return `<span class="chip" style="background:${bg};color:${fg}"><span class="dot-c"></span>${esc(n)}</span>`;
}

function accountBadge(email: string): string {
	return `<span class="chip acct">${esc(email || '—')}</span>`;
}

function toCsv(rows: ApiLog[]): string {
	const cols = ['time_bkk','client','account_email','machine_name','model',
		'prompt','prompt_chars','response_chars',
		'input_tokens','output_tokens','cache_creation_tokens','cache_read_tokens','total_tokens','cost_usd'];
	const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
	const line = (r: ApiLog) => [
		fmtBkk(r.ts), r.client, r.account_email, r.machine_name, r.model,
		r.prompt.replace(/\r?\n/g, ' '),
		r.prompt_chars, r.response_chars,
		r.input_tokens, r.output_tokens, r.cache_creation_tokens, r.cache_read_tokens, r.total_tokens, r.cost_usd,
	].map(cell).join(',');
	return [cols.join(','), ...rows.map(line)].join('\r\n');
}

function buildWhere(filters: Filters): { clause: string; params: (string | number)[] } {
	const conds: string[] = [];
	const params: (string | number)[] = [];

	conds.push('ts >= ? AND ts <= ?');
	params.push(dateToMs(filters.dateFrom, false), dateToMs(filters.dateTo, true));

	if (filters.model)   { conds.push('model = ?');         params.push(filters.model); }
	if (filters.account) { conds.push('account_email = ?'); params.push(filters.account); }
	if (filters.client) {
		if (filters.client === 'client') {
			conds.push("client IN ('client','claude-code-cli','claude-desktop')");
		} else {
			conds.push('client = ?');
			params.push(filters.client);
		}
	}

	return { clause: 'WHERE ' + conds.join(' AND '), params };
}

function pageBtn(p: number, cur: number, urlFn: (p: number) => string): string {
	if (p === cur) return `<button class="page-btn active" disabled>${p}</button>`;
	return `<a href="${urlFn(p)}" class="page-btn">${p}</a>`;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function buildDashboard(
	rows: ApiLog[],
	totalCount: number,
	totals: { total: number; totalInput: number; totalOutput: number; totalCacheRead: number; totalCacheCreate: number; totalCost: number },
	byModel: { model: string; n: number; tokens: number; cost: number }[],
	byClient: { client: string; n: number; cost: number }[],
	byAccount: { account_email: string; n: number; cost: number }[],
	allModels: string[],
	allAccounts: string[],
	allClients: string[],
	filters: Filters,
	todayStr: string,
	firstMonthStr: string,
	firstYearStr: string,
): string {

	// ── Pagination ────────────────────────────────────────────────────────────
	const perPageVal = filters.perPage === null ? 'all' : String(filters.perPage);
	const totalPages = filters.perPage === null ? 1 : Math.max(1, Math.ceil(totalCount / filters.perPage));
	const cur = filters.page;

	function pageUrl(p: number): string {
		const q = new URLSearchParams({
			period: filters.period,
			date_from: filters.dateFrom,
			date_to: filters.dateTo,
			per_page: perPageVal,
			page: String(p),
		});
		if (filters.model)   q.set('model',   filters.model);
		if (filters.account) q.set('account', filters.account);
		if (filters.client)  q.set('client',  filters.client);
		return '/?' + q.toString();
	}

	let pageButtons = '';
	if (filters.perPage !== null && totalPages > 1) {
		const parts: string[] = [];
		if (totalPages <= 7) {
			for (let p = 1; p <= totalPages; p++) parts.push(pageBtn(p, cur, pageUrl));
		} else {
			parts.push(pageBtn(1, cur, pageUrl));
			if (cur > 3) parts.push(`<button class="page-btn ellipsis" disabled>…</button>`);
			const s = Math.max(2, cur - 1);
			const e = Math.min(totalPages - 1, cur + 1);
			for (let p = s; p <= e; p++) parts.push(pageBtn(p, cur, pageUrl));
			if (cur < totalPages - 2) parts.push(`<button class="page-btn ellipsis" disabled>…</button>`);
			parts.push(pageBtn(totalPages, cur, pageUrl));
		}
		pageButtons = parts.join('');
	}

	const arrowL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
	const arrowR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

	const prevBtn = cur > 1
		? `<a href="${pageUrl(cur - 1)}" class="page-btn">${arrowL}<span class="hide-sm">Prev</span></a>`
		: `<button class="page-btn" disabled>${arrowL}<span class="hide-sm">Prev</span></button>`;
	const nextBtn = cur < totalPages
		? `<a href="${pageUrl(cur + 1)}" class="page-btn"><span class="hide-sm">Next</span>${arrowR}</a>`
		: `<button class="page-btn" disabled><span class="hide-sm">Next</span>${arrowR}</button>`;

	const startIdx = totalCount === 0 ? 0 : (filters.perPage === null ? 1 : (cur - 1) * filters.perPage + 1);
	const endIdx = filters.perPage === null ? totalCount : Math.min(cur * filters.perPage, totalCount);

	const paginationHtml = `
		<div class="pagination">
			<div class="info">แสดง <strong>${num(startIdx)}–${num(endIdx)}</strong> จาก <strong>${num(totalCount)}</strong> รายการ</div>
			<div class="pages">${prevBtn}${pageButtons}${nextBtn}</div>
		</div>`;

	// ── Export URL (carries current filters, no paging) ──────────────────────
	const exportParams = new URLSearchParams({ date_from: filters.dateFrom, date_to: filters.dateTo });
	if (filters.model)   exportParams.set('model',   filters.model);
	if (filters.account) exportParams.set('account', filters.account);
	if (filters.client)  exportParams.set('client',  filters.client);
	const exportUrl = '/export?' + exportParams.toString();

	// ── Dropdown options ──────────────────────────────────────────────────────
	const modelOpts   = allModels.map(m   => `<option value="${esc(m)}"${filters.model   === m   ? ' selected' : ''}>${esc(modelLabel(m))}</option>`).join('');
	const accountOpts = allAccounts.map(a => `<option value="${esc(a)}"${filters.account === a   ? ' selected' : ''}>${esc(a || '—')}</option>`).join('');
	const clientOpts  = allClients.map(c  => `<option value="${esc(c)}"${filters.client  === c   ? ' selected' : ''}>${esc(c)}</option>`).join('');

	// ── Breakdown bar rows ────────────────────────────────────────────────────
	const BREAKDOWN_TOP = 5;
	type BarItem = { name: string; n: number; cost: number; v: number };

	function barRowsHtml(items: BarItem[], limit?: number): string {
		if (items.length === 0) return `<div style="color:var(--ink-3);font-size:13px;padding:8px 0">ไม่มีข้อมูล</div>`;
		const max = Math.max(...items.map(i => i.v), 1);
		const list = limit ? items.slice(0, limit) : items;
		return list.map((it, i) => {
			const pct = Math.max(2, (it.v / max) * 100);
			return `<div class="bar-row">
				<div class="name"><span class="swatch" style="background:var(--peach-${400 - (i % 3) * 100})"></span>${esc(it.name)}</div>
				<div class="num"><span>${num(it.n)} calls</span><strong>$${num(it.cost, 4)}</strong></div>
				<div class="bar-track"><div class="bar-fill" data-pct="${pct.toFixed(1)}" style="width:0%"></div></div>
			</div>`;
		}).join('');
	}

	const byModelItems   = byModel.map(m => ({ name: modelLabel(m.model), n: m.n, cost: m.cost ?? 0, v: m.cost ?? m.n }));
	const byAccountItems = byAccount.map(a => ({ name: a.account_email || '—', n: a.n, cost: a.cost ?? 0, v: a.cost ?? a.n }));
	const byClientItems  = byClient.map(c => ({ name: c.client, n: c.n, cost: c.cost ?? 0, v: c.cost ?? c.n }));

	const byModelHtml   = barRowsHtml(byModelItems, BREAKDOWN_TOP);
	const byAccountHtml = barRowsHtml(byAccountItems, BREAKDOWN_TOP);
	const byClientHtml  = barRowsHtml(byClientItems, BREAKDOWN_TOP);

	const breakdownData = JSON.stringify({
		model:   byModelItems,
		account: byAccountItems,
		client:  byClientItems,
	});

	const showMore = (cat: string, count: number) => count > BREAKDOWN_TOP
		? `<button type="button" class="show-more" data-cat="${cat}">ดูทั้งหมด →</button>`
		: `<span class="count">${num(count)}</span>`;

	// ── KPI cards ─────────────────────────────────────────────────────────────
	// (Estimated Cost rendered as featured separately)
	const statCards = [
		{ label: 'API Calls',     value: num(totals.total),           sub: 'requests',  icon: 'svg-api' },
		{ label: 'Input Tokens',  value: num(totals.totalInput),      sub: 'in prompts', icon: 'svg-in' },
		{ label: 'Output Tokens', value: num(totals.totalOutput),     sub: 'from model', icon: 'svg-out' },
		{ label: 'Cache Write',   value: num(totals.totalCacheCreate),sub: 'tokens',     icon: 'svg-cw' },
		{ label: 'Cache Read',    value: num(totals.totalCacheRead),  sub: 'tokens hit', icon: 'svg-cr' },
	];
	const statSvg: Record<string, string> = {
		'svg-api': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
		'svg-in':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
		'svg-out': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
		'svg-cw':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>',
		'svg-cr':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>',
	};
	const statCardsHtml = statCards.map(s => `
		<div class="stat">
			<div class="label"><span class="icon">${statSvg[s.icon]}</span>${s.label}</div>
			<div class="value">${s.value}</div>
			<div class="trend">${s.sub}</div>
		</div>`).join('');

	// ── Log rows (table + mobile cards) ───────────────────────────────────────
	const logRows = rows.map(r => {
		const { time, date } = fmtBkkParts(r.ts);
		const fullPrompt = esc(r.prompt);
		return `<tr data-full="${fullPrompt}">
			<td><span class="time">${esc(time)}<span class="date">${esc(date)}</span></span></td>
			<td>${clientBadge(r.client)}</td>
			<td>${accountBadge(r.account_email)}</td>
			<td>${modelBadge(r.model)}</td>
			<td class="prompt-cell"><div class="truncate">${esc(r.prompt)}</div><span class="more">เปิดดูเต็ม →</span></td>
			<td class="num-cell"><span class="mono">${num(r.input_tokens)}</span></td>
			<td class="num-cell"><span class="mono">${num(r.output_tokens)}</span></td>
			<td class="num-cell"><span class="mono">${num(r.cache_creation_tokens)}</span></td>
			<td class="num-cell"><span class="mono">${num(r.cache_read_tokens)}</span></td>
			<td class="cost-cell">$${num(r.cost_usd, 5)}</td>
		</tr>`;
	}).join('');

	const logCards = rows.map(r => {
		const { time, date } = fmtBkkParts(r.ts);
		const fullPrompt = esc(r.prompt);
		return `<div class="log-card" data-full="${fullPrompt}">
			<div class="top">
				<span class="time">${esc(time)} <span class="date" style="display:inline">${esc(date)}</span></span>
				<span class="cost-big">$${num(r.cost_usd, 5)}</span>
			</div>
			<div class="prompt">${esc(r.prompt)}</div>
			<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
				${modelBadge(r.model)}
				${clientBadge(r.client)}
			</div>
			<div class="meta-grid">
				<div>Account<strong style="font-size:11px;">${esc(r.account_email || '—')}</strong></div>
				<div>Total tokens<strong>${num(r.total_tokens)}</strong></div>
				<div>Input / Output<strong>${num(r.input_tokens)} / ${num(r.output_tokens)}</strong></div>
				<div>Cache W / R<strong>${num(r.cache_creation_tokens)} / ${num(r.cache_read_tokens)}</strong></div>
			</div>
		</div>`;
	}).join('');

	const emptyTable = `<tr><td colspan="10" style="padding:32px 26px;color:var(--ink-3);text-align:center;">ไม่พบรายการ</td></tr>`;
	const emptyCards = `<div style="padding:32px 16px;color:var(--ink-3);text-align:center;font-size:14px;">ไม่พบรายการ</div>`;

	const estCost = '$' + num(totals.totalCost, 4);

	return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claude Monitor</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root {
	--bg: #FFF8F3;
	--bg-soft: #FFF1E6;
	--card: #FFFFFF;
	--peach-50: #FFF1E6;
	--peach-100: #FFE4D2;
	--peach-200: #FFD1B3;
	--peach-300: #FFB088;
	--peach-400: #FF9466;
	--peach-500: #F47948;
	--ink: #2A1A12;
	--ink-2: #5A4A3F;
	--ink-3: #8B7B6E;
	--line: #F3E4D4;
	--line-2: #EAD7C2;
	--good: #6FB48A;
	--shadow: 0 1px 0 rgba(180, 120, 70, 0.06), 0 8px 24px -12px rgba(180, 120, 70, 0.18);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
	font-family: "Plus Jakarta Sans", system-ui, sans-serif;
	background: var(--bg);
	background-image:
		radial-gradient(1200px 600px at 100% -10%, #FFE4D2 0%, transparent 60%),
		radial-gradient(900px 500px at -10% 110%, #FFEFE0 0%, transparent 60%);
	color: var(--ink);
	min-height: 100vh;
	-webkit-font-smoothing: antialiased;
	line-height: 1.35;
	font-size: 13px;
}
.mono { font-family: "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.wrap { max-width: 1500px; margin: 0 auto; padding: 18px 22px 48px; }

.topbar { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 14px; }
.logo { width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, var(--peach-300), var(--peach-500)); display: grid; place-items: center; box-shadow: 0 6px 14px -6px rgba(244, 121, 72, 0.45); flex-shrink: 0; }
.logo svg { width: 18px; height: 18px; color: white; }
.brand h1 { font-size: clamp(18px, 2vw, 24px); font-weight: 800; letter-spacing: -0.02em; margin: 0; line-height: 1; }
.brand .sub { color: var(--ink-3); font-size: 12px; margin-top: 4px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--peach-300); }
.live-dot { background: var(--good); box-shadow: 0 0 0 4px rgba(111, 180, 138, 0.18); animation: pulse 2s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { box-shadow: 0 0 0 4px rgba(111, 180, 138, 0.18); } 50% { box-shadow: 0 0 0 8px rgba(111, 180, 138, 0.05); } }
.refresh-pill { display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px; background: var(--card); border: 1px solid var(--line); border-radius: 999px; font-size: 12px; color: var(--ink-2); font-weight: 500; }

.filters { margin-top: 14px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px; box-shadow: var(--shadow); }
.filter-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
.field { flex: 1 1 130px; min-width: 0; }
.field.period { flex: 1.6 1 220px; }
.field.dates { flex: 1 1 140px; }
.field-actions { display: flex; gap: 8px; margin-left: auto; }
.field label { display: block; font-size: 10px; font-weight: 700; color: var(--ink-2); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 5px; }
.select, .date-input { width: 100%; height: 36px; padding: 0 12px; background: var(--bg); border: 1px solid var(--line-2); border-radius: 9px; font-family: inherit; font-size: 13px; color: var(--ink); font-weight: 500; appearance: none; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.select:hover, .date-input:hover { border-color: var(--peach-300); }
.select:focus, .date-input:focus { outline: none; border-color: var(--peach-400); background: white; box-shadow: 0 0 0 4px rgba(255, 148, 102, 0.15); }
.select-wrap { position: relative; }
.select-wrap::after { content: ''; position: absolute; right: 14px; top: 50%; width: 8px; height: 8px; border-right: 2px solid var(--ink-2); border-bottom: 2px solid var(--ink-2); transform: translateY(-70%) rotate(45deg); pointer-events: none; }

.seg { display: flex; background: var(--bg); border: 1px solid var(--line-2); border-radius: 9px; padding: 3px; gap: 3px; height: 36px; }
.seg button { flex: 1; border: 0; background: transparent; border-radius: 7px; font-family: inherit; font-size: 12px; font-weight: 600; color: var(--ink-2); cursor: pointer; transition: all 0.15s; }
.seg button:hover { color: var(--ink); }
.seg button.on { background: white; color: var(--peach-500); box-shadow: 0 1px 2px rgba(0,0,0,0.06), 0 2px 8px -2px rgba(244, 121, 72, 0.25); }

.btn { height: 36px; padding: 0 16px; border-radius: 9px; border: 1px solid var(--line-2); background: var(--card); color: var(--ink); font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; transition: all 0.15s; text-decoration: none; }
.btn:hover { border-color: var(--peach-300); background: var(--peach-50); }
.btn.primary { background: linear-gradient(180deg, var(--peach-300), var(--peach-400)); color: white; border-color: transparent; box-shadow: 0 3px 10px -2px rgba(244, 121, 72, 0.4); }
.btn.primary:hover { filter: brightness(1.05); transform: translateY(-1px); }
.btn svg { width: 14px; height: 14px; }

.stats { margin-top: 14px; display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px; }
.stat { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px 11px; box-shadow: var(--shadow); position: relative; overflow: hidden; }
.stat .label { font-size: 11px; color: var(--ink-3); font-weight: 500; display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.stat .icon { width: 20px; height: 20px; border-radius: 6px; background: var(--peach-50); color: var(--peach-500); display: grid; place-items: center; flex-shrink: 0; }
.stat .icon svg { width: 11px; height: 11px; }
.stat .value { font-size: clamp(18px, 1.6vw, 22px); font-weight: 800; letter-spacing: -0.02em; line-height: 1; color: var(--ink); font-variant-numeric: tabular-nums; }
.stat .trend { margin-top: 6px; font-size: 10px; color: var(--ink-3); font-weight: 500; }
.stat.featured { grid-column: span 2; background: linear-gradient(135deg, #FFF1E6 0%, #FFE4D2 100%); border-color: var(--peach-200); }
.stat.featured .value { font-size: clamp(22px, 2vw, 28px); background: linear-gradient(135deg, var(--peach-500), #D45A2A); -webkit-background-clip: text; background-clip: text; color: transparent; }
.stat.featured .icon { background: white; color: var(--peach-500); }

.grid-2 { margin-top: 14px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; box-shadow: var(--shadow); }
.card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 12px; }
.card h2 { font-size: 14px; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.card .count { font-size: 11px; color: var(--ink-3); font-weight: 500; padding: 3px 8px; background: var(--bg-soft); border-radius: 999px; }
.show-more { font-size: 12px; color: var(--peach-500); font-weight: 600; cursor: pointer; padding: 4px 8px; border-radius: 6px; transition: background 0.15s; background: none; border: 0; font-family: inherit; }
.show-more:hover { background: var(--peach-50); }

.bar-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); }
.bar-row:first-of-type { border-top: 0; padding-top: 2px; }
.bar-row .name { font-size: 13px; font-weight: 600; color: var(--ink); display: flex; align-items: center; gap: 8px; word-break: break-all; }
.swatch { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.bar-row .num { display: flex; gap: 14px; align-items: center; font-size: 12px; color: var(--ink-2); font-weight: 500; }
.bar-row .num strong { color: var(--ink); font-weight: 700; font-size: 13px; font-family: "JetBrains Mono", monospace; }
.bar-track { grid-column: 1 / -1; height: 6px; background: var(--peach-50); border-radius: 999px; overflow: hidden; margin-top: 2px; }
.bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--peach-300), var(--peach-500)); transition: width 0.6s cubic-bezier(.2,.8,.2,1); }

.logs { margin-top: 14px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden; }
.logs-head { padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; border-bottom: 1px solid var(--line); }
.logs-head h2 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
.logs-head .sub { color: var(--ink-3); font-size: 12px; margin-top: 2px; }
.pager { display: flex; align-items: center; gap: 14px; color: var(--ink-2); font-size: 13px; }
.pager .seg-sm { height: 36px; padding: 3px; }
.pager .seg-sm button { font-size: 12px; padding: 0 10px; }

.table-scroll { overflow-x: auto; }
table.logs-table { width: 100%; min-width: 900px; border-collapse: collapse; }
.logs-table th { text-align: left; font-size: 10px; font-weight: 700; color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.08em; padding: 10px 12px; background: var(--bg-soft); white-space: nowrap; }
.logs-table th:first-child { padding-left: 20px; }
.logs-table th:last-child { padding-right: 20px; text-align: right; }
.logs-table td { padding: 12px; border-top: 1px solid var(--line); font-size: 13px; color: var(--ink-2); vertical-align: middle; }
.logs-table td:first-child { padding-left: 20px; }
.logs-table td:last-child { padding-right: 20px; text-align: right; }
.logs-table tbody tr { transition: background 0.12s; cursor: pointer; }
.logs-table tbody tr:hover { background: var(--bg-soft); }

.time { font-family: "JetBrains Mono", monospace; font-size: 13px; color: var(--ink); font-weight: 500; white-space: nowrap; }
.time .date { color: var(--ink-3); font-size: 11px; display: block; margin-top: 2px; }

.chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: var(--peach-50); color: var(--peach-500); white-space: nowrap; word-break: break-all; }
.chip.client { background: #EEF4FF; color: #4B6FBF; }
.chip.acct { background: #F0F7EF; color: #4F8B5D; word-break: break-all; }
.chip.model { background: #FFF1E6; color: #C45A26; }
.chip .dot-c { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }

.prompt-cell { max-width: 360px; color: var(--ink); font-weight: 500; line-height: 1.45; }
.prompt-cell .truncate { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.prompt-cell .more { color: var(--peach-500); font-weight: 600; font-size: 12px; cursor: pointer; }
.num-cell .mono { font-size: 13px; font-weight: 600; color: var(--ink); }
.cost-cell { font-family: "JetBrains Mono", monospace; font-weight: 700; font-size: 14px; color: var(--ink); }

.pagination { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-top: 1px solid var(--line); background: var(--bg-soft); gap: 12px; flex-wrap: wrap; }
.pagination .info { font-size: 12px; color: var(--ink-2); font-weight: 500; }
.pagination .info strong { color: var(--ink); font-weight: 700; font-family: "JetBrains Mono", monospace; }
.pagination .pages { display: flex; gap: 4px; align-items: center; }
.page-btn { min-width: 32px; height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--line-2); background: white; color: var(--ink-2); font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 5px; transition: all 0.15s; text-decoration: none; }
.page-btn:hover:not(:disabled) { border-color: var(--peach-300); background: var(--peach-50); color: var(--ink); }
.page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.page-btn.active { background: linear-gradient(180deg, var(--peach-300), var(--peach-400)); color: white; border-color: transparent; box-shadow: 0 4px 10px -2px rgba(244, 121, 72, 0.35); opacity: 1; cursor: default; }
.page-btn.ellipsis { border: 0; background: transparent; cursor: default; color: var(--ink-3); }
.page-btn svg { width: 14px; height: 14px; }
@media (max-width: 480px) { .hide-sm { display: none; } }

.logs-cards { display: none; padding: 12px; }
.log-card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin-bottom: 12px; cursor: pointer; }
.log-card .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 8px; }
.log-card .prompt { font-size: 14px; font-weight: 500; color: var(--ink); line-height: 1.45; margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.log-card .meta-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 12px; }
.log-card .meta-grid > div { font-size: 11px; color: var(--ink-3); font-weight: 500; }
.log-card .meta-grid strong { display: block; font-family: "JetBrains Mono", monospace; font-size: 13px; font-weight: 600; color: var(--ink); margin-top: 2px; word-break: break-all; }
.log-card .cost-big { font-family: "JetBrains Mono", monospace; font-weight: 700; font-size: 16px; color: var(--ink); }

.modal { position: fixed; inset: 0; background: rgba(42, 26, 18, 0.4); backdrop-filter: blur(4px); display: none; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
.modal.open { display: flex; animation: fadeIn 0.2s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.modal-card { background: var(--card); border-radius: 24px; max-width: 720px; width: 100%; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 32px 80px -20px rgba(42, 26, 18, 0.4); animation: slideUp 0.25s cubic-bezier(.2,.8,.2,1); }
@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.modal-head { padding: 22px 26px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; }
.modal-head h3 { margin: 0; font-size: 18px; font-weight: 700; }
.modal-close { width: 36px; height: 36px; border-radius: 50%; border: 0; background: var(--bg-soft); cursor: pointer; font-size: 18px; color: var(--ink-2); display: grid; place-items: center; }
.modal-close:hover { background: var(--peach-100); color: var(--ink); }
.modal-body { padding: 24px 26px; overflow-y: auto; font-size: 14px; color: var(--ink-2); line-height: 1.6; white-space: pre-wrap; font-family: "JetBrains Mono", monospace; }

@media (max-width: 1100px) {
	.stats { grid-template-columns: repeat(3, 1fr); }
	.stat.featured { grid-column: span 3; }
	.grid-2 { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 760px) {
	.wrap { padding: 20px 16px 60px; }
	.grid-2 { grid-template-columns: 1fr; }
	.stats { grid-template-columns: repeat(2, 1fr); gap: 12px; }
	.stat.featured { grid-column: span 2; }
	.stat { padding: 16px; border-radius: 18px; }
	.field { flex: 1 1 calc(50% - 5px); }
	.field.period { flex: 1 1 100%; }
	.field-actions { width: 100%; margin-left: 0; }
	.field-actions .btn { flex: 1; justify-content: center; }
	.filters { padding: 16px; border-radius: 20px; }
	.card { padding: 20px; border-radius: 18px; }
	.table-scroll { display: none; }
	.logs-cards { display: block; }
	.logs-head { padding: 18px 18px; }
	.logs-head h2 { font-size: 18px; }
	.brand h1 { font-size: 22px; }
	.logo { width: 40px; height: 40px; border-radius: 12px; }
	.logo svg { width: 20px; height: 20px; }
}
@media (max-width: 600px) {
	.pagination { padding: 14px 16px; flex-direction: column; align-items: stretch; }
	.pagination .info { text-align: center; }
	.pagination .pages { justify-content: center; flex-wrap: wrap; }
}
@media (max-width: 420px) {
	.stats { grid-template-columns: 1fr; }
	.stat.featured { grid-column: span 1; }
	.field { flex: 1 1 100%; }
}
</style>
</head>
<body>
<div class="wrap">

	<header class="topbar">
		<div class="brand">
			<div class="logo" aria-hidden="true">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<polygon points="12 2 22 8 22 16 12 22 2 16 2 8 12 2"></polygon>
				</svg>
			</div>
			<div>
				<h1>Claude Monitor</h1>
				<div class="sub">
					<span class="dot live-dot"></span>
					<span>mitmproxy</span>
					<span class="dot"></span>
					<span>refresh 15s</span>
					<span class="dot"></span>
					<span>Asia/Bangkok</span>
				</div>
			</div>
		</div>
		<div class="refresh-pill">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="23 4 23 10 17 10"></polyline>
				<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
			</svg>
			<span>อัปเดตล่าสุด <strong id="lastUpdate" class="mono">--:--:--</strong></span>
		</div>
	</header>

	<form method="get" action="/" class="filters" id="ff" aria-label="ตัวกรองข้อมูล">
		<div class="filter-row">
			<div class="field period">
				<label>Period</label>
				<div class="seg" role="tablist" id="periodSeg">
					<button type="button" data-period="daily"${filters.period === 'daily' ? ' class="on"' : ''}>Daily</button>
					<button type="button" data-period="monthly"${filters.period === 'monthly' ? ' class="on"' : ''}>Monthly</button>
					<button type="button" data-period="yearly"${filters.period === 'yearly' ? ' class="on"' : ''}>Yearly</button>
				</div>
				<input type="hidden" name="period" id="period" value="${esc(filters.period)}">
			</div>
			<div class="field dates">
				<label>Date From</label>
				<input type="date" class="date-input" name="date_from" id="df" value="${esc(filters.dateFrom)}">
			</div>
			<div class="field dates">
				<label>Date To</label>
				<input type="date" class="date-input" name="date_to" id="dt" value="${esc(filters.dateTo)}">
			</div>
			<div class="field">
				<label>Model</label>
				<div class="select-wrap">
					<select class="select" name="model">
						<option value=""${filters.model === '' ? ' selected' : ''}>All</option>
						${modelOpts}
					</select>
				</div>
			</div>
			<div class="field">
				<label>Account</label>
				<div class="select-wrap">
					<select class="select" name="account">
						<option value=""${filters.account === '' ? ' selected' : ''}>All</option>
						${accountOpts}
					</select>
				</div>
			</div>
			<div class="field">
				<label>Client</label>
				<div class="select-wrap">
					<select class="select" name="client">
						<option value=""${filters.client === '' ? ' selected' : ''}>All</option>
						${clientOpts}
					</select>
				</div>
			</div>
			<input type="hidden" name="per_page" id="pph" value="${esc(perPageVal)}">
			<input type="hidden" name="page" value="1">
			<div class="field-actions">
				<a href="${exportUrl}" class="btn" download>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
						<polyline points="7 10 12 15 17 10"></polyline>
						<line x1="12" y1="15" x2="12" y2="3"></line>
					</svg>
					Export CSV
				</a>
				<button type="submit" class="btn primary">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="20 6 9 17 4 12"></polyline>
					</svg>
					Apply
				</button>
			</div>
		</div>
	</form>

	<section class="stats" aria-label="สรุปยอดรวม">
		<div class="stat featured">
			<div class="label"><span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg></span>Estimated Cost</div>
			<div class="value">${estCost}</div>
			<div class="trend">ค่าใช้จ่ายสะสมในช่วงที่เลือก</div>
		</div>
		${statCardsHtml}
	</section>

	<section class="grid-2">
		<div class="card">
			<div class="card-head"><h2>By Model</h2>${showMore('model', byModel.length)}</div>
			<div>${byModelHtml}</div>
		</div>
		<div class="card">
			<div class="card-head"><h2>By Account</h2>${showMore('account', byAccount.length)}</div>
			<div>${byAccountHtml}</div>
		</div>
		<div class="card">
			<div class="card-head"><h2>By Client</h2>${showMore('client', byClient.length)}</div>
			<div>${byClientHtml}</div>
		</div>
	</section>

	<section class="logs">
		<div class="logs-head">
			<div>
				<h2>Count Call</h2>
				<div class="sub">รายการเรียก API ทั้งหมด <span class="mono">${num(totalCount)}</span> records</div>
			</div>
			<div class="pager">
				<span>Rows per page</span>
				<div class="seg seg-sm" id="pageSizeSeg">
					<button type="button" data-size="10"${perPageVal === '10' ? ' class="on"' : ''}>10</button>
					<button type="button" data-size="20"${perPageVal === '20' ? ' class="on"' : ''}>20</button>
					<button type="button" data-size="50"${perPageVal === '50' ? ' class="on"' : ''}>50</button>
					<button type="button" data-size="100"${perPageVal === '100' ? ' class="on"' : ''}>100</button>
					<button type="button" data-size="all"${perPageVal === 'all' ? ' class="on"' : ''}>All</button>
				</div>
			</div>
		</div>

		<div class="table-scroll">
			<table class="logs-table">
				<thead>
					<tr>
						<th>Time (BKK)</th><th>Client</th><th>Account</th><th>Model</th><th>Prompt</th>
						<th>In</th><th>Out</th><th>Cache W</th><th>Cache R</th><th>Cost</th>
					</tr>
				</thead>
				<tbody id="logsTableBody">${logRows || emptyTable}</tbody>
			</table>
		</div>

		<div class="logs-cards" id="logsCards">${logCards || emptyCards}</div>

		${paginationHtml}
	</section>

</div>

<div class="modal" id="modal" role="dialog" aria-modal="true">
	<div class="modal-card">
		<div class="modal-head">
			<h3 id="modalTitle">Full Prompt</h3>
			<button class="modal-close" id="modalClose" aria-label="ปิด">✕</button>
		</div>
		<div class="modal-body" id="modalBody"></div>
	</div>
</div>

<script>
const D_TODAY='${todayStr}', D_MONTH='${firstMonthStr}', D_YEAR='${firstYearStr}';
const BREAKDOWN_DATA=${breakdownData};

// Period seg
document.querySelectorAll('#periodSeg button').forEach(b => b.addEventListener('click', () => {
	const v = b.dataset.period;
	document.getElementById('period').value = v;
	if (v === 'daily')   { document.getElementById('df').value = D_TODAY; document.getElementById('dt').value = D_TODAY; }
	else if (v === 'monthly') { document.getElementById('df').value = D_MONTH; document.getElementById('dt').value = D_TODAY; }
	else if (v === 'yearly')  { document.getElementById('df').value = D_YEAR;  document.getElementById('dt').value = D_TODAY; }
	document.getElementById('ff').submit();
}));

// Rows per page seg
document.querySelectorAll('#pageSizeSeg button').forEach(b => b.addEventListener('click', () => {
	document.getElementById('pph').value = b.dataset.size;
	document.getElementById('ff').submit();
}));

// Modal
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtMoney(n) { return '$' + (Number(n) || 0).toFixed(4); }
function fmtNum(n) { return (Number(n) || 0).toLocaleString('en-US'); }
function openPromptModal(text) {
	modalTitle.textContent = 'Full Prompt';
	modalBody.textContent = text;
	modalBody.style.fontFamily = '"JetBrains Mono", monospace';
	modalBody.style.whiteSpace = 'pre-wrap';
	modal.classList.add('open');
}
function openBreakdownModal(cat) {
	const titleMap = { model: 'All Models', account: 'All Accounts', client: 'All Clients' };
	const data = BREAKDOWN_DATA[cat] || [];
	const max = data.reduce((m, it) => Math.max(m, it.v), 0) || 1;
	modalTitle.textContent = titleMap[cat] || 'Details';
	modalBody.style.fontFamily = 'inherit';
	modalBody.style.whiteSpace = 'normal';
	modalBody.innerHTML = data.map((it, i) => {
		const pct = Math.max(2, (it.v / max) * 100);
		const swatch = ['#FF9466','#FFB088','#FFD1B3'][i % 3];
		return '<div class="bar-row">' +
			'<div class="name"><span class="swatch" style="background:' + swatch + '"></span>' + escapeHtml(it.name) + '</div>' +
			'<div class="num"><span>' + fmtNum(it.n) + ' calls</span><strong>' + fmtMoney(it.cost) + '</strong></div>' +
			'<div class="bar-track"><div class="bar-fill" style="width:' + pct.toFixed(1) + '%"></div></div>' +
		'</div>';
	}).join('') || '<div style="color:var(--ink-3);font-size:13px">ไม่มีข้อมูล</div>';
	modal.classList.add('open');
}
function closeModal() { modal.classList.remove('open'); }
document.getElementById('modalClose').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

document.querySelectorAll('#logsTableBody tr[data-full]').forEach(tr => {
	tr.addEventListener('click', () => openPromptModal(tr.dataset.full));
});
document.querySelectorAll('#logsCards .log-card[data-full]').forEach(c => {
	c.addEventListener('click', () => openPromptModal(c.dataset.full));
});
document.querySelectorAll('.show-more').forEach(btn => {
	btn.addEventListener('click', () => openBreakdownModal(btn.dataset.cat));
});

// Animate bar fills
requestAnimationFrame(() => {
	document.querySelectorAll('.bar-fill').forEach(b => { b.style.width = (b.dataset.pct || '0') + '%'; });
});

// Live clock (Asia/Bangkok)
function tick() {
	const t = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' });
	const el = document.getElementById('lastUpdate');
	if (el) el.textContent = t;
}
tick(); setInterval(tick, 1000);

// Preserve filter params during auto-refresh
setTimeout(() => location.replace(location.href), 15000);
</script>
</body>
</html>`;
}

// ─── Worker ───────────────────────────────────────────────────────────────────
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const { pathname } = url;

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
		}

		// POST /log
		if (pathname === '/log' && request.method === 'POST') {
			if (request.headers.get('X-Api-Key') !== env.API_KEY) {
				return json({ ok: false, error: 'Unauthorized' }, 401);
			}
			try {
				const b = await request.json() as Partial<ApiLog>;
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
				return json({ ok: true });
			} catch (e) {
				return json({ ok: false, error: String(e) }, 400);
			}
		}

		// GET /health
		if (pathname === '/health') return json({ ok: true });

		// GET / — Dashboard
		if (pathname === '/' && request.method === 'GET') {
			const todayStr     = todayBkk();
			const firstMonthStr = firstOfMonthBkk();
			const firstYearStr  = firstOfYearBkk();

			const period  = url.searchParams.get('period')    || 'daily';
			const dateFrom = url.searchParams.get('date_from') || todayStr;
			const dateTo   = url.searchParams.get('date_to')   || todayStr;
			const model    = url.searchParams.get('model')     || '';
			const account  = url.searchParams.get('account')   || '';
			const client   = url.searchParams.get('client')    || '';

			const perPageRaw = url.searchParams.get('per_page') || '10';
			const perPage: number | null = perPageRaw === 'all' ? null : Math.max(1, parseInt(perPageRaw) || 10);
			const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));

			const filters: Filters = { period, dateFrom, dateTo, model, account, client, page, perPage };
			const { clause, params } = buildWhere(filters);

			const offset = perPage === null ? 0 : (page - 1) * perPage;
			const limitClause = perPage === null ? '' : `LIMIT ${perPage} OFFSET ${offset}`;

			const [rows, countRow, totals, byModel, byClient, byAccount, allModelsRes, allAccountsRes, allClientsRes] = await Promise.all([
				env.DB.prepare(`SELECT * FROM api_logs ${clause} ORDER BY ts DESC ${limitClause}`)
					.bind(...params).all<ApiLog>(),
				env.DB.prepare(`SELECT COUNT(*) as n FROM api_logs ${clause}`)
					.bind(...params).first<{ n: number }>(),
				env.DB.prepare(
					`SELECT COUNT(*) as total, SUM(input_tokens) as totalInput, SUM(output_tokens) as totalOutput,
					        SUM(cache_read_tokens) as totalCacheRead, SUM(cache_creation_tokens) as totalCacheCreate,
					        SUM(cost_usd) as totalCost FROM api_logs ${clause}`
				).bind(...params).first<{ total: number; totalInput: number; totalOutput: number; totalCacheRead: number; totalCacheCreate: number; totalCost: number }>(),
				env.DB.prepare(`SELECT model, COUNT(*) as n, SUM(total_tokens) as tokens, SUM(cost_usd) as cost FROM api_logs ${clause} GROUP BY model ORDER BY cost DESC`)
					.bind(...params).all<{ model: string; n: number; tokens: number; cost: number }>(),
				env.DB.prepare(`SELECT CASE WHEN client IN ('claude-code-cli','claude-desktop') THEN 'client' ELSE client END as client, COUNT(*) as n, SUM(cost_usd) as cost FROM api_logs ${clause} GROUP BY 1 ORDER BY cost DESC`)
					.bind(...params).all<{ client: string; n: number; cost: number }>(),
				env.DB.prepare(`SELECT account_email, COUNT(*) as n, SUM(cost_usd) as cost FROM api_logs ${clause} GROUP BY account_email ORDER BY cost DESC`)
					.bind(...params).all<{ account_email: string; n: number; cost: number }>(),
				env.DB.prepare(`SELECT DISTINCT model FROM api_logs WHERE model != '' ORDER BY model`).all<{ model: string }>(),
				env.DB.prepare(`SELECT DISTINCT account_email FROM api_logs WHERE account_email != '' ORDER BY account_email`).all<{ account_email: string }>(),
				env.DB.prepare(`SELECT DISTINCT CASE WHEN client IN ('claude-code-cli','claude-desktop') THEN 'client' ELSE client END as client FROM api_logs WHERE client != '' ORDER BY client`).all<{ client: string }>(),
			]);

			const html = buildDashboard(
				rows.results,
				countRow?.n ?? 0,
				{ total: totals?.total ?? 0, totalInput: totals?.totalInput ?? 0, totalOutput: totals?.totalOutput ?? 0,
				  totalCacheRead: totals?.totalCacheRead ?? 0, totalCacheCreate: totals?.totalCacheCreate ?? 0, totalCost: totals?.totalCost ?? 0 },
				byModel.results, byClient.results, byAccount.results,
				allModelsRes.results.map(r => r.model),
				allAccountsRes.results.map(r => r.account_email),
				allClientsRes.results.map(r => r.client),
				filters,
				todayStr, firstMonthStr, firstYearStr,
			);
			return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
		}

		// GET /export — CSV download with same filters (no paging)
		if (pathname === '/export' && request.method === 'GET') {
			const todayStr = todayBkk();
			const dateFrom = url.searchParams.get('date_from') || todayStr;
			const dateTo   = url.searchParams.get('date_to')   || todayStr;
			const model    = url.searchParams.get('model')     || '';
			const account  = url.searchParams.get('account')   || '';
			const client   = url.searchParams.get('client')    || '';

			const filters: Filters = { period: '', dateFrom, dateTo, model, account, client, page: 1, perPage: null };
			const { clause, params } = buildWhere(filters);

			const rows = await env.DB.prepare(
				`SELECT * FROM api_logs ${clause} ORDER BY ts DESC`
			).bind(...params).all<ApiLog>();

			const csv = toCsv(rows.results);
			const filename = `claude-monitor-${dateFrom}-to-${dateTo}.csv`;
			return new Response(csv, {
				headers: {
					'Content-Type': 'text/csv;charset=utf-8',
					'Content-Disposition': `attachment; filename="${filename}"`,
					'Access-Control-Allow-Origin': '*',
				},
			});
		}

		return json({ ok: false, error: 'Not Found' }, 404);
	},
} satisfies ExportedHandler<Env>;
