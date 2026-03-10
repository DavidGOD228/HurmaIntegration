'use strict';

// BACKEND_URL is defined in config.js (loaded before this script in popup.html)
const backendUrl = (typeof BACKEND_URL !== 'undefined' ? BACKEND_URL : '').replace(/\/$/, '');

const $ = (id) => document.getElementById(id);

// ── On load ───────────────────────────────────────────────────────────────────
chrome.storage.local.get(['token', 'webhookUrl'], (data) => {
  if (data.token) {
    showMain(data);
    loadActivity(data.token);
    detectCurrentCandidate();
  } else {
    showSetup();
  }
});

// ── Setup / Registration ──────────────────────────────────────────────────────
function showSetup() {
  $('setup-section').style.display = 'block';
  $('main-section').style.display = 'none';
  $('status-dot').className = 'dot red';
}

function showMain(data) {
  $('setup-section').style.display = 'none';
  $('main-section').style.display = 'block';
  $('status-dot').className = 'dot';
  $('webhook-url').textContent = data.webhookUrl || '';
}

$('register-btn').addEventListener('click', async () => {
  const apiKey = $('setup-api-key').value.trim();
  const secret = $('setup-secret').value.trim();

  if (!apiKey || !secret) {
    showError('setup-error', 'Both fields are required.');
    return;
  }
  if (!backendUrl) {
    showError('setup-error', 'Backend URL not configured. Edit extension/config.js.');
    return;
  }

  $('register-btn').textContent = 'Connecting…';
  $('register-btn').disabled = true;
  $('setup-error').style.display = 'none';

  // Try to get recruiter name from the active Hurma tab
  const recruiterName = await getRecruiterNameFromTab();

  try {
    const res = await fetch(`${backendUrl}/api/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: recruiterName || 'Recruiter',
        fireflies_api_key: apiKey,
        fireflies_webhook_secret: secret,
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      showError('setup-error', json.error || 'Registration failed.');
      return;
    }

    chrome.storage.local.set({ token: json.webhook_token, webhookUrl: json.webhook_url }, () => {
      showMain({ token: json.webhook_token, webhookUrl: json.webhook_url });
      loadActivity(json.webhook_token);
    });
  } catch (err) {
    showError(
      'setup-error',
      `Cannot reach backend (${backendUrl}). Is the server running?\n${err.message}`,
    );
  } finally {
    $('register-btn').textContent = 'Connect';
    $('register-btn').disabled = false;
  }
});

// ── Copy webhook URL ──────────────────────────────────────────────────────────
$('copy-btn').addEventListener('click', () => {
  const url = $('webhook-url').textContent;
  navigator.clipboard.writeText(url).then(() => {
    const msg = $('copy-success');
    msg.style.display = 'block';
    setTimeout(() => { msg.style.display = 'none'; }, 2000);
  });
});

// ── Load recent activity ──────────────────────────────────────────────────────
async function loadActivity(token) {
  try {
    const res = await fetch(`${backendUrl}/api/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    renderActivity(data.recent_activity || []);
  } catch {
    // Server unreachable — just show empty
  }
}

function renderActivity(items) {
  const list = $('activity-list');
  if (!items.length) {
    list.innerHTML = '<div class="empty">No activity yet</div>';
    return;
  }
  list.innerHTML = items.slice(0, 8).map((item) => {
    const title = escHtml(item.title || item.fireflies_meeting_id || 'Meeting');
    const date  = item.received_at ? new Date(item.received_at).toLocaleDateString() : '';
    const cid   = item.hurma_candidate_id ? ` · ${escHtml(item.hurma_candidate_id)}` : '';
    return `
      <div class="activity-item">
        <div class="activity-title">
          ${title}
          <span>${escHtml(date)}${cid}</span>
        </div>
        ${badgeFor(item.processing_status)}
      </div>`;
  }).join('');
}

function badgeFor(status) {
  const cls = { done: 'done', failed: 'failed', pending: 'pending', duplicate: 'duplicate' }[status] || 'pending';
  return `<span class="badge ${cls}">${escHtml(status || 'pending')}</span>`;
}

// ── Detect current candidate (content script → popup) ────────────────────────
function detectCurrentCandidate() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: 'getCandidateId' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.candidateId) {
        $('candidate-section').style.display = 'block';
        $('candidate-bar').textContent = `Candidate ID: ${response.candidateId} — auto-inject is active on this page`;
      }
    });
  });
}

// ── Get recruiter name from active Hurma tab ──────────────────────────────────
function getRecruiterNameFromTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return resolve(null);
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getRecruiterName' }, (response) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(response?.name || null);
      });
    });
  });
}

// ── Logout ────────────────────────────────────────────────────────────────────
$('logout-btn').addEventListener('click', () => {
  if (confirm('Disconnect this account from your browser?')) {
    chrome.storage.local.clear(() => showSetup());
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function showError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.style.display = 'block';
}
function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
