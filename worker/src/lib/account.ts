const AVATAR_PALETTE = ['#F47948', '#FF9466', '#FFB088', '#FFD1B3', '#E8B493', '#CFC6BB'];

export function avatarColor(email: string): string {
	let h = 0;
	for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) | 0;
	return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

export function shadeHex(hex: string, percent: number): string {
	const f = parseInt(hex.slice(1), 16);
	const t = percent < 0 ? 0 : 255;
	const p = Math.abs(percent) / 100;
	const R = f >> 16;
	const G = (f >> 8) & 0xff;
	const B = f & 0xff;
	return '#' + (
		0x1000000 +
		(Math.round((t - R) * p) + R) * 0x10000 +
		(Math.round((t - G) * p) + G) * 0x100 +
		(Math.round((t - B) * p) + B)
	).toString(16).slice(1);
}

export function initials(email: string): string {
	const name = (email.split('@')[0] || '').replace(/[^a-zA-Z0-9]/g, '');
	return (name.slice(0, 2) || '??').toUpperCase();
}

export function emailDomain(email: string): string {
	return email.split('@')[1] || '';
}

// ─── Identity display ────────────────────────────────────────────────────────
// `account_email` is preferred; if empty, fall back to `ip:<client_ip>`. The
// "ip:" prefix lets views, links, and queries tell the two apart at a glance —
// the alternative (plain IP in the email column) would silently break grouping
// and dashboard filters that assume an email-shaped string.

export const IP_PREFIX = 'ip:';

export function displayAccount(email: string, clientIp: string): string {
	if (email) return email;
	if (clientIp) return IP_PREFIX + clientIp;
	return '—';
}

export function isIpIdentity(id: string): boolean {
	return id.startsWith(IP_PREFIX);
}

export function stripIpPrefix(id: string): string {
	return id.startsWith(IP_PREFIX) ? id.slice(IP_PREFIX.length) : id;
}

export type AcctStatus = 'live' | 'idle' | 'cold';

export function accountStatus(lastSeenMs: number, nowMs = Date.now()): AcctStatus {
	const d = nowMs - lastSeenMs;
	if (d < 60 * 60 * 1000) return 'live';
	if (d < 7 * 24 * 60 * 60 * 1000) return 'idle';
	return 'cold';
}

export function relativeTimeTh(lastSeenMs: number, nowMs = Date.now()): string {
	const d = Math.max(0, nowMs - lastSeenMs);
	const m = Math.floor(d / 60000);
	if (m < 1) return 'เมื่อกี้นี้';
	if (m < 60) return m + ' นาทีที่แล้ว';
	const h = Math.floor(m / 60);
	if (h < 24) return h + ' ชั่วโมงที่แล้ว';
	const dd = Math.floor(h / 24);
	if (dd === 1) return 'เมื่อวาน';
	if (dd < 7) return dd + ' วันก่อน';
	if (dd < 30) return Math.floor(dd / 7) + ' สัปดาห์ก่อน';
	return Math.floor(dd / 30) + ' เดือนก่อน';
}

export function compactNum(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
	if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
	return n.toLocaleString('en-US');
}

export interface AccountRow {
	email: string;
	calls: number;
	tokens: number;
	cost: number;
	lastSeen: number;
	topModels: string[];
}
