import type { Filters } from '../types';
import { dateToMs } from '../lib/date';

export function buildWhere(filters: Filters): { clause: string; params: (string | number)[] } {
	const conds: string[] = [];
	const params: (string | number)[] = [];

	conds.push('ts >= ? AND ts <= ?');
	params.push(dateToMs(filters.dateFrom, false), dateToMs(filters.dateTo, true));

	if (filters.model) { conds.push('model = ?'); params.push(filters.model); }

	// `filters.account` is an account email (identity = email only now).
	if (filters.account) {
		conds.push('account_email = ?');
		params.push(filters.account);
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
