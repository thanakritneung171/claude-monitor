import type { SessionUser } from '../types';
import type { EmailIdentityRow } from '../db/queries';
import { esc, num } from '../lib/format';
import { renderLayout } from './layout';
import { relativeTimeTh, accountStatus } from '../lib/account';

export interface NewIdentityRenderInput {
	rows: EmailIdentityRow[];
	user?: SessionUser;
}

const CLIENT_COLORS: Record<string, string> = {
	'claude-code-cli':       '#2563EB',
	'claude-code-vscode':    '#7C3AED',
	'claude-desktop':        '#F47948',
	'claude-desktop-code':   '#D97706',
	'claude-desktop-cowork': '#059669',
	'api':                   '#6B7280',
};

function clientBadges(clientTypes: string): string {
	if (!clientTypes) return '<span class="ni-muted">—</span>';
	const seen = new Set<string>();
	return clientTypes.split(',').map(c => c.trim()).filter(c => c && !seen.has(c) && seen.add(c))
		.map(c => {
			const color = CLIENT_COLORS[c] ?? '#6B7280';
			const label = c.replace('claude-', '').replace('-', ' ');
			return `<span class="ni-badge" style="background:${color}20;color:${color};border:1px solid ${color}40">${esc(label)}</span>`;
		}).join(' ');
}

const pageCss = `
.ni-stats { display:flex; gap:14px; margin-bottom:16px; flex-wrap:wrap; }
.ni-stat { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px 18px; box-shadow:var(--shadow); min-width:150px; }
.ni-stat .lbl { font-size:13px; color:var(--ink-3); font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
.ni-stat .val { font-size:26px; font-weight:700; color:var(--ink); margin-top:4px; }
.ni-wrap { overflow-x:auto; overflow-y:hidden; margin:0 -26px; border-top:1px solid var(--line); border-bottom:1px solid var(--line); background:var(--card); -webkit-overflow-scrolling:touch; scrollbar-width:thin; scrollbar-color:var(--peach-300) var(--bg-soft); }
@media (max-width:900px){ .ni-wrap { margin:0 -16px; } }
.ni-wrap::-webkit-scrollbar { height:12px; }
.ni-wrap::-webkit-scrollbar-track { background:var(--bg-soft); }
.ni-wrap::-webkit-scrollbar-thumb { background:var(--peach-300); border-radius:10px; border:3px solid var(--bg-soft); }
.ni-wrap::-webkit-scrollbar-thumb:hover { background:var(--peach-400); }
.ni-table { width:100%; min-width:1520px; border-collapse:collapse; font-size:13px; }
.ni-table th { background:var(--bg-soft,var(--card)); padding:10px 12px; text-align:left; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; color:var(--ink-3); white-space:nowrap; border-bottom:1px solid var(--line); position:sticky; top:0; z-index:1; }
.ni-table td { padding:10px 12px; border-bottom:1px solid var(--line); vertical-align:middle; white-space:nowrap; }
.ni-table tbody tr:last-child td { border-bottom:0; }
.ni-table tbody tr:hover td { background:var(--bg-soft); }
.ni-email { color:var(--peach-500); font-weight:600; white-space:nowrap; font-size:13px; }
.ni-muted { color:var(--ink-3); font-size:12px; }
.ni-mono { font-family:"JetBrains Mono",ui-monospace,monospace; font-size:11px; color:var(--ink-2); white-space:nowrap; }
.ni-badge { display:inline-block; padding:2px 7px; border-radius:20px; font-size:11px; font-weight:600; white-space:nowrap; }
.ni-ipcount { font-family:"JetBrains Mono",ui-monospace,monospace; font-size:11px; color:var(--ink); font-weight:600; background:var(--bg-soft); border:1px solid var(--line); border-radius:6px; padding:2px 7px; cursor:help; }
.ni-dot { width:7px; height:7px; border-radius:50%; display:inline-block; margin-right:6px; vertical-align:middle; background:var(--ink-3); }
.ni-dot.live { background:var(--good); }
.ni-dot.idle { background:#E0A340; }
.ni-dot.cold { background:var(--ink-3); }
.ni-when { color:var(--ink-2); font-size:12px; white-space:nowrap; }
.ni-empty { text-align:center; padding:48px 16px; color:var(--ink-3); }
`;

function row(r: EmailIdentityRow): string {
	const emailUrl = `/account?identity=${encodeURIComponent(r.email)}`;
	const stat     = accountStatus(r.updated_ms);

	const name   = r.name   ? esc(r.name)   : '<span class="ni-muted">—</span>';
	const acctId = r.account_id ? `<span class="ni-mono" title="${esc(r.account_id)}">${esc(r.account_id)}</span>` : '<span class="ni-muted">—</span>';
	const uuid   = r.uuid
		? `<span class="ni-mono" title="${esc(r.uuid)}">${esc(r.uuid)}</span>`
		: '<span class="ni-muted">—</span>';
	const anonId = r.anon_id
		? `<span class="ni-mono" title="${esc(r.anon_id)}">${esc(r.anon_id)}</span>`
		: '<span class="ni-muted">—</span>';
	const osStr  = r.os_type
		? `<span class="ni-mono">${esc(r.os_version ? `${r.os_type} ${r.os_version}` : r.os_type)}</span>`
		: '<span class="ni-muted">—</span>';
	const arch   = r.host_arch   ? `<span class="ni-mono">${esc(r.host_arch)}</span>`   : '<span class="ni-muted">—</span>';
	const appVer = r.app_version ? `<span class="ni-mono">${esc(r.app_version)}</span>` : '<span class="ni-muted">—</span>';
	const term   = r.terminal    ? `<span class="ni-mono">${esc(r.terminal)}</span>`    : '<span class="ni-muted">—</span>';
	const firstSeen = r.first_seen
		? `<span class="ni-when">${esc(relativeTimeTh(r.first_seen))}</span>`
		: '<span class="ni-muted">—</span>';

	return `<tr>
		<td><a class="ni-email" href="${emailUrl}">${esc(r.email)}</a></td>
		<td>${name}</td>
		<td>${acctId}</td>
		<td>${uuid}</td>
		<td>${anonId}</td>
		<td>${osStr}</td>
		<td>${arch}</td>
		<td>${appVer}</td>
		<td>${term}</td>
		<td>${clientBadges(r.client_types)}</td>
		<td>${firstSeen}</td>
		<td class="ni-when"><span class="ni-dot ${stat}"></span>${esc(relativeTimeTh(r.updated_ms))}</td>
		<td style="text-align:right"><span class="ni-mono">${num(r.calls)}</span></td>
	</tr>`;
}

export function renderNewIdentity(input: NewIdentityRenderInput): string {
	const { rows } = input;
	const totalCalls  = rows.reduce((s, r) => s + r.calls, 0);
	const withDevice  = rows.filter(r => r.os_type).length;
	const withAnonId  = rows.filter(r => r.anon_id).length;

	const body = rows.length === 0
		? `<div class="ni-empty">ยังไม่มี identity — รอ proxy จับ email จาก traffic ก่อน</div>`
		: `<table class="ni-table">
			<thead><tr>
				<th>Email</th>
				<th>Name</th>
				<th>Account ID</th>
					<th>UUID</th>
				<th>Anon ID</th>
				<th>OS</th>
				<th>Arch</th>
				<th>App Ver.</th>
				<th>Terminal</th>
				<th>Clients</th>
				<th>First Seen</th>
				<th>Last Seen</th>
				<th style="text-align:right">Calls</th>
			</tr></thead>
			<tbody>${rows.map(row).join('')}</tbody>
		</table>`;

	const content = `
		<div class="ni-stats">
			<div class="ni-stat"><div class="lbl">ผู้ใช้ (email)</div><div class="val">${num(rows.length)}</div></div>
			<div class="ni-stat"><div class="lbl">Calls รวม</div><div class="val">${num(totalCalls)}</div></div>
			<div class="ni-stat"><div class="lbl">มี Device Info</div><div class="val">${num(withDevice)}</div></div>
			<div class="ni-stat"><div class="lbl">มี Anon ID</div><div class="val">${num(withAnonId)}</div></div>
		</div>
		<div class="ni-wrap">${body}</div>`;

	return renderLayout({
		activeNav: 'new-identity',
		user: input.user,
		pageTitle: 'New Identity',
		pageSubtitle: 'Identity แบบ email เป็นหลัก (VPN-safe) — รวมทุก IP/device/client ของคนเดียวเป็นแถวเดียว',
		content,
		pageCss,
		title: 'New Identity — SDB AI Insight',
	});
}
