import type { Filters } from '../types';
import { dateToMs } from '../lib/date';
import { IP_PREFIX, isIpIdentity, stripIpPrefix } from '../lib/account';

export function buildWhere(filters: Filters): { clause: string; params: (string | number)[] } {
	const conds: string[] = [];
	const params: (string | number)[] = [];

	conds.push('ts >= ? AND ts <= ?');
	params.push(dateToMs(filters.dateFrom, false), dateToMs(filters.dateTo, true));

	if (filters.model) { conds.push('model = ?'); params.push(filters.model); }

	// `filters.account` accepts either an email or the `ip:xx.xx.xx.xx` fallback id.
	// The IP variant means "rows with empty email coming from this IP" — that's the
	// only sensible mapping of an ip-fallback identity back to row filtering.
	if (filters.account) {
		if (isIpIdentity(filters.account)) {
			conds.push("(account_email = '' AND client_ip = ?)");
			params.push(stripIpPrefix(filters.account));
		} else {
			conds.push('account_email = ?');
			params.push(filters.account);
		}
	}

	if (filters.client) {
		if (filters.client === 'claude-code-cli, claude-desktop') {
			conds.push("client IN ('claude-code-cli','claude-desktop')");
		} else {
			conds.push('client = ?');
			params.push(filters.client);
		}
	}

	return { clause: 'WHERE ' + conds.join(' AND '), params };
}

/** SQL fragment that yields the composed identity column: email if non-empty, otherwise 'ip:<client_ip>'. */
export const IDENTITY_EXPR = `CASE WHEN account_email != '' THEN account_email ELSE '${IP_PREFIX}' || client_ip END`;
