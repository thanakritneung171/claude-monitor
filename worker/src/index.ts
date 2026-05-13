/// <reference types="@cloudflare/workers-types" />

import type { Env } from './types';
import { json } from './lib/format';
import { requireUser } from './lib/auth';
import { handleLog } from './routes/log';
import { handleHealth } from './routes/health';
import { handleDashboard } from './routes/dashboard';
import { handleExport } from './routes/export';
import { handleAccounts } from './routes/accounts';
import { handleAccountDetail } from './routes/account-detail';
import { handleLoginGet, handleLoginPost, handleLogout, handleMe } from './routes/auth';
import { handleAnalytics } from './routes/analytics';
import { handleInsights } from './routes/insights';
import { handleDataSources } from './routes/data-sources';
import { handleMonitoring } from './routes/monitoring';
import { handleUsersGet, handleUsersPost } from './routes/users';
import { handleReports } from './routes/reports';
import {
	handleSettingsGet,
	handleSettingsPassword,
	handleSettingsKeyRotate,
	handleSettingsNotifications,
} from './routes/settings';

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const { pathname } = url;
		const method = request.method;

		if (method === 'OPTIONS') {
			return new Response(null, {
				headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
			});
		}

		// ─── Public endpoints ──────────────────────────────────────────────────
		if (pathname === '/log'     && method === 'POST') return handleLog(request, env);
		if (pathname === '/health')                       return handleHealth();
		if (pathname === '/login'   && method === 'GET')  return handleLoginGet(url, env, request);
		if (pathname === '/login'   && method === 'POST') return handleLoginPost(request, env);
		if (pathname === '/logout')                       return handleLogout(request, env);
		if (pathname === '/api/me'  && method === 'GET')  return handleMe(request, env);

		// ─── Authenticated routes ──────────────────────────────────────────────
		const gate = await requireUser(request, env);
		if (gate.response) return gate.response;
		const user = gate.user!;

		if (pathname === '/'             && method === 'GET') return handleDashboard(url, env, user);
		if (pathname === '/accounts'     && method === 'GET') return handleAccounts(url, env, user);
		if (pathname === '/account'      && method === 'GET') return handleAccountDetail(url, env, user);
		if (pathname === '/analytics'    && method === 'GET') return handleAnalytics(url, env, user);
		if (pathname === '/insights'     && method === 'GET') return handleInsights(url, env, user);
		if (pathname === '/data-sources' && method === 'GET') return handleDataSources(url, env, user);
		if (pathname === '/monitoring'   && method === 'GET') return handleMonitoring(url, env, user);
		if (pathname === '/reports'      && method === 'GET') return handleReports(url, env, user);
		if (pathname === '/export'       && method === 'GET') return handleExport(url, env);

		if (pathname === '/users'        && method === 'GET')  return handleUsersGet(url, env, user);
		if (pathname === '/users'        && method === 'POST') return handleUsersPost(request, env, user);

		if (pathname === '/settings'                 && method === 'GET')  return handleSettingsGet(url, env, user);
		if (pathname === '/settings/password'        && method === 'POST') return handleSettingsPassword(request, env, user);
		if (pathname === '/settings/key-rotate'      && method === 'POST') return handleSettingsKeyRotate(request, env, user);
		if (pathname === '/settings/notifications'   && method === 'POST') return handleSettingsNotifications(request, env, user);

		return json({ ok: false, error: 'Not Found' }, 404);
	},
} satisfies ExportedHandler<Env>;
