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

function modelBadge(model: string): string {
	const m = model.toLowerCase();
	const color = m.includes('opus') ? '#7c3aed' : m.includes('haiku') ? '#059669' : '#2563eb';
	const label = model.replace('claude-', '').split('-20')[0] || model;
	return `<span style="background:${color}22;color:${color};border:1px solid ${color}55;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700">${esc(label)}</span>`;
}

function clientBadge(client: string): string {
	const colors: Record<string, string> = {
		'claude-code': '#7c3aed', 'vscode': '#0078d4', 'desktop': '#d97706', 'api': '#059669',
	};
	const c = colors[client] ?? '#6b7280';
	return `<span style="background:${c};color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700">${esc(client)}</span>`;
}

function preview(text: string, len = 140): string {
	const t = text.trim().replace(/\s+/g, ' ');
	const e = esc(t.slice(0, len));
	if (t.length <= len) return e;
	return `${e}… <button onclick="showFull(this)" data-full="${esc(t)}" style="background:none;border:none;color:#818cf8;font-size:11px;cursor:pointer;text-decoration:underline;padding:0 0 0 4px">more</button>`;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function buildDashboard(rows: ApiLog[], totals: {
	total: number; totalInput: number; totalOutput: number;
	totalCacheRead: number; totalCacheCreate: number; totalCost: number;
}, byModel: { model: string; n: number; tokens: number; cost: number }[],
   byClient: { client: string; n: number }[],
   byMachine: { machine_name: string; n: number }[],
   byAccount: { account_email: string; n: number; cost: number }[]
): string {

	const kpis = [
		{ l: 'API Calls',     v: num(totals.total) },
		{ l: 'Input Tokens',  v: num(totals.totalInput) },
		{ l: 'Output Tokens', v: num(totals.totalOutput) },
		{ l: 'Cache Write',   v: num(totals.totalCacheCreate) },
		{ l: 'Cache Read',    v: num(totals.totalCacheRead) },
		{ l: 'Est. Cost',     v: '$' + num(totals.totalCost, 4) },
	];

	const modelRows = byModel.map(m =>
		`<tr><td>${modelBadge(m.model)}</td><td class="r">${num(m.n)}</td><td class="r">${num(m.tokens)}</td><td class="r cost">$${num(m.cost, 4)}</td></tr>`
	).join('');

	const clientRows = byClient.map(c =>
		`<tr><td>${clientBadge(c.client)}</td><td class="r">${num(c.n)}</td></tr>`
	).join('');

	const machineRows = byMachine.map(m =>
		`<tr><td><code style="font-size:12px">${esc(m.machine_name || '—')}</code></td><td class="r">${num(m.n)}</td></tr>`
	).join('');

	const accountRows = byAccount.map(a =>
		`<tr><td><code style="font-size:12px">${esc(a.account_email || '—')}</code></td><td class="r">${num(a.n)}</td><td class="r cost">$${num(a.cost, 4)}</td></tr>`
	).join('');

	const logRows = rows.map(r =>
		`<tr>
			<td class="ts">${fmtBkk(r.ts)}</td>
			<td>${clientBadge(r.client)}</td>
			<td><code style="font-size:11px">${esc(r.account_email || '—')}</code></td>
			<td><code style="font-size:11px">${esc(r.machine_name || '—')}</code></td>
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

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="15">
<title>Claude Monitor</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0d1117;color:#c9d1d9;font-size:14px}
header{background:#161b22;border-bottom:1px solid #30363d;padding:14px 24px;display:flex;align-items:center;gap:10px}
header h1{font-size:17px;font-weight:700;color:#a78bfa}
.sub{font-size:12px;color:#484f58;margin-left:auto}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#3fb950;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
main{padding:20px 24px;max-width:1700px;margin:0 auto}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:10px;margin-bottom:20px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px 16px}
.card .l{font-size:10px;text-transform:uppercase;letter-spacing:.9px;color:#484f58;font-weight:700;margin-bottom:5px}
.card .v{font-size:24px;font-weight:700;color:#f0f6fc;line-height:1}
.three{display:grid;grid-template-columns:2fr 1fr 1fr;gap:14px;margin-bottom:20px}
.four{display:grid;grid-template-columns:1.6fr 1.4fr 1fr 1fr;gap:14px;margin-bottom:20px}
@media(max-width:1100px){.four{grid-template-columns:1fr 1fr}}
section{margin-bottom:20px}
section h2{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#484f58;margin-bottom:8px}
table{width:100%;border-collapse:collapse;background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:hidden}
th{background:#0d1117;padding:7px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#484f58;border-bottom:1px solid #30363d;white-space:nowrap}
td{padding:7px 12px;border-bottom:1px solid #21262d;vertical-align:top}
tr:last-child td{border-bottom:none}
tr:hover td{background:#1c2128}
.r{text-align:right;font-variant-numeric:tabular-nums}
.b{font-weight:700;color:#f0f6fc}
.cost{color:#f0883e}
.cw{color:#a78bfa}
.cr{color:#3fb950}
.ts{white-space:nowrap;font-size:12px;color:#484f58;font-family:monospace}
.pmx{max-width:380px;word-break:break-word;font-size:13px;color:#8b949e}
#modal{display:none;position:fixed;inset:0;background:#000000aa;z-index:999;align-items:center;justify-content:center}
#modal.open{display:flex}
.mbox{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:22px;max-width:820px;width:92%;box-shadow:0 16px 48px #000a}
.mhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.mhead h3{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#484f58}
.mbody{font-size:13px;line-height:1.75;color:#c9d1d9;white-space:pre-wrap;word-break:break-word;max-height:68vh;overflow-y:auto;background:#0d1117;border-radius:6px;padding:14px;border:1px solid #30363d}
.cls{background:none;border:none;color:#484f58;font-size:18px;cursor:pointer;padding:0 4px;line-height:1}
.cls:hover{color:#f0f6fc}
</style>
</head>
<body>
<header>
  <h1>⬡ Claude Monitor</h1>
  <span class="dot"></span>
  <span style="font-size:12px;color:#484f58">mitmproxy · refresh 15s</span>
  <span class="sub">Asia/Bangkok · all time</span>
</header>
<main>
<div class="grid">
${kpis.map(k => `<div class="card"><div class="l">${k.l}</div><div class="v">${k.v}</div></div>`).join('\n')}
</div>
<div class="four">
  <section>
    <h2>By Model</h2>
    <table>
      <thead><tr><th>Model</th><th class="r">Calls</th><th class="r">Tokens</th><th class="r">Cost</th></tr></thead>
      <tbody>${modelRows || '<tr><td colspan="4" style="color:#484f58;padding:14px">No data yet</td></tr>'}</tbody>
    </table>
  </section>
  <section>
    <h2>By Account</h2>
    <table>
      <thead><tr><th>Email</th><th class="r">Calls</th><th class="r">Cost</th></tr></thead>
      <tbody>${accountRows || '<tr><td colspan="3" style="color:#484f58;padding:14px">—</td></tr>'}</tbody>
    </table>
  </section>
  <section>
    <h2>By Client</h2>
    <table>
      <thead><tr><th>Client</th><th class="r">Calls</th></tr></thead>
      <tbody>${clientRows || '<tr><td colspan="2" style="color:#484f58;padding:14px">—</td></tr>'}</tbody>
    </table>
  </section>
  <section>
    <h2>By Machine</h2>
    <table>
      <thead><tr><th>Machine</th><th class="r">Calls</th></tr></thead>
      <tbody>${machineRows || '<tr><td colspan="2" style="color:#484f58;padding:14px">—</td></tr>'}</tbody>
    </table>
  </section>
</div>
<section>
  <h2>Recent API Calls (last 100)</h2>
  <div style="overflow-x:auto">
    <table>
      <thead>
        <tr>
          <th>Time (BKK)</th><th>Client</th><th>Account</th><th>Machine</th><th>Model</th><th>Prompt</th>
          <th class="r">In</th><th class="r">Out</th>
          <th class="r">Cache↑</th><th class="r">Cache↓</th>
          <th class="r">Total</th><th class="r">Cost</th>
        </tr>
      </thead>
      <tbody>${logRows || '<tr><td colspan="12" style="color:#484f58;padding:16px">No calls yet — start mitmproxy and use Claude</td></tr>'}</tbody>
    </table>
  </div>
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
</script>
</body>
</html>`;
}

// ─── Worker ───────────────────────────────────────────────────────────────────
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const { pathname } = new URL(request.url);

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
		}

		// POST /log — receive from mitmproxy addon
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
			const [rows, totals, byModel, byClient, byMachine, byAccount] = await Promise.all([
				env.DB.prepare(`SELECT * FROM api_logs ORDER BY ts DESC LIMIT 100`).all<ApiLog>(),
				env.DB.prepare(
					`SELECT COUNT(*) as total, SUM(input_tokens) as totalInput, SUM(output_tokens) as totalOutput,
					        SUM(cache_read_tokens) as totalCacheRead, SUM(cache_creation_tokens) as totalCacheCreate,
					        SUM(cost_usd) as totalCost
					 FROM api_logs`
				).first<{ total: number; totalInput: number; totalOutput: number; totalCacheRead: number; totalCacheCreate: number; totalCost: number }>(),
				env.DB.prepare(
					`SELECT model, COUNT(*) as n, SUM(total_tokens) as tokens, SUM(cost_usd) as cost
					 FROM api_logs GROUP BY model ORDER BY n DESC`
				).all<{ model: string; n: number; tokens: number; cost: number }>(),
				env.DB.prepare(
					`SELECT client, COUNT(*) as n FROM api_logs GROUP BY client ORDER BY n DESC`
				).all<{ client: string; n: number }>(),
				env.DB.prepare(
					`SELECT machine_name, COUNT(*) as n FROM api_logs GROUP BY machine_name ORDER BY n DESC`
				).all<{ machine_name: string; n: number }>(),
				env.DB.prepare(
					`SELECT account_email, COUNT(*) as n, SUM(cost_usd) as cost
					 FROM api_logs GROUP BY account_email ORDER BY n DESC`
				).all<{ account_email: string; n: number; cost: number }>(),
			]);

			const html = buildDashboard(
				rows.results,
				{ total: totals?.total ?? 0, totalInput: totals?.totalInput ?? 0, totalOutput: totals?.totalOutput ?? 0,
				  totalCacheRead: totals?.totalCacheRead ?? 0, totalCacheCreate: totals?.totalCacheCreate ?? 0, totalCost: totals?.totalCost ?? 0 },
				byModel.results, byClient.results, byMachine.results, byAccount.results,
			);
			return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
		}

		return json({ ok: false, error: 'Not Found' }, 404);
	},
} satisfies ExportedHandler<Env>;
