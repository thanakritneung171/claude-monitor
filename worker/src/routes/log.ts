import type { Env, ApiLog } from '../types';
import { json } from '../lib/format';
import { insertLog, lookupIdentityByIp, upsertIdentity } from '../db/queries';
import { getEffectiveIngestKey } from '../lib/auth';

export async function handleLog(request: Request, env: Env): Promise<Response> {
	const provided = request.headers.get('X-Api-Key') ?? '';
	const expected = await getEffectiveIngestKey(env);
	if (!expected || provided !== expected) {
		return json({ ok: false, error: 'Unauthorized' }, 401);
	}
	try {
		const b = await request.json() as Partial<ApiLog>;
		const ip = b.client_ip ?? '';

		// L3 fill-in: empty email + known IP → borrow current owner from ip_identity
		if (!b.account_email && ip) {
			const known = await lookupIdentityByIp(env, ip);
			if (known?.email) {
				b.account_email = known.email;
			}
		}

		// L4 insert (always)
		await insertLog(env, b);

		// L3 sync: log has a real email → upsert mapping for next empty log
		if (b.account_email && ip) {
			await upsertIdentity(env, ip, b.account_email);
		}

		return json({ ok: true });
	} catch (e) {
		return json({ ok: false, error: String(e) }, 400);
	}
}
