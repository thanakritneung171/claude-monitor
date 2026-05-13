import type { Env, User, Session, Role } from '../types';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 100_000;

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
	const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
	const len = Math.floor(hex.length / 2);
	const out = new Uint8Array(len);
	for (let i = 0; i < len; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		{ name: 'PBKDF2' },
		false,
		['deriveBits'],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
		key,
		256,
	);
	return new Uint8Array(bits);
}

export async function hashPassword(plain: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hash = await pbkdf2(plain, salt, PBKDF2_ITERATIONS);
	return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
	const parts = stored.split('$');
	if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
	const iterations = parseInt(parts[1], 10);
	if (!Number.isFinite(iterations) || iterations < 1000) return false;
	const salt = hexToBytes(parts[2]);
	const expected = hexToBytes(parts[3]);
	const actual = await pbkdf2(plain, salt, iterations);
	if (actual.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
	return diff === 0;
}

export function newSessionToken(): string {
	return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function parseCookies(request: Request): Record<string, string> {
	const raw = request.headers.get('Cookie') ?? '';
	const out: Record<string, string> = {};
	for (const part of raw.split(';')) {
		const idx = part.indexOf('=');
		if (idx === -1) continue;
		const k = part.slice(0, idx).trim();
		const v = part.slice(idx + 1).trim();
		if (k) out[k] = decodeURIComponent(v);
	}
	return out;
}

export function buildSidCookie(token: string, maxAgeSec = SESSION_TTL_MS / 1000): string {
	return `sid=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearSidCookie(): string {
	return 'sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

export interface CurrentUser extends User {
	sessionId: string;
}

export async function getCurrentUser(request: Request, env: Env): Promise<CurrentUser | null> {
	const cookies = parseCookies(request);
	const sid = cookies['sid'];
	if (!sid) return null;
	const row = await env.DB.prepare(
		`SELECT u.id, u.email, u.password_hash, u.role, u.created_at, u.last_login_at, u.status,
		        s.id AS session_id, s.expires_at
		 FROM sessions s JOIN users u ON u.id = s.user_id
		 WHERE s.id = ?`
	).bind(sid).first<{
		id: string; email: string; password_hash: string; role: string;
		created_at: number; last_login_at: number | null; status: string;
		session_id: string; expires_at: number;
	}>();
	if (!row) return null;
	if (row.expires_at < Date.now()) {
		await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sid).run();
		return null;
	}
	if (row.status !== 'active') return null;
	return {
		id: row.id,
		email: row.email,
		password_hash: row.password_hash,
		role: row.role as Role,
		created_at: row.created_at,
		last_login_at: row.last_login_at,
		status: row.status as 'active' | 'disabled',
		sessionId: row.session_id,
	};
}

export async function createSession(env: Env, userId: string, request: Request): Promise<string> {
	const token = newSessionToken();
	const now = Date.now();
	const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? '';
	const ua = request.headers.get('User-Agent') ?? '';
	await env.DB.prepare(
		`INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)`
	).bind(token, userId, now, now + SESSION_TTL_MS, ip, ua).run();
	await env.DB.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).bind(now, userId).run();
	return token;
}

export async function destroySession(env: Env, sessionId: string): Promise<void> {
	await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();
}

export interface GateResult {
	user: CurrentUser | null;
	response: Response | null;
}

function isHtmlRequest(request: Request): boolean {
	const accept = request.headers.get('Accept') ?? '';
	return request.method === 'GET' && accept.includes('text/html');
}

function redirect(to: string): Response {
	return new Response(null, { status: 302, headers: { Location: to } });
}

export async function requireUser(request: Request, env: Env, role: Role | null = null): Promise<GateResult> {
	const user = await getCurrentUser(request, env);
	if (!user) {
		if (isHtmlRequest(request)) {
			const url = new URL(request.url);
			const next = encodeURIComponent(url.pathname + url.search);
			return { user: null, response: redirect(`/login?next=${next}`) };
		}
		return { user: null, response: new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } }) };
	}
	if (role === 'admin' && user.role !== 'admin') {
		return { user, response: null }; // Caller decides how to render 403 — typically a friendly page
	}
	return { user, response: null };
}

export async function getAppSetting(env: Env, key: string): Promise<string | null> {
	const row = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = ?`).bind(key).first<{ value: string }>();
	return row?.value ?? null;
}

export async function setAppSetting(env: Env, key: string, value: string): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO app_settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`
	).bind(key, value).run();
}

export async function getEffectiveIngestKey(env: Env): Promise<string> {
	const dbKey = await getAppSetting(env, 'ingest_key');
	return dbKey || env.API_KEY || '';
}

export type { User, Session, Role };
