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

function modelBadge(model: string): string {
	const m = model.toLowerCase();
	const color = m.includes('opus') ? '#7c3aed' : m.includes('haiku') ? '#059669' : '#2563eb';
	const label = model.replace('claude-', '').split('-20')[0] || model;
	return `<span style="background:${color}22;color:${color};border:1px solid ${color}55;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700">${esc(label)}</span>`;
}

function normalizeClient(raw: string): string {
	if (raw === 'claude-code-cli' || raw === 'claude-desktop') return 'client';
	return raw;
}

function clientBadge(client: string): string {
	const n = normalizeClient(client);
	const colors: Record<string, string> = {
		'claude-code': '#7c3aed', 'claude-code-vscode': '#0078d4', 'vscode': '#0078d4',
		'desktop': '#d97706', 'api': '#059669', 'client': '#6b7280',
	};
	const c = colors[n] ?? '#6b7280';
	return `<span style="background:${c};color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700">${esc(n)}</span>`;
}

function preview(text: string, len = 140): string {
	const t = text.trim().replace(/\s+/g, ' ');
	const e = esc(t.slice(0, len));
	if (t.length <= len) return e;
	return `${e}… <button onclick="showFull(this)" data-full="${esc(t)}" style="background:none;border:none;color:#ea580c;font-size:11px;cursor:pointer;text-decoration:underline;padding:0 0 0 4px">more</button>`;
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

// ─── Dashboard ────────────────────────────────────────────────────────────────
function buildDashboard(
	rows: ApiLog[],
	totalCount: number,
	totals: { total: number; totalInput: number; totalOutput: number; totalCacheRead: number; totalCacheCreate: number; totalCost: number },
	byModel: { model: string; n: number; tokens: number; cost: number }[],
	byClient: { client: string; n: number }[],
	byMachine: { machine_name: string; n: number }[],
	byAccount: { account_email: string; n: number; cost: number }[],
	allModels: string[],
	allAccounts: string[],
	allClients: string[],
	filters: Filters,
	todayStr: string,
	firstMonthStr: string,
	firstYearStr: string,
): string {

	const kpis = [
		{ l: 'API Calls',     v: num(totals.total) },
		{ l: 'Input Tokens',  v: num(totals.totalInput) },
		{ l: 'Output Tokens', v: num(totals.totalOutput) },
		{ l: 'Cache Write',   v: num(totals.totalCacheCreate) },
		{ l: 'Cache Read',    v: num(totals.totalCacheRead) },
		{ l: 'Est. Cost',     v: '$' + num(totals.totalCost, 4) },
	];

	const modelRows  = byModel.map(m => `<tr><td>${modelBadge(m.model)}</td><td class="r">${num(m.n)}</td><td class="r">${num(m.tokens)}</td><td class="r cost">$${num(m.cost, 4)}</td></tr>`).join('');
	const clientRows = byClient.map(c => `<tr><td>${clientBadge(c.client)}</td><td class="r">${num(c.n)}</td></tr>`).join('');
	const machineRows = byMachine.map(m => `<tr><td><code style="font-size:12px">${esc(m.machine_name || '—')}</code></td><td class="r">${num(m.n)}</td></tr>`).join('');
	const accountRows = byAccount.map(a => `<tr><td><code style="font-size:12px">${esc(a.account_email || '—')}</code></td><td class="r">${num(a.n)}</td><td class="r cost">$${num(a.cost, 4)}</td></tr>`).join('');

	const logRows = rows.map(r =>
		`<tr>
			<td class="ts">${fmtBkk(r.ts)}</td>
			<td>${clientBadge(r.client)}</td>
			<td><code style="font-size:11px">${esc(r.account_email || '—')}</code></td>
			<td>${modelBadge(r.model)}</td>
			<td class="pmx">${preview(r.prompt)}</td>
			<td class="r">${num(r.input_tokens)}</td>
			<td class="r">${num(r.output_tokens)}</td>
			<td class="r cw">${num(r.cache_creation_tokens)}</td>
			<td class="r cr">${num(r.cache_read_tokens)}</td>
			<td class="r b">${num(r.total_tokens)}</td>
			<td class="r cost">$${num(r.cost_usd, 5)}</td>
		</tr>`
	).join('');

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
		let s = Math.max(1, cur - 3);
		const e = Math.min(totalPages, s + 6);
		if (e - s < 6) s = Math.max(1, e - 6);
		if (s > 1)  parts.push(`<a href="${pageUrl(1)}" class="pg-btn">1</a>`);
		if (s > 2)  parts.push(`<span class="pg-ell">…</span>`);
		for (let p = s; p <= e; p++) parts.push(`<a href="${pageUrl(p)}" class="pg-btn${p === cur ? ' pg-cur' : ''}">${p}</a>`);
		if (e < totalPages - 1) parts.push(`<span class="pg-ell">…</span>`);
		if (e < totalPages) parts.push(`<a href="${pageUrl(totalPages)}" class="pg-btn">${totalPages}</a>`);
		pageButtons = parts.join('');
	}

	const prevBtn = cur > 1        ? `<a href="${pageUrl(cur - 1)}" class="pg-btn">‹</a>` : `<span class="pg-btn pg-dis">‹</span>`;
	const nextBtn = cur < totalPages ? `<a href="${pageUrl(cur + 1)}" class="pg-btn">›</a>` : `<span class="pg-btn pg-dis">›</span>`;

	const pagingHtml = `
	<div class="paging">
		<span class="pg-info">Showing ${num(rows.length)} of ${num(totalCount)} records</span>
		<div class="pg-btns">${prevBtn}${pageButtons}${nextBtn}</div>
	</div>`;

	// ── Export URL (carries current filters, no paging) ──────────────────────
	const exportParams = new URLSearchParams({ date_from: filters.dateFrom, date_to: filters.dateTo });
	if (filters.model)   exportParams.set('model',   filters.model);
	if (filters.account) exportParams.set('account', filters.account);
	if (filters.client)  exportParams.set('client',  filters.client);
	const exportUrl = '/export?' + exportParams.toString();

	// ── Dropdown options ──────────────────────────────────────────────────────
	const modelOpts   = allModels.map(m   => `<option value="${esc(m)}"${filters.model   === m   ? ' selected' : ''}>${esc(m.replace('claude-', '').split('-20')[0] || m)}</option>`).join('');
	const accountOpts = allAccounts.map(a => `<option value="${esc(a)}"${filters.account === a   ? ' selected' : ''}>${esc(a || '—')}</option>`).join('');
	const clientOpts  = allClients.map(c  => `<option value="${esc(c)}"${filters.client  === c   ? ' selected' : ''}>${esc(c)}</option>`).join('');

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude Monitor</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#ffffff;color:#111827;font-size:14px}
header{background:linear-gradient(135deg,#ea580c 0%,#f97316 100%);padding:14px 24px;display:flex;align-items:center;gap:10px;box-shadow:0 2px 8px rgba(234,88,12,.3)}
header h1{font-size:17px;font-weight:700;color:#ffffff}
.sub{font-size:12px;color:#ffffff;margin-left:auto;font-weight:600}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ffffff;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
main{padding:20px 24px;max-width:1700px;margin:0 auto}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:10px;margin-bottom:20px}
.card{background:#ffffff;border:1px solid #fed7aa;border-radius:8px;padding:14px 16px;box-shadow:0 1px 4px rgba(234,88,12,.08)}
.card .l{font-size:10px;text-transform:uppercase;letter-spacing:.9px;color:#374151;font-weight:700;margin-bottom:5px}
.card .v{font-size:24px;font-weight:700;color:#ea580c;line-height:1}
.four{display:grid;grid-template-columns:1.6fr 1.4fr 1fr 1fr;gap:14px;margin-bottom:20px}
@media(max-width:1100px){.four{grid-template-columns:1fr 1fr}}
section{margin-bottom:20px}
section h2{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#374151;margin-bottom:8px}
table{width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #fed7aa;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(234,88,12,.08)}
th{background:#fff7ed;padding:7px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#7c2d12;border-bottom:1px solid #fed7aa;white-space:nowrap}
td{padding:8px 12px;border-bottom:1px solid #fff7ed;vertical-align:top;color:#111827;font-size:13px}
tr:last-child td{border-bottom:none}
tr:hover td{background:#fff7ed}
.r{text-align:right;font-variant-numeric:tabular-nums}
.b{font-weight:700;color:#c2410c}
.cost{color:#c2410c;font-weight:600}
.cw{color:#6d28d9;font-weight:600}
.cr{color:#047857;font-weight:600}
.ts{white-space:nowrap;font-size:12px;color:#374151;font-family:monospace;font-weight:500}
.pmx{max-width:380px;word-break:break-word;font-size:13px;color:#1f2937}
#modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999;align-items:center;justify-content:center}
#modal.open{display:flex}
.mbox{background:#ffffff;border:1px solid #fed7aa;border-radius:10px;padding:22px;max-width:820px;width:92%;box-shadow:0 16px 48px rgba(0,0,0,.2)}
.mhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.mhead h3{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#374151}
.mbody{font-size:13px;line-height:1.75;color:#111827;white-space:pre-wrap;word-break:break-word;max-height:68vh;overflow-y:auto;background:#fff7ed;border-radius:6px;padding:14px;border:1px solid #fed7aa}
.cls{background:none;border:none;color:#6b7280;font-size:18px;cursor:pointer;padding:0 4px;line-height:1}
.cls:hover{color:#111827}
.filter-bar{background:#ffffff;border:1px solid #fed7aa;border-radius:8px;padding:14px 18px;margin-bottom:20px;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;box-shadow:0 1px 4px rgba(234,88,12,.08)}
.fg{display:flex;flex-direction:column;gap:4px}
.fg label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#374151}
.fg select,.fg input[type=date]{background:#ffffff;border:1px solid #fed7aa;color:#111827;border-radius:5px;padding:5px 8px;font-size:13px;height:30px;cursor:pointer;min-width:120px;font-weight:500}
.fg select:focus,.fg input[type=date]:focus{outline:none;border-color:#f97316}
.fg input[type=date]::-webkit-calendar-picker-indicator{filter:none}
.apply-btn{background:#ea580c;color:#ffffff;border:none;border-radius:5px;padding:5px 16px;font-size:13px;font-weight:700;cursor:pointer;height:30px;align-self:flex-end}
.apply-btn:hover{background:#c2410c}
.export-btn{background:none;border:1px solid #059669;color:#047857;border-radius:5px;padding:5px 14px;font-size:13px;font-weight:700;cursor:pointer;height:30px;align-self:flex-end;text-decoration:none;display:inline-flex;align-items:center;gap:5px}
.export-btn:hover{background:#05966915}
.tbl-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.tbl-hdr h2{margin:0}
.perpage-wrap{display:flex;align-items:center;gap:6px;font-size:12px;color:#374151;font-weight:500}
.perpage-wrap select{background:#ffffff;border:1px solid #fed7aa;color:#111827;border-radius:4px;padding:2px 6px;font-size:12px;cursor:pointer}
.paging{display:flex;align-items:center;justify-content:space-between;margin-top:12px;flex-wrap:wrap;gap:8px}
.pg-info{font-size:12px;color:#374151;font-weight:500}
.pg-btns{display:flex;gap:4px;align-items:center}
.pg-btn{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:26px;padding:0 6px;background:#ffffff;border:1px solid #d1d5db;border-radius:4px;color:#111827;font-size:12px;font-weight:500;text-decoration:none}
.pg-btn:hover:not(.pg-dis):not(.pg-cur){background:#fff7ed;border-color:#f97316}
.pg-cur{background:#fff7ed;border-color:#ea580c;color:#c2410c;font-weight:700}
.pg-dis{color:#9ca3af;cursor:default}
.pg-ell{color:#6b7280;font-size:12px;padding:0 2px}
</style>
</head>
<body>
<header>
  <h1>⬡ Claude Monitor</h1>
  <span class="dot"></span>
  <span style="font-size:12px;color:#ffffff;font-weight:600">mitmproxy · refresh 15s</span>
  <span class="sub">Asia/Bangkok</span>
</header>
<main>

<form method="get" action="/" class="filter-bar" id="ff">
  <div class="fg">
    <label>Period</label>
    <select name="period" id="period" onchange="onPeriod(this.value)">
      <option value="daily"${filters.period === 'daily' ? ' selected' : ''}>Daily</option>
      <option value="monthly"${filters.period === 'monthly' ? ' selected' : ''}>Monthly</option>
      <option value="yearly"${filters.period === 'yearly' ? ' selected' : ''}>Yearly</option>
    </select>
  </div>
  <div class="fg">
    <label>Date From</label>
    <input type="date" name="date_from" id="df" value="${esc(filters.dateFrom)}">
  </div>
  <div class="fg">
    <label>Date To</label>
    <input type="date" name="date_to" id="dt" value="${esc(filters.dateTo)}">
  </div>
  <div class="fg">
    <label>Model</label>
    <select name="model">
      <option value="">All</option>
      ${modelOpts}
    </select>
  </div>
  <div class="fg">
    <label>Account</label>
    <select name="account">
      <option value="">All</option>
      ${accountOpts}
    </select>
  </div>
  <div class="fg">
    <label>Client</label>
    <select name="client">
      <option value="">All</option>
      ${clientOpts}
    </select>
  </div>
  <input type="hidden" name="per_page" id="pph" value="${esc(perPageVal)}">
  <input type="hidden" name="page" value="1">
  <button type="submit" class="apply-btn">Apply</button>
  <a href="${exportUrl}" class="export-btn" download>↓ Export CSV</a>
</form>

<div class="grid">
${kpis.map(k => `<div class="card"><div class="l">${k.l}</div><div class="v">${k.v}</div></div>`).join('\n')}
</div>

<div class="four">
  <section>
    <h2>By Model</h2>
    <table><thead><tr><th>Model</th><th class="r">Calls</th><th class="r">Tokens</th><th class="r">Cost</th></tr></thead>
    <tbody>${modelRows || '<tr><td colspan="4" style="color:#94a3b8;padding:14px">No data</td></tr>'}</tbody></table>
  </section>
  <section>
    <h2>By Account</h2>
    <table><thead><tr><th>By Account</th><th class="r">Calls</th><th class="r">Cost</th></tr></thead>
    <tbody>${accountRows || '<tr><td colspan="3" style="color:#94a3b8;padding:14px">—</td></tr>'}</tbody></table>
  </section>
  <section>
    <h2>By Client</h2>
    <table><thead><tr><th>Client</th><th class="r">Calls</th></tr></thead>
    <tbody>${clientRows || '<tr><td colspan="2" style="color:#94a3b8;padding:14px">—</td></tr>'}</tbody></table>
  </section>
</div>

<section>
  <div class="tbl-hdr">
    <h2>Count Call</h2>
    <div class="perpage-wrap">
      <span>Rows per page:</span>
      <select onchange="onPerPage(this.value)">
        <option value="20"${perPageVal === '20' ? ' selected' : ''}>20</option>
        <option value="50"${perPageVal === '50' ? ' selected' : ''}>50</option>
        <option value="100"${perPageVal === '100' ? ' selected' : ''}>100</option>
        <option value="all"${perPageVal === 'all' ? ' selected' : ''}>All</option>
      </select>
    </div>
  </div>
  <div style="overflow-x:auto">
    <table>
      <thead><tr>
        <th>Time (BKK)</th><th>Client</th><th>Account</th><th>Model</th><th>Prompt</th>
        <th class="r" style="white-space:normal;line-height:1.3;text-align:center">Token<br>In</th>
        <th class="r" style="white-space:normal;line-height:1.3;text-align:center">Token<br>Out</th>
        <th class="r" style="white-space:normal;line-height:1.3;text-align:center">Cache<br>Write</th>
        <th class="r" style="white-space:normal;line-height:1.3;text-align:center">Cache<br>Read</th>
        <th class="r">Total</th><th class="r">Cost</th>
      </tr></thead>
      <tbody>${logRows || '<tr><td colspan="11" style="color:#94a3b8;padding:16px">No calls found</td></tr>'}</tbody>
    </table>
  </div>
  ${pagingHtml}
</section>
</main>

<div id="modal" onclick="if(event.target===this)closeM()">
  <div class="mbox">
    <div class="mhead"><h3>Full Prompt</h3><button class="cls" onclick="closeM()">✕</button></div>
    <div id="mbody" class="mbody"></div>
  </div>
</div>
<script>
function showFull(b){document.getElementById('mbody').textContent=b.dataset.full;document.getElementById('modal').classList.add('open')}
function closeM(){document.getElementById('modal').classList.remove('open')}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeM()})

const D_TODAY='${todayStr}', D_MONTH='${firstMonthStr}', D_YEAR='${firstYearStr}';
function onPeriod(v){
  if(v==='daily'){document.getElementById('df').value=D_TODAY;document.getElementById('dt').value=D_TODAY}
  else if(v==='monthly'){document.getElementById('df').value=D_MONTH;document.getElementById('dt').value=D_TODAY}
  else if(v==='yearly'){document.getElementById('df').value=D_YEAR;document.getElementById('dt').value=D_TODAY}
  document.getElementById('ff').submit();
}
function onPerPage(v){document.getElementById('pph').value=v;document.getElementById('ff').submit()}

// preserve filter params during auto-refresh
setTimeout(()=>location.replace(location.href), 15000);
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

			const perPageRaw = url.searchParams.get('per_page') || '20';
			const perPage: number | null = perPageRaw === 'all' ? null : Math.max(1, parseInt(perPageRaw) || 20);
			const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));

			const filters: Filters = { period, dateFrom, dateTo, model, account, client, page, perPage };
			const { clause, params } = buildWhere(filters);

			const offset = perPage === null ? 0 : (page - 1) * perPage;
			const limitClause = perPage === null ? '' : `LIMIT ${perPage} OFFSET ${offset}`;

			const [rows, countRow, totals, byModel, byClient, byMachine, byAccount, allModelsRes, allAccountsRes, allClientsRes] = await Promise.all([
				env.DB.prepare(`SELECT * FROM api_logs ${clause} ORDER BY ts DESC ${limitClause}`)
					.bind(...params).all<ApiLog>(),
				env.DB.prepare(`SELECT COUNT(*) as n FROM api_logs ${clause}`)
					.bind(...params).first<{ n: number }>(),
				env.DB.prepare(
					`SELECT COUNT(*) as total, SUM(input_tokens) as totalInput, SUM(output_tokens) as totalOutput,
					        SUM(cache_read_tokens) as totalCacheRead, SUM(cache_creation_tokens) as totalCacheCreate,
					        SUM(cost_usd) as totalCost FROM api_logs ${clause}`
				).bind(...params).first<{ total: number; totalInput: number; totalOutput: number; totalCacheRead: number; totalCacheCreate: number; totalCost: number }>(),
				env.DB.prepare(`SELECT model, COUNT(*) as n, SUM(total_tokens) as tokens, SUM(cost_usd) as cost FROM api_logs ${clause} GROUP BY model ORDER BY n DESC`)
					.bind(...params).all<{ model: string; n: number; tokens: number; cost: number }>(),
				env.DB.prepare(`SELECT CASE WHEN client IN ('claude-code-cli','claude-desktop') THEN 'client' ELSE client END as client, COUNT(*) as n FROM api_logs ${clause} GROUP BY 1 ORDER BY n DESC`)
					.bind(...params).all<{ client: string; n: number }>(),
				env.DB.prepare(`SELECT machine_name, COUNT(*) as n FROM api_logs ${clause} GROUP BY machine_name ORDER BY n DESC`)
					.bind(...params).all<{ machine_name: string; n: number }>(),
				env.DB.prepare(`SELECT account_email, COUNT(*) as n, SUM(cost_usd) as cost FROM api_logs ${clause} GROUP BY account_email ORDER BY n DESC`)
					.bind(...params).all<{ account_email: string; n: number; cost: number }>(),
				// distinct values for dropdowns (unfiltered)
				env.DB.prepare(`SELECT DISTINCT model FROM api_logs WHERE model != '' ORDER BY model`).all<{ model: string }>(),
				env.DB.prepare(`SELECT DISTINCT account_email FROM api_logs WHERE account_email != '' ORDER BY account_email`).all<{ account_email: string }>(),
				env.DB.prepare(`SELECT DISTINCT CASE WHEN client IN ('claude-code-cli','claude-desktop') THEN 'client' ELSE client END as client FROM api_logs WHERE client != '' ORDER BY client`).all<{ client: string }>(),
			]);

			const html = buildDashboard(
				rows.results,
				countRow?.n ?? 0,
				{ total: totals?.total ?? 0, totalInput: totals?.totalInput ?? 0, totalOutput: totals?.totalOutput ?? 0,
				  totalCacheRead: totals?.totalCacheRead ?? 0, totalCacheCreate: totals?.totalCacheCreate ?? 0, totalCost: totals?.totalCost ?? 0 },
				byModel.results, byClient.results, byMachine.results, byAccount.results,
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
