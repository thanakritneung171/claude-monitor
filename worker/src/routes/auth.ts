import type { Env } from '../types';
import {
	createSession,
	destroySession,
	buildSidCookie,
	clearSidCookie,
	getCurrentUser,
	generateCodeVerifier,
	codeChallengeS256,
	buildAuthorizeUrl,
	saveOauthState,
	consumeOauthState,
	exchangeCodeForTokens,
	verifyIdToken,
	fetchUserinfoEmail,
	newSessionToken,
} from '../lib/auth';
import { json } from '../lib/format';

const redirect = (to: string, headers: Record<string, string> = {}) =>
	new Response(null, { status: 302, headers: { Location: to, ...headers } });

function safeNext(raw: string | null): string {
	if (!raw) return '/';
	if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
	return raw;
}

export async function handleLoginGet(url: URL, env: Env, request: Request): Promise<Response> {
	const existing = await getCurrentUser(request, env);
	const next = safeNext(url.searchParams.get('next'));
	if (existing) return redirect(next);

	const state = newSessionToken();
	const verifier = generateCodeVerifier();
	const challenge = await codeChallengeS256(verifier);
	await saveOauthState(env, state, verifier, next);
	return redirect(buildAuthorizeUrl(env, state, challenge));
}

export async function handleCallback(url: URL, env: Env, request: Request): Promise<Response> {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const oidcError = url.searchParams.get('error');

	if (oidcError) {
		return new Response(`Logto returned error: ${oidcError}`, { status: 400 });
	}
	if (!code || !state) {
		return new Response('Missing code or state', { status: 400 });
	}

	const stored = await consumeOauthState(env, state);
	if (!stored) {
		return new Response('Invalid or expired state', { status: 400 });
	}

	let tokens;
	try {
		tokens = await exchangeCodeForTokens(env, code, stored.code_verifier);
	} catch (e) {
		return new Response(`Token exchange failed: ${(e as Error).message}`, { status: 502 });
	}

	let sub: string;
	let email: string | null;
	try {
		const claims = await verifyIdToken(env, tokens.id_token);
		sub = claims.sub;
		email = claims.email;
	} catch (e) {
		return new Response(`id_token verification failed: ${(e as Error).message}`, { status: 502 });
	}

	if (!email) {
		email = await fetchUserinfoEmail(env, tokens.access_token);
	}
	if (!email) {
		return new Response('Logto profile is missing an email address', { status: 502 });
	}

	const token = await createSession(env, sub, email, request);
	return redirect(safeNext(stored.next_path), { 'Set-Cookie': buildSidCookie(token) });
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
	const user = await getCurrentUser(request, env);
	if (user) await destroySession(env, user.sessionId);
	return redirect('/login', { 'Set-Cookie': clearSidCookie() });
}

export async function handleMe(request: Request, env: Env): Promise<Response> {
	const user = await getCurrentUser(request, env);
	if (!user) return json({ ok: false, user: null }, 401);
	return json({ ok: true, user: { email: user.email } });
}
