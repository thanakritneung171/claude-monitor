import css from './data-sources.css';
import type { SessionUser } from '../types';
import type { IngestStats } from '../db/queries-extra';
import { esc, fmtBkk, num } from '../lib/format';
import { renderLayout, type NavKey } from './layout';

export interface DataSourcesRenderInput {
	user?: SessionUser;
	stats: IngestStats;
	ingestKeyMasked: string;
	workerUrl: string;
}

function bytesHuman(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
	return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function renderDataSources(d: DataSourcesRenderInput): string {
	const isOnline = d.stats.newestTs > 0 && Date.now() - d.stats.newestTs < 5 * 60 * 1000;
	const onlinePill = isOnline
		? `<span class="pill online">online</span>`
		: `<span class="pill offline">no recent activity</span>`;

	const lastLog = d.stats.newestTs > 0 ? fmtBkk(d.stats.newestTs) : '—';
	const oldestLog = d.stats.oldestTs > 0 ? fmtBkk(d.stats.oldestTs) : '—';
	const dbAgeDays = d.stats.oldestTs > 0 ? Math.round((Date.now() - d.stats.oldestTs) / 86400000) : 0;

	const content = `
		<div class="ds-grid">
			<div class="ds-card">
				<div class="head">
					<div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg></div>
					<h3>Claude API Proxy</h3>
					${onlinePill}
				</div>
				<div class="kv-list">
					<div class="kv-row"><span class="k">Status</span><span class="v">${isOnline ? 'Receiving' : 'Idle'}</span></div>
					<div class="kv-row"><span class="k">Last log received</span><span class="v">${esc(lastLog)}</span></div>
					<div class="kv-row"><span class="k">Calls today</span><span class="v">${num(d.stats.rowsToday)}</span></div>
					<div class="kv-row"><span class="k">Source</span><span class="v">mitmproxy + Python addon</span></div>
				</div>
			</div>

			<div class="ds-card">
				<div class="head">
					<div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg></div>
					<h3>Ingest endpoint</h3>
				</div>
				<div class="kv-list">
					<div class="kv-row"><span class="k">URL</span><span class="v">POST ${esc(d.workerUrl)}/log</span></div>
					<div class="kv-row"><span class="k">Auth header</span><span class="v">X-Api-Key: ${esc(d.ingestKeyMasked)}</span></div>
					<div class="kv-row"><span class="k">Content type</span><span class="v">application/json</span></div>
				</div>
				<div style="font-size:11px;color:var(--ink-3);margin-top:10px;">รหัสคีย์ตอนนี้ใช้สำหรับ proxy เท่านั้น — สามารถ rotate ได้ที่หน้า Settings</div>
			</div>

			<div class="ds-card">
				<div class="head">
					<div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg></div>
					<h3>Database (D1)</h3>
				</div>
				<div class="kv-list">
					<div class="kv-row"><span class="k">Total rows</span><span class="v">${num(d.stats.totalRows)}</span></div>
					<div class="kv-row"><span class="k">Oldest record</span><span class="v">${esc(oldestLog)} (${dbAgeDays}d ago)</span></div>
					<div class="kv-row"><span class="k">Newest record</span><span class="v">${esc(lastLog)}</span></div>
					<div class="kv-row"><span class="k">Approx size</span><span class="v">${esc(bytesHuman(d.stats.approxBytes))}</span></div>
				</div>
			</div>

			<div class="ds-card">
				<div class="head">
					<div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></div>
					<h3>Setup instructions</h3>
				</div>
				<details class="setup" open>
					<summary>วิธีตั้งค่า proxy local</summary>
					<div class="code-block">cd proxy
# Edit config.py with WORKER_URL and API_KEY
mitmdump -s addon.py --listen-port 8080
# Then point your client (Claude Code etc.) at http://localhost:8080</div>
				</details>
				<details class="setup">
					<summary>Test ingest endpoint</summary>
					<div class="code-block">curl -X POST ${esc(d.workerUrl)}/log \\
  -H "X-Api-Key: YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"id":"test-1","ts":1700000000000,"client":"curl","model":"test","prompt":"hello","cost_usd":0.001}'</div>
				</details>
				<details class="setup">
					<summary>Apply schema migration</summary>
					<div class="code-block">wrangler d1 execute prompt-logger --remote --file=migrations/0002_auth.sql</div>
				</details>
			</div>
		</div>`;

	return renderLayout({
		activeNav: 'data_sources' as unknown as NavKey,
		user: d.user,
		pageTitle: 'Data Sources',
		pageSubtitle: 'จัดการแหล่งข้อมูลและ proxy endpoint ที่ป้อนข้อมูลเข้าระบบ',
		content,
		pageCss: css,
		title: 'Data Sources — SDB AI Insight',
	});
}
