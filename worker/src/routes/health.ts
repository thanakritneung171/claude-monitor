import { json } from '../lib/format';

export function handleHealth(): Response {
	return json({ ok: true });
}
