import type { Env, ApiLog } from '../types';
import { json } from '../lib/format';
import { insertLog, upsertEmailIdentity } from '../db/queries';
import { getEffectiveIngestKey } from '../lib/auth';

export async function handleLog(request: Request, env: Env): Promise<Response> {
	const provided = request.headers.get('X-Api-Key') ?? '';
	const expected = await getEffectiveIngestKey(env);
	if (!expected || provided !== expected) {
		return json({ ok: false, error: 'Unauthorized' }, 401);
	}
	try {
		const b = await request.json() as Partial<ApiLog>;

		// L4 insert (always) — client_ip is stored as audit only, never used as identity.
		await insertLog(env, b);

		// Identity sync: log has a real email → update the canonical email_identity record.
		if (b.account_email) {
			const raw = b as Record<string, unknown>;
			const ts = typeof raw.ts === 'number' ? raw.ts : 0;

			await upsertEmailIdentity(env, {
				email:      b.account_email,
				name:       String(raw.name        ?? ''),
				accountId:  String(raw.account_id  ?? ''),
				uuid:       String(raw.device_id   ?? ''),
				orgId:      String(raw.org_id      ?? ''),
				anonId:     String(raw.anon_id     ?? ''),
				osType:     String(raw.os_type     ?? ''),
				osVersion:  String(raw.os_version  ?? ''),
				hostArch:   String(raw.host_arch   ?? ''),
				appVersion: String(raw.app_version ?? ''),
				terminal:   String(raw.terminal    ?? ''),
				clientType: b.client ?? '',
				ts,
			});
		}

		return json({ ok: true });
	} catch (e) {
		return json({ ok: false, error: String(e) }, 400);
	}
}
