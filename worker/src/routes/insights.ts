import type { Env, SessionUser } from '../types';
import { renderLayout, renderIncomingBlock, type NavKey } from '../views/layout';

export async function handleInsights(_url: URL, _env: Env, user?: SessionUser): Promise<Response> {
	const content = renderIncomingBlock(
		'Insights',
		'AI-driven findings จากการใช้งานจริง — ฟีเจอร์นี้อยู่ระหว่างการพัฒนา',
	);
	const html = renderLayout({
		activeNav: 'insights' as unknown as NavKey,
		user,
		pageTitle: 'Insights',
		pageSubtitle: 'AI-driven findings จากการใช้งานจริง',
		content,
		title: 'Insights — SDB AI Insight',
	});
	return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
