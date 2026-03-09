'use strict';

const $ = (id) => document.getElementById(id);

// ── On load ──────────────────────────────────────────────────────────────────
chrome.storage.local.get(['token', 'backendUrl', 'webhookUrl', 'userName'], (data) => {
  if (data.token) {
    showMain(data);
    loadActivity(data.backendUrl, data.token);
    detectCurrentCandidate();
  } else {
    showSetup();
  }
});

// ── Setup ─────────────────────────────────────────────────────────────────────
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
  const name    = $('setup-name').value.trim();
  const apiKey  = $('setup-api-key').value.trim();
  const secret  = $('setup-secret').value.trim();
  const backend = $('setup-backend').value.trim().replace(/\/$/, '');

  if (!name || !apiKey || !secret || !backend) {
    showError('setup-error', 'All fields are required.');
    return;
  }

  $('register-btn').textContent = 'Registering...';
  $('register-btn').disabled = true;

  try {
    const res = await fetch(`${backend}/api/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        fireflies_api_key: apiKey,
        fireflies_webhook_secret: secret,
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      showError('setup-error', json.error || 'Registration failed.');
      return;
    }

    chrome.storage.local.set({
      token: json.webhook_token,
      backendUrl: backend,
      webhookUrl: json.webhook_url,
      userName: json.name,
    }, () => {
      showMain({ token: json.webhook_token, backendUrl: backend, webhookUrl: json.webhook_url });
      loadActivity(backend, json.webhook_token);
    });
  } catch (err) {
    showError('setup-error', `Could not reach backend: ${err.message}`);
  } finally {
    $('register-btn').textContent = 'Register';
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

// ── Load recent activity from backend ────────────────────────────────────────
async function loadActivity(backendUrl, token) {
  try {
    const res = await fetch(`${backendUrl}/api/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    renderActivity(data.recent_activity || []);
  } catch {
    // Network or backend unavailable — show empty
  }
}

function renderActivity(items) {
  const list = $('activity-list');
  if (!items.length) {
    list.innerHTML = '<div class="empty">No activity yet</div>';
    return;
  }

  list.innerHTML = items.slice(0, 8).map((item) => {
    const title = item.title || item.fireflies_meeting_id || 'Meeting';
    const date  = item.received_at ? new Date(item.received_at).toLocaleDateString() : '';
    const badge = badgeFor(item.processing_status);
    return `
      <div class="activity-item">
        <div class="activity-title">
          ${escHtml(title)}
          <span>${escHtml(date)}${item.hurma_candidate_id ? ` · Candidate: ${escHtml(item.hurma_candidate_id)}` : ''}</span>
        </div>
        ${badge}
      </div>`;
  }).join('');
}

function badgeFor(status) {
  const map = { done: 'done', failed: 'failed', pending: 'pending', duplicate: 'duplicate', processing: 'pending' };
  const cls = map[status] || 'pending';
  return `<span class="badge ${cls}">${status || 'pending'}</span>`;
}

// ── Detect current candidate from the active Hurma tab ───────────────────────
function detectCurrentCandidate() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: 'getCandidateId' }, (response) => {
      if (chrome.runtime.lastError) return; // not on a Hurma page
      if (response && response.candidateId) {
        $('candidate-section').style.display = 'block';
        $('candidate-bar').textContent = `Candidate ID: ${response.candidateId} — auto-inject is active`;
      }
    });
  });
}

// ── Logout ────────────────────────────────────────────────────────────────────
$('logout-btn').addEventListener('click', () => {
  if (confirm('Remove registration from this browser?')) {
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
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
