import type { Env, SessionUser } from '../types';
import { dateToMs, todayBkk } from '../lib/date';
import { renderClearData } from '../views/clear-data';

const htmlResponse = (body: string) =>
	new Response(body, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });

interface DistinctOptions {
	clients: string[];
	accounts: string[];
	models: string[];
	totalLogs: number;
	totalSessions: number;
}

async function loadOptions(env: Env): Promise<DistinctOptions> {
	const [clientsRes, accountsRes, modelsRes, logCountRow, sessCountRow] = await Promise.all([
		env.DB.prepare(`SELECT DISTINCT client FROM api_logs WHERE client != '' ORDER BY client`).all<{ client: string }>(),
		env.DB.prepare(`SELECT DISTINCT account_email FROM api_logs WHERE account_email != '' ORDER BY account_email`).all<{ account_email: string }>(),
		env.DB.prepare(`SELECT DISTINCT model FROM api_logs WHERE model != '' ORDER BY model`).all<{ model: string }>(),
		env.DB.prepare(`SELECT COUNT(*) as n FROM api_logs`).first<{ n: number }>(),
		env.DB.prepare(`SELECT COUNT(*) as n FROM sessions`).first<{ n: number }>(),
	]);
	return {
		clients: clientsRes.results.map(r => r.client),
		accounts: accountsRes.results.map(r => r.account_email),
		models: modelsRes.results.map(r => r.model),
		totalLogs: logCountRow?.n ?? 0,
		totalSessions: sessCountRow?.n ?? 0,
	};
}

export async function handleClearDataGet(url: URL, env: Env, user?: SessionUser): Promise<Response> {
	const opts = await loadOptions(env);

	const flash = url.searchParams.get('flash');
	const deleted = url.searchParams.get('deleted');
	let banner: { kind: 'success' | 'error'; message: string } | undefined;
	if (flash === 'all')      banner = { kind: 'success', message: `ลบ api_logs ทั้งหมดเรียบร้อย (${deleted ?? '0'} แถว)` };
	else if (flash === 'range')   banner = { kind: 'success', message: `ลบตามช่วงวันที่เรียบร้อย (${deleted ?? '0'} แถว)` };
	else if (flash === 'filter')  banner = { kind: 'success', message: `ลบตาม filter เรียบร้อย (${deleted ?? '0'} แถว)` };
	else if (flash === 'sessions') banner = { kind: 'success', message: `ลบ sessions ทั้งหมดเรียบร้อย (${deleted ?? '0'} แถว) — ผู้ใช้ทั้งหมดถูก logout` };
	else if (flash === 'noop')    banner = { kind: 'error',   message: 'ไม่ได้ระบุเงื่อนไข — ไม่มีอะไรถูกลบ' };
	else if (flash === 'error')   banner = { kind: 'error',   message: 'เกิดข้อผิดพลาดระหว่างลบ' };

	return htmlResponse(renderClearData({
		user,
		clients: opts.clients,
		accounts: opts.accounts,
		models: opts.models,
		totalLogs: opts.totalLogs,
		totalSessions: opts.totalSessions,
		todayStr: todayBkk(),
		banner,
	}));
}

function redirect(request: Request, flash: string, deleted = 0): Response {
	const u = new URL('/clear-data', request.url);
	u.searchParams.set('flash', flash);
	if (deleted) u.searchParams.set('deleted', String(deleted));
	return Response.redirect(u.toString(), 302);
}

export async function handleClearDataPost(request: Request, env: Env, user?: SessionUser): Promise<Response> {
	if (!user) return Response.redirect(new URL('/login', request.url).toString(), 302);

	const form = await request.formData();
	const action = String(form.get('action') ?? '');

	try {
		if (action === 'all') {
			const res = await env.DB.prepare(`DELETE FROM api_logs`).run();
			return redirect(request, 'all', (res.meta as { changes?: number } | undefined)?.changes ?? 0);
		}

		if (action === 'sessions') {
			const res = await env.DB.prepare(`DELETE FROM sessions`).run();
			return redirect(request, 'sessions', (res.meta as { changes?: number } | undefined)?.changes ?? 0);
		}

		if (action === 'range') {
			const from = String(form.get('date_from') ?? '');
			const to   = String(form.get('date_to') ?? '');
			if (!from || !to) return redirect(request, 'noop');
			const fromMs = dateToMs(from, false);
			const toMs   = dateToMs(to, true);
			const res = await env.DB.prepare(`DELETE FROM api_logs WHERE ts >= ? AND ts <= ?`)
				.bind(fromMs, toMs).run();
			return redirect(request, 'range', (res.meta as { changes?: number } | undefined)?.changes ?? 0);
		}

		if (action === 'filter') {
			const client  = String(form.get('client')  ?? '');
			const account = String(form.get('account') ?? '');
			const model   = String(form.get('model')   ?? '');
			const conds: string[] = [];
			const params: string[] = [];
			if (client)  { conds.push('client = ?');         params.push(client); }
			if (account) { conds.push('account_email = ?');  params.push(account); }
			if (model)   { conds.push('model = ?');          params.push(model); }
			if (conds.length === 0) return redirect(request, 'noop');
			const res = await env.DB.prepare(`DELETE FROM api_logs WHERE ${conds.join(' AND ')}`)
				.bind(...params).run();
			return redirect(request, 'filter', (res.meta as { changes?: number } | undefined)?.changes ?? 0);
		}

		return redirect(request, 'noop');
	} catch (e) {
		console.error('clear-data error', e);
		return redirect(request, 'error');
	}
}
