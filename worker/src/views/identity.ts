import type { SessionUser } from '../types';
import type { IdentityListRow } from '../db/queries';
import { esc, num } from '../lib/format';
import { renderLayout } from './layout';
import { relativeTimeTh, accountStatus, IP_PREFIX } from '../lib/account';

export interface IdentityRenderInput {
	rows: IdentityListRow[];
	user?: SessionUser;
}

const pageCss = `
.idn-stats { display:flex; gap:14px; margin-bottom:16px; flex-wrap:wrap; }
.idn-stat { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px 18px; box-shadow:var(--shadow); min-width:150px; }
.idn-stat .lbl { font-size:13px; color:var(--ink-3); font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
.idn-stat .val { font-size:26px; font-weight:700; color:var(--ink); margin-top:4px; }
.idn-table { width:100%; border-collapse:collapse; }
.idn-table th { text-align:left; font-size:13px; color:var(--ink-3); font-weight:600; text-transform:uppercase; letter-spacing:.04em; padding:10px 12px; border-bottom:1px solid var(--line); }
.idn-table td { padding:12px; border-bottom:1px solid var(--line); font-size:15px; color:var(--ink); vertical-align:middle; }
.idn-table tbody tr:last-child td { border-bottom:0; }
.idn-table tbody tr:hover td { background:var(--bg-soft); }
.idn-ip { font-family:"JetBrains Mono", ui-monospace, monospace; font-weight:600; color:var(--ink); }
.idn-email { color:var(--peach-500); font-weight:600; word-break:break-all; }
.idn-muted { color:var(--ink-3); }
.idn-when { color:var(--ink-2); font-size:14px; white-space:nowrap; }
.idn-dot { width:7px; height:7px; border-radius:50%; display:inline-block; margin-right:7px; vertical-align:middle; background:var(--ink-3); }
.idn-dot.live { background:var(--good); }
.idn-dot.idle { background:#E0A340; }
.idn-dot.cold { background:var(--ink-3); }
.idn-empty { text-align:center; padding:48px 16px; color:var(--ink-3); }
`;

function row(r: IdentityListRow): string {
	const ipUrl    = `/account?identity=${encodeURIComponent(IP_PREFIX + r.ip)}`;
	const emailUrl = `/account?identity=${encodeURIComponent(r.email)}`;
	const stat = accountStatus(r.updated_ms);
	const name = r.name ? esc(r.name) : '<span class="idn-muted">—</span>';
	return `<tr>
		<td><a class="idn-ip" href="${ipUrl}">${esc(r.ip)}</a></td>
		<td><a class="idn-email" href="${emailUrl}">${esc(r.email)}</a></td>
		<td>${name}</td>
		<td class="mono">${num(r.calls)}</td>
		<td class="idn-when"><span class="idn-dot ${stat}"></span>${esc(relativeTimeTh(r.updated_ms))}</td>
	</tr>`;
}

export function renderIdentity(input: IdentityRenderInput): string {
	const { rows } = input;
	const totalCalls = rows.reduce((s, r) => s + r.calls, 0);

	const body = rows.length === 0
		? `<div class="idn-empty">ยังไม่มี mapping IP → email — รอ proxy จับ email จาก traffic ก่อน</div>`
		: `<table class="idn-table">
			<thead><tr>
				<th>IP</th><th>Email</th><th>Name</th><th>Calls</th><th>อัปเดตล่าสุด</th>
			</tr></thead>
			<tbody>${rows.map(row).join('')}</tbody>
		</table>`;

	const content = `
		<div class="idn-stats">
			<div class="idn-stat"><div class="lbl">IP ที่ผูกแล้ว</div><div class="val">${num(rows.length)}</div></div>
			<div class="idn-stat"><div class="lbl">Calls รวม</div><div class="val">${num(totalCalls)}</div></div>
		</div>
		<div class="card">${body}</div>`;

	return renderLayout({
		activeNav: 'identity',
		user: input.user,
		pageTitle: 'IP Identity',
		pageSubtitle: 'การผูก IP ↔ email ปัจจุบัน (Layer 3) — ใช้เติม email ให้ log ที่ระบุตัวตนไม่ได้',
		content,
		pageCss,
		title: 'IP Identity — SDB AI Insight',
	});
}
