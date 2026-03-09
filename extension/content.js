'use strict';

/**
 * Content script — runs on *.hurma.work pages.
 *
 * Two responsibilities:
 * 1. Auto-inject HURMA_CANDIDATE_ID into the interview description field
 *    when a recruiter creates an interview.
 * 2. Answer popup queries about the current candidate ID.
 */

// ── Extract candidate ID from current URL ────────────────────────────────────
// Hurma URL pattern: https://company.hurma.work/.../recruitment/candidates/Je
function getCandidateIdFromUrl() {
  const match = window.location.pathname.match(/\/candidates\/([^/?#]+)/);
  return match ? match[1] : null;
}

let currentCandidateId = getCandidateIdFromUrl();

// Update when navigation happens inside the SPA
const _pushState = history.pushState.bind(history);
history.pushState = (...args) => {
  _pushState(...args);
  currentCandidateId = getCandidateIdFromUrl();
};
window.addEventListener('popstate', () => {
  currentCandidateId = getCandidateIdFromUrl();
});

// ── Answer popup queries ──────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'getCandidateId') {
    sendResponse({ candidateId: getCandidateIdFromUrl() });
  }
});

// ── Auto-inject candidate ID into interview description ───────────────────────
// Watch for the "Загальний опис" (General description) textarea that appears
// when a recruiter opens the "Рекрутинг дія" (Recruiting action) modal.

const MARKER = 'HURMA_CANDIDATE_ID=';

function tryInject(textarea) {
  const candidateId = getCandidateIdFromUrl();
  if (!candidateId) return;
  if (textarea.dataset.hurmaInjected === candidateId) return; // already injected

  const current = textarea.value || '';

  // Don't overwrite if recruiter already typed a candidate ID
  if (current.includes(MARKER)) {
    textarea.dataset.hurmaInjected = candidateId;
    return;
  }

  // Append candidate ID at the end (preserve whatever recruiter already wrote)
  const separator = current.trim() ? '\n' : '';
  const newValue = current + separator + `${MARKER}${candidateId}`;

  // Trigger React/Vue reactivity by simulating native input events
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  nativeInputValueSetter.call(textarea, newValue);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));

  textarea.dataset.hurmaInjected = candidateId;

  showToast(`Candidate ID injected: ${candidateId}`);
}

// ── MutationObserver: watch for modal with description field ─────────────────
let lastSeen = null;

const observer = new MutationObserver(() => {
  if (!getCandidateIdFromUrl()) return;

  // Find textareas that look like the description field.
  // We match on placeholder text (both Ukrainian and English variants).
  const textareas = document.querySelectorAll('textarea');
  for (const ta of textareas) {
    const placeholder = (ta.placeholder || '').toLowerCase();
    const isDescriptionField =
      placeholder.includes('опис') ||       // "опис" = description in Ukrainian
      placeholder.includes('description') ||
      placeholder.includes('загальний');

    if (isDescriptionField && ta !== lastSeen) {
      lastSeen = ta;
      // Small delay so modal fully renders before we inject
      setTimeout(() => tryInject(ta), 300);
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// Also try on page load (in case modal is already open)
setTimeout(() => {
  const textareas = document.querySelectorAll('textarea');
  for (const ta of textareas) {
    const placeholder = (ta.placeholder || '').toLowerCase();
    if (placeholder.includes('опис') || placeholder.includes('description')) {
      tryInject(ta);
    }
  }
}, 500);

// ── Small in-page toast notification ─────────────────────────────────────────
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
    transition: 'opacity .3s',
  });
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 350);
  }, 3000);
}
