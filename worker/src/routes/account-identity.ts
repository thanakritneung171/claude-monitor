import type { Env, SessionUser } from '../types';
import { fetchEmailIdentityList } from '../db/queries';
import { renderAccountIdentity } from '../views/account-identity';

export async function handleAccountIdentity(_url: URL, env: Env, user?: SessionUser): Promise<Response> {
	const rows = await fetchEmailIdentityList(env);
	const html = renderAccountIdentity({ rows, user });
	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
