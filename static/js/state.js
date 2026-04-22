// Global state
var clientState = {
  clients: {},
  filter: 'all',
  sortBy: 'recent',
  autoRefresh: false
};

var lockdownState = { active: false };
var requestSeq = 0;
var refreshTimer = null;

// Route configuration
var ROUTE_KEY = 'manger';

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
  auditLog: '/audit/log',
  lockdown: '/lockdown',
  lockdownJson: '/lockdown.json'
});

// Client identification for polls (admin & client interfaces)
function getCookie(name) {
  var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}
function setCookie(name, value, days) {
  if (days === undefined) days = 300;
  var d = new Date();
  d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
  document.cookie = name + '=' + value + ';expires=' + d.toUTCString() + ';path=/';
}
function generateID(length) {
  if (length === undefined) length = 8;
  var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var id = '';
  for (var i = 0; i < length; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}
var clientID = getCookie('clientID');
if (!clientID) {
  clientID = generateID();
  setCookie('clientID', clientID, 300);
}

function sendAudit(action, target, details, success) {
  var performer = authSession.currentLabel || 'anonymous';
  var body = JSON.stringify({
    performer: performer,
    action: action,
    target: target || 'system',
    details: details || {},
    success: success !== false ? true : false
  });
  return fetch(ROUTES.auditLog, {
    method: 'POST',
    body: body,
    headers: {'Content-Type': 'application/json'}
  }).catch(function(err) {
    console.warn('Audit log failed:', err);
  });
}
