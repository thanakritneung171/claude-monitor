import sidebarHtml from './sidebar.html';
import sidebarCss from './sidebar.css';
import sidebarJs from './sidebar.client.js';
import sharedCss from './shared.css';

import type { SessionUser } from '../types';
import { esc } from '../lib/format';
import { LOGO_DATA_URL, LOGO_ICON_DATA_URL } from '../lib/logo';

// export type NavKey =
// 	| 'dashboard'
// 	| 'analytics'
// 	| 'insights'
// 	| 'data_sources'
// 	| 'monitoring'
// 	| 'accounts'
// 	| 'users'
// 	| 'reports'
// 	| 'settings';

export type NavKey =
	| 'dashboard'
	| 'analytics'
	| 'accounts'
	| 'identity'
	| 'settings';

export interface LayoutInput {
	activeNav: NavKey;
	user?: SessionUser;
	pageTitle: string;
	pageSubtitle?: string;
	content: string;
	pageCss?: string;
	pageJs?: string;
	headExtra?: string;
	title?: string; // <title>
}

// const NAV_KEYS: NavKey[] = ['dashboard', 'analytics', 'insights', 'data_sources', 'monitoring', 'accounts', 'users', 'reports', 'settings'];
const NAV_KEYS: NavKey[] = ['dashboard', 'analytics', 'accounts', 'settings'];

export function renderSidebar(activeNav: NavKey, user?: SessionUser): string {
	let out = sidebarHtml;
	for (const k of NAV_KEYS) out = out.split(`{{nav_${k}}}`).join(k === activeNav ? 'on' : '');
	const email = user?.email ?? '';
	const initial = email.trim().charAt(0).toUpperCase() || '?';
	out = out.split('{{userEmail}}').join(esc(email));
	out = out.split('{{userInitial}}').join(esc(initial));
	out = out.split('{{logoDataUrl}}').join(LOGO_DATA_URL);
	out = out.split('{{logoIconDataUrl}}').join(LOGO_ICON_DATA_URL);
	return out;
}

export function renderLayout(input: LayoutInput): string {
	const sidebar = renderSidebar(input.activeNav, input.user);
	const userInitial = (input.user?.email ?? '').trim().charAt(0).toUpperCase() || '?';
	const title = input.title ?? `${input.pageTitle} — SDB AI Insight`;
	const pageSubtitle = input.pageSubtitle ?? '';

	return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${sharedCss}${sidebarCss}${input.pageCss ?? ''}</style>
${input.headExtra ?? ''}
</head>
<body>
<div class="shell" id="shell">
	${sidebar}
	<div class="main">
		<header class="topbar-inner">
			<button class="tb-toggle" id="sbToggle" aria-label="Toggle sidebar">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
			</button>
			<div class="tb-search">
				<span class="tb-search-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></span>
				<input id="tbSearch" type="search" placeholder="Search…" autocomplete="off">
			</div>
			<div class="tb-actions">
				<div class="avatar-menu" id="avatarMenu">
					<button class="tb-avatar" id="avatarBtn" data-avatar-initial aria-label="User menu">${esc(userInitial)}</button>
					<div class="avatar-drop" id="avatarDrop" role="menu">
						<div class="avatar-drop-head">
							<div class="avatar-drop-av" data-avatar-initial>${esc(userInitial)}</div>
							<div class="avatar-drop-info">
								<div class="avatar-drop-email">${esc(input.user?.email ?? '—')}</div>
							</div>
						</div>
						<div class="avatar-drop-sep"></div>
						<a href="/logout" class="avatar-drop-logout">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
							Sign out
						</a>
					</div>
				</div>
			</div>
		</header>
		<div class="page">
			<div class="page-head">
				<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
					<div>
						<h1>${esc(input.pageTitle)}</h1>
						${pageSubtitle ? `<div class="page-sub">${esc(pageSubtitle)}</div>` : ''}
					</div>
				</div>
			</div>
			${input.content}
		</div>
	</div>
</div>
<script>${sidebarJs}</script>
${input.pageJs ? `<script>${input.pageJs}</script>` : ''}
</body>
</html>`;
}

export function renderIncomingBlock(title: string, description: string): string {
	return `<div class="card" style="margin-top:14px;">
		<div class="incoming-block">
			<div class="incoming-icon">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
			</div>
			<span class="badge-incoming">⏳ Incoming</span>
			<h3>${esc(title)}</h3>
			<p>${esc(description)}</p>
		</div>
	</div>`;
}

