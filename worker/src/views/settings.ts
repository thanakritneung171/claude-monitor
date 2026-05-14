import css from './settings.css';
import clientJs from './settings.client.js';
import type { SessionUser } from '../types';
import { esc } from '../lib/format';
import { renderLayout } from './layout';

export interface SettingsRenderInput {
	user?: SessionUser;
	ingestKeyMasked: string;
	notifyEmail: boolean;
	notifyAnomaly: boolean;
	notifyBudget: boolean;
	version: string;
	compatibilityDate: string;
	banner?: { kind: 'success' | 'error'; message: string };
}

function switchHtml(key: string, on: boolean): string {
	return `<button type="button" class="switch ${on ? 'on' : ''}" data-key="${key}" aria-pressed="${on}"></button>
		<input type="hidden" name="${key}" value="${on ? '1' : '0'}">`;
}

export function renderSettings(d: SettingsRenderInput): string {
	const banner = d.banner ? `<div class="banner-${d.banner.kind === 'success' ? 'success' : 'error'}">${esc(d.banner.message)}</div>` : '';

	const profileBlock = `
		<div class="sb-section">
			<h3>Profile</h3>
			<p class="desc">บัญชี: <strong>${esc(d.user?.email ?? '')}</strong></p>
			<p class="desc">การจัดการบัญชีและรหัสผ่านทำผ่านระบบ Logto (Single Sign-On)</p>
		</div>`;

	const apiKeyBlock = `
		<div class="sb-section">
			<h3>Ingest API key</h3>
			<p class="desc">รหัสที่ proxy ใช้ส่งข้อมูลเข้าระบบ — เก็บไว้ในที่ปลอดภัย</p>
			<div class="s-kv">
				<div class="kv"><span class="k">Current key</span><span class="v">${esc(d.ingestKeyMasked)}</span></div>
				<div class="kv"><span class="k">Used at</span><span class="v">POST /log</span></div>
			</div>
			<form method="post" action="/settings/key-rotate" onsubmit="return confirm('Rotate ingest key? proxy เก่าจะใช้ต่อไม่ได้จนกว่าจะอัปเดต config');" style="margin-top:14px;">
				<button type="submit" class="btn danger">Rotate key</button>
			</form>
		</div>`;

	const appearanceBlock = `
		<div class="sb-section">
			<h3>Appearance</h3>
			<p class="desc">ปรับการแสดงผล (เก็บใน browser ของคุณ)</p>
			<div class="toggle-row">
				<div>
					<div class="lbl">Light theme</div>
					<div class="sub">ใช้สีพื้นหลังสว่าง (ปัจจุบันรองรับเฉพาะ light)</div>
				</div>
				<button class="switch on" disabled aria-pressed="true"></button>
			</div>
		</div>`;

	const notifBlock = `
		<div class="sb-section">
			<h3>Notifications</h3>
			<p class="desc">ตั้งค่าการแจ้งเตือนเมื่อมีเหตุการณ์ผิดปกติ (เก็บใน app_settings)</p>
			<form method="post" action="/settings/notifications" id="notif-form" class="s-form">
				<div class="toggle-row">
					<div>
						<div class="lbl">Email digest</div>
						<div class="sub">สรุปการใช้งานรายวันส่งถึงอีเมล</div>
					</div>
					${switchHtml('notify_email', d.notifyEmail)}
				</div>
				<div class="toggle-row">
					<div>
						<div class="lbl">Cost anomaly alert</div>
						<div class="sub">แจ้งเตือนเมื่อค่าใช้จ่ายสูงผิดปกติ</div>
					</div>
					${switchHtml('notify_anomaly', d.notifyAnomaly)}
				</div>
				<div class="toggle-row">
					<div>
						<div class="lbl">Budget threshold</div>
						<div class="sub">แจ้งเมื่อใกล้ถึง budget ที่ตั้งไว้</div>
					</div>
					${switchHtml('notify_budget', d.notifyBudget)}
				</div>
			</form>
		</div>`;

	const aboutBlock = `
		<div class="sb-section">
			<h3>About</h3>
			<div class="s-kv">
				<div class="kv"><span class="k">Version</span><span class="v">${esc(d.version)}</span></div>
				<div class="kv"><span class="k">Compatibility date</span><span class="v">${esc(d.compatibilityDate)}</span></div>
				<div class="kv"><span class="k">Timezone</span><span class="v">Asia/Bangkok (UTC+7)</span></div>
				<div class="kv"><span class="k">Identity provider</span><span class="v">Logto</span></div>
				<div class="kv"><span class="k">Runtime</span><span class="v">Cloudflare Workers + D1</span></div>
			</div>
		</div>`;

	const content = `
		${banner}
		<div class="settings-grid">
			<section>
				${profileBlock}
				${appearanceBlock}
			</section>
			<section>
				${apiKeyBlock}
				${notifBlock}
				${aboutBlock}
			</section>
		</div>`;

	return renderLayout({
		activeNav: 'settings',
		user: d.user,
		pageTitle: 'Settings',
		pageSubtitle: 'จัดการ API keys และการแจ้งเตือน',
		content,
		pageCss: css,
		pageJs: clientJs,
		title: 'Settings — SDB AI Insight',
	});
}
