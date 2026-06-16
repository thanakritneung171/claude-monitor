import css from './clear-data.css';
import type { SessionUser } from '../types';
import { esc, num } from '../lib/format';
import { renderLayout } from './layout';

export interface ClearDataRenderInput {
	user?: SessionUser;
	clients: string[];
	accounts: string[];
	models: string[];
	totalLogs: number;
	totalSessions: number;
	totalEmailIdentity: number;
	totalIpBackup: number;
	todayStr: string;
	banner?: { kind: 'success' | 'error'; message: string };
}

function optionList(opts: string[], placeholder: string): string {
	const items = opts.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
	return `<option value="">${esc(placeholder)}</option>${items}`;
}

export function renderClearData(d: ClearDataRenderInput): string {
	const banner = d.banner
		? `<div class="banner-${d.banner.kind === 'success' ? 'success' : 'error'}">${esc(d.banner.message)}</div>`
		: '';

	const rangeBlock = `
		<div class="cd-section">
			<h3>ลบเฉพาะช่วงเวลา</h3>
			<p class="desc">ลบ api_logs ในช่วงวันที่ที่เลือก (อิงเวลา Asia/Bangkok)</p>
			<form method="post" action="/clear-data" class="cd-form"
			      onsubmit="return confirm('ยืนยันลบ api_logs ในช่วงวันที่นี้?');">
				<input type="hidden" name="action" value="range">
				<div class="row">
					<label>From
						<input type="date" class="date-input" name="date_from" value="${esc(d.todayStr)}" required>
					</label>
					<label>To
						<input type="date" class="date-input" name="date_to" value="${esc(d.todayStr)}" required>
					</label>
				</div>
				<div class="actions">
					<button type="submit" class="btn danger">ลบช่วงเวลานี้</button>
				</div>
			</form>
		</div>`;

	const filterBlock = `
		<div class="cd-section">
			<h3>ลบเฉพาะ client / account / model</h3>
			<p class="desc">ระบุอย่างน้อยหนึ่งช่อง — เงื่อนไขจะถูกรวมแบบ AND</p>
			<form method="post" action="/clear-data" class="cd-form"
			      onsubmit="return confirm('ยืนยันลบ api_logs ตาม filter ที่ระบุ?');">
				<input type="hidden" name="action" value="filter">
				<label>Client
					<div class="select-wrap">
						<select class="select" name="client">${optionList(d.clients, '— ทุก client —')}</select>
					</div>
				</label>
				<label>Account
					<div class="select-wrap">
						<select class="select" name="account">${optionList(d.accounts, '— ทุก account —')}</select>
					</div>
				</label>
				<label>Model
					<div class="select-wrap">
						<select class="select" name="model">${optionList(d.models, '— ทุก model —')}</select>
					</div>
				</label>
				<div class="actions">
					<button type="submit" class="btn danger">ลบตาม filter</button>
				</div>
			</form>
		</div>`;

	const allBlock = `
		<div class="cd-section danger">
			<h3>ลบ api_logs ทั้งหมด</h3>
			<p class="desc">ลบทุกแถวในตาราง <span class="mono">api_logs</span> ปัจจุบันมี <strong>${num(d.totalLogs)}</strong> records</p>
			<form method="post" action="/clear-data"
			      onsubmit="return confirm('ยืนยันลบ api_logs ทั้งหมด ${num(d.totalLogs)} แถว? การกระทำนี้ไม่สามารถยกเลิกได้');">
				<input type="hidden" name="action" value="all">
				<div class="actions">
					<button type="submit" class="btn danger">ลบทั้งหมด</button>
				</div>
			</form>
		</div>`;

	const sessBlock = `
		<div class="cd-section danger">
			<h3>ลบ sessions ทั้งหมด</h3>
			<p class="desc">ลบทุก session ในระบบ — ผู้ใช้ทั้งหมดจะถูก logout ทันที (ปัจจุบันมี <strong>${num(d.totalSessions)}</strong> sessions)</p>
			<form method="post" action="/clear-data"
			      onsubmit="return confirm('ยืนยัน logout ผู้ใช้ทั้งหมดและลบ sessions ${num(d.totalSessions)} แถว?');">
				<input type="hidden" name="action" value="sessions">
				<div class="actions">
					<button type="submit" class="btn danger">Logout ทุก user</button>
				</div>
			</form>
		</div>`;

	const identityBlock = `
		<div class="cd-section danger">
			<h3>ลบ Identity (New Identity)</h3>
			<p class="desc">ลบทุกแถวในตาราง <span class="mono">email_identity</span> (หน้า New Identity) — ปัจจุบันมี <strong>${num(d.totalEmailIdentity)}</strong> users · ตารางจะ rebuild เองจาก log ใหม่</p>
			<form method="post" action="/clear-data"
			      onsubmit="return confirm('ยืนยันลบ email_identity ทั้งหมด ${num(d.totalEmailIdentity)} แถว?');">
				<input type="hidden" name="action" value="email_identity">
				<div class="actions">
					<button type="submit" class="btn danger">ลบ Identity ทั้งหมด</button>
				</div>
			</form>
		</div>`;

	const ipBackupBlock = `
		<div class="cd-section danger">
			<h3>ลบ IP Identity snapshot</h3>
			<p class="desc">ลบ snapshot เก่าในตาราง <span class="mono">ip_identity_backup</span> (หน้า /identity — frozen) — ปัจจุบันมี <strong>${num(d.totalIpBackup)}</strong> แถว · ลบแล้วหน้า /identity จะว่าง (เป็น snapshot ประวัติ ลบแล้วหายถาวร)</p>
			<form method="post" action="/clear-data"
			      onsubmit="return confirm('ยืนยันลบ ip_identity_backup ทั้งหมด ${num(d.totalIpBackup)} แถว? snapshot ประวัติจะหายถาวร');">
				<input type="hidden" name="action" value="ip_backup">
				<div class="actions">
					<button type="submit" class="btn danger">ลบ snapshot ทั้งหมด</button>
				</div>
			</form>
		</div>`;

	const content = `
		${banner}
		<div class="cd-grid">
			<section>
				${rangeBlock}
				${filterBlock}
			</section>
			<section>
				${allBlock}
				${sessBlock}
				${identityBlock}
				${ipBackupBlock}
			</section>
		</div>`;

	return renderLayout({
		activeNav: 'settings',
		user: d.user,
		pageTitle: 'Clear Data',
		pageSubtitle: 'ลบข้อมูลในระบบ — ใช้ด้วยความระมัดระวัง',
		content,
		pageCss: css,
		title: 'Clear Data — SDB AI Insight',
	});
}
