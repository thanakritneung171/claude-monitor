/// <reference types="@cloudflare/workers-types" />

import type { Env } from './types';
import { json } from './lib/format';
import { handleLog } from './routes/log';
import { handleHealth } from './routes/health';
import { handleDashboard } from './routes/dashboard';
import { handleExport } from './routes/export';

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const { pathname } = url;

		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
			});
		}

		if (pathname === '/log'    && request.method === 'POST') return handleLog(request, env);
		if (pathname === '/health')                              return handleHealth();
		if (pathname === '/'       && request.method === 'GET')  return handleDashboard(url, env);
		if (pathname === '/export' && request.method === 'GET')  return handleExport(url, env);

		return json({ ok: false, error: 'Not Found' }, 404);
	},
} satisfies ExportedHandler<Env>;
