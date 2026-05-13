import type { Env, User } from '../types';
import { renderReports } from '../views/reports';

export async function handleReports(url: URL, env: Env, user?: User): Promise<Response> {
	return new Response(renderReports({ user }), { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
