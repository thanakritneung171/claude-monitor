import type { Env, SessionUser } from '../types';
import { fetchIdentityBackup, fetchEmailIdentityList } from '../db/queries';
import { renderIdentity } from '../views/identity';
import { renderNewIdentity } from '../views/new-identity';

export async function handleIdentity(_url: URL, env: Env, user?: SessionUser): Promise<Response> {
	const rows = await fetchIdentityBackup(env);
	const html = renderIdentity({ rows, user });
	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}

export async function handleNewIdentity(_url: URL, env: Env, user?: SessionUser): Promise<Response> {
	const rows = await fetchEmailIdentityList(env);
	const html = renderNewIdentity({ rows, user });
	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
