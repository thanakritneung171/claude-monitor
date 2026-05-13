(function () {
	// Simple visual toggle (form posts on change for persistence)
	document.querySelectorAll('.switch[data-key]').forEach(function (sw) {
		sw.addEventListener('click', function () {
			sw.classList.toggle('on');
			var form = document.getElementById('notif-form');
			if (form) form.submit();
		});
	});
})();
