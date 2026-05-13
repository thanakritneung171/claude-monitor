import type { Env, ApiLog } from '../types';
import { json } from '../lib/format';
import { insertLog } from '../db/queries';

export async function handleLog(request: Request, env: Env): Promise<Response> {
	if (request.headers.get('X-Api-Key') !== env.API_KEY) {
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
