import css from './analytics.css';
import type { SessionUser } from '../types';
import type { BucketPoint, HeatmapCell } from '../db/queries-extra';
import { esc, num } from '../lib/format';
import { modelLabel } from '../lib/badge';
import { renderLayout } from './layout';

export interface AnalyticsRenderInput {
	user?: SessionUser;
	period: '7d' | '30d' | '90d';
	fromMs: number;
	toMs: number;
	timeseries: BucketPoint[];
	heatmap: HeatmapCell[];
	perModelSeries: { model: string; points: BucketPoint[]; totalCost: number }[];
	totals: { cost: number; calls: number; avgCostCall: number; tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number };
}

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function lineChart(points: BucketPoint[], keyOf: (p: BucketPoint) => number, color = '#F47948', height = 220): string {
	if (points.length === 0) {
		return `<div style="display:grid;place-items:center;height:${height}px;color:var(--ink-3);font-size:13px;">ไม่มีข้อมูลในช่วงที่เลือก</div>`;
	}
	const w = 600;
	const h = height;
	const pad = { l: 32, r: 12, t: 12, b: 24 };
	const values = points.map(keyOf);
	const max = Math.max(...values, 0.0001);
	const xStep = points.length > 1 ? (w - pad.l - pad.r) / (points.length - 1) : 0;
	const yScale = (v: number) => h - pad.b - (v / max) * (h - pad.t - pad.b);

	const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${pad.l + i * xStep} ${yScale(keyOf(p))}`).join(' ');
	const areaPath = `${linePath} L ${pad.l + (points.length - 1) * xStep} ${h - pad.b} L ${pad.l} ${h - pad.b} Z`;

	const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => {
		const v = max * t;
		const y = yScale(v);
		const label = v < 0.01 ? v.toFixed(4) : v >= 1000 ? num(v, 0) : v.toFixed(2);
		return `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="var(--line)" stroke-dasharray="2,3" stroke-width="1"/>
				<text x="${pad.l - 4}" y="${y + 3}" font-size="9" fill="var(--ink-3)" text-anchor="end" font-family="JetBrains Mono">${label}</text>`;
	}).join('');

	const xLabels = points.length <= 1 ? '' : (() => {
		const targetCount = Math.min(5, points.length);
		const out: string[] = [];
		for (let i = 0; i < targetCount; i++) {
			const idx = Math.round((i / (targetCount - 1)) * (points.length - 1));
			const x = pad.l + idx * xStep;
			out.push(`<text x="${x}" y="${h - 6}" font-size="9" fill="var(--ink-3)" text-anchor="middle">${esc(points[idx].bucket.slice(5))}</text>`);
		}
		return out.join('');
	})();

	return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
		<defs><linearGradient id="g-area" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color="${color}" stop-opacity="0.32"/>
			<stop offset="100%" stop-color="${color}" stop-opacity="0"/>
		</linearGradient></defs>
		${yTicks}
		<path d="${areaPath}" fill="url(#g-area)"/>
		<path d="${linePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
		${xLabels}
	</svg>`;
}

function stackedArea(points: BucketPoint[], height = 220): string {
	if (points.length === 0) {
		return `<div style="display:grid;place-items:center;height:${height}px;color:var(--ink-3);font-size:13px;">ไม่มีข้อมูล</div>`;
	}
	const w = 600;
	const h = height;
	const pad = { l: 32, r: 12, t: 12, b: 24 };
	const series: [string, (p: BucketPoint) => number, string][] = [
		['Cache R', (p) => p.cacheRead,  '#06B6D4'],
		['Output',  (p) => p.outputTokens, '#7C3AED'],
		['Cache W', (p) => p.cacheWrite, '#0D9488'],
		['Input',   (p) => p.inputTokens, '#F47948'],
	];

	const stacks = points.map(() => 0);
	const totalMax = Math.max(...points.map(p => p.inputTokens + p.outputTokens + p.cacheRead + p.cacheWrite), 1);
	const xStep = points.length > 1 ? (w - pad.l - pad.r) / (points.length - 1) : 0;
	const yScale = (v: number) => h - pad.b - (v / totalMax) * (h - pad.t - pad.b);

	let layers = '';
	for (const [, fn, color] of series) {
		const top: { x: number; y: number }[] = [];
		const bot: { x: number; y: number }[] = [];
		points.forEach((p, i) => {
			const x = pad.l + i * xStep;
			const v = fn(p);
			bot.push({ x, y: yScale(stacks[i]) });
			stacks[i] += v;
			top.push({ x, y: yScale(stacks[i]) });
		});
		const pathTop = top.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
		const pathBot = bot.slice().reverse().map(pt => `L ${pt.x} ${pt.y}`).join(' ');
		layers += `<path d="${pathTop} ${pathBot} Z" fill="${color}" fill-opacity="0.78"/>`;
	}

	const xLabels = points.length <= 1 ? '' : (() => {
		const targetCount = Math.min(5, points.length);
		const out: string[] = [];
		for (let i = 0; i < targetCount; i++) {
			const idx = Math.round((i / (targetCount - 1)) * (points.length - 1));
			const x = pad.l + idx * xStep;
			out.push(`<text x="${x}" y="${h - 6}" font-size="9" fill="var(--ink-3)" text-anchor="middle">${esc(points[idx].bucket.slice(5))}</text>`);
		}
		return out.join('');
	})();

	const legend = series.map(([name, , color]) =>
		`<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--ink-2);font-weight:500;">
			<span style="width:10px;height:10px;border-radius:3px;background:${color};"></span>${name}</span>`
	).join('');

	return `
		<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:6px;">${legend}</div>
		<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
			${layers}
			${xLabels}
		</svg>`;
}

function heatmapHtml(cells: HeatmapCell[]): string {
	const maxN = Math.max(...cells.map(c => c.n), 1);
	function bg(n: number): string {
		if (n === 0) return 'var(--peach-50)';
		const ratio = n / maxN;
		if (ratio < 0.2) return 'var(--peach-100)';
		if (ratio < 0.4) return 'var(--peach-200)';
		if (ratio < 0.6) return 'var(--peach-300)';
		if (ratio < 0.8) return 'var(--peach-400)';
		return 'var(--peach-500)';
	}

	// Hour header row
	const hourRow: string[] = [`<div></div>`];
	for (let h = 0; h < 24; h++) {
		const label = h % 4 === 0 ? String(h).padStart(2, '0') + ':00' : '';
		hourRow.push(`<div class="hm-hour-label">${label}</div>`);
	}

	const rows: string[] = [...hourRow];
	for (let d = 0; d < 7; d++) {
		rows.push(`<div class="hm-label">${DOW_LABELS[d]}</div>`);
		for (let h = 0; h < 24; h++) {
			const cell = cells.find(c => c.dow === d && c.hour === h) ?? { dow: d, hour: h, n: 0 };
			rows.push(`<div class="hm-cell" style="background:${bg(cell.n)}" title="${DOW_LABELS[d]} ${h}:00 — ${cell.n} calls"></div>`);
		}
	}
	return `<div class="heatmap-table">${rows.join('')}</div>
		<div class="heatmap-foot">
			<span>น้อย</span>
			<div class="scale">
				<span style="background:var(--peach-50);"></span>
				<span style="background:var(--peach-100);"></span>
				<span style="background:var(--peach-200);"></span>
				<span style="background:var(--peach-300);"></span>
				<span style="background:var(--peach-400);"></span>
				<span style="background:var(--peach-500);"></span>
			</div>
			<span>มาก</span>
		</div>`;
}

function sparkline(points: BucketPoint[], color: string): string {
	if (points.length === 0) return '<div style="color:var(--ink-3);font-size:11px;">no data</div>';
	const w = 100;
	const h = 30;
	const vals = points.map(p => p.cost);
	const max = Math.max(...vals, 0.0001);
	const xStep = points.length > 1 ? w / (points.length - 1) : 0;
	const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${i * xStep} ${h - (p.cost / max) * (h - 4) - 2}`).join(' ');
	return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
		<path d="${path}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
	</svg>`;
}

export function renderAnalytics(d: AnalyticsRenderInput): string {
	const periodLink = (p: '7d' | '30d' | '90d') => `<a href="?period=${p}"${d.period === p ? ' class="on"' : ''}>${p}</a>`;

	const perModelColors = ['#F47948', '#2563EB', '#7C3AED', '#0D9488', '#E11D48', '#F59E0B', '#06B6D4'];
	const modelList = d.perModelSeries.slice(0, 7).map((m, i) => `
		<div class="sparkline-row">
			<div class="name"><span class="swatch" style="background:${perModelColors[i % perModelColors.length]}"></span>${esc(modelLabel(m.model))}</div>
			<div class="spark">${sparkline(m.points, perModelColors[i % perModelColors.length])}</div>
			<div class="total">$${num(m.totalCost, 4)}</div>
		</div>`).join('');

	const summary = `
		<section class="summary-strip">
			<div class="ss-card"><div class="label">Total cost</div><div class="value">$${num(d.totals.cost, 4)}</div><div class="delta">in selected range</div></div>
			<div class="ss-card"><div class="label">Total calls</div><div class="value">${num(d.totals.calls)}</div><div class="delta">requests</div></div>
			<div class="ss-card"><div class="label">Avg cost / call</div><div class="value">$${num(d.totals.avgCostCall, 5)}</div><div class="delta">per request</div></div>
			<div class="ss-card"><div class="label">Cache read</div><div class="value">${num(d.totals.cacheRead)}</div><div class="delta">tokens cached hit</div></div>
		</section>`;

	const toolbar = `
		<div style="display:flex;gap:10px;align-items:center;margin-top:14px;">
			<span style="font-size:12px;color:var(--ink-2);font-weight:600;">Period</span>
			<div class="seg">${periodLink('7d')}${periodLink('30d')}${periodLink('90d')}</div>
		</div>`;

	const content = `
		${toolbar}
		${summary}
		<div class="an-row">
			<div class="card">
				<div class="card-head"><h2>Cost over time</h2><span class="count">${d.timeseries.length} buckets</span></div>
				<div class="chart-wrap">${lineChart(d.timeseries, p => p.cost, '#F47948')}</div>
			</div>
			<div class="card">
				<div class="card-head"><h2>Cost by model</h2><span class="count">${d.perModelSeries.length} models</span></div>
				<div class="sparkline-list">${modelList || '<div style="color:var(--ink-3);font-size:13px;">no models</div>'}</div>
			</div>
		</div>
		<div class="an-row">
			<div class="card">
				<div class="card-head"><h2>Token mix over time</h2><span class="count">stacked area</span></div>
				<div class="chart-wrap">${stackedArea(d.timeseries)}</div>
			</div>
			<div class="card">
				<div class="card-head"><h2>Calls timeline</h2><span class="count">requests / bucket</span></div>
				<div class="chart-wrap">${lineChart(d.timeseries, p => p.calls, '#2563EB')}</div>
			</div>
		</div>
		<div class="card" style="margin-top:14px;">
			<div class="card-head"><h2>Activity heatmap</h2><span class="count">day-of-week × hour</span></div>
			${heatmapHtml(d.heatmap)}
		</div>`;

	return renderLayout({
		activeNav: 'analytics',
		user: d.user,
		pageTitle: 'Analytics',
		pageSubtitle: 'ดู trend ค่าใช้จ่ายและการใช้ token ลึก ๆ ต่อช่วงเวลา',
		content,
		pageCss: css,
		title: 'Analytics — SDB AI Insight',
	});
}
