// Main initialization

function init() {
  // Initialize UI
  initTableListeners();
  initFilterSortListeners();

  // Load initial data
  loadClients().catch(function() {});
  updateLockdownBtn();
  setInterval(updateLockdownBtn, 30000);

  // Show initial auth state (not logged in) immediately
  updateAuthStatus();

  // Wait for accounts to load, then attempt auto-login
  if (typeof loadAccounts === 'function') {
    loadAccounts().then(function() {
      attemptAutoLogin();
      updateAuthStatus();
    }).catch(function() {
      // Accounts failed to load, still try auto-login (will fail gracefully)
      attemptAutoLogin();
      updateAuthStatus();
    });
    // Refresh accounts every 30 seconds to detect changes (password changes, account removals)
    setInterval(refreshAccounts, 30000);
  } else {
    attemptAutoLogin();
    updateAuthStatus();
  }

  // Keep auth status updated (also validates account still exists)
  setInterval(updateAuthStatus, 30000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
