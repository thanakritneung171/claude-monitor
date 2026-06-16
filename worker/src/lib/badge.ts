import { esc } from './format';
import { displayAccount } from './account';

// 12 สีจาก 12 กลุ่ม hue ที่ต่างกันชัดเจน ไม่มีสีซ้ำกลุ่ม
export const MODEL_PASTEL: string[] = [
	'#FCA5A5', // red        0°
	'#FDBA74', // orange    28°
	'#FCD34D', // yellow    48°
	'#BEF264', // lime      83°
	'#86EFAC', // green    141°
	'#5EEAD4', // teal     174°
	'#7DD3FC', // sky      202°
	'#818CF8', // indigo   234°
	'#C4B5FD', // violet   262°
	'#F0ABFC', // fuchsia  294°
	'#F9A8D4', // pink     325°
	'#CBD5E1', // slate    neutral
];
export const CLIENT_DARK: string[] = [
	'#DC2626', // red        0°
	'#EA580C', // orange    20°
	'#CA8A04', // gold      47°
	'#4D7C0F', // olive     83°
	'#16A34A', // green    144°
	'#0D9488', // teal     174°
	'#2563EB', // blue     221°
	'#7C3AED', // violet   265°
	'#C026D3', // magenta  288°
	'#DB2777', // pink     337°
	'#64748B', // slate    neutral
];

/** hash ชื่อ → index คงที่ ทุกหน้าชื่อเดียวกันได้สีเดียวกันเสมอ */
function hashIndex(name: string, len: number): number {
	let h = 5381;
	for (let i = 0; i < name.length; i++) {
		h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
	}
	return h % len;
}

/** สร้าง color map จากชื่อทั้งหมด โดยใช้ hash → สีคงที่ตามชื่อ ไม่ขึ้นกับ dataset */
export function buildColorMap(names: string[], palette: string[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const name of new Set(names)) {
		map.set(name, palette[hashIndex(name, palette.length)]);
	}
	return map;
}

export function modelLabel(model: string): string {
	return model.replace('claude-', '').split('-20')[0] || model;
}

export function modelBadge(model: string, colorMap?: Map<string, string>): string {
	const label = modelLabel(model);
	const bg = colorMap?.get(label) ?? MODEL_PASTEL[hashIndex(label, MODEL_PASTEL.length)];
	return `<span class="chip model" style="background:${bg};color:#1F2937">${esc(label)}</span>`;
}

export function normalizeClient(raw: string): string {
	if (raw === 'claude-code-cli' || raw === 'claude-desktop') return 'claude-code-cli, claude-desktop';
	return raw;
}

export function clientBadge(client: string, colorMap?: Map<string, string>): string {
	const n = normalizeClient(client);
	const bg = colorMap?.get(n) ?? CLIENT_DARK[hashIndex(n, CLIENT_DARK.length)];
	const label = n.includes(', ')
		? n.split(', ').map(p => esc(p)).join('<br>')
		: esc(n);
	const extra = n.includes(', ') ? 'text-align:center;line-height:1.2;' : '';
	return `<span class="chip" style="background:${bg};color:#fff;box-shadow:0 2px 8px ${bg}55;${extra}">${label}</span>`;
}

export function accountBadge(email: string): string {
	return `<span class="chip acct">${esc(displayAccount(email))}</span>`;
}
