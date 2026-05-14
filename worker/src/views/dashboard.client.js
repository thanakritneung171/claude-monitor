// Period seg
document.querySelectorAll('#periodSeg button').forEach(b => b.addEventListener('click', () => {
	const v = b.dataset.period;
	document.getElementById('period').value = v;
	if (v === 'daily')   { document.getElementById('df').value = D_TODAY; document.getElementById('dt').value = D_TODAY; }
	else if (v === 'monthly') { document.getElementById('df').value = D_MONTH; document.getElementById('dt').value = D_TODAY; }
	else if (v === 'yearly')  { document.getElementById('df').value = D_YEAR;  document.getElementById('dt').value = D_TODAY; }
	document.getElementById('ff').submit();
}));

// Rows per page seg
document.querySelectorAll('#pageSizeSeg button').forEach(b => b.addEventListener('click', () => {
	document.getElementById('pph').value = b.dataset.size;
	document.getElementById('ff').submit();
}));

// Modal
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');

function openPromptModal(text) {
	modalTitle.textContent = 'Full Prompt';
	modalBody.classList.add('prompt-body');
	modalBody.textContent = text;
	modal.classList.add('open');
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const BAR_COLORS = ['#F47948', '#FF9466', '#FFB088', '#FFD1B3', '#FFE4D2'];

function openBreakdownModal(cat) {
	const items = BREAKDOWN_ALL[cat] || [];
	const titleMap = { model: 'All Models', account: 'All Accounts', client: 'All Clients' };
	modalTitle.textContent = titleMap[cat] || 'All';
	modalBody.classList.remove('prompt-body');
	if (items.length === 0) {
		modalBody.innerHTML = '<div style="color:var(--ink-3);text-align:center;padding:20px;">ไม่มีข้อมูล</div>';
	} else {
		const max = Math.max.apply(null, items.map(i => i.cost || 0).concat([1]));
		modalBody.innerHTML = items.map((it, i) => {
			var color = it.color || BAR_COLORS[i % BAR_COLORS.length];
			var nameHtml;
			if (cat === 'model') {
				nameHtml = '<span class="chip" style="background:' + color + ';color:#1F2937">' + escapeHtml(it.name) + '</span>';
			} else if (cat === 'client') {
				nameHtml = '<span class="chip" style="background:' + color + ';color:#fff;box-shadow:0 2px 8px ' + color + '55">' + escapeHtml(it.name) + '</span>';
			} else {
				nameHtml = '<span class="swatch" style="background:' + color + '"></span>' + escapeHtml(it.name);
			}
			const pct = Math.max(2, ((it.cost || 0) / max) * 100);
			var linkBtn = (cat === 'account' && it.name && it.name !== '—')
				? '<a href="/account?email=' + encodeURIComponent(it.name) + '" class="bar-link-btn">ดูรายละเอียด →</a>'
				: '';
			return '<div class="bar-row">' +
				'<div class="name">' + nameHtml + '</div>' +
				'<div class="num"><span>' + it.n.toLocaleString('en-US') + ' calls</span><strong>$' + (it.cost || 0).toFixed(4) + '</strong>' + linkBtn + '</div>' +
				'<div class="bar-track"><div class="bar-fill" style="width:' + pct.toFixed(1) + '%;background:' + color + '"></div></div>' +
			'</div>';
		}).join('');
	}
	modal.classList.add('open');
}

function closeModal() { modal.classList.remove('open'); }
document.getElementById('modalClose').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

document.querySelectorAll('#logsTableBody tr[data-full]').forEach(tr => {
	tr.addEventListener('click', () => openPromptModal(tr.dataset.full));
});
document.querySelectorAll('#logsCards .log-card[data-full]').forEach(c => {
	c.addEventListener('click', () => openPromptModal(c.dataset.full));
});

document.querySelectorAll('.show-more').forEach(btn => {
	btn.addEventListener('click', () => openBreakdownModal(btn.dataset.cat));
});

// Animate bar fills to their target width
requestAnimationFrame(() => {
	document.querySelectorAll('.bar-row > .bar-track .bar-fill').forEach(b => {
		const pct = b.dataset.pct;
		if (pct) b.style.width = pct + '%';
	});
});

// Live clock (Asia/Bangkok)
function tick() {
	const t = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' });
	const el = document.getElementById('lastUpdate');
	if (el) el.textContent = t;
}
tick(); setInterval(tick, 1000);

// Preserve filter params during auto-refresh
setTimeout(() => location.replace(location.href), 15000);
