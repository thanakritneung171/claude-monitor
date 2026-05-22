import type { Env, SessionUser } from '../types';
import { fetchIdentityList } from '../db/queries';
import { renderIdentity } from '../views/identity';

export async function handleIdentity(_url: URL, env: Env, user?: SessionUser): Promise<Response> {
	const rows = await fetchIdentityList(env);
	const html = renderIdentity({ rows, user });
	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
