import html from './dashboard.html';
import css from './dashboard.css';
import clientJs from './dashboard.client.js';

import type { ApiLog, Filters, Totals, ByModel, ByClient, ByAccount } from '../types';
import { esc, num, fmtBkkParts } from '../lib/format';
import { modelBadge, clientBadge, accountBadge, modelLabel } from '../lib/badge';

const arrowL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
const arrowR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

const statSvg: Record<string, string> = {
	'svg-api': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
	'svg-in':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
	'svg-out': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
	'svg-cw':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>',
	'svg-cr':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>',
};

function pageBtn(p: number, cur: number, urlFn: (p: number) => string): string {
	if (p === cur) return `<button class="page-btn active" disabled>${p}</button>`;
	return `<a href="${urlFn(p)}" class="page-btn">${p}</a>`;
}

function buildPageUrl(filters: Filters, perPageVal: string): (p: number) => string {
	return (p: number): string => {
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
	};
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

function barRows(items: { name: string; n: number; cost: number; v: number }[]): string {
	if (items.length === 0) return `<div style="color:var(--ink-3);font-size:13px;padding:8px 0">ไม่มีข้อมูล</div>`;
	const max = Math.max(...items.map(i => i.v), 1);
	return items.map((it, i) => {
		const pct = Math.max(2, (it.v / max) * 100);
		return `<div class="bar-row">
			<div class="name"><span class="swatch" style="background:var(--peach-${400 - (i % 3) * 100})"></span>${esc(it.name)}</div>
			<div class="num"><span>${num(it.n)} calls</span><strong>$${num(it.cost, 4)}</strong></div>
			<div class="bar-track"><div class="bar-fill" data-pct="${pct.toFixed(1)}" style="width:0%"></div></div>
		</div>`;
	}).join('');
}

function renderStatCards(totals: Totals): string {
	const cards = [
		{ label: 'API Calls',     value: num(totals.total),           sub: 'requests',  icon: 'svg-api' },
		{ label: 'Input Tokens',  value: num(totals.totalInput),      sub: 'in prompts', icon: 'svg-in' },
		{ label: 'Output Tokens', value: num(totals.totalOutput),     sub: 'from model', icon: 'svg-out' },
		{ label: 'Cache Write',   value: num(totals.totalCacheCreate),sub: 'tokens',     icon: 'svg-cw' },
		{ label: 'Cache Read',    value: num(totals.totalCacheRead),  sub: 'tokens hit', icon: 'svg-cr' },
	];
	return cards.map(s => `
		<div class="stat">
			<div class="label"><span class="icon">${statSvg[s.icon]}</span>${s.label}</div>
			<div class="value">${s.value}</div>
			<div class="trend">${s.sub}</div>
		</div>`).join('');
}

function renderLogRows(rows: ApiLog[]): string {
	if (rows.length === 0) {
		return `<tr><td colspan="10" style="padding:32px 26px;color:var(--ink-3);text-align:center;">ไม่พบรายการ</td></tr>`;
	}
	return rows.map(r => {
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
}

function renderLogCards(rows: ApiLog[]): string {
	if (rows.length === 0) {
		return `<div style="padding:32px 16px;color:var(--ink-3);text-align:center;font-size:14px;">ไม่พบรายการ</div>`;
	}
	return rows.map(r => {
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
}

function buildExportUrl(filters: Filters): string {
	const p = new URLSearchParams({ date_from: filters.dateFrom, date_to: filters.dateTo });
	if (filters.model)   p.set('model',   filters.model);
	if (filters.account) p.set('account', filters.account);
	if (filters.client)  p.set('client',  filters.client);
	return '/export?' + p.toString();
}

export interface RenderInput {
	rows: ApiLog[];
	totalCount: number;
	totals: Totals;
	byModel: ByModel[];
	byClient: ByClient[];
	byAccount: ByAccount[];
	allModels: string[];
	allAccounts: string[];
	allClients: string[];
	filters: Filters;
	todayStr: string;
	firstMonthStr: string;
	firstYearStr: string;
}

export function renderDashboard(d: RenderInput): string {
	const perPageVal = d.filters.perPage === null ? 'all' : String(d.filters.perPage);

	const modelOpts   = d.allModels.map(m   => `<option value="${esc(m)}"${d.filters.model   === m ? ' selected' : ''}>${esc(modelLabel(m))}</option>`).join('');
	const accountOpts = d.allAccounts.map(a => `<option value="${esc(a)}"${d.filters.account === a ? ' selected' : ''}>${esc(a || '—')}</option>`).join('');
	const clientOpts  = d.allClients.map(c  => `<option value="${esc(c)}"${d.filters.client  === c ? ' selected' : ''}>${esc(c)}</option>`).join('');

	const byModelHtml   = barRows(d.byModel.map(m => ({ name: modelLabel(m.model), n: m.n, cost: m.cost ?? 0, v: m.cost ?? m.n })));
	const byAccountHtml = barRows(d.byAccount.map(a => ({ name: a.account_email || '—', n: a.n, cost: a.cost ?? 0, v: a.cost ?? a.n })));
	const byClientHtml  = barRows(d.byClient.map(c => ({ name: c.client, n: c.n, cost: c.cost ?? 0, v: c.cost ?? c.n })));

	const trendData = JSON.stringify(d.rows.slice().reverse().map(r => r.cost_usd));
	const trendCount = d.rows.length;

	const replacements: Record<string, string> = {
		'{{css}}': css,
		'{{clientJs}}': clientJs,
		'{{periodDailyOn}}':   d.filters.period === 'daily'   ? ' class="on"' : '',
		'{{periodMonthlyOn}}': d.filters.period === 'monthly' ? ' class="on"' : '',
		'{{periodYearlyOn}}':  d.filters.period === 'yearly'  ? ' class="on"' : '',
		'{{period}}':   esc(d.filters.period),
		'{{dateFrom}}': esc(d.filters.dateFrom),
		'{{dateTo}}':   esc(d.filters.dateTo),
		'{{modelAllSelected}}':   d.filters.model   === '' ? ' selected' : '',
		'{{accountAllSelected}}': d.filters.account === '' ? ' selected' : '',
		'{{clientAllSelected}}':  d.filters.client  === '' ? ' selected' : '',
		'{{modelOpts}}':   modelOpts,
		'{{accountOpts}}': accountOpts,
		'{{clientOpts}}':  clientOpts,
		'{{perPageVal}}':  esc(perPageVal),
		'{{exportUrl}}':   buildExportUrl(d.filters),
		'{{estCost}}':     '$' + num(d.totals.totalCost, 4),
		'{{statCards}}':   renderStatCards(d.totals),
		'{{byModelCount}}':   `${num(d.byModel.length)} model${d.byModel.length === 1 ? '' : 's'}`,
		'{{byAccountCount}}': `${num(d.byAccount.length)} account${d.byAccount.length === 1 ? '' : 's'}`,
		'{{byClientCount}}':  `${num(d.byClient.length)} client${d.byClient.length === 1 ? '' : 's'}`,
		'{{byModelHtml}}':   byModelHtml,
		'{{byAccountHtml}}': byAccountHtml,
		'{{byClientHtml}}':  byClientHtml,
		'{{trendCount}}':    num(trendCount),
		'{{trendPlural}}':   trendCount === 1 ? '' : 's',
		'{{totalCount}}':    num(d.totalCount),
		'{{size10On}}':  perPageVal === '10'  ? ' class="on"' : '',
		'{{size20On}}':  perPageVal === '20'  ? ' class="on"' : '',
		'{{size50On}}':  perPageVal === '50'  ? ' class="on"' : '',
		'{{size100On}}': perPageVal === '100' ? ' class="on"' : '',
		'{{sizeAllOn}}': perPageVal === 'all' ? ' class="on"' : '',
		'{{logRows}}':    renderLogRows(d.rows),
		'{{logCards}}':   renderLogCards(d.rows),
		'{{pagination}}': renderPagination(d.filters, d.totalCount, perPageVal),
		'{{today}}':      d.todayStr,
		'{{firstMonth}}': d.firstMonthStr,
		'{{firstYear}}':  d.firstYearStr,
		'{{trendData}}':  trendData,
	};

	let out = html;
	for (const [key, value] of Object.entries(replacements)) {
		out = out.split(key).join(value);
	}
	return out;
}
