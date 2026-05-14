(function () {
	var KEY = 'sdb-sb-collapsed';
	var sb = document.getElementById('sidebar');
	var shell = document.getElementById('shell');
	var sbToggle = document.getElementById('sbToggle'); // in topbar — desktop & mobile
	if (!sb || !shell) return;

	function apply(collapsed) {
		if (collapsed) {
			sb.classList.add('collapsed');
			shell.classList.add('collapsed');
		} else {
			sb.classList.remove('collapsed');
			shell.classList.remove('collapsed');
		}
	}

	try {
		apply(localStorage.getItem(KEY) === '1');
	} catch (e) { /* ignore */ }

	// Toggle: desktop = collapse/expand, mobile = overlay open/close
	if (sbToggle) {
		sbToggle.addEventListener('click', function () {
			if (window.matchMedia('(max-width: 900px)').matches) {
				sb.classList.toggle('mobile-open');
			} else {
				var nowCollapsed = !sb.classList.contains('collapsed');
				apply(nowCollapsed);
				try { localStorage.setItem(KEY, nowCollapsed ? '1' : '0'); } catch (e) { /* ignore */ }
			}
		});
	}

	// Fetch /api/me to populate avatar initial
	fetch('/api/me', { credentials: 'same-origin' })
		.then(function (r) { return r.ok ? r.json() : null; })
		.then(function (j) {
			if (!j || !j.user || !j.user.email) return;
			var initial = j.user.email.trim().charAt(0).toUpperCase();
			var avs = document.querySelectorAll('[data-avatar-initial]');
			for (var i = 0; i < avs.length; i++) {
				if (!avs[i].textContent.trim()) avs[i].textContent = initial;
			}
		})
		.catch(function () { /* ignore */ });

	// tbSearch — live filter table rows + mobile cards
	var tbSearch = document.getElementById('tbSearch');
	if (tbSearch) {
		// Ctrl+K / ⌘K to focus search
		document.addEventListener('keydown', function (e) {
			if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
				e.preventDefault();
				tbSearch.focus();
				tbSearch.select();
			}
			if (e.key === 'Escape' && document.activeElement === tbSearch) {
				tbSearch.value = '';
				tbSearch.blur();
				tbSearch.dispatchEvent(new Event('input'));
			}
		});

		tbSearch.addEventListener('input', function () {
			var q = this.value.trim().toLowerCase();
			var rows = document.querySelectorAll('#logsTableBody tr');
			var cards = document.querySelectorAll('#logsCards .log-card');
			rows.forEach(function (tr) {
				tr.style.display = (!q || tr.textContent.toLowerCase().includes(q)) ? '' : 'none';
			});
			cards.forEach(function (card) {
				card.style.display = (!q || card.textContent.toLowerCase().includes(q)) ? '' : 'none';
			});
			// show empty-state if all rows hidden
			var logsBody = document.getElementById('logsTableBody');
			if (logsBody) {
				var anyVisible = Array.from(rows).some(function (r) { return r.style.display !== 'none'; });
				var empty = document.getElementById('tbSearchEmpty');
				if (!anyVisible && q) {
					if (!empty) {
						empty = document.createElement('tr');
						empty.id = 'tbSearchEmpty';
						empty.innerHTML = '<td colspan="10" style="text-align:center;padding:32px;color:var(--ink-3);font-size:13px;">ไม่พบข้อมูลที่ตรงกับ &ldquo;' + q.replace(/[<>"'&]/g, '') + '&rdquo;</td>';
						logsBody.appendChild(empty);
					}
				} else if (empty) {
					empty.remove();
				}
			}
		});
	}

	// Avatar dropdown
	var avatarBtn = document.getElementById('avatarBtn');
	var avatarDrop = document.getElementById('avatarDrop');
	var avatarMenu = document.getElementById('avatarMenu');
	if (avatarBtn && avatarMenu) {
		avatarBtn.addEventListener('click', function (e) {
			e.stopPropagation();
			avatarMenu.classList.toggle('open');
		});
		document.addEventListener('click', function () {
			avatarMenu.classList.remove('open');
		});
		if (avatarDrop) {
			avatarDrop.addEventListener('click', function (e) { e.stopPropagation(); });
		}
	}
})();
