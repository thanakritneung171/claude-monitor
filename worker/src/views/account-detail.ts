import html from './account-detail.html';
import pageCss from './account-detail.css';
import clientJs from './account-detail.client.js';

import type { AccountDetailData } from '../db/queries';
import type { ApiLog, SessionUser } from '../types';
import { renderLayout } from './layout';
import { esc, num, fmtBkk, fmtBkkParts } from '../lib/format';
import { modelBadge, clientBadge, modelLabel, normalizeClient, buildColorMap, MODEL_PASTEL, CLIENT_DARK } from '../lib/badge';
import { avatarColor, shadeHex, initials, emailDomain, accountStatus, relativeTimeTh, compactNum } from '../lib/account';
import { todayBkk, firstOfYearBkk } from '../lib/date';

function dashboardYearlyUrl(email: string): string {
	const params = new URLSearchParams({
		period: 'yearly',
		date_from: firstOfYearBkk(),
		date_to: todayBkk(),
		account: email,
	});
	return '/?' + params.toString();
}

export interface AccountDetailRenderInput {
	data: AccountDetailData;
	period: '24h' | '7d' | '30d' | '90d' | 'all';
	clientFilter: string;
	modelFilter: string;
	user?: SessionUser;
}

const BAR_COLORS = ['#F47948', '#FF9466', '#FFB088', '#FFD1B3', '#FFE4D2'];

function buildLocalColorMap(items: { name: string }[], palette: string[]): Map<string, string> {
	return buildColorMap(items.map(it => it.name), palette);
}

const TH_MONTH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function fmtThShort(isoDay: string): string {
	const [, m, dd] = isoDay.split('-');
	const mi = Math.max(0, Math.min(11, parseInt(m, 10) - 1));
	return `${parseInt(dd, 10)} ${TH_MONTH_SHORT[mi]}`;
}

function trendXLabels(trend: { day: string; cost: number }[]): string {
	if (trend.length === 0) return '';
	const target = Math.min(5, trend.length);
	const idxs: number[] = [];
	if (trend.length === 1) {
		idxs.push(0);
	} else {
		for (let i = 0; i < target; i++) {
			idxs.push(Math.round((i / (target - 1)) * (trend.length - 1)));
		}
	}
	const seen = new Set<number>();
	return `<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--ink-3);margin-top:6px;">${
		idxs.filter(i => { if (seen.has(i)) return false; seen.add(i); return true; })
			.map(i => `<span>${esc(fmtThShort(trend[i].day))}</span>`).join('')
	}</div>`;
}

const STAT_SVG = {
	cost: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>',
	calls: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
	tokens: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
	clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
};

function barRowsHtml(items: { name: string; n: number; cost: number }[], style: 'default' | 'model' | 'client' = 'default', colorMap?: Map<string, string>): string {
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
			nameHtml = `<span class="swatch" style="background:${color}"></span><span>${esc(it.name)}</span>`;
		}
		const pct = Math.max(2, (it.cost / max) * 100);
		return `<div class="bar-row">
			<div class="name">${nameHtml}</div>
			<div class="num"><span>${num(it.n)} calls</span><strong>$${num(it.cost, 4)}</strong></div>
			<div class="bar-track"><div class="bar-fill" data-pct="${pct.toFixed(1)}" style="width:0%;background:${color};"></div></div>
		</div>`;
	}).join('');
}

function periodSeg(period: string, email: string, clientF: string, modelF: string): string {
	const opts: { v: string; label: string }[] = [
		{ v: '24h', label: '24h' }, { v: '7d', label: '7d' }, { v: '30d', label: '30d' }, { v: '90d', label: '90d' }, { v: 'all', label: 'All' },
	];
	return opts.map(o => {
		const params = new URLSearchParams({ email });
		if (o.v !== '30d') params.set('period', o.v);
		if (clientF) params.set('client', clientF);
		if (modelF) params.set('model', modelF);
		const url = '/account?' + params.toString();
		const on = period === o.v ? ' class="on"' : '';
		return `<a href="${url}"${on}>${o.label}</a>`;
	}).join('');
}

function topPromptsHtml(items: AccountDetailData['topPrompts']): string {
	if (items.length === 0) return `<div style="color:var(--ink-3);font-size:13px;padding:16px 0;text-align:center;">ไม่มีข้อมูล</div>`;
	return items.map(p => {
		const fullPrompt = esc(p.prompt);
		const modelsHtml = p.models.slice(0, 3).map(m => `<span class="chip model">${esc(modelLabel(m))}</span>`).join('');
		return `<div class="prompt-item" data-full="${fullPrompt}">
			<div class="meta">
				<span class="time">×${num(p.n)}</span>
				${modelsHtml}
				<span class="cost">~ $${num(p.avgCost, 4)} avg</span>
			</div>
			<div class="text">${esc(p.prompt)}</div>
		</div>`;
	}).join('');
}

function recentRowsHtml(rows: ApiLog[]): string {
	if (rows.length === 0) {
		return `<tr><td colspan="7" style="padding:32px;color:var(--ink-3);text-align:center;">ไม่พบรายการ</td></tr>`;
	}
	return rows.map(r => {
		const { time, date } = fmtBkkParts(r.ts);
		const fullPrompt = esc(r.prompt);
		return `<tr data-full="${fullPrompt}">
			<td>
				<div class="mono" style="font-size:13px;">${esc(time)}</div>
				<div style="font-size:10px;color:var(--ink-3);margin-top:2px;">${esc(date)}</div>
			</td>
			<td>${clientBadge(r.client)}</td>
			<td>${modelBadge(r.model)}</td>
			<td class="prompt-cell"><div class="truncate">${esc(r.prompt)}</div></td>
			<td><span class="mono">${num(r.total_tokens)}</span></td>
			<td><span class="mono">$${num(r.cost_usd, 5)}</span></td>
			<td class="cost">$${num(r.cost_usd, 5)}</td>
		</tr>`;
	}).join('');
}

function renderEmpty(email: string): string {
	return `<div class="empty-state">ไม่พบ account <strong>${esc(email)}</strong> ในระบบ — ลองกลับไปหน้า <a href="/accounts" style="color:var(--peach-500);font-weight:600;">Accounts</a></div>`;
}

function renderBody(d: AccountDetailData, period: string, clientFilter: string, modelFilter: string): string {
	if (!d.exists) return renderEmpty(d.email);

	const color = avatarColor(d.email);
	const dark = shadeHex(color, -25);
	const stat = accountStatus(d.lastSeen);
	const dotColor = stat === 'live' ? 'var(--good)' : stat === 'idle' ? 'var(--peach-300)' : '#CFC6BB';
	const firstSeenStr = d.firstSeen ? new Date(d.firstSeen).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' }) : '—';

	const byModelItems  = d.byModel.map(m => ({ name: modelLabel(m.model), n: m.n, cost: m.cost ?? 0 }));
	const byClientItems = d.byClient.map(c => ({ name: c.client,           n: c.n, cost: c.cost ?? 0 }));
	const mColorMap = buildLocalColorMap(byModelItems,  MODEL_PASTEL);
	const cColorMap = buildLocalColorMap(byClientItems, CLIENT_DARK);

	const clientOpts = d.allClients.map(c => `<option value="${esc(c)}"${clientFilter === c ? ' selected' : ''}>${esc(c)}</option>`).join('');
	const modelOpts = d.allModels.map(m => `<option value="${esc(m)}"${modelFilter === m ? ' selected' : ''}>${esc(modelLabel(m))}</option>`).join('');

	return `
	<section class="hero">
		<div class="avatar avatar-lg" style="background:linear-gradient(135deg, ${color}, ${dark});">${esc(initials(d.email))}</div>
		<div class="info">
			<h1>${esc(d.email)}</h1>
			<div class="meta">
				<span>Domain: <strong>${esc(emailDomain(d.email))}</strong></span>
				<span class="dot"></span>
				<span>เริ่มใช้งาน <strong>${esc(firstSeenStr)}</strong></span>
				<span class="dot"></span>
				<span class="dot" style="background:${dotColor};"></span>
				<span>Active <strong>${esc(relativeTimeTh(d.lastSeen))}</strong></span>
			</div>
		</div>
		<div class="actions">
			<a href="${dashboardYearlyUrl(d.email)}" class="btn primary">ดู Logs ทั้งหมด</a>
		</div>
	</section>

	<form method="get" action="/account" class="toolbar" id="filterForm">
		<input type="hidden" name="email" value="${esc(d.email)}">
		<span class="label-inline">ช่วงเวลา</span>
		<div class="seg" id="periodSeg">${periodSeg(period, d.email, clientFilter, modelFilter)}</div>
		<span class="label-inline" style="margin-left:8px;">Client</span>
		<div class="select-wrap" style="width:200px;">
			<select class="select" name="client" onchange="this.form.submit()">
				<option value=""${clientFilter === '' ? ' selected' : ''}>ทั้งหมด</option>
				${clientOpts}
			</select>
		</div>
		<span class="label-inline" style="margin-left:8px;">Model</span>
		<div class="select-wrap" style="width:170px;">
			<select class="select" name="model" onchange="this.form.submit()">
				<option value=""${modelFilter === '' ? ' selected' : ''}>ทั้งหมด</option>
				${modelOpts}
			</select>
		</div>
		<input type="hidden" name="period" value="${esc(period)}">
	</form>

	<section class="stats">
		<div class="stat featured">
			<div class="label"><span class="icon">${STAT_SVG.cost}</span>Total Spend</div>
			<div class="value">$${num(d.totalCost, 4)}</div>
			<div class="delta">ในช่วงที่เลือก</div>
		</div>
		<div class="stat">
			<div class="label"><span class="icon">${STAT_SVG.calls}</span>API Calls</div>
			<div class="value">${num(d.calls)}</div>
			<div class="delta">requests</div>
		</div>
		<div class="stat">
			<div class="label"><span class="icon">${STAT_SVG.tokens}</span>Total Tokens</div>
			<div class="value">${esc(compactNum(d.totalTokens))}</div>
			<div class="delta">In ${esc(compactNum(d.totalIn))} · Out ${esc(compactNum(d.totalOut))} · Cache ${esc(compactNum(d.totalCR + d.totalCW))}</div>
		</div>
		<div class="stat">
			<div class="label"><span class="icon">${STAT_SVG.clock}</span>Avg Cost / Call</div>
			<div class="value">$${num(d.calls > 0 ? d.totalCost / d.calls : 0, 5)}</div>
			<div class="delta">per request</div>
		</div>
	</section>

	<section class="charts">
		<div class="card">
			<div class="card-head"><h2>Cost over time</h2><span class="count">${d.costTrend.length} days</span></div>
			<svg id="trend" viewBox="0 0 600 200" preserveAspectRatio="none" class="spark-wrap"></svg>
			${trendXLabels(d.costTrend)}
		</div>
		<div class="card">
			<div class="card-head"><h2>By Model</h2><span class="count">${d.byModel.length} models</span></div>
			<div>${barRowsHtml(byModelItems, 'model', mColorMap)}</div>
		</div>
		<div class="card">
			<div class="card-head"><h2>By Client</h2><span class="count">${d.byClient.length} clients</span></div>
			<div>${barRowsHtml(byClientItems, 'client', cColorMap)}</div>
		</div>
	</section>

	<section class="top-prompts">
		<div class="card">
			<div class="card-head"><h2>Prompts ที่ใช้บ่อย</h2><span class="count">top 5</span></div>
			<div class="prompt-list">${topPromptsHtml(d.topPrompts)}</div>
		</div>
		<div class="card">
			<div class="card-head"><h2>Token Usage</h2><span class="count">${esc(compactNum(d.totalTokens))} total</span></div>
			<div class="donut-wrap">
				<div class="donut">
					<svg viewBox="0 0 100 100" id="donut"></svg>
					<div class="center"><div><div class="v">${esc(compactNum(d.totalTokens))}</div><div class="l">tokens</div></div></div>
				</div>
				<div class="donut-legend">
					<div class="row"><span class="swatch" style="background:#FFD1B3;"></span><span class="name">Cache Read</span><span class="v">${esc(compactNum(d.totalCR))}</span></div>
					<div class="row"><span class="swatch" style="background:#F47948;"></span><span class="name">Output</span><span class="v">${esc(compactNum(d.totalOut))}</span></div>
					<div class="row"><span class="swatch" style="background:#FF9466;"></span><span class="name">Cache Write</span><span class="v">${esc(compactNum(d.totalCW))}</span></div>
					<div class="row"><span class="swatch" style="background:#FFB088;"></span><span class="name">Input</span><span class="v">${esc(compactNum(d.totalIn))}</span></div>
				</div>
			</div>
		</div>
	</section>

	<div class="sec-head">
		<h2>Activity heatmap</h2>
		<span class="right">รอบ 7 วันล่าสุด · Asia/Bangkok</span>
	</div>
	<div class="card">
		<div class="heatmap" id="heatmap"></div>
		<div class="heatmap-foot">
			<span>น้อย</span>
			<div class="scale">
				<span style="background:var(--peach-50);"></span>
				<span style="background:var(--peach-100);"></span>
				<span style="background:var(--peach-200);"></span>
				<span style="background:var(--peach-300);"></span>
				<span style="background:var(--peach-500);"></span>
			</div>
			<span>มาก</span>
		</div>
	</div>

	<div class="sec-head">
		<h2>Prompts ล่าสุด</h2>
		<span class="right">${num(d.recentRows.length)} รายการล่าสุด</span>
	</div>
	<div class="prompts-table">
		<div class="table-head">
			<h3>Recent activity</h3>
			<a href="${dashboardYearlyUrl(d.email)}" class="btn">ดูทั้งหมด</a>
		</div>
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th>Time</th><th>Client</th><th>Model</th><th>Prompt</th><th>Tokens</th><th>Cost</th><th></th>
					</tr>
				</thead>
				<tbody>${recentRowsHtml(d.recentRows)}</tbody>
			</table>
		</div>
	</div>
	`;
}

export function renderAccountDetail(input: AccountDetailRenderInput): string {
	const { data, period, clientFilter, modelFilter } = input;
	const bodyHtml = renderBody(data, period, clientFilter, modelFilter);

	const tokenMix = JSON.stringify([
		{ name: 'Cache Read', value: data.totalCR, color: '#FFD1B3' },
		{ name: 'Output', value: data.totalOut, color: '#F47948' },
		{ name: 'Cache Write', value: data.totalCW, color: '#FF9466' },
		{ name: 'Input', value: data.totalIn, color: '#FFB088' },
	]);

	const trendData = JSON.stringify(data.costTrend);
	const heatmapData = JSON.stringify(data.heatmap);

	const replacements: Record<string, string> = {
		'{{clientJs}}':  clientJs,
		'{{email}}':     esc(data.email),
		'{{bodyHtml}}':  bodyHtml,
		'{{tokenMix}}':  tokenMix,
		'{{trendData}}': trendData,
		'{{heatmapData}}': heatmapData,
	};
	let content = html;
	for (const [k, v] of Object.entries(replacements)) content = content.split(k).join(v);

	return renderLayout({
		activeNav: 'accounts',
		user: input.user,
		pageTitle: data.email,
		pageSubtitle: 'Account activity & usage breakdown',
		content,
		pageCss,
		title: `${data.email} — SDB AI Insight`,
	});
}
