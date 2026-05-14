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
})();
