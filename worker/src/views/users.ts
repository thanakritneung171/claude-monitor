import css from './users.css';
import clientJs from './users.client.js';
import type { User } from '../types';
import { esc, fmtBkk, num } from '../lib/format';
import { renderLayout } from './layout';

export interface UsersRenderInput {
	user?: User;
	users: User[];
	banner?: { kind: 'success' | 'error'; message: string };
	tempPassword?: string;
}

export function renderUsers(d: UsersRenderInput): string {
	const rows = d.users.map(u => {
		const isYou = u.id === d.user?.id;
		const initial = u.email.charAt(0).toUpperCase();
		return `<tr>
			<td>
				<div class="u-email">
					<div class="u-avatar">${esc(initial)}</div>
					<div class="body">
						<strong>${esc(u.email)}${isYou ? '<span class="you">(you)</span>' : ''}</strong>
						<span style="font-size:11px;color:var(--ink-3);">${esc(u.id)}</span>
					</div>
				</div>
			</td>
			<td><span class="role-pill ${u.role}">${esc(u.role)}</span></td>
			<td>${u.created_at ? esc(fmtBkk(u.created_at)) : '—'}</td>
			<td>${u.last_login_at ? esc(fmtBkk(u.last_login_at)) : '<span style="color:var(--ink-3);">never</span>'}</td>
			<td><span class="status-pill ${u.status}">${esc(u.status)}</span></td>
			<td>
				<div class="row-actions">
					${isYou ? '<button disabled title="ไม่สามารถแก้ตัวเองได้">—</button>' : `
						<form method="post" action="/users" style="display:inline;">
							<input type="hidden" name="action" value="toggle-status">
							<input type="hidden" name="user_id" value="${esc(u.id)}">
							<button type="submit">${u.status === 'active' ? 'Disable' : 'Enable'}</button>
						</form>
						<form method="post" action="/users" style="display:inline;" onsubmit="return confirm('ลบ ${esc(u.email)} ?');">
							<input type="hidden" name="action" value="delete">
							<input type="hidden" name="user_id" value="${esc(u.id)}">
							<button type="submit" class="danger">Delete</button>
						</form>
					`}
				</div>
			</td>
		</tr>`;
	}).join('');

	const banner = d.banner ? `<div class="banner ${d.banner.kind}">${esc(d.banner.message)}</div>` : '';
	const tempPasswordBlock = d.tempPassword
		? `<div class="banner success">รหัสผ่านชั่วคราว: <strong style="font-family:'JetBrains Mono',monospace;background:white;padding:2px 6px;border-radius:4px;">${esc(d.tempPassword)}</strong> — กรุณาส่งให้ผู้ใช้และเปลี่ยนทันทีหลังเข้าสู่ระบบ</div>`
		: '';

	const content = `
		<div class="users-toolbar">
			<div class="left"><strong>${num(d.users.length)}</strong> users · <strong>${num(d.users.filter(u => u.status === 'active').length)}</strong> active</div>
			<button class="btn primary" id="btnInvite">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
				Invite user
			</button>
		</div>
		${banner}
		${tempPasswordBlock}
		<div class="users-card">
			<table>
				<thead>
					<tr><th>User</th><th>Role</th><th>Created</th><th>Last login</th><th>Status</th><th>Actions</th></tr>
				</thead>
				<tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:var(--ink-3);padding:32px;">ไม่มีผู้ใช้</td></tr>'}</tbody>
			</table>
		</div>

		<dialog class="modal-dlg" id="inviteDlg">
			<form method="post" action="/users" class="dlg-card">
				<input type="hidden" name="action" value="invite">
				<div class="dlg-head">
					<h3>Invite user</h3>
					<p>เพิ่มผู้ใช้ใหม่ — ระบบจะสร้างรหัสผ่านชั่วคราวให้</p>
				</div>
				<div class="dlg-body">
					<label>Email
						<input class="input" type="email" name="email" required autocomplete="off" placeholder="user@company.com">
					</label>
					<label>Role
						<div class="select-wrap">
							<select class="select" name="role">
								<option value="viewer">Viewer</option>
								<option value="admin">Admin</option>
							</select>
						</div>
					</label>
				</div>
				<div class="dlg-foot">
					<button type="button" class="btn" id="btnInviteCancel">Cancel</button>
					<button type="submit" class="btn primary">Create user</button>
				</div>
			</form>
		</dialog>`;

	return renderLayout({
		activeNav: 'users',
		user: d.user,
		pageTitle: 'Users',
		pageSubtitle: 'จัดการบัญชีผู้ใช้และสิทธิ์การเข้าถึง dashboard',
		content,
		pageCss: css,
		pageJs: clientJs,
		title: 'Users — SDB AI Insight',
	});
}
