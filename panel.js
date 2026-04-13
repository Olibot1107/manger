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

var ROUTES = Object.freeze({
  clientsJson: decodeRoute('4202020e001c1912400d161d03'),
  clientBan: decodeRoute('4202020e001c19124105041c'),
  clientUnban: decodeRoute('4202020e001c191241120b100c0f'),
  clientDelete: decodeRoute('4202020e001c19124103001e08150b'),
  clientMessage: decodeRoute('4202020e001c1912410a00011e000902'),
  clientRedirect: decodeRoute('4202020e001c19124115001604130b0411'),
  clientEffect: decodeRoute('4202020e001c19124102031408021a'),
  clientImage: decodeRoute('4202020e001c1912410e08130a04'),
  lockdown: decodeRoute('420d01040e16021600'),
  lockdownJson: decodeRoute('420d01040e16021600490f01020f')
});

var EFFECTS = [
  { value: '', label: 'No Effect' },
  { value: 'invert', label: 'Invert Colors' },
  { value: 'french', label: 'French Mode' },
  { value: 'party', label: 'Funny Party' },
  { value: 'mirror', label: 'Mirror Flip' },
  { value: 'tiny', label: 'Tiny Mode' },
  { value: 'glitch', label: 'Glitch Mode' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'gray', label: 'Grayscale' },
  { value: 'rainbow', label: 'Rainbow' },
  { value: 'wobble', label: 'Wobble' },
  { value: 'comic', label: 'Comic Mode' },
  { value: 'zoom', label: 'Zoom Pop' },
  { value: 'blur', label: 'Blur' },
  { value: 'flipv', label: 'Vertical Flip' },
  { value: 'neon', label: 'Neon Glow' },
  { value: 'scanlines', label: 'Scanlines' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'skew', label: 'Skew' },
  { value: 'spin', label: 'Spin' },
  { value: 'confetti', label: 'Confetti' }
];

var FRENCH_REPLACEMENTS = [
  [/\bClient Manager\b/gi, 'Gestionnaire de clients'],
  [/\bUsername\b/gi, "Nom d'utilisateur"],
  [/\bStatus\b/gi, 'Statut'],
  [/\bLast Ping\b/gi, 'Dernier ping'],
  [/\bCurrent URL\b/gi, 'URL actuelle'],
  [/\bActions\b/gi, 'Actions'],
  [/\bAuto Refresh\b/gi, 'Rafraîchissement auto'],
  [/\bRefresh\b/gi, 'Rafraîchir'],
  [/\bBan All Active\b/gi, 'Bannir tous les actifs'],
  [/\bUnban All\b/gi, 'Débannir tout'],
  [/\bDelete All\b/gi, 'Tout supprimer'],
  [/\bActive\b/gi, 'Actif'],
  [/\bInactive\b/gi, 'Inactif'],
  [/\bBANNED\b/gi, 'INTERDIT'],
  [/\bUnknown\b/gi, 'Inconnu'],
  [/\bNever\b/gi, 'Jamais'],
  [/\bRedirect\b/gi, 'Rediriger'],
  [/\bMessage\b/gi, 'Message'],
  [/\bImage\b/gi, 'Image'],
  [/\bBan\b/gi, 'Bannir'],
  [/\bUnban\b/gi, 'Débannir'],
  [/\bApply Effect\b/gi, 'Appliquer l\'effet'],
  [/\bReset Effect\b/gi, 'Réinitialiser l\'effet'],
  [/\bNeon Glow\b/gi, 'Lueur néon'],
  [/\bScanlines\b/gi, 'Lignes CRT'],
  [/\bPulse\b/gi, 'Pouls'],
  [/\bSkew\b/gi, 'Inclinaison'],
  [/\bSpin\b/gi, 'Rotation'],
  [/\bConfetti\b/gi, 'Confettis']
];

function effectLabel(effect) {
  var map = {
    '': 'No Effect',
    invert: 'Invert Colors',
    french: 'French Mode',
    party: 'Funny Party',
    mirror: 'Mirror Flip',
    tiny: 'Tiny Mode',
    glitch: 'Glitch Mode',
    sepia: 'Sepia',
    gray: 'Grayscale',
    rainbow: 'Rainbow',
    wobble: 'Wobble',
    comic: 'Comic Mode',
    zoom: 'Zoom Pop',
    blur: 'Blur',
    flipv: 'Vertical Flip',
    neon: 'Neon Glow',
    scanlines: 'Scanlines',
    pulse: 'Pulse',
    skew: 'Skew',
    spin: 'Spin',
    confetti: 'Confetti'
  };
  return map[effect] || 'No Effect';
}

function effectOptionsHtml(selected) {
  return EFFECTS.map(function(effect) {
    return '<option value="' + effect.value + '"' + (effect.value === selected ? ' selected' : '') + '>' + effect.label + '</option>';
  }).join('');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function translateFrench(text) {
  var result = String(text || '');
  FRENCH_REPLACEMENTS.forEach(function(pair) {
    result = result.replace(pair[0], pair[1]);
  });
  return result;
}

function walkTextNodes(root, callback) {
  if (!root) return;
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  var node;
  while ((node = walker.nextNode())) {
    if (!node.parentElement) continue;
    var tag = node.parentElement.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
    callback(node);
  }
}

function restoreFrenchMode() {
  walkTextNodes(document.body, function(node) {
    if (frenchTextMap.has(node)) {
      node.nodeValue = frenchTextMap.get(node);
    }
  });

  document.querySelectorAll('[placeholder]').forEach(function(el) {
    if (frenchPlaceholderMap.has(el)) {
      el.setAttribute('placeholder', frenchPlaceholderMap.get(el));
    }
  });

  document.documentElement.removeAttribute('lang');
}

function translateFrenchMode() {
  document.documentElement.setAttribute('lang', 'fr');

  walkTextNodes(document.body, function(node) {
    if (!frenchTextMap.has(node)) {
      frenchTextMap.set(node, node.nodeValue);
    }
    node.nodeValue = translateFrench(frenchTextMap.get(node));
  });

  document.querySelectorAll('[placeholder]').forEach(function(el) {
    if (!frenchPlaceholderMap.has(el)) {
      frenchPlaceholderMap.set(el, el.getAttribute('placeholder') || '');
    }
    el.setAttribute('placeholder', translateFrench(frenchPlaceholderMap.get(el)));
  });

  document.title = translateFrench(document.title);
}

function clearEffectArtifacts() {
  if (effectStyleNode) {
    effectStyleNode.remove();
    effectStyleNode = null;
  }
  if (frenchObserver) {
    frenchObserver.disconnect();
    frenchObserver = null;
  }

  document.documentElement.classList.remove(
    'client-party',
    'client-glitch',
    'client-rainbow',
    'client-wobble',
    'client-neon',
    'client-scanlines',
    'client-pulse',
    'client-skew',
    'client-spin',
    'client-confetti'
  );
  document.documentElement.style.filter = '';
  document.documentElement.style.transform = '';
  document.documentElement.style.transformOrigin = '';
  document.documentElement.style.animation = '';
  document.documentElement.style.zoom = '';

  document.body.style.filter = '';
  document.body.style.transform = '';
  document.body.style.transformOrigin = '';
  document.body.style.animation = '';
  document.body.style.zoom = '';

  restoreFrenchMode();
}

function ensureEffectStyle(css) {
  if (effectStyleNode) {
    effectStyleNode.remove();
  }
  effectStyleNode = document.createElement('style');
  effectStyleNode.textContent = css;
  document.head.appendChild(effectStyleNode);
}

function applyClientEffect(effect) {
  effect = effect || '';
  if (effect === currentEffect) {
    if (effect === 'french') translateFrenchMode();
    return;
  }

  clearEffectArtifacts();
  currentEffect = effect;

  if (!effect) return;

  if (effect === 'invert') {
    document.documentElement.style.filter = 'invert(1) hue-rotate(180deg)';
  } else if (effect === 'mirror') {
    document.documentElement.style.transform = 'scaleX(-1)';
    document.documentElement.style.transformOrigin = 'center center';
  } else if (effect === 'tiny') {
    document.documentElement.style.transform = 'scale(0.88)';
    document.documentElement.style.transformOrigin = 'top center';
    document.documentElement.style.zoom = '0.9';
  } else if (effect === 'sepia') {
    document.documentElement.style.filter = 'sepia(1) saturate(1.25) contrast(1.05)';
  } else if (effect === 'gray') {
    document.documentElement.style.filter = 'grayscale(1) contrast(1.08)';
  } else if (effect === 'blur') {
    document.documentElement.style.filter = 'blur(1.5px) saturate(0.9)';
  } else if (effect === 'flipv') {
    document.documentElement.style.transform = 'scaleY(-1)';
    document.documentElement.style.transformOrigin = 'center center';
  } else if (effect === 'party') {
    ensureEffectStyle(`
      @keyframes clientPartySpin {
        0% { filter: hue-rotate(0deg) saturate(1.2); }
        100% { filter: hue-rotate(360deg) saturate(1.8); }
      }
      html.client-party {
        animation: clientPartySpin 2s linear infinite;
      }
    `);
    document.documentElement.classList.add('client-party');
  } else if (effect === 'glitch') {
    ensureEffectStyle(`
      @keyframes clientGlitchShake {
        0% { transform: translate(0, 0); }
        25% { transform: translate(1px, -1px); }
        50% { transform: translate(-1px, 1px); }
        75% { transform: translate(1px, 1px); }
        100% { transform: translate(0, 0); }
      }
      html.client-glitch body {
        animation: clientGlitchShake 0.18s infinite;
      }
    `);
    document.documentElement.classList.add('client-glitch');
  } else if (effect === 'rainbow') {
    ensureEffectStyle(`
      @keyframes clientRainbowPulse {
        0% { filter: hue-rotate(0deg) saturate(1.3); }
        100% { filter: hue-rotate(360deg) saturate(1.7); }
      }
      html.client-rainbow body {
        animation: clientRainbowPulse 1.2s linear infinite;
      }
    `);
    document.documentElement.classList.add('client-rainbow');
  } else if (effect === 'wobble') {
    ensureEffectStyle(`
      @keyframes clientWobble {
        0% { transform: rotate(0deg) translate(0, 0); }
        25% { transform: rotate(0.6deg) translate(1px, -1px); }
        50% { transform: rotate(-0.6deg) translate(-1px, 1px); }
        75% { transform: rotate(0.4deg) translate(1px, 1px); }
        100% { transform: rotate(0deg) translate(0, 0); }
      }
      html.client-wobble body {
        animation: clientWobble 0.7s ease-in-out infinite;
      }
    `);
    document.documentElement.classList.add('client-wobble');
  } else if (effect === 'comic') {
    document.documentElement.style.filter = 'contrast(1.5) saturate(1.8) brightness(1.05)';
  } else if (effect === 'zoom') {
    document.documentElement.style.transform = 'scale(1.08)';
    document.documentElement.style.transformOrigin = 'top center';
  } else if (effect === 'neon') {
    ensureEffectStyle(`
      @keyframes clientNeonPulse {
        0% { filter: brightness(1.05) saturate(1.5) hue-rotate(0deg); }
        100% { filter: brightness(1.25) saturate(2) hue-rotate(360deg); }
      }
      html.client-neon body {
        animation: clientNeonPulse 1.8s ease-in-out infinite alternate;
      }
      html.client-neon a, html.client-neon button, html.client-neon input, html.client-neon select {
        box-shadow: 0 0 12px rgba(0, 255, 255, 0.35);
      }
    `);
    document.documentElement.classList.add('client-neon');
  } else if (effect === 'scanlines') {
    ensureEffectStyle(`
      html.client-scanlines body {
        background-image:
          linear-gradient(rgba(255,255,255,0.08) 50%, rgba(0,0,0,0) 50%);
        background-size: 100% 4px;
      }
    `);
    document.documentElement.classList.add('client-scanlines');
  } else if (effect === 'pulse') {
    ensureEffectStyle(`
      @keyframes clientPulse {
        0% { transform: scale(1); filter: brightness(1); }
        50% { transform: scale(1.015); filter: brightness(1.12); }
        100% { transform: scale(1); filter: brightness(1); }
      }
      html.client-pulse body {
        animation: clientPulse 1.5s ease-in-out infinite;
      }
    `);
    document.documentElement.classList.add('client-pulse');
  } else if (effect === 'skew') {
    document.documentElement.style.transform = 'skewX(-5deg)';
    document.documentElement.style.transformOrigin = 'center center';
  } else if (effect === 'spin') {
    ensureEffectStyle(`
      @keyframes clientSpin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      html.client-spin body {
        animation: clientSpin 8s linear infinite;
      }
    `);
    document.documentElement.classList.add('client-spin');
  } else if (effect === 'confetti') {
    ensureEffectStyle(`
      @keyframes clientConfetti {
        0% { background-position: 0 0, 0 0, 0 0; }
        100% { background-position: 120px 80px, -90px 140px, 200px -100px; }
      }
      html.client-confetti body {
        background-image:
          radial-gradient(circle, rgba(255,0,0,0.35) 0 2px, transparent 3px),
          radial-gradient(circle, rgba(0,255,0,0.30) 0 2px, transparent 3px),
          radial-gradient(circle, rgba(0,128,255,0.30) 0 2px, transparent 3px);
        background-size: 80px 80px, 120px 120px, 160px 160px;
        animation: clientConfetti 10s linear infinite;
      }
    `);
    document.documentElement.classList.add('client-confetti');
  } else if (effect === 'french') {
    translateFrenchMode();
    frenchObserver = new MutationObserver(function() {
      translateFrenchMode();
    });
    frenchObserver.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }
}

function renderClients(clients) {
  clientState.clients = clients;
  const table = document.getElementById('clientsTable');
  const existingRows = {};
  table.querySelectorAll('tr').forEach(row => {
    const username = row.cells[0]?.textContent;
    if (username) existingRows[username] = row;
  });

  let filtered = Object.entries(clients);

  if (clientState.filter === 'active') {
    filtered = filtered.filter(([u, d]) => !d.banned && d.recent);
  } else if (clientState.filter === 'banned') {
    filtered = filtered.filter(([u, d]) => d.banned);
  } else if (clientState.filter === 'inactive') {
    filtered = filtered.filter(([u, d]) => !d.recent);
  }

  if (clientState.sortBy === 'recent') {
    filtered.sort((a, b) => (b[1].last_ping || '').localeCompare(a[1].last_ping || ''));
  } else if (clientState.sortBy === 'name') {
    filtered.sort((a, b) => a[0].localeCompare(b[0]));
  } else if (clientState.sortBy === 'url') {
    filtered.sort((a, b) => (a[1].current_url || '').localeCompare(b[1].current_url || ''));
  }

  const activeCount = Object.values(clients).filter(d => !d.banned && d.recent).length;
  const bannedCount = Object.values(clients).filter(d => d.banned).length;
  const totalCount = Object.keys(clients).length;

  table.innerHTML = '<tr><th>Username</th><th>Status</th><th>Last Ping</th><th>Current URL</th><th>Effect</th><th>Actions</th></tr>';

  filtered.forEach(([user, data]) => {
    const row = document.createElement('tr');
    row.className = data.recent ? 'recent' : 'inactive';
    if (data.banned) row.style.backgroundColor = '#ffcccc';

    const existing = existingRows[user];
    const effectValue = existing ? (existing.querySelector('.inp-effect')?.value || data.effect || '') : (data.effect || '');
    const urlVal = existing ? (existing.querySelector('.inp-url')?.value || '') : '';
    const msgVal = existing ? (existing.querySelector('.inp-msg')?.value || '') : '';

    row.setAttribute('data-user', user);
    row.innerHTML =
      '<td>' + escapeHtml(user) + '</td>' +
      '<td>' + (data.banned ? '<span style="color:red;font-weight:bold;">BANNED</span>' : (data.recent ? '<span style="color:green;">Active</span>' : 'Inactive')) + '</td>' +
      '<td>' + escapeHtml(data.last_ping || 'Never') + '</td>' +
      '<td>' + (data.current_url ? '<a href="' + escapeHtml(data.current_url) + '" target="_blank">' + escapeHtml(data.current_url) + '</a>' : '<span style="color:gray;">Unknown</span>') + '</td>' +
      '<td>' + escapeHtml(effectLabel(data.effect || '')) + '</td>' +
      '<td data-user="' + escapeHtml(user) + '">' +
        '<button class="btn-ban" ' + (data.banned ? 'disabled' : '') + '>Ban</button> ' +
        '<button class="btn-unban" ' + (!data.banned ? 'disabled' : '') + '>Unban</button> ' +
        '<input class="inp-url" placeholder="URL" value="' + escapeHtml(urlVal) + '"><button class="btn-redirect">Redirect</button> ' +
        '<input type="file" class="inp-img"><button class="btn-img">Image</button> ' +
        '<input class="inp-msg" placeholder="Message" value="' + escapeHtml(msgVal) + '"><button class="btn-msg">Message</button> ' +
        '<select class="inp-effect">' + effectOptionsHtml(effectValue) + '</select><button class="btn-effect">Apply Effect</button> <button class="btn-effect-clear">Reset Effect</button> ' +
        '<button class="btn-delete" style="color:white;background-color:red;">Delete</button>' +
      '</td>';
    table.appendChild(row);
  });

  document.getElementById('clientStats').textContent = 'Active: ' + activeCount + ' | Banned: ' + bannedCount + ' | Total: ' + totalCount;
}

function loadClients() {
  var current = ++requestSeq;
  return fetch(ROUTES.clientsJson)
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

function banClient(btn) {
  var user = btn.closest('td').getAttribute('data-user');
  return fetch(ROUTES.clientBan, {method: 'POST', body: 'username=' + encodeURIComponent(user), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}).then(loadClients);
}

function unbanClient(btn) {
  var user = btn.closest('td').getAttribute('data-user');
  return fetch(ROUTES.clientUnban, {method: 'POST', body: 'username=' + encodeURIComponent(user), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}).then(loadClients);
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
  return fetch(ROUTES.clientRedirect, {method: 'POST', body: 'username=' + encodeURIComponent(user) + '&url=' + encodeURIComponent(url), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}).then(loadClients);
}

function sendEffect(btn, effect) {
  var user = btn.closest('td').getAttribute('data-user');
  return fetch(ROUTES.clientEffect, {method: 'POST', body: 'username=' + encodeURIComponent(user) + '&effect=' + encodeURIComponent(effect || ''), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}).then(loadClients);
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

function toggleLockdown(url) {
  var targetUrl = url || 'https://www.google.com';
  return fetch(ROUTES.lockdown, {method: 'POST', body: 'action=on&url=' + encodeURIComponent(targetUrl), headers: {'Content-Type': 'application/x-www-form-urlencoded'}})
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

function updateLockdownBtn() {
  return fetch(ROUTES.lockdownJson).then(function(r) { return r.json(); }).then(function(d) {
    lockdownState.active = !!d.active;
    var btn = document.getElementById('btn-lockdown');
    if (!btn) return;
    if (d.active) {
      btn.textContent = 'UNLOCK';
      btn.style.backgroundColor = 'green';
    } else {
      btn.textContent = 'LOCKDOWN';
      btn.style.backgroundColor = '#ff00ff';
    }
  });
}

loadClients().catch(function() {});
updateLockdownBtn();

var clientsTable = document.getElementById('clientsTable');
if (clientsTable) {
  clientsTable.addEventListener('click', function(e) {
    var btn = e.target;
    var td = btn.closest('td');
    if (!td) return;
    var user = td.getAttribute('data-user');
    if (!user) return;

    if (btn.classList.contains('btn-ban')) {
      banClient(btn);
    } else if (btn.classList.contains('btn-unban')) {
      unbanClient(btn);
    } else if (btn.classList.contains('btn-delete')) {
      deleteClient(btn);
    } else if (btn.classList.contains('btn-redirect')) {
      var url = td.querySelector('.inp-url').value;
      sendRedirect(btn, url);
    } else if (btn.classList.contains('btn-msg')) {
      var msg = td.querySelector('.inp-msg').value;
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
      const url = prompt("Enter URL to redirect all active clients to:", "https://example.com");
      if (!url) return;

      fetch(ROUTES.clientsJson).then(r => r.json()).then(function(clients) {
        const promises = [];
        for (const [user, data] of Object.entries(clients)) {
          if (data.recent) {
            promises.push(fetch(ROUTES.clientRedirect, {method: 'POST', body: 'username=' + encodeURIComponent(user) + '&url=' + encodeURIComponent(url), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}));
          }
        }
        Promise.all(promises).then(loadClients);
      });
    }

    function messageAllActive() {
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
        urlInput.name = 'url';
        urlInput.value = rickUrl;
        form.appendChild(urlInput);

        const passInput = document.createElement('input');
        passInput.name = 'passcode';
        passInput.value = passcode;
        form.appendChild(passInput);

        document.body.appendChild(form);
        form.submit();
      });
    }
