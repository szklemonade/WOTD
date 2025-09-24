// options.js
const KEY_SETTINGS = "wotd_settings";

const $ = (id) => document.getElementById(id);
const sourceSel       = $("source");
const wordnikKeyInput = $("wordnikKey");
const wordleUseWOTD   = $("wordleUseWOTD");
const oxfordKeyInput  = $("oxfordKey");
const saveBtn         = $("save");
const statusEl        = $("status");

// chrome.storage.sync を直に使う（SWなしでOK）
function getSync(k){
  return new Promise(r=>{
    if (chrome?.storage?.sync) chrome.storage.sync.get([k], v => r(v[k] || null));
    else r(JSON.parse(localStorage.getItem(k) || "null"));
  });
}
function setSync(k,v){
  return new Promise(r=>{
    if (chrome?.storage?.sync) chrome.storage.sync.set({[k]:v}, ()=>r(true));
    else { localStorage.setItem(k, JSON.stringify(v)); r(true); }
  });
}

(async function init(){
  const s = (await getSync(KEY_SETTINGS)) || {};
  sourceSel.value            = s.source || "dictionary.com";
  wordnikKeyInput.value      = s.wordnikKey || "";
  wordleUseWOTD.checked      = s.wordleUseWOTD ?? true;
  oxfordKeyInput.value       = s.oxfordKey || "";
})();

saveBtn.addEventListener("click", async ()=>{
  const cur = (await getSync(KEY_SETTINGS)) || {};
  const next = {
    ...cur,
    source: sourceSel.value,
    wordnikKey: (wordnikKeyInput.value || "").trim(),
    wordleUseWOTD: !!wordleUseWOTD.checked,
    oxfordKey: (oxfordKeyInput.value || "").trim()
  };
  await setSync(KEY_SETTINGS, next);
  const tail = next.oxfordKey ? ` (Oxford …${next.oxfordKey.slice(-4)})` : "";
  statusEl.textContent = "Saved!" + tail;
  setTimeout(()=> statusEl.textContent = "", 1500);
});
