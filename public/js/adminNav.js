// Shows the "Admin" nav tab only when a valid admin session is stored in
// this browser tab — general users should never see it. Wired up via
// <script type="module" src="/js/adminNav.js"> on every page except
// admin.html, which handles its own nav state inline (it already talks to
// /api/admin/verify to unlock the panel, no need to duplicate that call).
//
// Pages using this must have a hidden link in their .tab-bar:
//   <a href="/admin.html" id="adminNavLink" hidden>Admin</a>

const link = document.getElementById('adminNavLink');
if (link) {
  const pw = sessionStorage.getItem('wa_admin_pw') || '';
  if (pw) {
    fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    }).then(res => {
      if (res.ok) link.hidden = false;
      else sessionStorage.removeItem('wa_admin_pw'); // stale/wrong - stop asking
    }).catch(() => {});
  }
}
