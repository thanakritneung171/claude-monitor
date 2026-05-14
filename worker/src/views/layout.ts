import sidebarHtml from './sidebar.html';
import sidebarCss from './sidebar.css';
import sidebarJs from './sidebar.client.js';
import sharedCss from './shared.css';

import type { User } from '../types';
import { esc } from '../lib/format';

export type NavKey =
	| 'dashboard'
	| 'analytics'
	| 'insights'
	| 'data_sources'
	| 'monitoring'
	| 'accounts'
	| 'users'
	| 'reports'
	| 'settings';

export interface LayoutInput {
	activeNav: NavKey;
	user?: User;
	pageTitle: string;
	pageSubtitle?: string;
	content: string;
	pageCss?: string;
	pageJs?: string;
	headExtra?: string;
	title?: string; // <title>
}

const NAV_KEYS: NavKey[] = ['dashboard', 'analytics', 'insights', 'data_sources', 'monitoring', 'accounts', 'users', 'reports', 'settings'];

export function renderSidebar(activeNav: NavKey, user?: User): string {
	let out = sidebarHtml;
	for (const k of NAV_KEYS) out = out.split(`{{nav_${k}}}`).join(k === activeNav ? 'on' : '');
	const email = user?.email ?? '';
	const initial = email.trim().charAt(0).toUpperCase() || '?';
	const role = user?.role ?? '';
	out = out.split('{{userEmail}}').join(esc(email));
	out = out.split('{{userInitial}}').join(esc(initial));
	out = out.split('{{userRole}}').join(esc(role));
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
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
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
				<input id="tbSearch" type="search" placeholder="Search models, insights, or data…" autocomplete="off">
			</div>
			<div class="tb-actions">
				<button class="tb-bell" aria-label="Notifications">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
				</button>
				<div class="tb-avatar" data-avatar-initial title="${esc(input.user?.email ?? '')}">${esc(userInitial)}</div>
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

export function render403(activeNav: NavKey, user?: User): string {
	const body = `
	<div style="background:var(--card);border:1px solid var(--line);border-radius:14px;padding:48px 32px;text-align:center;max-width:520px;margin:40px auto;">
		<div style="width:64px;height:64px;border-radius:50%;background:#FFEEEE;color:#D14343;display:grid;place-items:center;margin:0 auto 16px;">
			<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
		</div>
		<h2 style="font-size:22px;font-weight:800;margin:0 0 8px;letter-spacing:-0.02em;">Admin access required</h2>
		<p style="color:var(--ink-3);font-size:14px;margin:0 0 20px;">หน้านี้สงวนสำหรับผู้ดูแลระบบเท่านั้น ติดต่อ admin หากต้องการสิทธิ์ใช้งาน</p>
		<a href="/" class="btn primary">กลับสู่ Dashboard</a>
	</div>`;
	return renderLayout({
		activeNav,
		user,
		pageTitle: 'Access denied',
		pageSubtitle: 'You do not have permission to view this page',
		content: body,
	});
}
