// View toggle (grid / list)
const viewToggle = document.getElementById('viewToggle');
if (viewToggle) {
	viewToggle.addEventListener('click', e => {
		const b = e.target.closest('button');
		if (!b) return;
		viewToggle.querySelectorAll('button').forEach(x => x.classList.remove('on'));
		b.classList.add('on');
		document.body.classList.toggle('list-mode', b.dataset.view === 'list');
	});
}

// Search filter
const searchInput = document.getElementById('searchInput');
if (searchInput) {
	searchInput.addEventListener('input', () => {
		const q = searchInput.value.trim().toLowerCase();
		document.querySelectorAll('#grid > [data-search]').forEach(el => {
			el.style.display = (q === '' || el.dataset.search.includes(q)) ? '' : 'none';
		});
		document.querySelectorAll('#tableBody > tr[data-search]').forEach(el => {
			el.style.display = (q === '' || el.dataset.search.includes(q)) ? '' : 'none';
		});
	});
}

// Sort
const sortSelect = document.getElementById('sortSelect');
if (sortSelect) {
	sortSelect.addEventListener('change', () => {
		const key = sortSelect.value;
		const cmp = (a, b) => {
			if (key === 'email') return a.email.localeCompare(b.email);
			if (key === 'lastSeen') return b.lastSeen - a.lastSeen;
			if (key === 'calls') return b.calls - a.calls;
			return b.cost - a.cost;
		};
		const sorted = ACCOUNTS_DATA.slice().sort(cmp);
		const grid = document.getElementById('grid');
		const tbody = document.getElementById('tableBody');
		const gridMap = {};
		grid.querySelectorAll('[data-email]').forEach(el => gridMap[el.dataset.email] = el);
		const tableMap = {};
		tbody.querySelectorAll('[data-email]').forEach(el => tableMap[el.dataset.email] = el);
		sorted.forEach(a => {
			if (gridMap[a.email]) grid.appendChild(gridMap[a.email]);
			if (tableMap[a.email]) tbody.appendChild(tableMap[a.email]);
		});
	});
}

// Live clock (Asia/Bangkok)
function tick() {
	const t = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' });
	const el = document.getElementById('lastUpdate');
	if (el) el.textContent = t;
}
tick(); setInterval(tick, 1000);
