import type { ApiLog, Filters, SessionUser } from '../types';
import { esc, num, fmtBkkParts } from '../lib/format';
import { modelBadge, clientBadge, buildColorMap, MODEL_PASTEL, CLIENT_DARK, modelLabel, normalizeClient } from '../lib/badge';
import { displayAccount } from '../lib/account';
import { renderLayout } from './layout';

const arrowL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
const arrowR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

function buildPageUrl(filters: Filters, perPageVal: string) {
	return (p: number) => {
		const q = new URLSearchParams({
			date_from: filters.dateFrom, date_to: filters.dateTo,
			per_page: perPageVal, page: String(p),
		});
		if (filters.model)   q.set('model',   filters.model);
		if (filters.account) q.set('account', filters.account);
		if (filters.client)  q.set('client',  filters.client);
		return '/logs?' + q.toString();
	};
}

function pageBtn(p: number, cur: number, urlFn: (p: number) => string): string {
	if (p === cur) return `<button class="page-btn active" disabled>${p}</button>`;
	return `<a href="${urlFn(p)}" class="page-btn">${p}</a>`;
}

function renderPagination(filters: Filters, totalCount: number, perPageVal: string): string {
	const totalPages = filters.perPage === null ? 1 : Math.max(1, Math.ceil(totalCount / filters.perPage));
	const cur = filters.page;
	const pageUrl = buildPageUrl(filters, perPageVal);

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

	const prevBtn = cur > 1
		? `<a href="${pageUrl(cur - 1)}" class="page-btn">${arrowL}<span class="hide-sm">Prev</span></a>`
		: `<button class="page-btn" disabled>${arrowL}<span class="hide-sm">Prev</span></button>`;
	const nextBtn = cur < totalPages
		? `<a href="${pageUrl(cur + 1)}" class="page-btn"><span class="hide-sm">Next</span>${arrowR}</a>`
		: `<button class="page-btn" disabled><span class="hide-sm">Next</span>${arrowR}</button>`;

	const startIdx = totalCount === 0 ? 0 : (filters.perPage === null ? 1 : (cur - 1) * filters.perPage + 1);
	const endIdx = filters.perPage === null ? totalCount : Math.min(cur * filters.perPage, totalCount);

	return `
		<div class="pagination">
			<div class="info">แสดง <strong>${num(startIdx)}–${num(endIdx)}</strong> จาก <strong>${num(totalCount)}</strong> รายการ</div>
			<div class="pages">${prevBtn}${pageButtons}${nextBtn}</div>
		</div>`;
}

function chip(val: string | undefined, color = '#6B7280'): string {
	if (!val) return '<span class="empty-val">—</span>';
	return `<span class="tag" style="background:${color}20;color:${color};border:1px solid ${color}40">${esc(val)}</span>`;
}

function truncate(s: string | undefined, n = 60): string {
	if (!s) return '<span class="empty-val">—</span>';
	return esc(s.length > n ? s.slice(0, n) + '…' : s);
}

function renderRows(rows: ApiLog[], mColorMap: Map<string, string>, cColorMap: Map<string, string>): string {
	if (rows.length === 0) {
		return `<tr><td colspan="20" style="padding:32px;color:var(--ink-3);text-align:center;">ไม่พบรายการ</td></tr>`;
	}
	return rows.map(r => {
		const { time, date } = fmtBkkParts(r.ts);
		const anonIdDisplay = r.anon_id
			? `<span class="mono-sm" title="${esc(r.anon_id)}">${esc(r.anon_id.slice(0, 20))}…</span>`
			: '<span style="color:var(--ink-3)">—</span>';
		return `<tr>
			<td class="nowrap"><span class="time">${esc(time)}<br><span class="date">${esc(date)}</span></span></td>
			<td class="td-center">${clientBadge(r.client, cColorMap)}</td>
			<td>${esc(displayAccount(r.account_email))}</td>
			<td class="mono-sm">${esc(r.client_ip || '—')}</td>
			<td class="td-center">${modelBadge(r.model, mColorMap)}</td>
			<td>${chip(r.os_type,    '#2563EB')}</td>
			<td class="mono-sm">${esc(r.os_version || '—')}</td>
			<td>${chip(r.host_arch,  '#7C3AED')}</td>
			<td class="mono-sm">${esc(r.app_version || '—')}</td>
			<td>${chip(r.terminal,   '#0891B2')}</td>
			<td class="mono-sm" title="${esc(r.device_id || '')}">${r.device_id ? esc(r.device_id.slice(0, 18)) + '…' : '—'}</td>
			<td class="mono-sm">${esc(r.mac_address || '—')}</td>
			<td>${anonIdDisplay}</td>
			<td class="prompt-cell">${truncate(r.prompt, 80)}</td>
			<td class="num-cell"><span class="mono">${num(r.input_tokens)}</span></td>
			<td class="num-cell"><span class="mono">${num(r.output_tokens)}</span></td>
			<td class="num-cell"><span class="mono">${num(r.cache_creation_tokens)}</span></td>
			<td class="num-cell"><span class="mono">${num(r.cache_read_tokens)}</span></td>
			<td class="num-cell"><span class="mono">${num(r.total_tokens)}</span></td>
			<td class="cost-cell">$${num(r.cost_usd, 5)}</td>
		</tr>`;
	}).join('');
}

export interface LogsRenderInput {
	rows: ApiLog[];
	totalCount: number;
	allModels: string[];
	allAccounts: string[];
	allClients: string[];
	filters: Filters;
	todayStr: string;
	user?: SessionUser;
}

export function renderLogs(d: LogsRenderInput): string {
	const perPageVal = d.filters.perPage === null ? 'all' : String(d.filters.perPage);

	const modelOpts   = d.allModels.map(m   => `<option value="${esc(m)}"${d.filters.model   === m ? ' selected' : ''}>${esc(modelLabel(m))}</option>`).join('');
	const accountOpts = d.allAccounts.map(a => `<option value="${esc(a)}"${d.filters.account === a ? ' selected' : ''}>${esc(a || '—')}</option>`).join('');
	const clientOpts  = d.allClients.map(c  => `<option value="${esc(c)}"${d.filters.client  === c ? ' selected' : ''}>${esc(c)}</option>`).join('');

	const allModelLabels = [...new Set(d.allModels.map(m => modelLabel(m)))];
	const allClientNames = [...new Set([...d.allClients.map(c => normalizeClient(c)), ...d.rows.map(r => normalizeClient(r.client))])];
	const mColorMap = buildColorMap(allModelLabels, MODEL_PASTEL);
	const cColorMap = buildColorMap(allClientNames, CLIENT_DARK);

	const tableRows = renderRows(d.rows, mColorMap, cColorMap);
	const pagination = renderPagination(d.filters, d.totalCount, perPageVal);

	const sizeBtn = (val: string, label: string) =>
		`<button type="button" class="sz-btn${perPageVal === val ? ' on' : ''}" data-sz="${val}">${label}</button>`;

	const css = `
.logs-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); }
.logs-table { width: 100%; min-width: 1600px; border-collapse: collapse; font-size: 12.5px; }
.logs-table th { background: var(--surface-2); padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-3); white-space: nowrap; border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 1; }
.logs-table td { padding: 8px 12px; border-bottom: 1px solid var(--border-light, var(--border)); vertical-align: middle; }
.logs-table tr:last-child td { border-bottom: none; }
.logs-table tr:hover td { background: var(--surface-2); }
.time { font-size: 12px; font-weight: 500; }
.date { font-size: 11px; color: var(--ink-3); display: block; }
.mono-sm { font-family: var(--font-mono, 'JetBrains Mono', monospace); font-size: 11px; color: var(--ink-2); white-space: nowrap; }
.num-cell { text-align: right; }
.num-cell .mono { font-family: var(--font-mono, 'JetBrains Mono', monospace); font-size: 12px; }
.cost-cell { text-align: right; font-weight: 600; font-size: 12px; white-space: nowrap; }
.prompt-cell { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-2); font-size: 12px; }
.tag { display: inline-block; padding: 2px 7px; border-radius: 20px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.empty-val { color: var(--ink-3); font-size: 12px; }
.nowrap { white-space: nowrap; }
.td-center { text-align: center; }
.filter-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; margin-bottom: 16px; }
.filter-row label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-3); }
.filter-row input, .filter-row select { height: 34px; padding: 0 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--ink); font-size: 13px; outline: none; min-width: 130px; }
.filter-row input:focus, .filter-row select:focus { border-color: var(--accent, #F47948); }
.filter-btn { height: 34px; padding: 0 16px; border-radius: 8px; background: var(--accent, #F47948); color: #fff; font-size: 13px; font-weight: 600; border: none; cursor: pointer; }
.sz-row { display: flex; gap: 6px; align-items: center; margin-bottom: 14px; }
.sz-btn { height: 30px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--ink-2); font-size: 12px; cursor: pointer; }
.sz-btn.on { background: var(--accent, #F47948); color: #fff; border-color: var(--accent, #F47948); }
.count-tag { font-size: 12px; color: var(--ink-3); margin-left: 8px; }
.pagination { display: flex; align-items: center; justify-content: space-between; padding: 14px 0; gap: 12px; flex-wrap: wrap; }
.pagination .info { font-size: 13px; color: var(--ink-3); }
.pages { display: flex; gap: 4px; }
.page-btn { height: 32px; min-width: 32px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--ink-2); font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; text-decoration: none; }
.page-btn.active { background: var(--accent, #F47948); color: #fff; border-color: var(--accent, #F47948); }
.page-btn:disabled { opacity: .4; cursor: default; }
.page-btn svg { width: 14px; height: 14px; }
`;

	const content = `
<form method="get" action="/logs">
<div class="filter-row">
	<label>จาก <input type="date" name="date_from" value="${esc(d.filters.dateFrom)}"></label>
	<label>ถึง  <input type="date" name="date_to"   value="${esc(d.filters.dateTo)}"></label>
	<label>Model
		<select name="model">
			<option value=""${d.filters.model === '' ? ' selected' : ''}>ทุก model</option>
			${modelOpts}
		</select>
	</label>
	<label>Account
		<select name="account">
			<option value=""${d.filters.account === '' ? ' selected' : ''}>ทุก account</option>
			${accountOpts}
		</select>
	</label>
	<label>Client
		<select name="client">
			<option value=""${d.filters.client === '' ? ' selected' : ''}>ทุก client</option>
			${clientOpts}
		</select>
	</label>
	<input type="hidden" name="per_page" id="perPageInput" value="${esc(perPageVal)}">
	<button type="submit" class="filter-btn">กรอง</button>
</div>
</form>

<div class="sz-row">
	<span style="font-size:12px;font-weight:600;color:var(--ink-3);">แสดง:</span>
	${sizeBtn('20', '20')}${sizeBtn('50', '50')}${sizeBtn('100', '100')}${sizeBtn('all', 'ทั้งหมด')}
	<span class="count-tag">รวม ${num(d.totalCount)} รายการ</span>
</div>

<div class="logs-wrap">
<table class="logs-table">
<thead>
<tr>
	<th>Time</th>
	<th>Client</th>
	<th>Account</th>
	<th>IP</th>
	<th>Model</th>
	<th>OS</th>
	<th>OS Ver.</th>
	<th>Arch</th>
	<th>App Ver.</th>
	<th>Terminal</th>
	<th>Device ID</th>
	<th>MAC</th>
	<th>Anon ID</th>
	<th>Prompt</th>
	<th>Input</th>
	<th>Output</th>
	<th>Cache W</th>
	<th>Cache R</th>
	<th>Total</th>
	<th>Cost</th>
</tr>
</thead>
<tbody>${tableRows}</tbody>
</table>
</div>

${pagination}

<script>
document.querySelectorAll('.sz-btn').forEach(btn => {
	btn.addEventListener('click', () => {
		document.getElementById('perPageInput').value = btn.dataset.sz;
		btn.closest('form') || document.querySelector('form[action="/logs"]').submit();
		document.querySelector('form[action="/logs"]').submit();
	});
});
</script>
`;

	return renderLayout({
		activeNav: 'logs',
		user: d.user,
		pageTitle: 'Logs',
		pageSubtitle: 'ดูทุก field ของทุก log entry',
		content,
		pageCss: css,
		title: 'SDB AI Insight — Logs',
	});
}
