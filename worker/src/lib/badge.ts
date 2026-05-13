import { esc } from './format';

export function modelLabel(model: string): string {
	return model.replace('claude-', '').split('-20')[0] || model;
}

export function modelBadge(model: string): string {
	return `<span class="chip model">${esc(modelLabel(model))}</span>`;
}

export function normalizeClient(raw: string): string {
	if (raw === 'claude-code-cli' || raw === 'claude-desktop') return 'client';
	return raw;
}

export function clientBadge(client: string): string {
	const n = normalizeClient(client);
	const colors: Record<string, [string, string]> = {
		'claude-code':         ['#F1ECFF', '#7C3AED'],
		'claude-code-vscode':  ['#E6F1FB', '#0078D4'],
		'vscode':              ['#E6F1FB', '#0078D4'],
		'desktop':             ['#FFF1E0', '#D97706'],
		'api':                 ['#E8F5EC', '#2F8F4A'],
		'client':              ['#EEF4FF', '#4B6FBF'],
	};
	const [bg, fg] = colors[n] ?? ['#EEF4FF', '#4B6FBF'];
	return `<span class="chip" style="background:${bg};color:${fg}"><span class="dot-c"></span>${esc(n)}</span>`;
}

export function accountBadge(email: string): string {
	return `<span class="chip acct">${esc(email || '—')}</span>`;
}
