import { esc } from './format';

export const MODEL_PASTEL: string[] = [
	'#6EE7B7', '#D8B4FE', '#FCA5A5', '#FCD34D', '#7DD3FC',
	'#F9A8D4', '#86EFAC', '#C4B5FD', '#FED7AA', '#A5F3FC',
	'#BEF264', '#F0ABFC', '#A7F3D0', '#CBD5E1', '#FDE68A',
];
export const CLIENT_DARK: string[] = [
	'#2563EB', '#9333EA', '#DC2626', '#D97706', '#0891B2',
	'#DB2777', '#16A34A', '#7C3AED', '#EA580C', '#0284C7',
	'#4D7C0F', '#C026D3', '#0D9488', '#E11D48', '#4F46E5',
];

/** สร้าง color map จากชื่อทั้งหมด → ไม่มีสีซ้ำ */
export function buildColorMap(names: string[], palette: string[]): Map<string, string> {
	const unique = [...new Set(names)].sort();
	const map = new Map<string, string>();
	unique.forEach((name, i) => map.set(name, palette[i % palette.length]));
	return map;
}

export function modelLabel(model: string): string {
	return model.replace('claude-', '').split('-20')[0] || model;
}

export function modelBadge(model: string, colorMap?: Map<string, string>): string {
	const label = modelLabel(model);
	const bg = colorMap?.get(label) ?? MODEL_PASTEL[0];
	return `<span class="chip model" style="background:${bg};color:#1F2937">${esc(label)}</span>`;
}

export function normalizeClient(raw: string): string {
	if (raw === 'claude-code-cli' || raw === 'claude-desktop') return 'client';
	return raw;
}

export function clientBadge(client: string, colorMap?: Map<string, string>): string {
	const n = normalizeClient(client);
	const bg = colorMap?.get(n) ?? CLIENT_DARK[0];
	return `<span class="chip" style="background:${bg};color:#fff;box-shadow:0 2px 8px ${bg}55">${esc(n)}</span>`;
}

export function accountBadge(email: string): string {
	return `<span class="chip acct">${esc(email || '—')}</span>`;
}
