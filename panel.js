var clientState = {
  clients: {},
  filter: 'all',
  sortBy: 'recent',
  autoRefresh: false,
  autoRefreshInterval: null
};

var lockdownState = { active: false };
var currentEffect = '';
var effectStyleNode = null;
var frenchObserver = null;
var frenchTextMap = new WeakMap();
var frenchPlaceholderMap = new WeakMap();
var requestSeq = 0;
var refreshTimer = null;

var ROUTE_KEY = 'manger';

function decodeRoute(hex) {
  var out = '';
  for (var i = 0; i < hex.length; i += 2) {
    var value = parseInt(hex.slice(i, i + 2), 16);
    var keyCode = ROUTE_KEY.charCodeAt((i / 2) % ROUTE_KEY.length);
    out += String.fromCharCode(value ^ keyCode);
  }
  return out;
}

function encodeRouteValue(text) {
  var value = String(text || '');
  var out = '';
  for (var i = 0; i < value.length; i++) {
    var keyCode = ROUTE_KEY.charCodeAt(i % ROUTE_KEY.length);
    var encoded = value.charCodeAt(i) ^ keyCode;
    out += ('0' + encoded.toString(16)).slice(-2);
  }
  return out;
}

var ROUTES = Object.freeze({
  clientsJson: '/clients.json',
  clientBan: '/clients/ban',
  clientUnban: '/clients/unban',
  clientDelete: '/clients/delete',
  clientMessage: '/clients/message',
  clientQuestion: '/clients/question',
  clientTimeout: '/clients/timeout',
  clientTimeoutClear: '/clients/timeout/clear',
  clientRedirect: '/clients/redirect',
  clientEffect: '/clients/effect',
  clientNote: '/clients/note',
  clientImage: '/clients/image',
  lockdown: '/lockdown',
  lockdownJson: '/lockdown.json'
});

function loadClients() {
  var current = ++requestSeq;
  return fetch(ROUTES.clientsJson + '?_=' + Date.now(), { cache: 'no-store' })
    .then(function(r) {
      if (!r.ok) throw new Error('Failed to load clients');
      return r.json();
    })
    .then(function(data) {
      if (current !== requestSeq) return data;
      renderClients(data);
      return data;
    })
    .catch(function(err) {
      console.error(err);
      if (current === requestSeq) {
        var stats = document.getElementById('clientStats');
        if (stats) stats.textContent = 'Unable to load clients';
      }
      throw err;
    });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function effectLabel(effect) {
  var map = {
    '': 'No Effect',
    invert: 'Invert Colors',
    mirror: 'Mirror Flip',
    sepia: 'Sepia',
    gray: 'Grayscale',
    comic: 'Comic Mode',
    zoom: 'Zoom Pop',
    blur: 'Blur',
    neon: 'Neon Glow',
    scanlines: 'Scanlines',
    pulse: 'Pulse',
    spn: 'SPN Screen'
  };
  return map[effect] || 'No Effect';
}

function effectOptionsHtml(selected) {
  var EFFECTS = [
    { value: '', label: 'No Effect' },
    { value: 'invert', label: 'Invert Colors' },
    { value: 'mirror', label: 'Mirror Flip' },
    { value: 'sepia', label: 'Sepia' },
    { value: 'gray', label: 'Grayscale' },
    { value: 'comic', label: 'Comic Mode' },
    { value: 'zoom', label: 'Zoom Pop' },
    { value: 'blur', label: 'Blur' },
    { value: 'neon', label: 'Neon Glow' },
    { value: 'scanlines', label: 'Scanlines' },
    { value: 'pulse', label: 'Pulse' },
    { value: 'spn', label: 'SPN Screen' }
  ];
  return EFFECTS.map(function(effect) {
    return '<option value="' + effect.value + '"' + (effect.value === selected ? ' selected' : '') + '>' + effect.label + '</option>';
  }).join('');
}

function formatDurationLabel(seconds) {
  seconds = Math.max(0, Math.floor(seconds || 0));
  var minutes = Math.floor(seconds / 60);
  var remainder = seconds % 60;
  if (minutes > 0) {
    return minutes + 'm ' + String(remainder).padStart(2, '0') + 's';
  }
  return remainder + 's';
}

function renderClients(clients) {
  clientState.clients = clients;
  var table = document.getElementById('clientsTable');
  var existingRows = {};
  table.querySelectorAll('tr').forEach(function(row) {
    var username = row.cells[0]?.textContent;
    if (username) existingRows[username] = row;
  });

  var filtered = Object.entries(clients);

  if (clientState.filter === 'active') {
    filtered = filtered.filter(function(entry) { return !entry[1].banned && entry[1].recent; });
  } else if (clientState.filter === 'banned') {
    filtered = filtered.filter(function(entry) { return entry[1].banned; });
  } else if (clientState.filter === 'inactive') {
    filtered = filtered.filter(function(entry) { return !entry[1].recent; });
  }

  if (clientState.sortBy === 'recent') {
    filtered.sort(function(a, b) { return (b[1].last_ping || '').localeCompare(a[1].last_ping || ''); });
  } else if (clientState.sortBy === 'name') {
    filtered.sort(function(a, b) { return a[0].localeCompare(b[0]); });
  } else if (clientState.sortBy === 'url') {
    filtered.sort(function(a, b) { return (a[1].current_url || '').localeCompare(b[1].current_url || ''); });
  }

  var activeCount = Object.values(clients).filter(function(d) { return !d.banned && d.recent; }).length;
  var bannedCount = Object.values(clients).filter(function(d) { return d.banned; }).length;
  var timeoutCount = Object.values(clients).filter(function(d) { return d.timeout_active; }).length;
  var totalCount = Object.keys(clients).length;

  table.innerHTML = '<tr><th>Username</th><th>Status</th><th>Last Ping</th><th>Current URL</th><th>Effect</th><th>Question</th><th>Response</th><th>Actions</th></tr>';

  filtered.forEach(function(entry) {
    var user = entry[0];
    var data = entry[1];
    var row = document.createElement('tr');
    row.className = data.recent ? 'recent' : 'inactive';
    var statusText = '';

    var statusInfo = '';
    var statusBg = '';
    if (data.banned) {
      statusInfo = '<span style="color:blue;font-weight:bold;">Banned</span>';
      statusBg = '#ccddff';
    } else if (data.timeout_active) {
      statusInfo = '<span style="color:orange;font-weight:bold;">Timeout ' + formatDurationLabel(data.timeout_remaining_seconds || 0) + '</span>';
      statusBg = '#ffe4b5';
    }
    if (statusInfo) {
      var onlineStatus = data.recent ? 'Online' : 'Offline';
      statusText = '<span style="color:' + (data.recent ? 'green' : 'gray') + ';">' + onlineStatus + '</span> (' + statusInfo + ')';
      row.style.backgroundColor = statusBg;
    } else {
      statusText = (data.recent ? '<span style="color:green;">Active</span>' : 'Inactive');
    }

    var existing = existingRows[user];
    var effectValue = existing ? (existing.querySelector('.inp-effect')?.value || data.effect || '') : (data.effect || '');
    var urlVal = existing ? (existing.querySelector('.inp-url')?.value || '') : '';
    var msgVal = existing ? (existing.querySelector('.inp-msg')?.value || '') : '';
    var noteVal = existing ? (existing.querySelector('.inp-note')?.value || data.note || '') : (data.note || '');
    var questionVal = existing ? (existing.querySelector('.inp-question')?.value || data.question || '') : (data.question || '');
    var timeoutDurationVal = existing ? (existing.querySelector('.inp-timeout-duration')?.value || '') : '';
    var timeoutReasonVal = existing ? (existing.querySelector('.inp-timeout-reason')?.value || data.timeout_reason || '') : (data.timeout_reason || '');
    var answerVal = data.question_answer || '';

    row.setAttribute('data-user', user);
    row.innerHTML =
      '<td>' + escapeHtml(user) + '</td>' +
      '<td>' + statusText + '</td>' +
      '<td>' + escapeHtml(data.last_ping || 'Never') + '</td>' +
      '<td>' + (data.current_url ? '<a href="' + escapeHtml(data.current_url) + '" target="_blank">' + escapeHtml(data.current_url) + '</a>' : '<span style="color:gray;">Unknown</span>') + '</td>' +
      '<td>' + escapeHtml(effectLabel(data.effect || '')) + '</td>' +
      '<td>' + (data.question ? escapeHtml(data.question) : '<span style="color:gray;">None</span>') + '</td>' +
      '<td>' + (answerVal ? '<strong>' + escapeHtml(answerVal) + '</strong>' : '<span style="color:gray;">Pending</span>') + '</td>' +
      '<td data-user="' + escapeHtml(user) + '">' +
        '<div class="action-group ban-group" style="background-color: #ffcccc;"><button class="btn-toggle-ban" style="background-color:#ff4444;color:white;" ' + (data.timeout_active ? 'disabled' : '') + '>' + (data.banned ? 'Unban' : 'Ban') + '</button></div>' +
        '<div class="action-group redirect-group" style="background-color: #cce5ff;"><input class="inp-url" placeholder="URL" value="' + escapeHtml(urlVal) + '"><button class="btn-redirect" style="background-color:#0066cc;color:white;">Redirect</button></div>' +
        '<div class="action-group image-group" style="background-color: #e6ccff;"><input type="file" class="inp-img"><button class="btn-img" style="background-color:#9900cc;color:white;">Image</button></div>' +
        '<div class="action-group message-group" style="background-color: #ccffcc;"><input class="inp-msg" placeholder="Message" value="' + escapeHtml(msgVal) + '"><button class="btn-msg" style="background-color:#00cc00;color:white;">Message</button></div>' +
        '<div class="action-group question-group" style="background-color: #ffe0cc;"><input class="inp-question" placeholder="Yes/No question" value="' + escapeHtml(questionVal) + '"><button class="btn-question" style="background-color:#cc6600;color:white;">Ask</button> <button class="btn-clear-question" style="background-color:#cc9933;color:white;">Clear Ask</button></div>' +
        '<div class="action-group timeout-group" style="background-color: #ffcccc;">' + (data.timeout_active ? '<button class="btn-untimeout" style="background-color:#cc0066;color:white;">Untimeout</button>' : '<input class="inp-timeout-duration" placeholder="2m 20s" value="' + escapeHtml(timeoutDurationVal) + '"><input class="inp-timeout-reason" placeholder="Timeout reason" value="' + escapeHtml(timeoutReasonVal) + '"><button class="btn-timeout" style="background-color:#cc0066;color:white;" ' + (data.banned ? 'disabled' : '') + '>Timeout</button>') + '</div>' +
        '<div class="action-group note-group" style="background-color: #ccffcc;"><input class="inp-note" placeholder="Note" value="' + escapeHtml(noteVal) + '"><button class="btn-note" style="background-color:#009900;color:white;">Save Note</button></div>' +
        '<div class="action-group effect-group" style="background-color: #e6ccff;"><select class="inp-effect">' + effectOptionsHtml(effectValue) + '</select><button class="btn-effect" style="background-color:#6600cc;color:white;">Apply Effect</button> <button class="btn-effect-clear" style="background-color:#9966cc;color:white;">Reset Effect</button></div>' +
        '<div class="action-group delete-group" style="background-color: #ffcccc;"><button class="btn-delete" style="background-color:#cc0000;color:white;">Delete</button></div>' +
      '</td>';
    table.appendChild(row);
  });

  document.getElementById('clientStats').textContent = 'Active: ' + activeCount + ' | Banned: ' + bannedCount + ' | Timed Out: ' + timeoutCount + ' | Total: ' + totalCount;
}

function banClient(btn) {
  var user = btn.closest('td').getAttribute('data-user');
  return fetch(ROUTES.clientBan, {method: 'POST', body: 'username=' + encodeURIComponent(user), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}).then(loadClients);
}

function unbanClient(btn) {
  var user = btn.closest('td').getAttribute('data-user');
  return fetch(ROUTES.clientUnban, {method: 'POST', body: 'username=' + encodeURIComponent(user), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}).then(loadClients);
}

function toggleBan(btn) {
  var user = btn.closest('td').getAttribute('data-user');
  var data = clientState.clients[user];
  if (data && data.banned) {
    unbanClient(btn);
  } else {
    banClient(btn);
  }
}

function deleteClient(btn) {
  var user = btn.closest('td').getAttribute('data-user');
  if (!confirm('Delete ' + user + '?')) return;
  return fetch(ROUTES.clientDelete, {method: 'POST', body: 'username=' + encodeURIComponent(user), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}).then(loadClients);
}

function sendMessage(btn, msg) {
  var user = btn.closest('td').getAttribute('data-user');
  if (!msg) return;
  return fetch(ROUTES.clientMessage, {method: 'POST', body: 'username=' + encodeURIComponent(user) + '&message=' + encodeURIComponent(msg), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}).then(loadClients);
}

function sendRedirect(btn, url) {
  var user = btn.closest('td').getAttribute('data-user');
  if (!url) return;
  return fetch(ROUTES.clientRedirect, {method: 'POST', body: 'username=' + encodeURIComponent(user) + '&u=' + encodeRouteValue(url), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}).then(loadClients);
}

function sendEffect(btn, effect) {
  var user = btn.closest('td').getAttribute('data-user');
  return fetch(ROUTES.clientEffect, {method: 'POST', body: 'username=' + encodeURIComponent(user) + '&effect=' + encodeURIComponent(effect || ''), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}).then(loadClients);
}

function sendNote(btn, note) {
  var user = btn.closest('td').getAttribute('data-user');
  return fetch(ROUTES.clientNote, {method: 'POST', body: 'username=' + encodeURIComponent(user) + '&note=' + encodeURIComponent(note || ''), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}).then(loadClients);
}

function sendQuestion(btn, question) {
  var user = btn.closest('td').getAttribute('data-user');
  return fetch(ROUTES.clientQuestion, {method: 'POST', body: 'username=' + encodeURIComponent(user) + '&question=' + encodeURIComponent(question || ''), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}).then(loadClients);
}

function sendTimeout(btn, duration, reason) {
  var user = btn.closest('td').getAttribute('data-user');
  if (!duration) return;
  return fetch(ROUTES.clientTimeout, {
    method: 'POST',
    body: 'username=' + encodeURIComponent(user) + '&duration=' + encodeURIComponent(duration) + '&reason=' + encodeURIComponent(reason || ''),
    headers: {'Content-Type': 'application/x-www-form-urlencoded'}
  }).then(loadClients);
}

function clearClientTimeout(btn) {
  var user = btn.closest('td').getAttribute('data-user');
  return fetch(ROUTES.clientTimeoutClear, {
    method: 'POST',
    body: 'username=' + encodeURIComponent(user),
    headers: {'Content-Type': 'application/x-www-form-urlencoded'}
  }).then(loadClients);
}

function banAllActive() {
  if (!confirm('Ban all active clients?')) return;
  Promise.all(Object.entries(clientState.clients).map(function(entry) {
    var user = entry[0];
    var data = entry[1];
    if (data.recent && !data.banned) {
      return fetch(ROUTES.clientBan, {method: 'POST', body: 'username=' + encodeURIComponent(user), headers: {'Content-Type': 'application/x-www-form-urlencoded'}});
    }
    return Promise.resolve();
  })).then(loadClients);
}

function unbanAll() {
  if (!confirm('Unban all clients?')) return;
  Promise.all(Object.entries(clientState.clients).map(function(entry) {
    var user = entry[0];
    var data = entry[1];
    if (data.banned) {
      return fetch(ROUTES.clientUnban, {method: 'POST', body: 'username=' + encodeURIComponent(user), headers: {'Content-Type': 'application/x-www-form-urlencoded'}});
    }
    return Promise.resolve();
  })).then(loadClients);
}

function deleteAll() {
  if (!confirm('Delete ALL clients? This cannot be undone!')) return;
  Promise.all(Object.keys(clientState.clients).map(function(user) {
    return fetch(ROUTES.clientDelete, {method: 'POST', body: 'username=' + encodeURIComponent(user), headers: {'Content-Type': 'application/x-www-form-urlencoded'}});
  })).then(loadClients);
}

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
  return fetch(ROUTES.lockdown, {method: 'POST', body: body, headers: {'Content-Type': 'application/x-www-form-urlencoded'}})
    .then(function(r) { return r.json(); })
    .then(function() {
      loadClients();
      updateLockdownBtn();
    });
}

function disableLockdown() {
  return fetch(ROUTES.lockdown, {method: 'POST', body: 'action=off', headers: {'Content-Type': 'application/x-www-form-urlencoded'}})
    .then(function(r) { return r.json(); })
    .then(function() {
      loadClients();
      updateLockdownBtn();
    });
}

function promptLockdown() {
  var duration = prompt("Enter lockdown duration in minutes (leave empty for indefinite):", "7");
  if (duration === null) return;
  toggleLockdown(duration || '');
}

function updateLockdownBtn() {
  return fetch(ROUTES.lockdownJson).then(function(r) { return r.json(); }).then(function(d) {
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

loadClients().catch(function() {});
updateLockdownBtn();
setInterval(updateLockdownBtn, 30000);

var clientsTable = document.getElementById('clientsTable');
if (clientsTable) {
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
      var f = td.querySelector('.inp-img').files[0];
      if (f) {
        var fd = new FormData();
        fd.append('username', user);
        fd.append('image_file', f);
        fetch(ROUTES.clientImage, {method: 'POST', body: fd}).then(loadClients);
      }
    } else if (btn.classList.contains('btn-effect')) {
      sendEffect(btn, td.querySelector('.inp-effect').value);
    } else if (btn.classList.contains('btn-effect-clear')) {
      sendEffect(btn, '');
    } else if (btn.classList.contains('btn-note')) {
      sendNote(btn, td.querySelector('.inp-note').value);
    } else if (btn.classList.contains('btn-question')) {
      sendQuestion(btn, td.querySelector('.inp-question').value);
    } else if (btn.classList.contains('btn-clear-question')) {
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

document.getElementById('filterSelect')?.addEventListener('change', function(e) {
  clientState.filter = e.target.value;
  loadClients();
});

document.getElementById('sortSelect')?.addEventListener('change', function(e) {
  clientState.sortBy = e.target.value;
  loadClients();
});

// --- Image Manager ---
const IMAGE_HISTORY_KEY = 'globalImageHistory';
let currentSelectedImage = null;

function loadImageHistory() {
  const stored = localStorage.getItem(IMAGE_HISTORY_KEY);
  try {
    return stored ? JSON.parse(stored) : [];
  } catch (err) {
    console.error(err);
    return [];
  }
}

function saveImageToHistory(base64, name) {
  let history = loadImageHistory();
  if (!history.some(item => item.base64 === base64)) {
    history.push({base64: base64, name: name});
    localStorage.setItem(IMAGE_HISTORY_KEY, JSON.stringify(history));
    addImageManagerEntry(base64, name);
  }
  selectImage(base64);
}

function convertImageToBase64(input, userId) {
  const file = input.files[0];
  if (!file) return;
  let name = prompt("Enter a name for this image:", file.name) || file.name;

  const reader = new FileReader();
  reader.onload = function(e) {
    const base64 = e.target.result;
    document.getElementById('image_' + userId).value = base64;
    saveImageToHistory(base64, name);
  };
  reader.readAsDataURL(file);
}

function addImageManagerEntry(base64, name) {
  const container = document.getElementById('image_manager_global');
  if (!container) return;
  if (Array.from(container.children).some(div => div.dataset.base64 === base64)) return;

  const div = document.createElement('div');
  div.className = 'entry';
  div.dataset.base64 = base64;
  div.innerHTML = `
    <button type="button" onclick="selectImage('${base64}')">Select</button>
    <button type="button" onclick="previewImage('${base64}')">Preview</button>
    <button type="button" onclick="deleteImage('${base64}', this)">Delete</button>
    <span class="entry-name">${name}</span>
  `;
  container.appendChild(div);
}

function selectImage(base64) {
  currentSelectedImage = base64;
  document.querySelectorAll('input[name=image]').forEach(inp => inp.value = base64);
  updateImageVisual();
}

function redirectAllActive() {
  if (!pass('redirectAll')) return;
  const url = prompt("Enter URL to redirect all active clients to:", "https://example.com");
  if (!url) return;

  fetch(ROUTES.clientsJson).then(r => r.json()).then(function(clients) {
    const promises = [];
    for (const [user, data] of Object.entries(clients)) {
      if (data.recent) {
        promises.push(fetch(ROUTES.clientRedirect, {method: 'POST', body: 'username=' + encodeURIComponent(user) + '&u=' + encodeRouteValue(url), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}));
      }
    }
    Promise.all(promises).then(loadClients);
  });
}

function messageAllActive() {
  if (!pass('messageAll')) return;
  const msg = prompt("Enter message to send to all active clients:");
  if (!msg) return;

  fetch(ROUTES.clientsJson).then(r => r.json()).then(function(clients) {
    const promises = [];
    for (const [user, data] of Object.entries(clients)) {
      if (data.recent) {
        promises.push(fetch(ROUTES.clientMessage, {method: 'POST', body: 'username=' + encodeURIComponent(user) + '&message=' + encodeURIComponent(msg), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}));
      }
    }
    Promise.all(promises).then(loadClients);
  });
}

function askAllActive() {
  if (!pass('askAll')) return;
  const question = prompt("Enter question to ask all active clients:");
  if (!question) return;
  if (!confirm("Ask all active clients this question?\n\n" + question)) return;

  fetch(ROUTES.clientsJson).then(r => r.json()).then(function(clients) {
    const promises = [];
    for (const [user, data] of Object.entries(clients)) {
      if (data.recent) {
        promises.push(fetch(ROUTES.clientQuestion, {method: 'POST', body: 'username=' + encodeURIComponent(user) + '&question=' + encodeURIComponent(question), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}));
      }
    }
    Promise.all(promises).then(loadClients);
  });
}

function showIdAllClients() {
  if (!pass('showIdAll')) return;
  if (!confirm("Show each client's ID on their screen for 5 seconds?")) return;

  fetch(ROUTES.clientsJson).then(r => r.json()).then(function(clients) {
    const promises = [];
    for (const [user, data] of Object.entries(clients)) {
      if (data.recent) {
        promises.push(fetch(ROUTES.clientMessage, {method: 'POST', body: 'username=' + encodeURIComponent(user) + '&message=' + encodeURIComponent('Your ID: ' + user), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}));
      }
    }
    Promise.all(promises).then(loadClients);
  });
}

function sendImageToAllActive() {
  if (!pass('sendImageAll')) return;
  if (!currentSelectedImage) {
    alert("Please select an image first from the Image Manager below.");
    return;
  }
  if (!confirm("Send selected image to all active clients?")) return;

  fetch(ROUTES.clientsJson).then(r => r.json()).then(function(clients) {
    const promises = [];
    for (const [user, data] of Object.entries(clients)) {
      if (data.recent) {
        promises.push(fetch(ROUTES.clientImage, {method: 'POST', body: 'username=' + encodeURIComponent(user) + '&image=' + encodeURIComponent(currentSelectedImage), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}));
      }
    }
    Promise.all(promises).then(loadClients);
  });
}

function sendImageFileToAllActive(input) {
  if (!pass('sendImageAll')) return;
  const f = input.files[0];
  if (!f) return;
  if (!confirm("Send this image to all active clients?")) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const base64 = e.target.result;
    fetch(ROUTES.clientsJson).then(r => r.json()).then(function(clients) {
      const promises = [];
      for (const [user, data] of Object.entries(clients)) {
        if (data.recent) {
          promises.push(fetch(ROUTES.clientImage, {method: 'POST', body: 'username=' + encodeURIComponent(user) + '&image=' + encodeURIComponent(base64), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}));
        }
      }
      Promise.all(promises).then(loadClients);
    });
  };
  reader.readAsDataURL(f);
}

function updateImageVisual() {
  document.querySelectorAll('#image_manager_global .entry').forEach(div => {
    if (div.dataset.base64 === currentSelectedImage) {
      div.classList.add('selected');
    } else {
      div.classList.remove('selected');
    }
  });
  const label = document.getElementById('current_selected_image');
  if (!label) return;
  if (currentSelectedImage) {
    const item = loadImageHistory().find(i => i.base64 === currentSelectedImage);
    label.textContent = "Current Selected Image: " + (item ? item.name : "");
  } else {
    label.textContent = "No Image Selected";
  }
}

function previewImage(base64) {
  const win = window.open();
  if (!win) return;
  win.document.write('<img src="' + base64 + '" style="max-width:100%;max-height:100%;">');
}

function deleteImage(base64, btn) {
  let history = loadImageHistory();
  history = history.filter(item => item.base64 !== base64);
  localStorage.setItem(IMAGE_HISTORY_KEY, JSON.stringify(history));
  if (btn && btn.parentElement) btn.parentElement.remove();
  if (currentSelectedImage === base64) {
    currentSelectedImage = null;
    updateImageVisual();
  }
}

function initGlobalImageHistory() {
  const history = loadImageHistory();
  history.forEach(item => addImageManagerEntry(item.base64, item.name));
  updateImageVisual();
}

function rickrollAllClients() {
  if (!confirm("Are you sure you want to Rickroll all active clients?")) return;

  const rickUrl = "https://shattereddisk.github.io/rickroll/rickroll.mp4";
  const passcode = prompt("Enter passcode:");
  if (!passcode) {
    alert("Passcode required!");
    return;
  }

  const activeRows = document.querySelectorAll('tr.recent');

  activeRows.forEach(row => {
    const username = row.querySelector('input[name="username"]')?.value;
    if (!username) return;

    const form = document.createElement('form');
    form.method = 'post';
    form.action = ROUTES.clientRedirect;
    form.style.display = 'none';

    const userInput = document.createElement('input');
    userInput.name = 'username';
    userInput.value = username;
    form.appendChild(userInput);

    const urlInput = document.createElement('input');
    urlInput.name = 'u';
    urlInput.value = encodeRouteValue(rickUrl);
    form.appendChild(urlInput);

    const passInput = document.createElement('input');
    passInput.name = 'passcode';
    passInput.value = passcode;
    form.appendChild(passInput);

    document.body.appendChild(form);
    form.submit();
  });
}

// ============================================
// PASSWORD AUTH SYSTEM — EDIT THIS SECTION ONLY
// ============================================

var PASSWORD_CONFIG = {
  // Session timeout in minutes (0 = no timeout)
  sessionTimeoutMinutes: 30,

  // Hardcoded accounts — add/edit/remove here only
  passwords: [
    {
      password: "1211",
      label: "ojdaw",
      mode: "deny",        // "deny" = blacklist (allow all except deniedActions)
      allowedActions: [],  // ignored in deny mode
      deniedActions: []    // empty = full access
    },
    {
      password: "viewer",
      label: "Viewer",
      mode: "allow",       // "allow" = whitelist (block all except allowedActions)
      allowedActions: [],  // empty = view-only, nothing allowed
      deniedActions: []    // ignored in allow mode
    }
  ]
};

// Available action names for reference:
// ban, unban, toggleBan, delete, redirect, message, image, effect, note,
// question, timeout, untimeout, banAll, unbanAll, deleteAll, redirectAll,
// messageAll, askAll, showIdAll, sendImageAll, lockdown, rickroll

var authSession = {
  authenticated: false,
  currentLabel: null,
  currentPermissions: null,
  loginTime: null,
  timer: null
};

function isSessionValid() {
  if (!authSession.authenticated) return false;
  if (PASSWORD_CONFIG.sessionTimeoutMinutes <= 0) return true;
  var elapsed = (Date.now() - authSession.loginTime) / 1000 / 60;
  return elapsed < PASSWORD_CONFIG.sessionTimeoutMinutes;
}

function isActionAllowed(actionName) {
  if (!authSession.authenticated || !isSessionValid()) return false;
  var perms = authSession.currentPermissions;
  if (perms.mode === "allow") {
    if (perms.allowedActions.length === 0) return false;
    return perms.allowedActions.indexOf(actionName) !== -1;
  } else {
    return perms.deniedActions.indexOf(actionName) === -1;
  }
}

function pass(actionName) {
  if (authSession.authenticated && isSessionValid()) {
    if (!isActionAllowed(actionName)) {
      alert("Access Denied: Your account (" + authSession.currentLabel + ") cannot do this.");
      return false;
    }
    return true;
  }

  var userInput = prompt("Enter password:");
  if (!userInput) return false;

  var matched = null;
  for (var i = 0; i < PASSWORD_CONFIG.passwords.length; i++) {
    if (PASSWORD_CONFIG.passwords[i].password === userInput) {
      matched = PASSWORD_CONFIG.passwords[i];
      break;
    }
  }

  if (!matched) {
    alert("Wrong password.");
    return false;
  }

  authSession.authenticated = true;
  authSession.currentLabel = matched.label;
  authSession.currentPermissions = {
    mode: matched.mode,
    allowedActions: matched.allowedActions.slice(),
    deniedActions: matched.deniedActions.slice()
  };
  authSession.loginTime = Date.now();

  if (authSession.timer) clearTimeout(authSession.timer);
  if (PASSWORD_CONFIG.sessionTimeoutMinutes > 0) {
    authSession.timer = setTimeout(function() {
      authSession.authenticated = false;
      alert("Session expired.");
      updateAuthStatus();
    }, PASSWORD_CONFIG.sessionTimeoutMinutes * 60 * 1000);
  }

  if (!isActionAllowed(actionName)) {
    alert("Authenticated as " + matched.label + " — but this action is blocked for you.");
    return false;
  }

  updateAuthStatus();
  return true;
}

function logout() {
  authSession.authenticated = false;
  authSession.currentLabel = null;
  authSession.currentPermissions = null;
  authSession.loginTime = null;
  if (authSession.timer) clearTimeout(authSession.timer);
  authSession.timer = null;
  updateAuthStatus();
}

function updateAuthStatus() {
  var el = document.getElementById('authStatus');
  if (!el) return;
  if (authSession.authenticated && isSessionValid()) {
    var remaining = "";
    if (PASSWORD_CONFIG.sessionTimeoutMinutes > 0) {
      var mins = Math.max(0, Math.round(PASSWORD_CONFIG.sessionTimeoutMinutes - (Date.now() - authSession.loginTime) / 1000 / 60));
      remaining = " (" + mins + "m)";
    }
    el.innerHTML = '<span style="color:lime;">● ' + escapeHtml(authSession.currentLabel) + remaining + '</span> <button onclick="logout()" style="margin-left:6px;font-size:11px;">Logout</button>';
  } else {
    el.innerHTML = '<span style="color:red;">● Not logged in</span>';
  }
}

// Inject auth status bar
function injectAuthBar() {
  var bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:0;right:0;z-index:9999;padding:6px 12px;background:#111;color:#fff;font-family:sans-serif;font-size:12px;border-bottom-left-radius:6px;';
  bar.innerHTML = '<span id="authStatus"><span style="color:red;">● Not logged in</span></span>';
  document.body.appendChild(bar);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectAuthBar);
} else {
  injectAuthBar();
}

setInterval(updateAuthStatus, 30000);
