import type { Env, User } from '../types';
import {
	hashPassword,
	verifyPassword,
	getAppSetting,
	setAppSetting,
	getEffectiveIngestKey,
	newSessionToken,
} from '../lib/auth';
import { renderSettings } from '../views/settings';

const htmlResponse = (body: string, headers: Record<string, string> = {}) =>
	new Response(body, { headers: { 'Content-Type': 'text/html;charset=utf-8', ...headers } });

const VERSION = '1.1.0';

function maskKey(key: string): string {
	if (!key) return '••••••••';
	if (key.length <= 6) return '••••••••';
	return '••••••••' + key.slice(-4);
}

export async function handleSettingsGet(url: URL, env: Env, user?: User): Promise<Response> {
	const [ingestKey, notifyEmail, notifyAnomaly, notifyBudget, usersCount] = await Promise.all([
		getEffectiveIngestKey(env),
		getAppSetting(env, 'notify_email'),
		getAppSetting(env, 'notify_anomaly'),
		getAppSetting(env, 'notify_budget'),
		env.DB.prepare(`SELECT COUNT(*) as n FROM users`).first<{ n: number }>(),
	]);

	const flash = url.searchParams.get('flash');
	let banner: { kind: 'success' | 'error'; message: string } | undefined;
	if (flash === 'password-changed') banner = { kind: 'success', message: 'เปลี่ยนรหัสผ่านสำเร็จ — กรุณาเข้าสู่ระบบใหม่' };
	else if (flash === 'password-mismatch') banner = { kind: 'error', message: 'รหัสยืนยันไม่ตรงกัน' };
	else if (flash === 'password-wrong') banner = { kind: 'error', message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' };
	else if (flash === 'key-rotated') banner = { kind: 'success', message: 'Rotate ingest key สำเร็จ — อัปเดต proxy config ก่อนใช้งานต่อ' };
	else if (flash === 'notif-saved') banner = { kind: 'success', message: 'บันทึกการตั้งค่าแจ้งเตือนแล้ว' };
	else if (flash === 'forbidden') banner = { kind: 'error', message: 'ต้องเป็น admin' };

	return htmlResponse(renderSettings({
		user,
		ingestKeyMasked: maskKey(ingestKey),
		notifyEmail: notifyEmail === '1',
		notifyAnomaly: notifyAnomaly === '1',
		notifyBudget: notifyBudget === '1',
		version: VERSION,
		compatibilityDate: '2025-04-01',
		totalUsers: usersCount?.n ?? 0,
		banner,
	}));
}

export async function handleSettingsPassword(request: Request, env: Env, user?: User): Promise<Response> {
	if (!user) return Response.redirect(new URL('/login', request.url).toString(), 302);
	const form = await request.formData();
	const current = String(form.get('current_password') ?? '');
	const next = String(form.get('new_password') ?? '');
	const confirm = String(form.get('confirm_password') ?? '');

	if (next.length < 8 || next !== confirm) {
		return Response.redirect(new URL('/settings?flash=password-mismatch', request.url).toString(), 302);
	}
	const row = await env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?`).bind(user.id).first<{ password_hash: string }>();
	if (!row || !(await verifyPassword(current, row.password_hash))) {
		return Response.redirect(new URL('/settings?flash=password-wrong', request.url).toString(), 302);
	}
	const hash = await hashPassword(next);
	await env.DB.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).bind(hash, user.id).run();
	// Invalidate all sessions for this user (force re-login)
	await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(user.id).run();

	return new Response(null, {
		status: 302,
		headers: {
			Location: '/login?flash=password-changed',
			'Set-Cookie': 'sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
		},
	});
}

export async function handleSettingsKeyRotate(request: Request, env: Env, user?: User): Promise<Response> {
	if (user?.role !== 'admin') {
		return Response.redirect(new URL('/settings?flash=forbidden', request.url).toString(), 302);
	}
	const newKey = newSessionToken();
	await setAppSetting(env, 'ingest_key', newKey);
	return Response.redirect(new URL('/settings?flash=key-rotated', request.url).toString(), 302);
}

export async function handleSettingsNotifications(request: Request, env: Env, user?: User): Promise<Response> {
	if (!user) return Response.redirect(new URL('/login', request.url).toString(), 302);
	const form = await request.formData();
	const keys = ['notify_email', 'notify_anomaly', 'notify_budget'];
	for (const k of keys) {
		const val = String(form.get(k) ?? '0');
		await setAppSetting(env, k, val === '1' ? '1' : '0');
	}
	return Response.redirect(new URL('/settings?flash=notif-saved', request.url).toString(), 302);
}
