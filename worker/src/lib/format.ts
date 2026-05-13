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
