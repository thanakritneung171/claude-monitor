import css from './monitoring.css';
import type { SessionUser } from '../types';
import type { ErrorRatePoint, ThroughputPoint, ActiveSession, ErrorGroup } from '../db/queries-extra';
import { esc, num } from '../lib/format';
import { modelLabel, clientBadge } from '../lib/badge';
import { renderLayout, type NavKey } from './layout';

export interface MonitoringRenderInput {
	user?: SessionUser;
	errorRate: ErrorRatePoint[];
	throughput: ThroughputPoint[];
	activeSessions: ActiveSession[];
	topErrors: ErrorGroup[];
	totals: { totalCalls: number; errorCount: number; avgErrorRate: number; activeNow: number };
}

function relativeAgo(ts: number): string {
	const diff = Date.now() - ts;
	if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	return `${Math.floor(diff / 3_600_000)}h ago`;
}

function errorRateLine(points: ErrorRatePoint[]): string {
	if (points.length === 0) {
		return '<div style="display:grid;place-items:center;height:160px;color:var(--ink-3);font-size:13px;">ไม่มีข้อมูล</div>';
	}
	const w = 600, h = 160;
	const pad = { l: 28, r: 8, t: 8, b: 20 };
	const max = Math.max(...points.map(p => p.rate), 0.01);
	const xStep = points.length > 1 ? (w - pad.l - pad.r) / (points.length - 1) : 0;
	const yScale = (v: number) => h - pad.b - (v / max) * (h - pad.t - pad.b);
	const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${pad.l + i * xStep} ${yScale(p.rate)}`).join(' ');
	const area = `${path} L ${pad.l + (points.length - 1) * xStep} ${h - pad.b} L ${pad.l} ${h - pad.b} Z`;
	return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
		<defs><linearGradient id="g-err" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color="#E11D48" stop-opacity="0.32"/>
			<stop offset="100%" stop-color="#E11D48" stop-opacity="0"/>
		</linearGradient></defs>
		<line x1="${pad.l}" y1="${yScale(max)}" x2="${w - pad.r}" y2="${yScale(max)}" stroke="var(--line)" stroke-dasharray="2,3"/>
		<line x1="${pad.l}" y1="${yScale(0)}" x2="${w - pad.r}" y2="${yScale(0)}" stroke="var(--line)" stroke-dasharray="2,3"/>
		<text x="${pad.l - 4}" y="${yScale(max) + 3}" font-size="9" fill="var(--ink-3)" text-anchor="end" font-family="JetBrains Mono">${(max * 100).toFixed(1)}%</text>
		<text x="${pad.l - 4}" y="${yScale(0) + 3}" font-size="9" fill="var(--ink-3)" text-anchor="end" font-family="JetBrains Mono">0%</text>
		<path d="${area}" fill="url(#g-err)"/>
		<path d="${path}" fill="none" stroke="#E11D48" stroke-width="2" stroke-linecap="round"/>
	</svg>`;
}

function throughputSpark(points: ThroughputPoint[]): string {
	if (points.length === 0) {
		return '<div style="display:grid;place-items:center;height:160px;color:var(--ink-3);font-size:13px;">no traffic</div>';
	}
	const w = 600, h = 160;
	const pad = { l: 28, r: 8, t: 8, b: 20 };
	const vals = points.map(p => p.n);
	const max = Math.max(...vals, 1);
	const xStep = points.length > 1 ? (w - pad.l - pad.r) / (points.length - 1) : 0;
	const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${pad.l + i * xStep} ${h - pad.b - (p.n / max) * (h - pad.t - pad.b)}`).join(' ');
	return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
		<text x="${pad.l - 4}" y="${pad.t + 8}" font-size="9" fill="var(--ink-3)" text-anchor="end" font-family="JetBrains Mono">${num(max)}/min</text>
		<text x="${pad.l - 4}" y="${h - pad.b + 3}" font-size="9" fill="var(--ink-3)" text-anchor="end" font-family="JetBrains Mono">0</text>
		<path d="${path}" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
	</svg>`;
}

export function renderMonitoring(d: MonitoringRenderInput): string {
	const errClass = d.totals.avgErrorRate >= 0.05 ? 'bad' : d.totals.avgErrorRate >= 0.01 ? 'warn' : 'good';
	const errLabel = `${(d.totals.avgErrorRate * 100).toFixed(2)}%`;

	const sessionsHtml = d.activeSessions.length === 0
		? '<div style="color:var(--ink-3);font-size:13px;padding:14px 0;text-align:center;">ไม่มี session ที่ active ในช่วง 5 นาทีล่าสุด</div>'
		: d.activeSessions.slice(0, 8).map(s => `
			<div class="session-row">
				<span class="dot-live"></span>
				<div class="who">${esc(s.account_email || '—')} <span style="color:var(--ink-3);font-weight:500;font-size:11px;margin-left:6px;">via ${esc(s.client)} · ${esc(modelLabel(s.lastModel))}</span></div>
				<span class="ago">${esc(relativeAgo(s.lastSeen))}</span>
			</div>`).join('');

	const errorTableRows = d.topErrors.length === 0
		? '<tr><td colspan="4" style="text-align:center;color:var(--ink-3);padding:20px;">ไม่มี error ใน 24 ชั่วโมงล่าสุด</td></tr>'
		: d.topErrors.map(e => {
			const cls = e.rate >= 0.5 ? 'bad' : e.rate >= 0.1 ? 'warn' : '';
			return `<tr>
				<td>${clientBadge(e.client)}</td>
				<td><span class="chip model">${esc(modelLabel(e.model))}</span></td>
				<td>${num(e.errors)} / ${num(e.total)}</td>
				<td class="rate ${cls}">${(e.rate * 100).toFixed(1)}%</td>
			</tr>`;
		}).join('');

	const alertRule = (name: string, cond: string, ok: boolean) => `
		<div class="alert-rule">
			<div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></div>
			<div class="body">
				<div class="name">${esc(name)}</div>
				<div class="cond">${esc(cond)}</div>
			</div>
			<span class="state ${ok ? 'ok' : ''}">${ok ? 'OK' : 'ALERT'}</span>
		</div>`;

	const content = `
		<section class="mon-strip">
			<div class="mon-card"><div class="label">Calls (24h)</div><div class="value">${num(d.totals.totalCalls)}</div><div class="desc">total requests</div></div>
			<div class="mon-card"><div class="label">Error rate</div><div class="value ${errClass}">${errLabel}</div><div class="desc">${num(d.totals.errorCount)} no-response calls</div></div>
			<div class="mon-card"><div class="label">Active sessions</div><div class="value">${num(d.totals.activeNow)}</div><div class="desc">in last 5 min</div></div>
			<div class="mon-card"><div class="label">Status</div><div class="value good">Operational</div><div class="desc">all checks passing</div></div>
		</section>

		<div class="mon-grid-2">
			<div class="card">
				<div class="card-head"><h2>API Health (last 24h)</h2><span class="count">error rate / hour</span></div>
				<div class="chart-wrap-160">${errorRateLine(d.errorRate)}</div>
			</div>
			<div class="card">
				<div class="card-head"><h2>Active sessions</h2><span class="count">${d.activeSessions.length}</span></div>
				${sessionsHtml}
			</div>
		</div>

		<div class="mon-grid-2">
			<div class="card">
				<div class="card-head"><h2>Throughput (calls/min, 24h)</h2><span class="count">${d.throughput.length} buckets</span></div>
				<div class="chart-wrap-160">${throughputSpark(d.throughput)}</div>
			</div>
			<div class="card">
				<div class="card-head"><h2>Top errors by group</h2><span class="count">${d.topErrors.length}</span></div>
				<table class="err-table">
					<thead><tr><th>Client</th><th>Model</th><th>Errors</th><th>Rate</th></tr></thead>
					<tbody>${errorTableRows}</tbody>
				</table>
			</div>
		</div>

		<div class="card" style="margin-top:14px;">
			<div class="card-head"><h2>Alert rules</h2><span class="count">read-only</span></div>
			${alertRule('Error rate spike',       'error rate ≥ 5% across all clients (1h window)', d.totals.avgErrorRate < 0.05)}
			${alertRule('No data received',       'no /log POSTs received in last 10 minutes',     d.totals.activeNow > 0 || d.totals.totalCalls > 0)}
			${alertRule('Cost over budget',       'daily cost > $50',                              true)}
			${alertRule('Slow ingest',            '< 1 call/min during business hours',            d.throughput.length > 0)}
		</div>`;

	return renderLayout({
		activeNav: 'monitoring' as unknown as NavKey,
		user: d.user,
		pageTitle: 'Monitoring',
		pageSubtitle: 'สถานะการทำงานแบบ real-time, error rate, throughput',
		content,
		pageCss: css,
		title: 'Monitoring — SDB AI Insight',
		pageJs: `setTimeout(function(){ location.reload(); }, 15000);`,
	});
}
