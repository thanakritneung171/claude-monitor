import type { Env, SessionUser } from '../types';
import { renderReports } from '../views/reports';

export async function handleReports(url: URL, env: Env, user?: SessionUser): Promise<Response> {
	return new Response(renderReports({ user }), { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
