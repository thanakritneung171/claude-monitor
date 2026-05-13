import type { Env, ApiLog } from '../types';
import { json } from '../lib/format';
import { insertLog } from '../db/queries';
import { getEffectiveIngestKey } from '../lib/auth';

export async function handleLog(request: Request, env: Env): Promise<Response> {
	const provided = request.headers.get('X-Api-Key') ?? '';
	const expected = await getEffectiveIngestKey(env);
	if (!expected || provided !== expected) {
		return json({ ok: false, error: 'Unauthorized' }, 401);
	}
	try {
		const b = await request.json() as Partial<ApiLog>;
		await insertLog(env, b);
		return json({ ok: true });
	} catch (e) {
		return json({ ok: false, error: String(e) }, 400);
	}
}
