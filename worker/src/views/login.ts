import html from './login.html';
import css from './login.css';
import { esc } from '../lib/format';

export interface LoginRenderInput {
	error?: string;
	info?: string;
	next?: string;
	email?: string;
}

export function renderLogin(input: LoginRenderInput = {}): string {
	const errorBanner = input.error
		? `<div class="error-banner">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
			${esc(input.error)}
		</div>`
		: '';

	const replacements: Record<string, string> = {
		'{{css}}': css,
		'{{errorBanner}}': errorBanner,
		'{{next}}': esc(input.next ?? '/'),
		'{{emailVal}}': esc(input.email ?? ''),
	};

	let out = html;
	for (const [k, v] of Object.entries(replacements)) out = out.split(k).join(v);
	return out;
}
