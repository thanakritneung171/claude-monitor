import html from './accounts.html';
import pageCss from './accounts.css';
import clientJs from './accounts.client.js';

import type { AccountsListData } from '../db/queries';
import type { SessionUser } from '../types';
import { esc, num } from '../lib/format';
import { renderLayout } from './layout';
import { modelLabel } from '../lib/badge';
import { avatarColor, shadeHex, initials, emailDomain, accountStatus, relativeTimeTh, compactNum } from '../lib/account';

export interface AccountsRenderInput {
	data: AccountsListData;
	period: '7d' | '30d' | '90d' | 'all';
	user?: SessionUser;
}

function modelChip(model: string): string {
	return `<span class="chip model">${esc(modelLabel(model))}</span>`;
}

function gridCard(a: AccountsListData['accounts'][number]): string {
	const color = avatarColor(a.email);
	const dark = shadeHex(color, -25);
	const stat = accountStatus(a.lastSeen);
	const search = `${a.email.toLowerCase()} ${emailDomain(a.email).toLowerCase()}`;
	const url = `/account?identity=${encodeURIComponent(a.email)}`;
	const topModel = a.topModels[0] ?? '—';
	return `<a class="acct-card" data-email="${esc(a.email)}" data-search="${esc(search)}" href="${url}">
		<div class="top">
			<div class="avatar" style="background:linear-gradient(135deg, ${color}, ${dark});">${esc(initials(a.email))}</div>
			<div style="flex:1;min-width:0;">
				<div class="email">${esc(a.email)}</div>
				<div class="domain">${esc(emailDomain(a.email))}</div>
			</div>
		</div>
		<div class="metrics">
			<div class="metric">
				<div class="lbl">Total Cost</div>
				<div class="val money">$${num(a.cost, 4)}</div>
			</div>
			<div class="metric">
				<div class="lbl">API Calls</div>
				<div class="val">${num(a.calls)}</div>
			</div>
			<div class="metric">
				<div class="lbl">Tokens</div>
				<div class="val">${esc(compactNum(a.tokens))}</div>
			</div>
			<div class="metric">
				<div class="lbl">Top Model</div>
				<div class="val" style="font-size:13px;font-weight:700;color:var(--ink-2);">${esc(modelLabel(topModel))}</div>
			</div>
		</div>
		<div class="footer">
			<div class="top-models">${a.topModels.slice(0, 3).map(modelChip).join('')}</div>
			<div class="last-seen"><span class="pulse-mini ${stat}"></span>${esc(relativeTimeTh(a.lastSeen))}</div>
		</div>
	</a>`;
}

function tableRow(a: AccountsListData['accounts'][number]): string {
	const color = avatarColor(a.email);
	const dark = shadeHex(color, -25);
	const stat = accountStatus(a.lastSeen);
	const search = `${a.email.toLowerCase()} ${emailDomain(a.email).toLowerCase()}`;
	const url = `/account?identity=${encodeURIComponent(a.email)}`;
	const topModel = a.topModels[0] ?? '—';
	return `<tr data-email="${esc(a.email)}" data-search="${esc(search)}" onclick="location.href='${url}'">
		<td>
			<div class="acct-cell">
				<div class="avatar" style="background:linear-gradient(135deg, ${color}, ${dark});">${esc(initials(a.email))}</div>
				<div class="col">
					<div class="email-lg">${esc(a.email)}</div>
					<div class="email-sm">${esc(emailDomain(a.email))}</div>
				</div>
			</div>
		</td>
		<td class="mono" style="font-weight:600;">${num(a.calls)}</td>
		<td class="mono" style="font-weight:600;">${esc(compactNum(a.tokens))}</td>
		<td>${modelChip(topModel)}</td>
		<td style="color:var(--ink-2);"><span class="pulse-mini ${stat}" style="margin-right:6px;"></span>${esc(relativeTimeTh(a.lastSeen))}</td>
		<td class="money-cell">$${num(a.cost, 4)}</td>
	</tr>`;
}

export function renderAccounts(input: AccountsRenderInput): string {
	const { data, period } = input;
	const periodLabelMap: Record<string, string> = { '7d': '7 วัน', '30d': '30 วัน', '90d': '90 วัน', 'all': 'ทั้งหมด' };

	const gridCards = data.accounts.map(gridCard).join('');
	const tableRows = data.accounts.map(tableRow).join('');

	const avgCallsPerAcct = data.totalAccounts > 0 ? Math.round(data.totalCalls / data.totalAccounts) : 0;
	const avgCost = data.totalAccounts > 0 ? data.totalSpend / data.totalAccounts : 0;

	const emptyState = data.accounts.length === 0
		? `<div class="empty-state">ยังไม่มี account ที่มีกิจกรรมในช่วงที่เลือก</div>`
		: '';

	const accountsData = JSON.stringify(data.accounts.map(a => ({
		email: a.email, calls: a.calls, cost: a.cost, lastSeen: a.lastSeen,
	})));

	const exportUrl = '/export?date_from=' + new Date(Date.now() - daysFromPeriod(period) * 86400000).toISOString().slice(0, 10)
		+ '&date_to=' + new Date().toISOString().slice(0, 10);

	const replacements: Record<string, string> = {
		'{{clientJs}}':  clientJs,
		'{{activeAccounts}}': num(data.activeAccounts),
		'{{totalAccounts}}':  num(data.totalAccounts),
		'{{totalSpend}}':     '$' + num(data.totalSpend, 4),
		'{{totalCalls}}':     num(data.totalCalls),
		'{{avgCallsPerAcct}}': num(avgCallsPerAcct),
		'{{avgCost}}':        '$' + num(avgCost, 4),
		'{{periodLabel}}':    periodLabelMap[period] ?? '30 วัน',
		'{{period7dOn}}':  period === '7d'  ? ' class="on"' : '',
		'{{period30dOn}}': period === '30d' ? ' class="on"' : '',
		'{{period90dOn}}': period === '90d' ? ' class="on"' : '',
		'{{periodAllOn}}': period === 'all' ? ' class="on"' : '',
		'{{gridCards}}':  gridCards,
		'{{tableRows}}':  tableRows,
		'{{emptyState}}': emptyState,
		'{{accountsData}}': accountsData,
		'{{exportUrl}}':  exportUrl,
	};

	let content = html;
	for (const [k, v] of Object.entries(replacements)) content = content.split(k).join(v);

	return renderLayout({
		activeNav: 'accounts',
		user: input.user,
		pageTitle: 'Accounts',
		pageSubtitle: 'รายชื่อ account ทั้งหมดที่เชื่อมต่อ Claude API พร้อมสรุปการใช้งาน',
		content,
		pageCss,
		title: 'Accounts — SDB AI Insight',
	});
}

function daysFromPeriod(p: string): number {
	if (p === '7d') return 7;
	if (p === '90d') return 90;
	if (p === 'all') return 365 * 5;
	return 30;
}
