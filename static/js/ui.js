// UI event handlers

function toggleAutoRefresh() {
  clientState.autoRefresh = !clientState.autoRefresh;
  var btn = document.getElementById('btn-auto');
  if (clientState.autoRefresh) {
    btn.textContent = 'Stop Auto';
    btn.style.backgroundColor = 'red';
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadClients, 3000);
  } else {
    btn.textContent = 'Auto Refresh';
    btn.style.backgroundColor = '';
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function toggleLockdown(duration) {
  var body = 'action=on';
  if (duration) {
    body += '&duration=' + encodeURIComponent(duration);
  }
  body += '&performer=' + encodeURIComponent(authSession.currentLabel || '');
  fetch(ROUTES.lockdown, {method: 'POST', body: body, headers: {'Content-Type': 'application/x-www-form-urlencoded'}})
    .then(function(r) { return r.json(); })
    .then(function() {
      loadClients();
      updateLockdownBtn();
    });
}

function disableLockdown() {
  if (!pass('lockdown')) return;
  fetch(ROUTES.lockdown, {method: 'POST', body: 'action=off&performer=' + encodeURIComponent(authSession.currentLabel || ''), headers: {'Content-Type': 'application/x-www-form-urlencoded'}})
    .then(function(r) { return r.json(); })
    .then(function() {
      loadClients();
      updateLockdownBtn();
    });
}

function promptLockdown() {
  if (!pass('lockdown')) return;
  var duration = prompt("Enter lockdown duration in minutes (leave empty for indefinite):", "7");
  if (duration === null) return;
  toggleLockdown(duration || '');
}

function updateLockdownBtn() {
  fetch(ROUTES.lockdownJson).then(function(r) { return r.json(); }).then(function(d) {
    lockdownState.active = !!d.active;
    lockdownState.unlockTime = d.unlock_time || null;
    var btn = document.getElementById('btn-lockdown');
    if (!btn) return;
    if (d.active) {
      if (d.unlock_time) {
        var remaining = Math.max(0, Math.round((d.unlock_time - Date.now()) / 1000 / 60));
        btn.textContent = 'LOCKED (' + remaining + 'm)';
      } else {
        btn.textContent = 'UNLOCK';
      }
      btn.style.backgroundColor = 'green';
    } else {
      btn.textContent = 'LOCKDOWN';
      btn.style.backgroundColor = '#ff00ff';
    }
  });
}

// Table click delegation
function initTableListeners() {
  var clientsTable = document.getElementById('clientsTable');
  if (!clientsTable) return;
  clientsTable.addEventListener('click', function(e) {
    var btn = e.target;
    var td = btn.closest('td');
    if (!td) return;
    var user = td.getAttribute('data-user');
    if (!user) return;
    if (btn.classList.contains('btn-ban')) {
      if (!pass('ban')) return;
      banClient(btn);
    } else if (btn.classList.contains('btn-unban')) {
      if (!pass('unban')) return;
      unbanClient(btn);
    } else if (btn.classList.contains('btn-toggle-ban')) {
      if (!pass('toggleBan')) return;
      toggleBan(btn);
    } else if (btn.classList.contains('btn-delete')) {
      deleteClient(btn);
    } else if (btn.classList.contains('btn-redirect')) {
      var url = td.querySelector('.inp-url').value;
      if (!pass('redirect')) return;
      sendRedirect(btn, url);
    } else if (btn.classList.contains('btn-msg')) {
      var msg = td.querySelector('.inp-msg').value;
      if (!pass('message')) return;
      sendMessage(btn, msg);
    } else if (btn.classList.contains('btn-img')) {
      if (!pass('image')) return;
      var f = td.querySelector('.inp-img').files[0];
      if (f) {
        var fd = new FormData();
        fd.append('username', user);
        fd.append('image_file', f);
        fetch(ROUTES.clientImage, {method: 'POST', body: fd}).then(loadClients);
      }
    } else if (btn.classList.contains('btn-effect')) {
      if (!pass('effect')) return;
      sendEffect(btn, td.querySelector('.inp-effect').value);
    } else if (btn.classList.contains('btn-effect-clear')) {
      if (!pass('effect')) return;
      sendEffect(btn, '');
    } else if (btn.classList.contains('btn-note')) {
      if (!pass('notes')) return;
      sendNote(btn, td.querySelector('.inp-note').value);
    } else if (btn.classList.contains('btn-question')) {
      if (!pass('question')) return;
      sendQuestion(btn, td.querySelector('.inp-question').value);
    } else if (btn.classList.contains('btn-clear-question')) {
      if (!pass('question')) return;
      sendQuestion(btn, '');
    } else if (btn.classList.contains('btn-timeout')) {
      if (!pass('timeout')) return;
      sendTimeout(btn, td.querySelector('.inp-timeout-duration').value, td.querySelector('.inp-timeout-reason').value);
    } else if (btn.classList.contains('btn-timeout-clear') || btn.classList.contains('btn-untimeout')) {
      if (!pass('untimeout')) return;
      clearClientTimeout(btn);
    }
  });
}

function initFilterSortListeners() {
  document.getElementById('filterSelect')?.addEventListener('change', function(e) {
    clientState.filter = e.target.value;
    loadClients();
  });

  document.getElementById('sortSelect')?.addEventListener('change', function(e) {
    clientState.sortBy = e.target.value;
    loadClients();
  });
}
