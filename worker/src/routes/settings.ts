import type { Env, SessionUser } from '../types';
import {
	getAppSetting,
	setAppSetting,
	getEffectiveIngestKey,
	newSessionToken,
} from '../lib/auth';
import { renderSettings } from '../views/settings';

const htmlResponse = (body: string, headers: Record<string, string> = {}) =>
	new Response(body, { headers: { 'Content-Type': 'text/html;charset=utf-8', ...headers } });

const VERSION = '1.1.0';

function maskKey(key: string): string {
	if (!key) return '••••••••';
	if (key.length <= 6) return '••••••••';
	return '••••••••' + key.slice(-4);
}

export async function handleSettingsGet(url: URL, env: Env, user?: SessionUser): Promise<Response> {
	const [ingestKey, notifyEmail, notifyAnomaly, notifyBudget] = await Promise.all([
		getEffectiveIngestKey(env),
		getAppSetting(env, 'notify_email'),
		getAppSetting(env, 'notify_anomaly'),
		getAppSetting(env, 'notify_budget'),
	]);

	const flash = url.searchParams.get('flash');
	let banner: { kind: 'success' | 'error'; message: string } | undefined;
	if (flash === 'key-rotated') banner = { kind: 'success', message: 'Rotate ingest key สำเร็จ — อัปเดต proxy config ก่อนใช้งานต่อ' };
	else if (flash === 'notif-saved') banner = { kind: 'success', message: 'บันทึกการตั้งค่าแจ้งเตือนแล้ว' };

	return htmlResponse(renderSettings({
		user,
		ingestKeyMasked: maskKey(ingestKey),
		notifyEmail: notifyEmail === '1',
		notifyAnomaly: notifyAnomaly === '1',
		notifyBudget: notifyBudget === '1',
		version: VERSION,
		compatibilityDate: '2025-04-01',
		banner,
	}));
}

export async function handleSettingsKeyRotate(request: Request, env: Env, user?: SessionUser): Promise<Response> {
	if (!user) return Response.redirect(new URL('/login', request.url).toString(), 302);
	const newKey = newSessionToken();
	await setAppSetting(env, 'ingest_key', newKey);
	return Response.redirect(new URL('/settings?flash=key-rotated', request.url).toString(), 302);
}

export async function handleSettingsNotifications(request: Request, env: Env, user?: SessionUser): Promise<Response> {
	if (!user) return Response.redirect(new URL('/login', request.url).toString(), 302);
	const form = await request.formData();
	const keys = ['notify_email', 'notify_anomaly', 'notify_budget'];
	for (const k of keys) {
		const val = String(form.get(k) ?? '0');
		await setAppSetting(env, k, val === '1' ? '1' : '0');
	}
	return Response.redirect(new URL('/settings?flash=notif-saved', request.url).toString(), 302);
}
