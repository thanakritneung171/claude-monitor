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
function openModal(text) {
	document.getElementById('modalBody').textContent = text;
	modal.classList.add('open');
}
function closeModal() { modal.classList.remove('open'); }
document.getElementById('modalClose').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

document.querySelectorAll('#logsTableBody tr[data-full]').forEach(tr => {
	tr.addEventListener('click', () => openModal(tr.dataset.full));
});
document.querySelectorAll('#logsCards .log-card[data-full]').forEach(c => {
	c.addEventListener('click', () => openModal(c.dataset.full));
});

// Animate bar fills
requestAnimationFrame(() => {
	document.querySelectorAll('.bar-fill').forEach(b => { b.style.width = (b.dataset.pct || '0') + '%'; });
});

// Trend chart
(function () {
	const svg = document.getElementById('trendChart');
	if (!svg || !TREND_DATA.length) return;
	const w = 600, h = 200, pad = 16;
	const maxC = Math.max.apply(null, TREND_DATA);
	const range = maxC > 0 ? maxC : 1;
	const n = TREND_DATA.length;
	const pts = TREND_DATA.map((c, i) => {
		const x = pad + (n === 1 ? (w - pad * 2) / 2 : (i / (n - 1)) * (w - pad * 2));
		const y = h - pad - (c / range) * (h - pad * 2);
		return [x, y];
	});
	const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
	const area = path + ' L' + pts[pts.length - 1][0] + ',' + (h - pad) + ' L' + pts[0][0] + ',' + (h - pad) + ' Z';
	svg.innerHTML =
		'<defs><linearGradient id="grad" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#FF9466" stop-opacity="0.4"/><stop offset="100%" stop-color="#FFB088" stop-opacity="0"/></linearGradient></defs>' +
		'<path d="' + area + '" fill="url(#grad)"/>' +
		'<path d="' + path + '" fill="none" stroke="#F47948" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
		pts.map(p => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.5" fill="white" stroke="#F47948" stroke-width="2"/>').join('');
})();

// Live clock (Asia/Bangkok)
function tick() {
	const t = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' });
	const el = document.getElementById('lastUpdate');
	if (el) el.textContent = t;
}
tick(); setInterval(tick, 1000);

// Preserve filter params during auto-refresh
setTimeout(() => location.replace(location.href), 15000);
