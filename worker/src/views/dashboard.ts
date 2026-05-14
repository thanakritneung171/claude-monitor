import html from './dashboard.html';
import css from './dashboard.css';
import clientJs from './dashboard.client.js';

import type { ApiLog, Filters, Totals, ByModel, ByClient, ByAccount, User } from '../types';
import { esc, num, fmtBkkParts } from '../lib/format';
import { modelBadge, clientBadge, accountBadge, modelLabel, normalizeClient, buildColorMap, MODEL_PASTEL, CLIENT_DARK } from '../lib/badge';
import { renderLayout } from './layout';

const BAR_COLORS = ['#F47948', '#FF9466', '#FFB088', '#FFD1B3', '#FFE4D2'];
const TOP_N = 5;

const arrowL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
const arrowR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

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

interface BarItem { name: string; n: number; cost: number; }

function barRowsHtml(items: BarItem[], style: 'default' | 'model' | 'client' = 'default', colorMap?: Map<string, string>): string {
	if (items.length === 0) return `<div style="color:var(--ink-3);font-size:13px;padding:8px 0">ไม่มีข้อมูล</div>`;
	const max = Math.max(...items.map(i => i.cost), 1);
	return items.map((it, i) => {
		let color: string;
		let nameHtml: string;
		if (style === 'model') {
			color = colorMap?.get(it.name) ?? MODEL_PASTEL[0];
			nameHtml = `<span class="chip" style="background:${color};color:#1F2937">${esc(it.name)}</span>`;
		} else if (style === 'client') {
			color = colorMap?.get(it.name) ?? CLIENT_DARK[0];
			nameHtml = `<span class="chip" style="background:${color};color:#fff;box-shadow:0 2px 8px ${color}55">${esc(it.name)}</span>`;
		} else {
			color = BAR_COLORS[i % BAR_COLORS.length];
			nameHtml = `<span class="swatch" style="background:${color}"></span>${esc(it.name)}`;
		}
		const pct = Math.max(2, (it.cost / max) * 100);
		return `<div class="bar-row">
			<div class="name">${nameHtml}</div>
			<div class="num"><span>${num(it.n)} calls</span><strong>$${num(it.cost, 4)}</strong></div>
			<div class="bar-track"><div class="bar-fill" data-pct="${pct.toFixed(1)}" style="width:0%;background:${color}"></div></div>
		</div>`;
	}).join('');
}

function renderStatCards(totals: Totals): string {
	const cards = [
		{ key: 'g-count', label: 'COUNT CALL',   value: num(totals.total) },
		{ key: 'g-in',    label: 'INPUT TOKEN',  value: num(totals.totalInput) },
		{ key: 'g-out',   label: 'OUTPUT TOKEN', value: num(totals.totalOutput) },
		{ key: 'g-cw',    label: 'CACHE WRITE',  value: num(totals.totalCacheCreate) },
		{ key: 'g-cr',    label: 'CACHE READ',   value: num(totals.totalCacheRead) },
		{ key: 'g-cost',  label: 'EST. COST',    value: '$' + num(totals.totalCost, 4) },
	];
	return cards.map(s => `
		<div class="stat ${s.key}">
			<div class="label">${s.label}</div>
			<div class="value">${s.value}</div>
		</div>`).join('');
}

function renderLogRows(rows: ApiLog[], mColorMap: Map<string, string>, cColorMap: Map<string, string>): string {
	if (rows.length === 0) {
		return `<tr><td colspan="10" style="padding:32px 26px;color:var(--ink-3);text-align:center;">ไม่พบรายการ</td></tr>`;
	}
	return rows.map(r => {
		const { time, date } = fmtBkkParts(r.ts);
		const fullPrompt = esc(r.prompt);
		return `<tr data-full="${fullPrompt}">
			<td><span class="time">${esc(time)}<span class="date">${esc(date)}</span></span></td>
			<td class="td-center">${clientBadge(r.client, cColorMap)}</td>
			<td>${accountBadge(r.account_email)}</td>
			<td class="td-center">${modelBadge(r.model, mColorMap)}</td>
			<td class="prompt-cell"><div class="truncate">${esc(r.prompt)}</div><span class="more">เปิดดูเต็ม →</span></td>
			<td class="num-cell"><span class="mono">${num(r.input_tokens)}</span></td>
			<td class="num-cell"><span class="mono">${num(r.output_tokens)}</span></td>
			<td class="num-cell cw"><span class="mono">${num(r.cache_creation_tokens)}</span></td>
			<td class="num-cell cr"><span class="mono">${num(r.cache_read_tokens)}</span></td>
			<td class="cost-cell">$${num(r.cost_usd, 5)}</td>
		</tr>`;
	}).join('');
}

function renderLogCards(rows: ApiLog[], mColorMap: Map<string, string>, cColorMap: Map<string, string>): string {
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
				${modelBadge(r.model, mColorMap)}
				${clientBadge(r.client, cColorMap)}
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

function showMoreBtn(cat: 'model' | 'account' | 'client', total: number): string {
	if (total <= TOP_N) return '';
	return `<button type="button" class="show-more" data-cat="${cat}">ดูทั้งหมด →</button>`;
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
	user?: User;
}

export function renderDashboard(d: RenderInput): string {
	const perPageVal = d.filters.perPage === null ? 'all' : String(d.filters.perPage);

	const modelOpts   = d.allModels.map(m   => `<option value="${esc(m)}"${d.filters.model   === m ? ' selected' : ''}>${esc(modelLabel(m))}</option>`).join('');
	const accountOpts = d.allAccounts.map(a => `<option value="${esc(a)}"${d.filters.account === a ? ' selected' : ''}>${esc(a || '—')}</option>`).join('');
	const clientOpts  = d.allClients.map(c  => `<option value="${esc(c)}"${d.filters.client  === c ? ' selected' : ''}>${esc(c)}</option>`).join('');

	const modelItems:   BarItem[] = d.byModel.map(m   => ({ name: modelLabel(m.model),     n: m.n, cost: m.cost ?? 0 }));
	const accountItems: BarItem[] = d.byAccount.map(a => ({ name: a.account_email || '—', n: a.n, cost: a.cost ?? 0 }));
	const clientItems:  BarItem[] = d.byClient.map(c  => ({ name: c.client,                n: c.n, cost: c.cost ?? 0 }));

	// Build non-repeating color maps from ALL names in this page
	const allModelLabels = [...new Set([
		...modelItems.map(it => it.name),
		...d.rows.map(r => modelLabel(r.model)),
	])];
	const allClientNames = [...new Set([
		...clientItems.map(it => it.name),
		...d.rows.map(r => normalizeClient(r.client)),
	])];
	const mColorMap = buildColorMap(allModelLabels, MODEL_PASTEL);
	const cColorMap = buildColorMap(allClientNames, CLIENT_DARK);

	const byModelHtml   = barRowsHtml(modelItems.slice(0, TOP_N), 'model',  mColorMap);
	const byAccountHtml = barRowsHtml(accountItems.slice(0, TOP_N));
	const byClientHtml  = barRowsHtml(clientItems.slice(0, TOP_N), 'client', cColorMap);

	const breakdownAll = JSON.stringify({
		model:   modelItems.map(it => ({ ...it, color: mColorMap.get(it.name) ?? '' })),
		account: accountItems,
		client:  clientItems.map(it => ({ ...it, color: cColorMap.get(it.name) ?? '' })),
	});

	const replacements: Record<string, string> = {
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
		'{{statCards}}':   renderStatCards(d.totals),
		'{{byModelShowMore}}':   showMoreBtn('model',   modelItems.length),
		'{{byAccountShowMore}}': showMoreBtn('account', accountItems.length),
		'{{byClientShowMore}}':  showMoreBtn('client',  clientItems.length),
		'{{byModelHtml}}':   byModelHtml,
		'{{byAccountHtml}}': byAccountHtml,
		'{{byClientHtml}}':  byClientHtml,
		'{{totalCount}}':    num(d.totalCount),
		'{{size10On}}':  perPageVal === '10'  ? ' class="on"' : '',
		'{{size20On}}':  perPageVal === '20'  ? ' class="on"' : '',
		'{{size50On}}':  perPageVal === '50'  ? ' class="on"' : '',
		'{{size100On}}': perPageVal === '100' ? ' class="on"' : '',
		'{{sizeAllOn}}': perPageVal === 'all' ? ' class="on"' : '',
		'{{logRows}}':    renderLogRows(d.rows, mColorMap, cColorMap),
		'{{logCards}}':   renderLogCards(d.rows, mColorMap, cColorMap),
		'{{pagination}}': renderPagination(d.filters, d.totalCount, perPageVal),
		'{{today}}':      d.todayStr,
		'{{firstMonth}}': d.firstMonthStr,
		'{{firstYear}}':  d.firstYearStr,
		'{{breakdownAll}}': breakdownAll,
	};

	let content = html;
	for (const [key, value] of Object.entries(replacements)) {
		content = content.split(key).join(value);
	}

	return renderLayout({
		activeNav: 'dashboard',
		user: d.user,
		pageTitle: 'Dashboard Overview',
		pageSubtitle: 'Monitor your AI models and system performance',
		content,
		pageCss: css,
		title: 'SDB AI Insight — Dashboard',
	});
}
