'use strict';
/* markClipper — panel-only background. No popup. Action click always opens side panel. */

const PANEL = 'sidepanel.html';

chrome.runtime.onInstalled.addListener(async () => {
  try { await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch (e) {}
  try { await chrome.sidePanel.setOptions({ path: PANEL, enabled: true }); } catch (e) {}
  buildMenus();
});

chrome.runtime.onStartup.addListener(async () => {
  try { await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch (e) {}
});

function buildMenus() {
  try { chrome.contextMenus.removeAll(() => {
    const items = [
      { id: 'mc-open', title: 'Open markClipper panel', contexts: ['action'] },
      { id: 'mc-article', title: 'Clip article as Markdown', contexts: ['page', 'frame'] },
      { id: 'mc-full', title: 'Clip full page as Markdown', contexts: ['page', 'frame'] },
      { id: 'mc-selection', title: 'Clip selection as Markdown', contexts: ['selection'] },
      { id: 'mc-images', title: 'Grab all photos from page', contexts: ['page', 'frame'] },
      { id: 'mc-shot', title: 'Screenshot visible page', contexts: ['page', 'frame', 'action'] },
      { id: 'mc-link', title: 'Clip link as Markdown bookmark', contexts: ['link'] },
      { id: 'mc-image', title: 'Clip this photo as Markdown', contexts: ['image'] },
      { id: 'mc-image-dl', title: 'Download this photo', contexts: ['image'] },
      { id: 'mc-bookmark', title: 'Clip bookmark (title + URL)', contexts: ['page', 'action'] }
    ];
    for (const it of items) { try { chrome.contextMenus.create(it); } catch (e) {} }
  }); } catch (e) {}
}

async function openPanel(tab) {
  try {
    const win = tab && tab.windowId != null ? tab.windowId : undefined;
    if (win != null) { try { await chrome.sidePanel.open({ windowId: win }); return; } catch (e) {} }
    // fallback: enable + rely on action click behavior
    try { await chrome.sidePanel.setOptions({ path: PANEL, enabled: true }); } catch (e) {}
  } catch (e) {}
}

async function requestClip(mode, info) {
  // remember what the user asked so the panel can auto-clip on open
  try {
    await chrome.storage.session.set({
      mcPending: { mode: mode || 'article', at: Date.now(), info: info || null }
    });
  } catch (e) {}
  let tab = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tab = tabs && tabs[0];
  } catch (e) {}
  await openPanel(tab);
  // nudge the panel in case it is already open
  try { chrome.runtime.sendMessage({ type: 'mc-clip-request', mode: mode || 'article', info: info || null }); } catch (e) {}
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = info.menuItemId || '';
  if (id === 'mc-open' || id === 'mc-bookmark') {
    if (id === 'mc-bookmark') requestClip('bookmark', { pageUrl: info.pageUrl });
    else openPanel(tab);
    return;
  }
  if (id === 'mc-article') requestClip('article', { pageUrl: info.pageUrl });
  else if (id === 'mc-full') requestClip('full', { pageUrl: info.pageUrl });
  else if (id === 'mc-selection') requestClip('selection', { selectionText: info.selectionText, pageUrl: info.pageUrl });
  else if (id === 'mc-images') requestClip('images', { pageUrl: info.pageUrl });
  else if (id === 'mc-shot') requestClip('screenshot', { pageUrl: info.pageUrl });
  else if (id === 'mc-link') requestClip('link', { linkUrl: info.linkUrl, pageUrl: info.pageUrl });
  else if (id === 'mc-image') requestClip('image', { srcUrl: info.srcUrl, pageUrl: info.pageUrl });
  else if (id === 'mc-image-dl') {
    try { chrome.downloads.download({ url: info.srcUrl, saveAs: false }); } catch (e) {}
    requestClip('image', { srcUrl: info.srcUrl, pageUrl: info.pageUrl });
  }
});

chrome.action.onClicked.addListener((tab) => { openPanel(tab); });

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'clip-article') requestClip('article');
  else if (cmd === 'clip-selection') requestClip('selection');
  else if (cmd === 'clip-images') requestClip('images');
  else if (cmd === 'clip-screenshot') requestClip('screenshot');
  else if (cmd === 'clip-bookmark') requestClip('bookmark');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'mc-open-panel') { openPanel(sender && sender.tab); sendResponse({ ok: true }); return true; }
  if (msg && msg.type === 'mc-clip-request') { requestClip(msg.mode, msg.info); sendResponse({ ok: true }); return true; }
});
