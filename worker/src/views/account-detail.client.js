// Modal
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modalBody');
function openModal(text) {
	modalBody.textContent = text;
	modal.classList.add('open');
}
document.getElementById('modalClose').addEventListener('click', () => modal.classList.remove('open'));
modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') modal.classList.remove('open'); });

document.querySelectorAll('[data-full]').forEach(el => {
	el.addEventListener('click', () => openModal(el.dataset.full));
});

// Animate bar fills
requestAnimationFrame(() => {
	document.querySelectorAll('.bar-fill[data-pct]').forEach(b => {
		b.style.width = b.dataset.pct + '%';
	});
});

// Cost trend sparkline
(function trend() {
	const svg = document.getElementById('trend');
	if (!svg || !TREND_DATA || !TREND_DATA.length) return;
	const w = 600, h = 200, pad = 12;
	const max = Math.max.apply(null, TREND_DATA.map(p => p.cost).concat([0.0001]));
	const n = TREND_DATA.length;
	const pts = TREND_DATA.map((p, i) => {
		const x = pad + (n === 1 ? (w - pad * 2) / 2 : (i / (n - 1)) * (w - pad * 2));
		const y = h - pad - (p.cost / max) * (h - pad * 2);
		return [x, y];
	});
	const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
	const area = path + ' L' + pts[pts.length - 1][0] + ',' + (h - pad) + ' L' + pts[0][0] + ',' + (h - pad) + ' Z';
	const dotEvery = Math.max(1, Math.floor(n / 8));
	svg.innerHTML =
		'<defs><linearGradient id="g1" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#FF9466" stop-opacity="0.4"/><stop offset="100%" stop-color="#FFB088" stop-opacity="0"/></linearGradient></defs>' +
		'<path d="' + area + '" fill="url(#g1)"/>' +
		'<path d="' + path + '" fill="none" stroke="#F47948" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
		pts.map((p, i) => (i % dotEvery === 0) ? '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" fill="white" stroke="#F47948" stroke-width="2"/>' : '').join('');
})();

// Token donut
(function donut() {
	const svg = document.getElementById('donut');
	if (!svg || !TOKEN_MIX || !TOKEN_MIX.length) return;
	const total = TOKEN_MIX.reduce((s, x) => s + x.value, 0);
	if (total === 0) return;
	const r = 40, c = 50, circ = 2 * Math.PI * r;
	let offset = 0;
	let segs = '';
	TOKEN_MIX.forEach(s => {
		const len = (s.value / total) * circ;
		segs += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="' + s.color + '" stroke-width="14" stroke-dasharray="' + len + ' ' + (circ - len) + '" stroke-dashoffset="' + (-offset) + '"/>';
		offset += len;
	});
	svg.innerHTML = segs;
})();

// Heatmap
(function heatmap() {
	const el = document.getElementById('heatmap');
	if (!el || !HEATMAP_DATA) return;
	const days = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
	const max = Math.max.apply(null, HEATMAP_DATA.map(c => c.n).concat([1]));
	let html = '<div class="h-label"></div>';
	for (let h = 0; h < 24; h++) html += '<div class="h-label">' + h + '</div>';
	for (let d = 0; d < 7; d++) {
		html += '<div class="day-label">' + days[d] + '</div>';
		for (let h = 0; h < 24; h++) {
			const cell = HEATMAP_DATA.find(c => c.dow === d && c.hour === h);
			const n = cell ? cell.n : 0;
			const v = n / max;
			let bg = 'var(--peach-50)';
			if (v > 0.75) bg = 'var(--peach-500)';
			else if (v > 0.55) bg = 'var(--peach-300)';
			else if (v > 0.35) bg = 'var(--peach-200)';
			else if (v > 0.15) bg = 'var(--peach-100)';
			else if (n > 0) bg = 'var(--peach-100)';
			html += '<div class="cell" style="background:' + bg + ';" title="' + days[d] + ' ' + String(h).padStart(2, '0') + ':00 · ' + n + ' calls"></div>';
		}
	}
	el.innerHTML = html;
})();
