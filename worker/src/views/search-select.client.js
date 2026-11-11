// Shared searchable select (ใช้ร่วมกันทุกหน้า: Dashboard, Logs, …)
// วิธีใช้: <div class="select-wrap"><select class="select js-search-select" name="…">…</select></div>
// CSS อยู่ใน shared.css (.ss-*)
// Searchable select — enhance <select.js-search-select> with a filterable dropdown.
// The native <select> stays in the DOM (hidden) so the form still submits its value.
document.querySelectorAll('select.js-search-select').forEach(function(sel) {
	var wrap = sel.parentElement; // .select-wrap (position: relative, keeps the chevron)
	sel.classList.add('ss-native');

	var btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'select ss-btn';
	btn.setAttribute('aria-haspopup', 'listbox');
	btn.setAttribute('aria-expanded', 'false');
	var labelSpan = document.createElement('span');
	labelSpan.className = 'ss-label';
	btn.appendChild(labelSpan);

	var panel = document.createElement('div');
	panel.className = 'ss-panel';
	var searchWrap = document.createElement('div');
	searchWrap.className = 'ss-search';
	var search = document.createElement('input');
	search.type = 'text';
	search.placeholder = 'ค้นหา...';
	search.setAttribute('autocomplete', 'off');
	searchWrap.appendChild(search);
	var list = document.createElement('ul');
	list.className = 'ss-list';
	list.setAttribute('role', 'listbox');
	panel.appendChild(searchWrap);
	panel.appendChild(list);
	wrap.appendChild(btn);
	wrap.appendChild(panel);

	var options = Array.prototype.map.call(sel.options, function(o) {
		return { value: o.value, text: o.textContent };
	});
	var visible = [];
	var active = -1;

	function syncLabel() {
		var o = sel.options[sel.selectedIndex];
		labelSpan.textContent = o ? o.textContent : '';
	}
	syncLabel();

	function renderList(q) {
		list.innerHTML = '';
		visible = [];
		active = -1;
		var ql = q.trim().toLowerCase();
		options.forEach(function(opt) {
			if (ql && opt.text.toLowerCase().indexOf(ql) === -1) return;
			var li = document.createElement('li');
			li.className = 'ss-opt';
			li.setAttribute('role', 'option');
			li.textContent = opt.text;
			if (opt.value === sel.value) li.classList.add('sel');
			li.addEventListener('mousedown', function(e) {
				e.preventDefault(); // keep focus on search input
				choose(opt.value);
			});
			list.appendChild(li);
			visible.push({ value: opt.value, li: li });
		});
		if (visible.length === 0) {
			var empty = document.createElement('li');
			empty.className = 'ss-empty';
			empty.textContent = 'ไม่พบรายการ';
			list.appendChild(empty);
		}
	}

	function setActive(i) {
		visible.forEach(function(v, idx) { v.li.classList.toggle('active', idx === i); });
		active = i;
		if (visible[i]) visible[i].li.scrollIntoView({ block: 'nearest' });
	}

	function choose(value) {
		sel.value = value;
		syncLabel();
		close();
	}

	function open() {
		renderList('');
		search.value = '';
		panel.classList.add('open');
		btn.setAttribute('aria-expanded', 'true');
		search.focus();
	}
	function close() {
		panel.classList.remove('open');
		btn.setAttribute('aria-expanded', 'false');
	}

	btn.addEventListener('click', function() {
		panel.classList.contains('open') ? close() : open();
	});
	search.addEventListener('input', function() { renderList(search.value); });
	search.addEventListener('keydown', function(e) {
		if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(active + 1, visible.length - 1)); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
		else if (e.key === 'Enter') {
			e.preventDefault();
			if (active >= 0 && visible[active]) choose(visible[active].value);
			else if (visible.length === 1) choose(visible[0].value);
		} else if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); }
	});
	document.addEventListener('click', function(e) {
		if (!wrap.contains(e.target)) close();
	});
});
