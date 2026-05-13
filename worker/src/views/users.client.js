(function () {
	var dlg = document.getElementById('inviteDlg');
	var openBtn = document.getElementById('btnInvite');
	var closeBtn = document.getElementById('btnInviteCancel');
	if (!dlg) return;

	if (openBtn) {
		openBtn.addEventListener('click', function () {
			if (typeof dlg.showModal === 'function') dlg.showModal();
			else dlg.setAttribute('open', '');
		});
	}
	if (closeBtn) {
		closeBtn.addEventListener('click', function (e) {
			e.preventDefault();
			if (typeof dlg.close === 'function') dlg.close();
			else dlg.removeAttribute('open');
		});
	}
})();
