import type { Env, User } from '../types';
import { hashPassword, newSessionToken } from '../lib/auth';
import { renderUsers } from '../views/users';
import { render403, type NavKey } from '../views/layout';

const htmlResponse = (body: string, init: ResponseInit = {}) =>
	new Response(body, { ...init, headers: { 'Content-Type': 'text/html;charset=utf-8', ...(init.headers ?? {}) } });

async function loadUsers(env: Env): Promise<User[]> {
	const res = await env.DB.prepare(
		`SELECT id, email, password_hash, role, created_at, last_login_at, status
		 FROM users ORDER BY created_at DESC`
	).all<User>();
	return res.results;
}

export async function handleUsersGet(url: URL, env: Env, user?: User): Promise<Response> {
	if (user?.role !== 'admin') {
		return htmlResponse(render403('users' as unknown as NavKey, user), { status: 403 });
	}
	const users = await loadUsers(env);

	const flash = url.searchParams.get('flash');
	const temp = url.searchParams.get('temp');
	let banner: { kind: 'success' | 'error'; message: string } | undefined;
	if (flash === 'invited') banner = { kind: 'success', message: 'สร้างผู้ใช้สำเร็จ' };
	else if (flash === 'deleted') banner = { kind: 'success', message: 'ลบผู้ใช้แล้ว' };
	else if (flash === 'toggled') banner = { kind: 'success', message: 'อัปเดตสถานะแล้ว' };
	else if (flash === 'duplicate') banner = { kind: 'error', message: 'อีเมลนี้มีอยู่แล้วในระบบ' };
	else if (flash === 'invalid') banner = { kind: 'error', message: 'ข้อมูลไม่ถูกต้อง' };

	return htmlResponse(renderUsers({ user, users, banner, tempPassword: temp ?? undefined }));
}

export async function handleUsersPost(request: Request, env: Env, user?: User): Promise<Response> {
	if (user?.role !== 'admin') {
		return htmlResponse(render403('users' as unknown as NavKey, user), { status: 403 });
	}
	const form = await request.formData();
	const action = String(form.get('action') ?? '');

	if (action === 'invite') {
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		const role = String(form.get('role') ?? 'viewer');
		if (!email || !email.includes('@')) {
			return Response.redirect(new URL('/users?flash=invalid', request.url).toString(), 302);
		}
		const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first<{ id: string }>();
		if (existing) {
			return Response.redirect(new URL('/users?flash=duplicate', request.url).toString(), 302);
		}
		const tempPassword = newSessionToken().slice(0, 12);
		const hash = await hashPassword(tempPassword);
		const id = crypto.randomUUID();
		await env.DB.prepare(
			`INSERT INTO users (id, email, password_hash, role, created_at, status)
			 VALUES (?, ?, ?, ?, ?, 'active')`
		).bind(id, email, hash, role === 'admin' ? 'admin' : 'viewer', Date.now()).run();

		const back = new URL(`/users?flash=invited&temp=${encodeURIComponent(tempPassword)}`, request.url);
		return Response.redirect(back.toString(), 302);
	}

	if (action === 'toggle-status') {
		const uid = String(form.get('user_id') ?? '');
		if (uid && uid !== user.id) {
			const target = await env.DB.prepare(`SELECT status FROM users WHERE id = ?`).bind(uid).first<{ status: string }>();
			if (target) {
				const next = target.status === 'active' ? 'disabled' : 'active';
				await env.DB.prepare(`UPDATE users SET status = ? WHERE id = ?`).bind(next, uid).run();
				if (next === 'disabled') {
					await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(uid).run();
				}
			}
		}
		return Response.redirect(new URL('/users?flash=toggled', request.url).toString(), 302);
	}

	if (action === 'delete') {
		const uid = String(form.get('user_id') ?? '');
		if (uid && uid !== user.id) {
			await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(uid).run();
			await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(uid).run();
		}
		return Response.redirect(new URL('/users?flash=deleted', request.url).toString(), 302);
	}

	return Response.redirect(new URL('/users', request.url).toString(), 302);
}
