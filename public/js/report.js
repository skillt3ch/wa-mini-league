// Shared "Report an issue" modal — wired up on every page via
// <button id="reportBtn"> in the site header. Builds its own markup so
// each page only needs the button + this one script tag, nothing else
// duplicated in the HTML.
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

const btn = document.getElementById('reportBtn');
if (btn) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="Report an issue">
      <div class="modal-head">
        <h2>Report an issue</h2>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <p class="hint name-raw">A disputed result, someone acting up, a site bug - whatever it is, this goes straight to the admins, nobody else sees it.</p>
      <label class="modal-label">Category
        <select id="reportCategory">
          <option value="player">Player behaviour</option>
          <option value="bug">Site bug</option>
          <option value="other" selected>Other</option>
        </select>
      </label>
      <label class="modal-label">What's going on?
        <textarea id="reportMessage" rows="5" maxlength="2000" placeholder="Describe the issue..."></textarea>
      </label>
      <label class="modal-label">Your name/handle (optional)
        <input type="text" id="reportName" maxlength="60" placeholder="Leave blank to stay anonymous">
      </label>
      <div id="reportMsg"></div>
      <div class="opts">
        <button class="opt primary" id="reportSubmitBtn">Submit report</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const modal = backdrop.querySelector('.modal');
  const msgEl = backdrop.querySelector('#reportMsg');

  function open() {
    backdrop.hidden = false;
    backdrop.querySelector('#reportMessage').focus();
  }
  function close() {
    backdrop.hidden = true;
    msgEl.innerHTML = '';
    backdrop.querySelector('#reportMessage').value = '';
    backdrop.querySelector('#reportName').value = '';
    backdrop.querySelector('#reportCategory').value = 'other';
    const submitBtn = backdrop.querySelector('#reportSubmitBtn');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit report';
  }

  btn.addEventListener('click', open);
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !backdrop.hidden) close(); });
  modal.addEventListener('click', e => e.stopPropagation());

  backdrop.querySelector('#reportSubmitBtn').addEventListener('click', async () => {
    const category = backdrop.querySelector('#reportCategory').value;
    const message = backdrop.querySelector('#reportMessage').value.trim();
    const reporterName = backdrop.querySelector('#reportName').value.trim();

    if (!message) {
      msgEl.innerHTML = `<div class="err name-raw">Describe the issue before submitting.</div>`;
      return;
    }

    const submitBtn = backdrop.querySelector('#reportSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    msgEl.innerHTML = '';

    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, message, reporterName })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not submit that.');
      msgEl.innerHTML = `<div class="ok name-raw">Sent. Thanks - an admin will take a look.</div>`;
      setTimeout(close, 1600);
    } catch (ex) {
      msgEl.innerHTML = `<div class="err name-raw">${esc(ex.message)}</div>`;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit report';
    }
  });
}
