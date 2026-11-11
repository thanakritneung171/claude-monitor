export function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
	});
}

export function esc(s: unknown): string {
	return String(s ?? '')
		.replace(/&/g, '&amp;').replace(/</g, '&lt;')
		.replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function num(n: number | null | undefined, dec = 0): string {
	return (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** claude.ai แชต (/completion) ไม่ส่ง usage กลับมาให้ client — แถวพวกนี้ token/cost = 0
 *  ไม่ใช่ "ฟรี" แต่ "ไม่มีข้อมูล" จึงแสดง "—" แทน (แถว Desktop cloud session ที่มี usage
 *  จริงจะมี total_tokens > 0 จึงแสดงตัวเลขตามปกติ) */
const NO_USAGE_CLIENTS = new Set(['claude-web', 'claude-desktop']);
export const NO_USAGE_TITLE = 'claude.ai ไม่ส่งจำนวน token กลับมา — ไม่มีข้อมูล';

export function usageUnavailable(r: { client: string; total_tokens: number | null | undefined }): boolean {
	return NO_USAGE_CLIENTS.has(r.client) && !r.total_tokens;
}

/** ตัวเลข token/cost ของแถว — "—" ถ้าแถวนั้นไม่มีข้อมูล usage */
export function usageNum(
	r: { client: string; total_tokens: number | null | undefined },
	n: number | null | undefined,
	dec = 0,
	prefix = '',
): string {
	return usageUnavailable(r)
		? `<span class="na" title="${NO_USAGE_TITLE}" style="color:var(--ink-3)">—</span>`
		: `${prefix}${num(n, dec)}`;
}

export function fmtBkk(ms: number): string {
	return new Date(ms).toLocaleString('en-GB', {
		timeZone: 'Asia/Bangkok',
		day: '2-digit', month: '2-digit', year: '2-digit',
		hour: '2-digit', minute: '2-digit', second: '2-digit',
	});
}

export function fmtBkkParts(ms: number): { time: string; date: string } {
	const d = new Date(ms);
	const date = d.toLocaleDateString('en-GB', {
		timeZone: 'Asia/Bangkok',
		day: '2-digit', month: '2-digit', year: '2-digit',
	});
	const time = d.toLocaleTimeString('en-GB', {
		timeZone: 'Asia/Bangkok',
		hour: '2-digit', minute: '2-digit', second: '2-digit',
	});
	return { time, date };
}
