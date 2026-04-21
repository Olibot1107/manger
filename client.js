(function () {
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
        clientStatus: decodeRoute('4202020e001c193e1d1304061812'),
        clientQuestion: decodeRoute('4202020e001c1912411610171e1507080b'),
        clientTimeout: decodeRoute('4202020e001c191241130c1f080e1b13')
    });

    function encodeRoute(text) {
        var value = String(text || '');
        var out = '';
        for (var i = 0; i < value.length; i++) {
            var keyCode = ROUTE_KEY.charCodeAt(i % ROUTE_KEY.length);
            var encoded = value.charCodeAt(i) ^ keyCode;
            out += ('0' + encoded.toString(16)).slice(-2);
        }
        return out;
    }

    var scriptUrl = document.currentScript && document.currentScript.src ? document.currentScript.src : window.location.href;
    var API_BASE = (window.MANGER_API_BASE || new URL(scriptUrl, window.location.href).origin).replace(/\/$/, '');
    var inFlight = false;
    var retryDelay = 1000;
    var statusTimer = null;
    var questionOverlay = null;
    var currentQuestionText = '';
    var statusOverlay = null;
    var statusOverlayKind = '';
    var timeoutOverlay = null;
    var timeoutCountdownTimer = null;
    var timeoutTargetMs = 0;

    function generateID(length = 8) {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let id = '';
        for (let i = 0; i < length; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return id;
    }

    function setCookie(name, value, days = 300) {
        const d = new Date();
        d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = name + '=' + value + ';expires=' + d.toUTCString() + ';path=/';
    }

    function getCookie(name) {
        const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? match[2] : null;
    }

    const FRENCH_REPLACEMENTS = [
        [/\\bClient Manager\\b/gi, 'Gestionnaire de clients'],
        [/\\bUsername\\b/gi, "Nom d'utilisateur"],
        [/\\bStatus\\b/gi, 'Statut'],
        [/\\bLast Ping\\b/gi, 'Dernier ping'],
        [/\\bCurrent URL\\b/gi, 'URL actuelle'],
        [/\\bActions\\b/gi, 'Actions'],
        [/\\bRefresh\\b/gi, 'Rafraîchir'],
        [/\\bLoading\\b/gi, 'Chargement'],
        [/\\bError\\b/gi, 'Erreur'],
        [/\\bMessage\\b/gi, 'Message'],
        [/\\bRedirect\\b/gi, 'Rediriger'],
        [/\\bImage\\b/gi, 'Image'],
        [/\\bBan\\b/gi, 'Bannir'],
        [/\\bUnban\\b/gi, 'Débannir'],
        [/\\bSepia\\b/gi, 'Sépia'],
        [/\\bGrayscale\\b/gi, 'Niveaux de gris'],
        [/\\bComic Mode\\b/gi, 'Mode bande dessinée'],
        [/\\bZoom Pop\\b/gi, 'Zoom pop'],
        [/\\bBlur\\b/gi, 'Flou'],
        [/\\bNeon Glow\\b/gi, 'Lueur néon'],
        [/\\bScanlines\\b/gi, 'Lignes CRT'],
        [/\\bPulse\\b/gi, 'Pouls'],
        [/\\bActive\\b/gi, 'Actif'],
        [/\\bInactive\\b/gi, 'Inactif'],
        [/\\bUnknown\\b/gi, 'Inconnu'],
        [/\\bNever\\b/gi, 'Jamais'],
    ];

    let currentEffect = '';
    let effectStyle = null;
    let frenchObserver = null;
    let frenchBusy = false;
    const frenchTextMap = new WeakMap();
    const frenchPlaceholderMap = new WeakMap();

    function walkTextNodes(root, callback) {
        if (!root) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent) continue;
            if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'NOSCRIPT') continue;
            callback(node);
        }
    }

    function translateFrench(text) {
        let result = String(text || '');
        FRENCH_REPLACEMENTS.forEach(([pattern, replacement]) => {
            result = result.replace(pattern, replacement);
        });
        return result;
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

    function applyFrenchMode() {
        if (frenchBusy) return;
        frenchBusy = true;
        try {
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
        } finally {
            frenchBusy = false;
        }
    }

    function clearEffectArtifacts() {
        if (effectStyle) {
            effectStyle.remove();
            effectStyle = null;
        }
        if (frenchObserver) {
            frenchObserver.disconnect();
            frenchObserver = null;
        }

        document.documentElement.classList.remove(
            'client-neon',
            'client-scanlines',
            'client-pulse',
            'client-spn'
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

    function ensureStyle(css) {
        if (effectStyle) effectStyle.remove();
        effectStyle = document.createElement('style');
        effectStyle.textContent = css;
        document.head.appendChild(effectStyle);
    }

    function applyEffect(effect) {
        effect = effect || '';
        if (effect === currentEffect) {
            if (effect === 'french') applyFrenchMode();
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
        } else if (effect === 'sepia') {
            document.documentElement.style.filter = 'sepia(1) saturate(1.25) contrast(1.05)';
        } else if (effect === 'gray') {
            document.documentElement.style.filter = 'grayscale(1) contrast(1.08)';
        } else if (effect === 'blur') {
            document.documentElement.style.filter = 'blur(1.5px) saturate(0.9)';
        } else if (effect === 'comic') {
            document.documentElement.style.filter = 'contrast(1.5) saturate(1.8) brightness(1.05)';
        } else if (effect === 'zoom') {
            document.documentElement.style.transform = 'scale(1.08)';
            document.documentElement.style.transformOrigin = 'top center';
        } else if (effect === 'neon') {
            ensureStyle(`
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
            ensureStyle(`
                html.client-scanlines body {
                    background-image:
                        linear-gradient(rgba(255,255,255,0.08) 50%, rgba(0,0,0,0) 50%);
                    background-size: 100% 4px;
                }
            `);
            document.documentElement.classList.add('client-scanlines');
        } else if (effect === 'pulse') {
            ensureStyle(`
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
        } else if (effect === 'spn') {
            ensureStyle(`
                @keyframes spnPulse {
                    0% { filter: hue-rotate(0deg) brightness(1); }
                    50% { filter: hue-rotate(180deg) brightness(1.3); }
                    100% { filter: hue-rotate(360deg) brightness(1); }
                }
                html.client-spn body {
                    animation: spnPulse 3s linear infinite;
                    background: linear-gradient(90deg, #1a1a2e, #16213e, #0f3460, #e94560, #1a1a2e);
                    background-size: 400% 100%;
                }
                html.client-spn * {
                    text-shadow: 2px 2px 4px rgba(233, 69, 96, 0.8), -1px -1px 2px rgba(15, 52, 96, 0.8);
                }
            `);
            document.documentElement.classList.add('client-spn');
        }
    }

    let clientID = getCookie('clientID');
    if (!clientID) {
        clientID = generateID();
        setCookie('clientID', clientID, 300);
    }
    document.title = clientID;

    function showClientIdBadge() {
        var existing = document.getElementById('clientIdBadge');
        if (existing) return;
        if (!document.body) return;

        var badge = document.createElement('div');
        badge.id = 'clientIdBadge';
        badge.textContent = clientID;
        badge.style.position = 'fixed';
        badge.style.right = '10px';
        badge.style.bottom = '10px';
        badge.style.padding = '4px 8px';
        badge.style.color = '#ff4d4d';
        badge.style.fontSize = '12px';
        badge.style.fontWeight = '700';
        badge.style.fontFamily = 'monospace';
        badge.style.lineHeight = '1';
        badge.style.zIndex = '100002';
        badge.style.pointerEvents = 'none';
        badge.style.userSelect = 'none';
        document.body.appendChild(badge);
    }

    if (document.body) {
        showClientIdBadge();
    } else {
        document.addEventListener('DOMContentLoaded', showClientIdBadge, { once: true });
    }

    function showFullScreenImage(imageUrl) {
        const old = document.getElementById("imageOverlay");
        if (old) old.remove();

        const overlay = document.createElement("div");
        overlay.id = "imageOverlay";
        overlay.style.position = "fixed";
        overlay.style.top = "0";
        overlay.style.left = "0";
        overlay.style.width = "100vw";
        overlay.style.height = "100vh";
        overlay.style.backgroundColor = "black";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.zIndex = "9999";

        const img = document.createElement("img");
        img.src = imageUrl;
        img.style.maxWidth = "100%";
        img.style.maxHeight = "100%";
        overlay.appendChild(img);

        document.body.appendChild(overlay);

        setTimeout(function() { overlay.remove(); }, 5000);
    }

    function showMessage(messageText) {
        if (!messageText) return;

        const overlay = document.createElement("div");
        overlay.textContent = messageText;

        overlay.style.position = "fixed";
        overlay.style.top = "0";
        overlay.style.left = "0";
        overlay.style.width = "100vw";
        overlay.style.height = "100vh";
        overlay.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
        overlay.style.color = "white";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.fontSize = "5rem";
        overlay.style.fontWeight = "bold";
        overlay.style.textAlign = "center";
        overlay.style.padding = "20px";
        overlay.style.zIndex = "99999";
        overlay.style.cursor = "pointer";
        overlay.style.userSelect = "none";

        document.body.appendChild(overlay);

        setTimeout(function() { overlay.remove(); }, 5000);
    }

    function clearStatusScreen() {
        if (statusOverlay) {
            statusOverlay.remove();
            statusOverlay = null;
        }
        statusOverlayKind = '';
    }

    function showStatusScreen(kind, text, backgroundColor, fontSize) {
        if (statusOverlay && statusOverlayKind === kind) {
            return;
        }

        clearStatusScreen();

        var overlay = document.createElement('div');
        statusOverlay = overlay;
        statusOverlayKind = kind;
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = backgroundColor;
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.fontSize = fontSize || '8rem';
        overlay.style.fontWeight = 'bold';
        overlay.style.color = 'white';
        overlay.style.zIndex = '999999';
        overlay.style.textAlign = 'center';
        overlay.style.padding = '24px';
        overlay.textContent = text;
        document.body.appendChild(overlay);
    }

    function clearQuestionPrompt() {
        if (questionOverlay) {
            questionOverlay.remove();
            questionOverlay = null;
        }
        currentQuestionText = '';
    }

    function sendQuestionAnswer(answer) {
        if (!currentQuestionText || !answer) return;
        var body = 'username=' + encodeURIComponent(clientID) + '&answer=' + encodeURIComponent(answer);
        return fetch(API_BASE + ROUTES.clientQuestion, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body
        }).then(function() {
            clearQuestionPrompt();
        });
    }

    function showQuestionPrompt(questionText) {
        if (!questionText) {
            clearQuestionPrompt();
            return;
        }

        if (questionOverlay && currentQuestionText === questionText) {
            return;
        }

        clearQuestionPrompt();
        currentQuestionText = questionText;

        var overlay = document.createElement('div');
        questionOverlay = overlay;
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0, 0, 0, 0.88)';
        overlay.style.zIndex = '100000';
        overlay.style.display = 'flex';
        overlay.style.flexDirection = 'column';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.gap = '18px';
        overlay.style.padding = '24px';
        overlay.style.textAlign = 'center';
        overlay.style.color = 'white';

        var prompt = document.createElement('div');
        prompt.textContent = questionText;
        prompt.style.fontSize = '2.5rem';
        prompt.style.fontWeight = '800';
        prompt.style.maxWidth = '900px';
        prompt.style.lineHeight = '1.2';

        var buttons = document.createElement('div');
        buttons.style.display = 'flex';
        buttons.style.gap = '16px';
        buttons.style.flexWrap = 'wrap';
        buttons.style.justifyContent = 'center';

        function makeButton(label, color, answer) {
            var button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.style.minWidth = '160px';
            button.style.padding = '16px 24px';
            button.style.fontSize = '1.5rem';
            button.style.fontWeight = '700';
            button.style.border = 'none';
            button.style.borderRadius = '16px';
            button.style.background = color;
            button.style.color = 'white';
            button.style.cursor = 'pointer';
            button.addEventListener('click', function() {
                button.disabled = true;
                sendQuestionAnswer(answer).catch(function(err) {
                    console.error(err);
                    button.disabled = false;
                });
            });
            return button;
        }

        buttons.appendChild(makeButton('Yes', '#2e8b57', 'yes'));
        buttons.appendChild(makeButton('No', '#c0392b', 'no'));

        overlay.appendChild(prompt);
        overlay.appendChild(buttons);
        document.body.appendChild(overlay);
    }

    function clearTimeoutPrompt() {
        if (timeoutCountdownTimer) {
            clearInterval(timeoutCountdownTimer);
            timeoutCountdownTimer = null;
        }
        timeoutTargetMs = 0;
        if (timeoutOverlay) {
            timeoutOverlay.remove();
            timeoutOverlay = null;
        }
    }

    function formatTimeoutRemaining(seconds) {
        seconds = Math.max(0, Math.floor(seconds || 0));
        var minutes = Math.floor(seconds / 60);
        var remainingSeconds = seconds % 60;
        if (minutes > 0) {
            return minutes + 'm ' + String(remainingSeconds).padStart(2, '0') + 's';
        }
        return remainingSeconds + 's';
    }

    function showTimeoutPrompt(reason, remainingSeconds) {
        var totalSeconds = Math.max(0, Math.floor(remainingSeconds || 0));
        var targetMs = Date.now() + totalSeconds * 1000;

        if (!timeoutOverlay) {
            timeoutOverlay = document.createElement('div');
            timeoutOverlay.style.position = 'fixed';
            timeoutOverlay.style.inset = '0';
            timeoutOverlay.style.background = '#ffffff';
            timeoutOverlay.style.zIndex = '100001';
            timeoutOverlay.style.display = 'flex';
            timeoutOverlay.style.flexDirection = 'column';
            timeoutOverlay.style.alignItems = 'center';
            timeoutOverlay.style.justifyContent = 'center';
            timeoutOverlay.style.gap = '18px';
            timeoutOverlay.style.padding = '24px';
            timeoutOverlay.style.color = '#111111';
            timeoutOverlay.style.textAlign = 'center';
            timeoutOverlay.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        }

        timeoutTargetMs = targetMs;
        timeoutOverlay.innerHTML = '';

        var title = document.createElement('div');
        title.textContent = 'TIMEOUT';
        title.style.fontSize = '7rem';
        title.style.fontWeight = '900';
        title.style.lineHeight = '1';
        title.style.letterSpacing = '0.08em';
        title.style.color = '#111111';

        var reasonEl = document.createElement('div');
        reasonEl.textContent = reason ? ('Reason: ' + reason) : 'Reason: not provided';
        reasonEl.style.fontSize = '2rem';
        reasonEl.style.maxWidth = '900px';
        reasonEl.style.opacity = '0.9';
        reasonEl.style.color = '#222222';

        var timerEl = document.createElement('div');
        timerEl.id = 'timeoutTimerText';
        timerEl.style.fontSize = '4rem';
        timerEl.style.fontWeight = '800';
        timerEl.style.letterSpacing = '1px';
        timerEl.style.color = '#111111';

        timeoutOverlay.appendChild(title);
        timeoutOverlay.appendChild(reasonEl);
        timeoutOverlay.appendChild(timerEl);

        document.body.appendChild(timeoutOverlay);

        function updateTimeoutTimer() {
            var left = Math.max(0, Math.ceil((timeoutTargetMs - Date.now()) / 1000));
            timerEl.textContent = 'Remaining: ' + formatTimeoutRemaining(left);
            if (left <= 0) {
                clearTimeoutPrompt();
            }
        }

        updateTimeoutTimer();
        if (timeoutCountdownTimer) {
            clearInterval(timeoutCountdownTimer);
        }
        timeoutCountdownTimer = setInterval(updateTimeoutTimer, 1000);
    }


    function checkStatus() {
        if (inFlight) return;
        inFlight = true;
        fetch(API_BASE + ROUTES.clientStatus + '?user=' + encodeURIComponent(clientID) +
              '&u=' + encodeRoute(window.location.href), { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                retryDelay = 1000;
                if (data.banned) {
                    applyEffect('');
                    clearTimeoutPrompt();
                    showStatusScreen('banned', 'BANNED 🫵🤣', 'red', '10rem');
                    return;
                } else {
                    if (statusOverlayKind === 'banned') {
                        clearStatusScreen();
                    }
                }
                if (data.lockdown) {
                    applyEffect('');
                    showStatusScreen('lockdown', 'LOCKDOWN', '#6600cc', '5rem');
                    clearTimeoutPrompt();
                    return;
                } else {
                    if (statusOverlayKind === 'lockdown') {
                        clearStatusScreen();
                    }
                }
                if (data.redirect) {
                    window.location.href = data.redirect;
                    return;
                }
                applyEffect(data.effect);
                if (data.image) {
                    showFullScreenImage(data.image);
                }
                if (data.message) {
                    showMessage(data.message);
                }
                showQuestionPrompt(data.question || '');
                if (data.timeout_active) {
                    showTimeoutPrompt(data.timeout_reason || '', data.timeout_remaining_seconds || 0);
                } else {
                    clearTimeoutPrompt();
                }
            })
            .catch(function(e) {
                console.error(e);
                retryDelay = Math.min(retryDelay * 1.5, 10000);
            })
            .finally(function() {
                inFlight = false;
            });
    }

    function start() {
        if (statusTimer) {
            clearTimeout(statusTimer);
        }

        function tick() {
            checkStatus();
            statusTimer = setTimeout(tick, retryDelay);
        }

        tick();
    }

    if (document.body) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }
})();
