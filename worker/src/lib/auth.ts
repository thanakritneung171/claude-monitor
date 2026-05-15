import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env, SessionUser } from '../types';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function base64UrlEncode(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBase64Url(bytesLen: number): string {
	return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytesLen)));
}

export function newSessionToken(): string {
	return randomBase64Url(32);
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

export interface CurrentUser extends SessionUser {
	sessionId: string;
	idToken: string | null;
}

export async function getCurrentUser(request: Request, env: Env): Promise<CurrentUser | null> {
	const cookies = parseCookies(request);
	const sid = cookies['sid'];
	if (!sid) return null;
	const row = await env.DB.prepare(
		`SELECT id, sub, email, expires_at, id_token FROM sessions WHERE id = ?`
	).bind(sid).first<{ id: string; sub: string; email: string; expires_at: number; id_token: string | null }>();
	if (!row) return null;
	if (row.expires_at < Date.now()) {
		await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sid).run();
		return null;
	}
	return { id: row.id, sub: row.sub, email: row.email, sessionId: row.id, idToken: row.id_token };
}

export async function createSession(env: Env, sub: string, email: string, idToken: string, request: Request): Promise<string> {
	const token = newSessionToken();
	const now = Date.now();
	const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? '';
	const ua = request.headers.get('User-Agent') ?? '';
	await env.DB.prepare(
		`INSERT INTO sessions (id, sub, email, created_at, expires_at, ip, user_agent, id_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	).bind(token, sub, email, now, now + SESSION_TTL_MS, ip, ua, idToken).run();
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

export async function requireUser(request: Request, env: Env): Promise<GateResult> {
	const user = await getCurrentUser(request, env);
	if (!user) {
		if (isHtmlRequest(request)) {
			const url = new URL(request.url);
			const next = encodeURIComponent(url.pathname + url.search);
			return { user: null, response: redirect(`/login?next=${next}`) };
		}
		return {
			user: null,
			response: new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			}),
		};
	}
	return { user, response: null };
}

// ─── app_settings helpers (kept) ──────────────────────────────────────────────
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

// ─── Logto OIDC helpers ───────────────────────────────────────────────────────
function logtoBase(env: Env): string {
	return env.LOGTO_ENDPOINT.replace(/\/+$/, '');
}

export function generateCodeVerifier(): string {
	return randomBase64Url(64);
}

export async function codeChallengeS256(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return base64UrlEncode(new Uint8Array(digest));
}

export function buildAuthorizeUrl(env: Env, state: string, codeChallenge: string): string {
	const u = new URL(`${logtoBase(env)}/oidc/auth`);
	u.searchParams.set('client_id', env.LOGTO_APP_ID);
	u.searchParams.set('redirect_uri', env.LOGTO_REDIRECT_URI);
	u.searchParams.set('response_type', 'code');
	u.searchParams.set('scope', 'openid profile email');
	u.searchParams.set('state', state);
	u.searchParams.set('code_challenge', codeChallenge);
	u.searchParams.set('code_challenge_method', 'S256');
	return u.toString();
}

export interface TokenResponse {
	id_token: string;
	access_token: string;
	token_type: string;
	expires_in?: number;
}

export async function exchangeCodeForTokens(env: Env, code: string, codeVerifier: string): Promise<TokenResponse> {
	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		code,
		redirect_uri: env.LOGTO_REDIRECT_URI,
		code_verifier: codeVerifier,
		client_id: env.LOGTO_APP_ID,
		client_secret: env.LOGTO_APP_SECRET,
	});
	const resp = await fetch(`${logtoBase(env)}/oidc/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
	});
	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`Logto token exchange failed: ${resp.status} ${text}`);
	}
	return resp.json() as Promise<TokenResponse>;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function getJwks(env: Env) {
	const url = `${logtoBase(env)}/oidc/jwks`;
	let jwks = jwksCache.get(url);
	if (!jwks) {
		jwks = createRemoteJWKSet(new URL(url));
		jwksCache.set(url, jwks);
	}
	return jwks;
}

export async function verifyIdToken(env: Env, idToken: string): Promise<{ sub: string; email: string | null }> {
	const { payload } = await jwtVerify(idToken, getJwks(env), {
		issuer: `${logtoBase(env)}/oidc`,
		audience: env.LOGTO_APP_ID,
	});
	const sub = String(payload.sub ?? '');
	if (!sub) throw new Error('id_token missing sub');
	const email = typeof payload.email === 'string' ? payload.email : null;
	return { sub, email };
}

export async function fetchUserinfoEmail(env: Env, accessToken: string): Promise<string | null> {
	const resp = await fetch(`${logtoBase(env)}/oidc/me`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!resp.ok) return null;
	const info = await resp.json() as { email?: string };
	return typeof info.email === 'string' ? info.email : null;
}

export function buildEndSessionUrl(env: Env, idToken: string | null): string {
	const u = new URL(`${logtoBase(env)}/oidc/session/end`);
	u.searchParams.set('client_id', env.LOGTO_APP_ID);
	u.searchParams.set('post_logout_redirect_uri', env.LOGTO_POST_LOGOUT_REDIRECT_URI);
	if (idToken) u.searchParams.set('id_token_hint', idToken);
	return u.toString();
}

export async function saveOauthState(env: Env, state: string, codeVerifier: string, nextPath: string): Promise<void> {
	const expires = Date.now() + OAUTH_STATE_TTL_MS;
	await env.DB.prepare(
		`INSERT INTO oauth_state (state, code_verifier, next_path, expires_at) VALUES (?, ?, ?, ?)`
	).bind(state, codeVerifier, nextPath, expires).run();
}

export async function consumeOauthState(env: Env, state: string): Promise<{ code_verifier: string; next_path: string } | null> {
	const row = await env.DB.prepare(
		`SELECT code_verifier, next_path, expires_at FROM oauth_state WHERE state = ?`
	).bind(state).first<{ code_verifier: string; next_path: string; expires_at: number }>();
	if (!row) return null;
	await env.DB.prepare(`DELETE FROM oauth_state WHERE state = ?`).bind(state).run();
	if (row.expires_at < Date.now()) return null;
	return { code_verifier: row.code_verifier, next_path: row.next_path };
}

export type { SessionUser };
