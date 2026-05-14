import css from './insights.css';
import type { User } from '../types';
import type { TopPromptRow, AnomalyDay, CacheRatioRow } from '../db/queries-extra';
import type { ByClient } from '../types';
import { esc, num } from '../lib/format';
import { modelLabel } from '../lib/badge';
import { renderLayout, type NavKey } from './layout';

export interface InsightsRenderInput {
	user?: User;
	topPrompts: TopPromptRow[];
	highestCostUser: { email: string; cost: number; calls: number } | null;
	anomalies: AnomalyDay[];
	topClient: ByClient | null;
	lowCacheAccounts: CacheRatioRow[];
	periodDays: number;
}

export function renderInsights(d: InsightsRenderInput): string {
	const topPromptsHtml = d.topPrompts.length === 0
		? '<div style="color:var(--ink-3);font-size:13px;padding:12px 0;">ยังไม่มี prompt ในช่วงนี้</div>'
		: d.topPrompts.map(p => `
			<div class="prompt-item">
				<div class="meta">
					<span>×${num(p.calls)}</span>
					<span class="chip model">${esc(modelLabel(p.model))}</span>
					<span class="cost">$${num(p.totalCost, 4)}</span>
				</div>
				<div class="text">${esc(p.prompt)}</div>
			</div>`).join('');

	const highestUserBlock = d.highestCostUser
		? `<div class="callout">
			<div class="label">Highest cost account</div>
			<div class="value">${esc(d.highestCostUser.email)}</div>
			<div class="desc">$${num(d.highestCostUser.cost, 4)} จาก ${num(d.highestCostUser.calls)} calls ในช่วง ${d.periodDays} วันที่ผ่านมา</div>
		</div>`
		: '<div class="card"><div class="label" style="color:var(--ink-3);font-size:11px;">No account data</div></div>';

	const anomalyBlock = d.anomalies.length > 0
		? `<div class="callout anomaly">
			<div class="label">⚠ Cost spike detected</div>
			<div class="value">${esc(d.anomalies[0].day)}</div>
			<div class="desc">$${num(d.anomalies[0].cost, 4)} — สูงกว่าค่าเฉลี่ย 7 วัน <strong>${d.anomalies[0].ratio.toFixed(1)}×</strong> ($${num(d.anomalies[0].rollingAvg, 4)})</div>
		</div>`
		: `<div class="callout good">
			<div class="label">✓ Costs healthy</div>
			<div class="value">No anomalies</div>
			<div class="desc">ไม่พบวันที่ค่าใช้จ่ายสูงผิดปกติเทียบกับค่าเฉลี่ย 7 วัน</div>
		</div>`;

	const topClientBlock = d.topClient
		? `<div class="callout">
			<div class="label">Most active client</div>
			<div class="value">${esc(d.topClient.client)}</div>
			<div class="desc">${num(d.topClient.n)} calls · $${num(d.topClient.cost, 4)} ทั้งหมด</div>
		</div>`
		: '';

	const lowCacheRows = d.lowCacheAccounts.length === 0
		? '<div style="color:var(--ink-3);font-size:13px;">ทุก account มี cache ratio ดี</div>'
		: d.lowCacheAccounts.slice(0, 8).map(c => `
			<div class="cache-row">
				<span class="email">${esc(c.email)}</span>
				<span class="ratio">${(c.ratio * 100).toFixed(1)}% cached · ${num(c.calls)} calls</span>
			</div>`).join('');

	const content = `
		<div class="insights-grid">
			<div class="card">
				<div class="card-head"><h2>Top expensive prompts</h2><span class="count">${d.periodDays}d</span></div>
				<div class="prompt-list">${topPromptsHtml}</div>
			</div>
			<div style="display:flex;flex-direction:column;gap:14px;">
				${highestUserBlock}
				${anomalyBlock}
				${topClientBlock}
			</div>
		</div>
		<div class="card" style="margin-top:14px;">
			<div class="card-head">
				<h2>Cache ratio opportunities</h2>
				<span class="count">${d.lowCacheAccounts.length} accounts &lt; 20%</span>
			</div>
			<div style="font-size:12px;color:var(--ink-3);margin-bottom:10px;">บัญชีที่อัตราการใช้ cache read ต่ำ อาจประหยัดได้ถ้าใช้ prompt caching</div>
			<div class="cache-list">${lowCacheRows}</div>
		</div>`;

	return renderLayout({
		activeNav: 'insights' as unknown as NavKey,
		user: d.user,
		pageTitle: 'Insights',
		pageSubtitle: 'AI-driven findings จากการใช้งานจริง',
		content,
		pageCss: css,
		title: 'Insights — SDB AI Insight',
	});
}
