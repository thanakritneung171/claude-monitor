import type { Env, User } from '../types';
import { fetchIngestStats } from '../db/queries-extra';
import { getEffectiveIngestKey } from '../lib/auth';
import { renderDataSources } from '../views/data-sources';

function maskKey(key: string): string {
	if (!key) return '••••••••';
	if (key.length <= 6) return '••••••••';
	return '••••••••' + key.slice(-4);
}

export async function handleDataSources(url: URL, env: Env, user?: User): Promise<Response> {
	const [stats, ingestKey] = await Promise.all([
		fetchIngestStats(env),
		getEffectiveIngestKey(env),
	]);

	const workerUrl = `${url.protocol}//${url.host}`;

	const html = renderDataSources({
		user,
		stats,
		ingestKeyMasked: maskKey(ingestKey),
		workerUrl,
	});
	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
