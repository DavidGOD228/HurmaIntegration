'use strict';

/**
 * Content script — runs on *.hurma.work pages.
 *
 * Responsibilities:
 * 1. Extract candidate ID from the current page URL.
 * 2. Auto-inject HURMA_CANDIDATE_ID into the description field when
 *    a recruiter opens the "Рекрутинг дія" modal — but ONLY if the
 *    description doesn't already contain a Hurma candidate profile URL
 *    (recruiters often paste the URL themselves, and the backend can parse it).
 * 3. Answer popup queries: getCandidateId, getRecruiterName.
 */

// ── Extract candidate ID from current URL ────────────────────────────────────
// Hurma URL pattern: https://company.hurma.work/candidates/show/74LI
function getCandidateIdFromUrl() {
  const match = window.location.pathname.match(/\/candidates\/show\/([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

// Update on SPA navigation
const _pushState = history.pushState.bind(history);
history.pushState = (...args) => { _pushState(...args); };
window.addEventListener('popstate', () => {});

// ── Try to detect the logged-in recruiter's name from the page ───────────────
function getRecruiterName() {
  // Try common Hurma DOM selectors for the user's display name.
  // These are best-effort; Hurma may update their markup.
  const selectors = [
    '.user-name',
    '.current-user__name',
    '[data-user-name]',
    '.navbar .user .name',
    '.header__user-name',
    '.profile-name',
    // Generic: avatar tooltip or title with the user name
    '[title*="Аліса"], [title*="Олена"], [title*="Дмитро"]', // just examples
  ];

  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const name = (el.textContent || el.getAttribute('title') || el.getAttribute('data-user-name') || '').trim();
        if (name && name.length > 2) return name;
      }
    } catch {}
  }

  // Fallback: look for any element that has 2+ capitalised Ukrainian/Latin words
  // near the top of the page (header area)
  const headerEls = document.querySelectorAll('header *, nav *, .header *');
  for (const el of headerEls) {
    if (el.children.length > 0) continue; // leaf nodes only
    const text = (el.textContent || '').trim();
    // Two-word name, either Latin or Cyrillic, each word 2+ chars
    if (/^[A-ZА-ЯІЇЄҐ][a-zа-яіїєґ]+\s+[A-ZА-ЯІЇЄҐ][a-zа-яіїєґ]+$/.test(text)) {
      return text;
    }
  }
  return null;
}

// ── Respond to popup messages ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'getCandidateId') {
    sendResponse({ candidateId: getCandidateIdFromUrl() });
  }
  if (msg.action === 'getRecruiterName') {
    sendResponse({ name: getRecruiterName() });
  }
});

// ── Auto-inject into description field ───────────────────────────────────────
const MARKER = 'HURMA_CANDIDATE_ID=';
const HURMA_URL_PATTERN = /hurma\.work\/candidates\/show\//i;

function hasHurmaUrl(text) {
  return HURMA_URL_PATTERN.test(text);
}

function tryInject(textarea) {
  const candidateId = getCandidateIdFromUrl();
  if (!candidateId) return;
  if (textarea.dataset.hurmaInjected === candidateId) return; // already done

  const current = textarea.value || '';

  // If the description already has a Hurma profile URL or our marker → skip
  // The backend will extract the candidate ID from the URL automatically
  if (hasHurmaUrl(current) || current.includes(MARKER)) {
    textarea.dataset.hurmaInjected = candidateId;
    return;
  }

  // Append the marker so the backend can always find it
  const separator = current.trim() ? '\n' : '';
  const newValue = current + separator + `${MARKER}${candidateId}`;

  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  nativeSetter.call(textarea, newValue);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));

  textarea.dataset.hurmaInjected = candidateId;
  showToast(`Candidate ${candidateId} linked`);
}

// ── MutationObserver: watch for modal with description textarea ───────────────
let lastSeen = null;

function checkTextareas() {
  if (!getCandidateIdFromUrl()) return;
  const textareas = document.querySelectorAll('textarea');
  for (const ta of textareas) {
    const placeholder = (ta.placeholder || '').toLowerCase();
    const isDescription =
      placeholder.includes('опис') ||
      placeholder.includes('description') ||
      placeholder.includes('загальний');
    if (isDescription && ta !== lastSeen) {
      lastSeen = ta;
      setTimeout(() => tryInject(ta), 300);
    }
  }
}

const observer = new MutationObserver(checkTextareas);
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(checkTextareas, 600);

// ── Toast notification ────────────────────────────────────────────────────────
function showToast(msg) {
  const existing = document.getElementById('hurma-recorder-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'hurma-recorder-toast';
  toast.textContent = '🔗 HurmaRecorder: ' + msg;
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    background: '#2d5be3',
    color: '#fff',
    padding: '10px 16px',
    borderRadius: '8px',
    fontSize: '13px',
    zIndex: '99999',
    boxShadow: '0 4px 12px rgba(0,0,0,.2)',
    opacity: '1',
    transition: 'opacity .3s',
  });
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 350);
  }, 3000);
}
