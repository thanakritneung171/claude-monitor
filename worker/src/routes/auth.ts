import type { Env, User, Role } from '../types';
import { renderLogin } from '../views/login';
import {
	verifyPassword,
	createSession,
	destroySession,
	buildSidCookie,
	clearSidCookie,
	getCurrentUser,
} from '../lib/auth';
import { json } from '../lib/format';

const htmlResponse = (body: string, headers: Record<string, string> = {}) =>
	new Response(body, { headers: { 'Content-Type': 'text/html;charset=utf-8', ...headers } });

const redirect = (to: string, headers: Record<string, string> = {}) =>
	new Response(null, { status: 302, headers: { Location: to, ...headers } });

function safeNext(raw: string | null): string {
	if (!raw) return '/';
	if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
	return raw;
}

export async function handleLoginGet(url: URL, env: Env, request: Request): Promise<Response> {
	const user = await getCurrentUser(request, env);
	if (user) return redirect(safeNext(url.searchParams.get('next')));
	const next = safeNext(url.searchParams.get('next'));
	const flash = url.searchParams.get('flash');
	let error: string | undefined;
	if (flash === 'password-changed') error = 'เปลี่ยนรหัสผ่านสำเร็จ — กรุณาเข้าสู่ระบบใหม่';
	return htmlResponse(renderLogin({ next, error }));
}

export async function handleLoginPost(request: Request, env: Env): Promise<Response> {
	const form = await request.formData();
	const email = String(form.get('email') ?? '').trim().toLowerCase();
	const password = String(form.get('password') ?? '');
	const next = safeNext(String(form.get('next') ?? '/'));

	if (!email || !password) {
		return htmlResponse(renderLogin({ error: 'กรุณากรอกอีเมลและรหัสผ่าน', next, email }), { 'Cache-Control': 'no-store' });
	}

	const user = await env.DB.prepare(
		`SELECT id, email, password_hash, role, status FROM users WHERE email = ?`
	).bind(email).first<{ id: string; email: string; password_hash: string; role: string; status: string }>();

	if (!user || user.status !== 'active' || !(await verifyPassword(password, user.password_hash))) {
		return htmlResponse(renderLogin({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', next, email }), { 'Cache-Control': 'no-store' });
	}

	const token = await createSession(env, user.id, request);
	return redirect(next, { 'Set-Cookie': buildSidCookie(token) });
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
	const user = await getCurrentUser(request, env);
	if (user) await destroySession(env, user.sessionId);
	return redirect('/login', { 'Set-Cookie': clearSidCookie() });
}

export async function handleMe(request: Request, env: Env): Promise<Response> {
	const user = await getCurrentUser(request, env);
	if (!user) return json({ ok: false, user: null }, 401);
	return json({
		ok: true,
		user: { id: user.id, email: user.email, role: user.role },
	});
}
