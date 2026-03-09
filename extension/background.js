'use strict';

// Manifest V3 service worker — keeps the extension alive and handles
// any background tasks. Currently minimal; extend if needed.

chrome.runtime.onInstalled.addListener(() => {
  console.log('[HurmaRecorder] Extension installed/updated.');
});
