// service_worker.js  (Manifest V3)
const KEY_SETTINGS = "wotd_settings";

// 初期値を一度だけ投入（既にある場合は何もしない）
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get([KEY_SETTINGS], (v) => {
    if (!v[KEY_SETTINGS]) {
      const defaults = {
        source: "dictionary.com",
        wordnikKey: "",
        wordleUseWOTD: true,
        oxfordKey: ""
      };
      chrome.storage.sync.set({ [KEY_SETTINGS]: defaults });
    }
  });
});

// Options ページ ⇄ SW のメッセージ受け口
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return; // 応答不要のメッセージは無視

  if (msg.type === "GET_SETTINGS") {
    chrome.storage.sync.get([KEY_SETTINGS], (v) => {
      sendResponse(v[KEY_SETTINGS] || null);
    });
    return true; // 非同期応答を継続
  }

  if (msg.type === "SET_SETTINGS") {
    chrome.storage.sync.get([KEY_SETTINGS], (v) => {
      const cur = v[KEY_SETTINGS] || {};
      const next = { ...cur, ...(msg.payload || {}) };
      chrome.storage.sync.set({ [KEY_SETTINGS]: next }, () => {
        sendResponse({ ok: true, settings: next });
      });
    });
    return true; // 非同期応答を継続
  }
});
