import css from './reports.css';
import type { User } from '../types';
import { esc } from '../lib/format';
import { todayBkk, firstOfMonthBkk } from '../lib/date';
import { renderLayout, type NavKey } from './layout';

export interface ReportsRenderInput { user?: User; }

const COLUMNS = [
	{ key: 'ts',                    label: 'Timestamp' },
	{ key: 'account_email',         label: 'Account' },
	{ key: 'client',                label: 'Client' },
	{ key: 'model',                 label: 'Model' },
	{ key: 'prompt',                label: 'Prompt' },
	{ key: 'input_tokens',          label: 'Input' },
	{ key: 'output_tokens',         label: 'Output' },
	{ key: 'cache_creation_tokens', label: 'Cache W' },
	{ key: 'cache_read_tokens',     label: 'Cache R' },
	{ key: 'total_tokens',          label: 'Total tokens' },
	{ key: 'cost_usd',              label: 'Cost' },
];

export function renderReports(d: ReportsRenderInput): string {
	const today = todayBkk();
	const monthStart = firstOfMonthBkk();
	const yearStart = today.slice(0, 4) + '-01-01';

	const colChips = COLUMNS.map(c => `
		<label class="col-chip">
			<input type="checkbox" name="cols" value="${c.key}" checked>
			${esc(c.label)}
		</label>`).join('');

	const quickCard = (href: string, title: string, desc: string, ic: string) => `
		<a class="quick-card" href="${esc(href)}" download>
			<div class="ic">${ic}</div>
			<div class="title">${esc(title)}</div>
			<div class="desc">${esc(desc)}</div>
		</a>`;

	const dlIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';

	const content = `
		<section class="quick-row">
			${quickCard(`/export?date_from=${today}&date_to=${today}`, 'Today (CSV)', 'ส่งออกข้อมูลของวันนี้ทั้งหมด', dlIcon)}
			${quickCard(`/export?date_from=${monthStart}&date_to=${today}`, 'This month (CSV)', 'ตั้งแต่ต้นเดือนถึงวันนี้', dlIcon)}
			${quickCard(`/export?date_from=${yearStart}&date_to=${today}`, 'This year (CSV)', 'ตั้งแต่ต้นปีถึงวันนี้', dlIcon)}
			${quickCard(`/export?date_from=2020-01-01&date_to=${today}`, 'All time (CSV)', 'ข้อมูลทั้งหมดในระบบ', dlIcon)}
		</section>

		<div class="card" style="margin-top:18px;">
			<div class="card-head">
				<h2>Custom report</h2>
				<span class="count">CSV</span>
			</div>
			<form method="get" action="/export" class="custom-form">
				<div class="field">
					<span>Date from</span>
					<input class="date-input" type="date" name="date_from" value="${esc(monthStart)}">
				</div>
				<div class="field">
					<span>Date to</span>
					<input class="date-input" type="date" name="date_to" value="${esc(today)}">
				</div>
				<div class="field">
					<span>Model filter (optional)</span>
					<input class="input" type="text" name="model" placeholder="e.g. claude-opus-4-7">
				</div>
				<div class="field full" style="justify-content:flex-start;">
					<div style="width:100%;">
						<span style="display:block;font-size:10px;font-weight:700;color:var(--ink-2);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Columns</span>
						<div class="columns-list">${colChips}</div>
					</div>
				</div>
				<div class="full">
					<button type="submit" class="btn primary">${dlIcon} Generate report</button>
				</div>
			</form>
		</div>

		<div class="card" style="margin-top:18px;">
			<div class="card-head">
				<h2>Recent exports</h2>
				<span class="badge-incoming">⏳ Incoming</span>
			</div>
			<div class="incoming-block" style="padding:36px 24px;">
				<div class="incoming-icon">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
				</div>
				<h3>Export history</h3>
				<p>ระบบจะบันทึกประวัติ export ไว้ให้ดาวน์โหลดซ้ำได้ — ฟีเจอร์นี้จะพร้อมในเวอร์ชันถัดไป</p>
			</div>
		</div>`;

	return renderLayout({
		activeNav: 'reports' as unknown as NavKey,
		user: d.user,
		pageTitle: 'Reports',
		pageSubtitle: 'สร้างรายงานและ export ข้อมูลในรูปแบบ CSV',
		content,
		pageCss: css,
		title: 'Reports — SDB AI Insight',
	});
}
