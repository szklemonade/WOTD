// ========== 設定 & 参照 ==========
// 置き換え

const SOURCES = [
  "dictionary.com","oxford","merriam-webster","awad","nyt","wordnik","wordspy","vocabulary","cambridge"
];

const SOURCE_LABEL = {
  "dictionary.com":"Dictionary.com","oxford":"Oxford","merriam-webster":"Merriam-Webster",
  "awad":"A.Word.A.Day","nyt":"NYT","wordnik":"Wordnik","wordspy":"wordspy","vocabulary":"vocabulary",
  "cambridge":"Cambridge"
};

const el = (id)=>document.getElementById(id);
const content=el("content"), refreshBtn=el("refresh"), sourceLink=el("sourceLink");
const sourceSel=el("sourceSel"), tabWOTD=el("tab-wotd"), tabAll=el("tab-all");
const viewWOTD=el("view-wotd"), viewAll=el("view-all"), footerWOTD=el("footer-wotd");
const listEl=el("list");
const datePick = el("datePick"), dateGo = el("dateGo"), dateToday = el("dateToday");
const HAS_CHROME = typeof chrome!=="undefined";
const KEY_CACHE="wotd_cache", KEY_SETTINGS="wotd_settings";

const Storage = {
  async getLocal(k){ if(HAS_CHROME && chrome.storage?.local) return new Promise(r=>chrome.storage.local.get([k],v=>r(v[k]||null)));
    try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{ return null; } },
  async setLocal(k,v){ if(HAS_CHROME && chrome.storage?.local) return new Promise(r=>chrome.storage.local.set({[k]:v},()=>r(true)));
    try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} return true; },
  async getSync(k){ if(HAS_CHROME && chrome.storage?.sync) return new Promise(r=>chrome.storage.sync.get([k],v=>r(v[k]||null)));
    try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{ return null; } },
  async setSync(k,v){ if(HAS_CHROME && chrome.storage?.sync) return new Promise(r=>chrome.storage.sync.set({[k]:v},()=>r(true)));
    try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} return true; }
};

// ========== 入口 ==========
let currentTab="wotd", allCache=null;
init();

refreshBtn?.addEventListener("click",()=>{ if(currentTab==="all") loadAll(true); else load(true); });
tabWOTD?.addEventListener("click",()=>activate("wotd"));
tabAll?.addEventListener("click",()=>activate("all"));
sourceSel?.addEventListener("change", async ()=>{
  const s=(await Storage.getSync(KEY_SETTINGS))||{};
  await Storage.setSync(KEY_SETTINGS,{...s, source:sourceSel.value});
  if (datePick?.value) {
    // 任意日モード中はその日付で再取得
    loadForDate(datePick.value);
  } else if (currentTab!=="all") {
    load(true);
  }
});

listEl?.addEventListener("click", async (e)=>{
  const btn=e.target?.closest?.("button[data-use]"); if(!btn) return;
  const src=btn.getAttribute("data-use"); btn.disabled=true; const t=btn.textContent; btn.textContent="Using…";
  try{ const s=(await Storage.getSync(KEY_SETTINGS))||{};
    await Storage.setSync(KEY_SETTINGS,{...s, source:src});
    if(sourceSel) sourceSel.value=src; activate("wotd"); await load(true);
  } finally { btn.disabled=false; btn.textContent=t; }
});
dateGo?.addEventListener("click", () => {
  const v = datePick?.value?.trim();
  if (v) loadForDate(v);
});

datePick?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const v = datePick?.value?.trim();
    if (v) loadForDate(v);
  }
});

dateToday?.addEventListener("click", () => {
  if (datePick) datePick.value = "";
  // きょうの通常フローへ戻す
  activate("wotd");
  load(true);
});


async function init(){
  try{
    let s=await Storage.getSync(KEY_SETTINGS);
    if(!s){ s={ source:"dictionary.com", wordnikKey:"" }; await Storage.setSync(KEY_SETTINGS,s); }
    if(sourceSel) sourceSel.value=s.source||"dictionary.com";
    await load(false);
    activate("wotd");
  }catch(err){ renderError(err); }
  if (datePick) datePick.max = new Date().toISOString().slice(0,10);

// たとえば init() の最後など
listEl?.classList.add('cards-grid');
}

function activate(tab){
  currentTab=tab;
  const isW=tab==="wotd", isA=tab==="all";
  tabWOTD?.classList.toggle("active",isW);
  tabAll?.classList.toggle("active",isA);
  if(viewWOTD) viewWOTD.hidden=!isW;
  if(viewAll) viewAll.hidden=!isA;
  if(footerWOTD) footerWOTD.style.display=isW?"flex":"none";
  if(isA) loadAll(false);
}

// ========== データ取得 ==========
async function load(force){
  renderLoading();
  const s=(await Storage.getSync(KEY_SETTINGS))||{};
  const today=new Date().toISOString().slice(0,10);
  const cache=await Storage.getLocal(KEY_CACHE);
  const okCache=cache && !force && cache.dateISO===today && cache.source===s.source;
  if(okCache){ render(cache.data); return; }
  try{
    const timeout=(ms)=>new Promise((_,rej)=>setTimeout(()=>rej(new Error("Timeout")),ms));
    const data=await Promise.race([ fetchWOTD(s.source, s.wordnikKey), timeout(15000) ]);
    await Storage.setLocal(KEY_CACHE,{dateISO:today, source:s.source, data});
    render(data);
  }catch(e){ renderError(e); }
}

async function loadAll(force){
  const today=new Date().toISOString().slice(0,10);
  if(!force && allCache?.dateISO===today){ renderList(allCache.items); return; }
  if(listEl) listEl.innerHTML=`<div class="loading">Loading...</div>`;
  const s=(await Storage.getSync(KEY_SETTINGS))||{};
  const results=await Promise.all(SOURCES.map(async (src)=>{
    try{
      if(src==="wordnik" && !s?.wordnikKey) throw new Error("Set Wordnik API key in Options");
      const data=await fetchWOTD(src, s?.wordnikKey);
      return { source:src, ok:true, data };
    }catch(err){
      return { source:src, ok:false, error:err?.message||String(err) };
    }
  }));
  allCache={dateISO:today, items:results};
  renderList(results);
}

// ========== フェッチャ群（このファイル内に同居：export/import なし） ==========
const H = {
  async text(url){ const r=await fetch(url,{credentials:"omit"}); if(!r.ok) throw new Error(`${url} ${r.status}`); return r.text(); },
  doc(html){ return new DOMParser().parseFromString(html,"text/html"); },
  bullets(lines,n=2){ return (lines||[]).filter(Boolean).slice(0,n).map(t=>`• ${t}`).join("\n"); },
  pick(arr){ return arr.filter(Boolean).map(s=>s.trim()); },
  slugWord(url,reList){ for(const re of reList){ const m=url.match(re); if(m?.[1]) return m[1].replace(/-+/g," "); } return ""; }
};


// --- Dictionary.com WOTD（JST当日/前日判定 + カレンダーブロック抽出 → 既存フォールバック）---
async function fetchFromDictionary(){
  const url = "https://www.dictionary.com/e/word-of-the-day/";
  const html = await H.text(url);
  const doc  = H.doc(html);
  const norm = (s)=> (s||"").trim().replace(/\s+/g," ");

  // ── 単語名（タイトル等から取得：後で照合に使う） ──
  const titles = [
    doc.querySelector("meta[property='og:title']")?.content,
    doc.querySelector("meta[name='twitter:title']")?.content,
    doc.querySelector("title")?.textContent,
    doc.querySelector("h1")?.textContent
  ].filter(Boolean).map(norm);
  let metaWord = "";
  for (const t of titles){
    const m = /Word of the Day[:\s-]*([A-Za-z][A-Za-z\-']{1,})/i.exec(t);
    if (m?.[1]) { metaWord = m[1]; break; }
  }
  if (!metaWord) metaWord = norm(doc.querySelector(".otd-item-headword__word, article h1, h1")?.textContent || "");

  // ── JSTの today / yesterday を文字列化 ──
  const jstNow = new Date(Date.now() + 9*60*60*1000);
  const toISO = (d)=> new Date(d - 9*60*60*1000).toISOString().slice(0,10); // 保存はISO(UTC)だけど比較用に文字で
  const today = toISO(+jstNow);
  const yest  = toISO(+jstNow - 24*60*60*1000);

  // ── 1) カレンダーブロック（曜日+月日+年 → 語 → 品詞 → 定義）を丸ごとテキストから抽出 ──
  function parseBlocksFromText() {
    const text = norm(doc.body?.innerText || doc.body?.textContent || "");
    // 例: "Friday, September 12, 2025 tycoon ... noun a businessperson with great wealth or influence"
    const re = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\s+([A-Za-z][A-Za-z\-']{1,})[\s\S]*?\b(noun|verb|adjective|adverb)\b[\s:]*([a-z].{8,220}?)(?=\s+(?:Learn More|Look it up|More about|EXAMPLES|WHAT'S YOUR WORD IQ|Load More|Word of the Day Calendar|[A-Z][a-z]+,\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})|\s*$)/gi;
    const monthMap = {January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,September:8,October:9,November:10,December:11};
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      const y = +m[4], mo = monthMap[m[2]], d = +m[3];
      const dateISO = new Date(Date.UTC(y, mo, d)).toISOString().slice(0,10);
      out.push({
        dateISO,
        word: m[5],
        pos: m[6].toLowerCase(),
        def: norm(m[7])
      });
    }
    return out;
  }

  const blocks = parseBlocksFromText();

  // ── 2) ブロックが取れたら JST基準で当日→前日→最新を選ぶ（metaWord一致があれば最優先） ──
  let picked = null;
  if (blocks.length) {
    // metaWord が一致する候補を優先（tycoon 等）
    const eq = blocks.filter(b => b.word.toLowerCase() === metaWord.toLowerCase());
    const byDate = (a,b)=> (a.dateISO < b.dateISO ? 1 : a.dateISO > b.dateISO ? -1 : 0);

    if (eq.length) {
      eq.sort(byDate);
      picked = eq[0];
    } else {
      const todays = blocks.filter(b => b.dateISO === today);
      const yests  = blocks.filter(b => b.dateISO === yest);
      if (todays.length) { todays.sort(byDate); picked = todays[0]; }
      else if (yests.length){ yests.sort(byDate); picked = yests[0]; }
      else { blocks.sort(byDate); picked = blocks[0]; }
    }
  }

  // ── 3) ブロックから確定できたら即返す ──
  if (picked && picked.def) {
    return {
      source: "dictionary.com",
      word: picked.word || metaWord || "(unknown)",
      pronunciation: "",
      excerpt: "",
      definitions: `• ${picked.def}`,
      examples: "",
      url
    };
  }

  // ── 4) 保険：従来の "What It Means" → 本文 → /browse/<word> の順で抽出 ──
  const scope = doc.querySelector("article, main, #content, .content") || doc;
  const isNoiseText = (t)=>[
    /^Advertisement$/i, /^Sponsored/i, /^Subscribe/i, /^Sign up/i, /^Share\b/i,
    /^Related:/i, /^More from/i, /^Trending/i, /^Privacy/i, /^About\b/i,
    /^Word of the Day$/i, /^Word of the Day Calendar$/i, /^Load More$/i,
    /^By clicking/i, /Terms\s*&\s*Conditions/i, /Privacy\s*polic(y|ies)/i,
    /^Name$/i, /This field is for validation purposes/i, /Email/i, /Your email/i,
    /^Previous Words/i, /^Yesterday'?s Word/i, /^Learn More$/i, /^Look it up$/i
  ].some(re=>re.test(t));
  const isNoiseContainer = (el)=> !!el.closest?.(
    'form, nav, footer, header, aside, .newsletter, .subscribe, .subscription, .signup, .modal, [role="dialog"], .previous, [class*="previous-words"], [data-section="previous-words"], [class*="calendar"]'
  );

  function findHeader(re){
    const nodes = Array.from(scope.querySelectorAll("h1,h2,h3,h4,strong,em,p,div"));
    return nodes.find(n => re.test(norm(n.textContent||"")));
  }
  const hdr = findHeader(/what\s+it\s+means/i);
  function collectDefinitionCandidates(startEl){
    const endRE = /^(Why\s+We\s+Love\s+It|Where\s+It\s+Comes\s+From|Did\s+You\s+Know)/i;
    const out = [];
    for (let el = startEl?.nextElementSibling; el; el = el.nextElementSibling){
      const tag = el.tagName || "";
      const txt = norm(el.textContent || "");
      if (/^H[1-6]$/.test(tag) && endRE.test(txt)) break;
      if (!el.matches("p, li, div, section")) continue;
      if (isNoiseContainer(el)) continue;
      if (!txt || isNoiseText(txt)) continue;
      out.push(txt);
      if (out.length >= 4) break;
    }
    return out;
  }
  function pickDefinition(cands){
    let hit = cands.find(t => /^(an?\s+[a-z]|to\s+[a-z])/i.test(t) && t.length <= 160);
    if (hit) return [hit];
    hit = cands.find(t => /^(noun|verb|adjective|adverb)\s*:\s*/i.test(t) && t.length <= 180);
    if (hit) return [hit.replace(/^(noun|verb|adjective|adverb)\s*:\s*/i, "").trim()];
    const mids = cands.filter(t => t.length >= 40 && t.length <= 200);
    if (mids.length) return [mids[0]];
    return cands.slice(0,2);
  }
  async function extractFromBrowse(wordStr){
    if (!wordStr) return { defs:"", url:"" };
    const browURL = `https://www.dictionary.com/browse/${encodeURIComponent(wordStr.toLowerCase().replace(/\s+/g,"-"))}`;
    try{
      const bhtml = await H.text(browURL);
      const bdoc  = H.doc(bhtml);
      let desc = (bdoc.querySelector('meta[name="description"]')?.content || "").trim();
      desc = desc.replace(/\s*See (?:more|definition).*/i, "").trim();
      if (desc && desc.length > 20) return { defs:`• ${desc}`, url:browURL };
      let lines = Array.from(bdoc.querySelectorAll('.one-click-content, .def, [data-type="definition"], [class^="css-"]'))
        .map(n => norm(n.textContent || "")).filter(t => t && t.length > 20);
      if (lines.length) return { defs: H.bullets(lines, 2), url:browURL };
    }catch{}
    return { defs:"", url:browURL };
  }

  let cands = hdr ? collectDefinitionCandidates(hdr) : [];
  if (!cands.length){
    const head = scope.querySelector(".otd-item-headword__word, h1") || scope.firstElementChild;
    if (head) cands = collectDefinitionCandidates(head);
  }
  let defLines = pickDefinition(cands);
  if (!defLines.length){
    const m = (doc.querySelector('meta[name="description"]')?.content ||
               doc.querySelector('meta[property="og:description"]')?.content ||
               doc.querySelector('meta[name="twitter:description"]')?.content || "").trim();
    if (m && !/Build your vocabulary/i.test(m)) defLines = [m];
  }

  let defs = H.bullets(defLines, 2);
  let canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href") || url;

  if (!defs && metaWord) {
    const br = await extractFromBrowse(metaWord);
    if (br.defs) { defs = br.defs; canonical = br.url || canonical; }
  }

  return {
    source: "dictionary.com",
    word: metaWord || "(unknown)",
    pronunciation: "",
    excerpt: "",
    definitions: defs || "",
    examples: "",
    url: canonical
  };
}
//---Dictionary.com ここまで

// --- Merriam-Webster WOTD（記事スコープ限定＋見出し優先の堅牢版）---
async function fetchFromMW(){
  const url = "https://www.merriam-webster.com/word-of-the-day";
  const html = await H.text(url);
  const doc  = H.doc(html);

  // 単語：見出し → canonical のスラッグ → タイトル
  let word =
    (doc.querySelector(".word-and-pronunciation h1, h1.word-header-txt")?.textContent || "").trim();
  if (!word) {
    const canon = doc.querySelector('link[rel="canonical"]')?.getAttribute("href") || "";
    const m = canon.match(/word-of-the-day\/([a-z\-']+)-\d{4}-\d{2}-\d{2}/i);
    if (m) word = m[1].replace(/-+/g, " ").trim();
  }
  if (!word) {
    const titles = H.pick([
      doc.querySelector("meta[property='og:title']")?.content,
      doc.querySelector("meta[name='twitter:title']")?.content,
      doc.querySelector("title")?.textContent,
      doc.querySelector("h1")?.textContent
    ]);
    for (const t of titles){
      const m = /Word of the Day[:\s-]*([A-Za-z][A-Za-z\-']{1,})/i.exec(t);
      if (m?.[1]) { word = m[1]; break; }
    }
  }

  // 記事スコープ（ここから外はナビ扱いとして無視）
  const scope =
    doc.querySelector("article") ||
    doc.querySelector("main") ||
    doc;

  // ノイズ除去語（ナビ/購読/広告など）
  const drop = [
    /^Chatbot$/i, /^Games$/i, /^Quizzes?$/i, /^Word of the Day/i,
    /^Subscribe/i, /^Advertisement$/i, /^Privacy/i, /^About\b/i,
    /^Learn More/i, /^See All/i, /^Trending Now/i
  ];

  // 1) 「What It Means」見出しの直後の段落を優先
  let defParas = [];
  const meansHdr = Array.from(scope.querySelectorAll("h2,h3,strong,em"))
    .find(n => /What\s+It\s+Means/i.test((n.textContent||"").trim()));
  if (meansHdr) {
    let el = meansHdr.parentElement;
    // 見出しの次の段落～2つ
    while (el && defParas.length < 2) {
      el = el.nextElementSibling;
      if (!el) break;
      if (el.matches("p, div, section, article, li")) {
        const t = (el.textContent || "").trim().replace(/\s+/g," ");
        if (t && !drop.some(re => re.test(t)) && t.length > 30) defParas.push(t);
      }
    }
  }

  // 2) 公式の定義ブロック（wod-definition-container）があればそこから
  if (defParas.length === 0) {
    defParas = Array.from(scope.querySelectorAll(".wod-definition-container p, .wod-definition-container li"))
      .map(n => (n.textContent || "").trim().replace(/\s+/g," "))
      .filter(Boolean)
      .filter(t => !drop.some(re => re.test(t)))
      .filter(t => t.length > 30)
      .slice(0, 2);
  }

  // 3) さらに無ければ記事本文の長文段落から抽出
  if (defParas.length === 0) {
    defParas = Array.from(scope.querySelectorAll("section p, article p"))
      .map(n => (n.textContent || "").trim().replace(/\s+/g," "))
      .filter(Boolean)
      .filter(t => !drop.some(re => re.test(t)))
      .filter(t => t.length > 60)
      .slice(0, 2);
  }

  // 4) 最後の保険：meta description
  if (defParas.length === 0) {
    const meta =
      doc.querySelector('meta[name="description"]')?.content ||
      doc.querySelector('meta[property="og:description"]')?.content || "";
    if (meta) defParas = [meta.trim()];
  }

  const defs = H.bullets(defParas, 2);

  return {
    source: "merriam-webster",
    word: word || "(unknown)",
    pronunciation: "",
    excerpt: "",
    definitions: defs,
    examples: "",
    url
  };
}
//---Merriam-Webster ここまで

// Oxford（API優先・403/401/権限不足は自動フォールバック）
async function fetchFromOxford() {
  const API_BASE = "https://www.oxfordlearnersdictionaries.com/api/v1";
  const s   = (await Storage.getSync("wotd_settings")) || {};
  const key = (s.oxfordKey || "").trim();  // Options で保存したキー

  const day = new Date().toISOString().slice(0,10);

  // ---------------- フォールバック（スクレイピング最小版） ----------------
  async function fallbackScrape() {
    const base = "https://www.oxfordlearnersdictionaries.com";
    const home = `${base}/`;
    const hhtml = await H.text(home);
    const hdoc  = H.doc(hhtml);
    const scope = (Array.from(hdoc.querySelectorAll("h1,h2,h3,section,article,div,span,p"))
                  .find(n => /Word of the Day/i.test((n.textContent||"").replace(/\s+/g," ")))?.closest("section,article,div")) || hdoc;

    let a = Array.from(scope.querySelectorAll('a[href*="/definition/english/"]'));
    if (!a.length) a = Array.from(hdoc.querySelectorAll('a[href*="/definition/english/"]'));
    a = a.filter(x => /\/definition\/english\/[A-Za-z0-9_\-]+/.test(x.getAttribute("href")||""))
         .sort((x,y)=> (x.getAttribute("href").length - y.getAttribute("href").length));
    if (!a.length) throw new Error("oxford: no link for today on home");

    const href   = a[0].getAttribute("href");
    const defURL = href.startsWith("http") ? href : new URL(href, base).toString();

    const dhtml = await H.text(defURL);
    const ddoc  = H.doc(dhtml);

    let word = (ddoc.querySelector("h1.headword, .headword")?.textContent || "").trim();
    if (!word) {
      const m = defURL.match(/\/definition\/english\/([A-Za-z0-9_\-]+)/i);
      if (m) word = m[1].split("_")[0].replace(/-/g," ").trim();
    }
    const defLines = Array.from(ddoc.querySelectorAll("span.def, div.def, p.def, .def"))
      .map(n => (n.textContent||"").trim())
      .filter(Boolean)
      .slice(0,2);

    return {
      source: "oxford",
      word: word || "(unknown)",
      pronunciation: (ddoc.querySelector(".phon, .pron, .pron-g .phon")?.textContent || "").trim(),
      excerpt: "",
      definitions: defLines.length ? defLines.map(t => `• ${t}`).join("\n") : "",
      examples: "",
      url: defURL
    };
  }

  // ---------------- API 呼び出し ----------------
  // 403/401/400 などのときに詳細をログへ出して原因を掴みやすく
  async function apiJson(path, params={}) {
    const u = new URL(API_BASE + path);
    for (const [k,v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
    const headers = { "Accept": "application/json" };
    if (key) headers["X-Api-Key"] = key; // 表記ゆれ対策（大文字小文字はHTTP上は非区別）

    const r = await fetch(u.toString(), { headers, credentials:"omit", mode:"cors" });
    const text = await r.text(); // まず文字列で確保（エラー詳細のため）
    if (!r.ok) {
      // デバッグ補助
      console.debug("Oxford API error", r.status, text.slice(0,500));
      // API の制限や未権限は 401/403 で来る
      const err = new Error(`Oxford API ${r.status}`);
      err.status = r.status;
      err.body   = text;
      throw err;
    }
    try { return JSON.parse(text); } catch { return {}; }
  }

  try {
    // 1) /dictionaries → OALD を優先選択
    const dictsRaw = await apiJson("/dictionaries");
    const dicts = Array.isArray(dictsRaw) ? dictsRaw : (dictsRaw.dictionaries || []);
    const pick =
      dicts.find(d => /Advanced Learner/i.test(d.dictionaryName || "")) ||
      dicts.find(d => /oald/i.test(d.dictionaryCode || "")) ||
      dicts[0];
    if (!pick) throw new Error("Oxford API: no dictionaries available");

    // 2) 指定辞書の WOTD プレビュー
    const data = await apiJson(`/dictionaries/${encodeURIComponent(pick.dictionaryCode)}/wordoftheday/preview`, { day });

    const word    = (data.entryLabel || data.label || data.headword || "").trim();
    const preview = (data.textEntryPreview || data.htmlEntryPreview || data.preview || data.text || "").trim();
    const defs    = preview ? preview.replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim() : "";
    const url     = data.entryUrl ||
                    (data.entryId ? `${API_BASE}/dictionaries/${encodeURIComponent(pick.dictionaryCode)}/entries/${encodeURIComponent(data.entryId)}` :
                     "https://www.oxfordlearnersdictionaries.com/");

    return {
      source: "oxford",
      word: word || "(unknown)",
      pronunciation: "",
      excerpt: "",
      definitions: defs ? `• ${defs}` : "",
      examples: "",
      url
    };
  } catch (e) {
    // 403/401（権限/キー問題）・CORS 相当・その他はフォールバック
    if (e && (e.status === 401 || e.status === 403)) {
      console.info("Oxford API unauthorized/forbidden; falling back to scrape.");
      return await fallbackScrape();
    }
    // それ以外も最終的にはフォールバックを試す
    try { return await fallbackScrape(); }
    catch { throw e; }
  }
}
// ---Oxford ここまで

// --- A.Word.A.Day（AWAD）堅牢版：ラベル間テキスト抽出 ---
async function fetchFromAWAD(){
  const url = "https://wordsmith.org/words/today.html";
  const html = await H.text(url);
  const doc  = H.doc(html);

  // 可視テキスト（改行を残す）
  const bodyEl = doc.querySelector("body");
  const raw = (bodyEl?.innerText || bodyEl?.textContent || html).trim();

  // 見出し群（登場順に並べる）
  const LABELS = [
    "PRONUNCIATION",
    "MEANING",
    "ETYMOLOGY",
    "NOTES",
    "USAGE",
    "A THOUGHT FOR TODAY",
    "We need your help"
  ];

  // ラベル名を与えると「次のラベル」までの本文を返す
  function section(name){
    function esc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
    const idx  = LABELS.indexOf(name);
    const here = esc(name) + "\\s*:\\s*";       // 例: "MEANING:\s*"
    const next = LABELS.slice(idx+1).map(l => esc(l) + "\\s*:").join("|") || "$";
    const re   = new RegExp(here + "([\\s\\S]*?)\\s*(?:" + next + ")", "i");
    const m    = raw.match(re);
    return m ? m[1].trim().replace(/\s+\n/g,"\n").replace(/[ \t]+/g," ").trim() : "";
  }

  // 単語：<title> "A.Word.A.Day --word" → だめなら直近の見出し
  let word = "";
  const title = (doc.querySelector("title")?.textContent || "").trim();
  const tm = title.match(/A\.Word\.A\.Day\s*[-–—]\s*(.+)$/i);
  if (tm) word = tm[1].trim();
  if (!word) {
    word = (doc.querySelector("h3, h1")?.textContent || "").trim();
  }

  // 各セクション
  const pron = section("PRONUNCIATION"); // 例: "(sak-ruh-FISH-uhl lam)"
  const mean = section("MEANING");       // 定義の本体
  const etym = section("ETYMOLOGY");
  const note = section("NOTES");
  const usage= section("USAGE");         // 出典付きの用例が1段落

  // definitions は2行以内の箇条書きに整形（UI仕様に合わせる）
  const bullets = [
    mean && `• ${mean}`,
    etym && `• ${etym}`
  ].filter(Boolean).join("\n");

  // examples は用例をそのまま1件
  const examples = usage ? `• ${usage}` : "";

  return {
    source: "awad",
    word: word || "(unknown)",
    pronunciation: pron || "",
    excerpt: note || "",
    definitions: bullets,
    examples,
    url
  };
}
//---A.Word.A.Day ここまで

// --- NYT Word of the Day（JST当日/前日優先 + コロン定義＆用例を確実抽出）---
async function fetchFromNYT(){
  const INDEX_PAGES = [
    "https://www.nytimes.com/section/learning",
    "https://www.nytimes.com/column/learning-word-of-the-day",
  ];
  const norm = (s)=> (s||"").trim().replace(/\s+/g," ");
  const abs  = (href, base="https://www.nytimes.com") => href?.startsWith("http") ? href : new URL(href||"", base).toString();

  function parseNYTUrl(u){
    const m = (u||"").match(/\/(\d{4})\/(\d{2})\/(\d{2})\/learning\/word-of-the-day-([a-z\-']+)\.html/i);
    if (!m) return null;
    return { ymd:`${m[1]}-${m[2]}-${m[3]}`, slug: decodeURIComponent(m[4]).replace(/-+/g," ").trim() };
  }

  const now = new Date();
  const toISO = (d)=> d.toISOString().slice(0,10);
  const today = toISO(now);
  const yest = (()=>{ const d=new Date(now); d.setDate(d.getDate()-1); return toISO(d); })();

  async function listCandidates(){
    const map = new Map();
    for (const u of INDEX_PAGES){
      try{
        const html = await H.text(u);
        const doc  = H.doc(html);
        for (const a of Array.from(doc.querySelectorAll("a[href]"))){
          const full = abs(a.getAttribute("href"));
          const meta = parseNYTUrl(full);
          if (meta) map.set(full, { url: full, ...meta });
        }
      }catch{}
    }
    return Array.from(map.values()).sort((a,b)=> (a.ymd < b.ymd ? 1 : a.ymd > b.ymd ? -1 : 0));
  }

  function extractWord(artDoc, url){
    const fromUrl = parseNYTUrl(url)?.slug || "";
    if (fromUrl) return fromUrl;
    const titles = [
      artDoc.querySelector("meta[property='og:title']")?.content,
      artDoc.querySelector("meta[name='twitter:title']")?.content,
      artDoc.querySelector("title")?.textContent,
      artDoc.querySelector("h1")?.textContent
    ].filter(Boolean);
    for (const t of titles){
      const m = t.match(/Word of the Day\s*[:—-]\s*“?([A-Za-z][A-Za-z\-']{1,})/i)
             || t.match(/^“?([A-Za-z][A-Za-z\-']{1,})”?\s*[-—]\s*Word of the Day/i);
      if (m?.[1]) return m[1];
    }
    return "";
  }

  // ノイズ除去（数字も英文表記もカバー）
  const dropRE = new RegExp([
    '^By\\b','^Credit:','^Advertisement$','^Sign up','^Subscribe','^Photo\\b',
    '^This word has appeared\\b','^This word appears\\b',
    '^Can you use it in a sentence\\?',
    '^The Learning Network','^Share full article'
  ].join('|'), 'i');

  // ——— コロン定義 & 用例抽出 ———
  function extractDefAndExample(artDoc, word){
    const article = artDoc.querySelector('article') || artDoc.body || artDoc;
    const paras = Array.from(article.querySelectorAll('p'))
      .map(n => norm(n.textContent))
      .filter(Boolean)
      .filter(t => !dropRE.test(t));

    // 1) “word … : <definition>” を段落横断で探す（見出し行 + 次段落の「: …」も拾う）
    const wre = new RegExp('^'+word.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')+'\\b','i');
    let defLine = '';
    for (let i=0; i<paras.length; i++){
      const p = paras[i];

      // パターンA：同一段落内にコロン定義
      let m = p.match(new RegExp(
        '^'+word.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')+
        '(?:\\s*\\\\\\s*[^\\\\]+\\s*\\\\)?\\s*(?:noun|verb|adjective|adverb|pronoun|preposition|conjunction|interjection)?\\s*:\\s*(.+)$',
        'i'
      ));
      if (m) { defLine = m[1].trim(); break; }

      // パターンB：見出し段落の直後が「: 定義」
      if (wre.test(p) && paras[i+1] && /^:\s*\S/.test(paras[i+1])) {
        defLine = paras[i+1].replace(/^:\s*/,'').trim();
        break;
      }
    }

    // 2) 用例：語を含む “。”/“.” 終了の自然文（まず見出し近傍→全体）
    function findExample(startIdx=0){
      for (let i=startIdx; i<paras.length; i++){
        const t = paras[i];
        if (new RegExp('\\b'+word.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')+'\\b','i').test(t) && /[.!?][”"]?$/.test(t) && t.length > 40){
          return t;
        }
      }
      return '';
    }
    // 見出し近傍から探す
    let headIdx = paras.findIndex(p => wre.test(p));
    if (headIdx < 0) headIdx = 0;
    const exLineNear = findExample(headIdx);
    const exLineAny  = exLineNear || findExample(0);

    return { defLine, exLine: exLineAny };
  }

  // 1) 候補URL
  const candidates = await listCandidates();
  if (!candidates.length) throw new Error("NYT: could not find any WOTD links");

  // 2) JSTで当日→前日→最新
  const prefer = candidates.find(c => c.ymd === today) || candidates.find(c => c.ymd === yest) || candidates[0];
  const articleURL = prefer.url;

  // 3) 記事取得 & 解析
  const artHTML = await H.text(articleURL);
  const artDoc  = H.doc(artHTML);

  const word = extractWord(artDoc, articleURL) || "(unknown)";
  const { defLine, exLine } = extractDefAndExample(artDoc, word);

  // フォールバック（長文パラグラフ2件）
  let defs = '';
  if (defLine) defs = `• ${defLine}`;
  if (!defs){
    const scope = artDoc.querySelector('article') || artDoc;
    const paras = Array.from(scope.querySelectorAll('p'))
      .map(n=>norm(n.textContent)).filter(Boolean).filter(t=>!dropRE.test(t)).filter(t=>t.length>=80).slice(0,2);
    if (paras.length) defs = H.bullets(paras, 2);
    else {
      const meta = artDoc.querySelector('meta[name="description"]')?.content
                || artDoc.querySelector('meta[property="og:description"]')?.content || "";
      if (meta) defs = `• ${norm(meta)}`;
    }
  }

  const examples = exLine ? `• ${exLine}` : "";

  return { source:"nyt", word, pronunciation:"", excerpt:"", definitions: defs, examples, url: articleURL };
}
//---NYTここまで

// --- Wordnik
async function fetchFromWordnik(key){
  if(!key) throw new Error("Wordnik API key required");
  const url=`https://api.wordnik.com/v4/words.json/wordOfTheDay?api_key=${encodeURIComponent(key)}`;
  const r=await fetch(url,{credentials:"omit"}); if(!r.ok) throw new Error(`Wordnik ${r.status}`);
  const j=await r.json(); const word=j.word||"";
  const defs=(j.definitions||[]).map(d=>`• ${d.text}`).join("\n");
  const exs=(j.examples||[]).slice(0,2).map(e=>`• ${e.text}`).join("\n");
  return { source:"wordnik", word, pronunciation:(j.pronunciations||[])[0]?.raw||"", excerpt:"", definitions:defs, examples:exs, url:`https://www.wordnik.com/words/${encodeURIComponent(word)}` };
}
// --- Wordnik ここまで

// --- Word Spy（定義抽出を強化した堅牢版）---
async function fetchFromWordspy(){
  // どこかの索引/ホームから /words/<slug>/ リンクを拾う
  async function pickAnyWordLink(){
    async function scrapeForWordLinks(u){
      const r = await fetch(u, { credentials:"omit" });
      if (!r.ok) return null;
      const html = await r.text();
      const doc  = new DOMParser().parseFromString(html, "text/html");
      const links = Array.from(doc.querySelectorAll('a[href*="/words/"]'))
        .map(a => a.getAttribute("href") || "")
        .filter(h => /\/words\/[^\/?#]+\/?$/i.test(h))
        .map(h => h.startsWith("http") ? h : new URL(h, r.url).toString());
      return links.length ? links : null;
    }

    const tries = [
      "https://wordspy.com/",
      "https://wordspy.com/alpha/",
      "https://wordspy.com/tags/alpha"
    ];
    for (const u of tries){
      const links = await scrapeForWordLinks(u);
      if (links && links.length){
        return links[Math.floor(Math.random() * links.length)];
      }
    }

    // 最終フォールバック：既知スラッグ
    const seeds = [
      "frequency-illusion","captcha","monotasking",
      "eat-what-you-kill","zucker","alpha-geek","phubbing","bleisure"
    ];
    const pick = seeds[Math.floor(Math.random() * seeds.length)];
    return `https://wordspy.com/words/${pick}/`;
  }

  // 単語ページの取得
  const wordURL = await pickAnyWordLink();
  const res  = await fetch(wordURL, { credentials:"omit", redirect:"follow" });
  if (!res.ok) throw new Error(`wordspy word ${res.status}`);
  const finalURL = res.url;
  const html = await res.text();
  const doc  = new DOMParser().parseFromString(html, "text/html");

  // 見出し語
  let word = (doc.querySelector("h1")?.textContent || "").trim();
  if (!word) {
    const m = finalURL.match(/\/words\/([^\/?#]+)\//);
    if (m) word = decodeURIComponent(m[1]).replace(/-/g, " ");
  }

  // ── 定義抽出（強化ポイント） ──
  // 1) スコープを記事主体に絞る
  const scope = doc.querySelector("article, .entry-content, .post, main, #main, #content") || doc;

  // 2) 候補テキストを収集（p と li）。ノイズを除去
  const drop = [
    /^Share\b/i, /^About Word Spy/i, /^Tags?:/i, /^Filed under/i, /^Comments?\b/i,
    /^Examples?:/i, /^First use:/i, /^Etymology:/i, /^Notes?:/i, /^Source:/i, /^Photo\b/i
  ];
  const paras = Array.from(scope.querySelectorAll("p, li"))
    .map(n => (n.textContent || "").trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .filter(t => !drop.some(re => re.test(t)));

  // 3) 品詞パターン優先（n./v./adj./adv./interj./abbr. など）
  let defsCandidates = paras.filter(t => /^(n\.|v\.|adj\.|adv\.|interj\.|abbr\.|prep\.|vt\.|vi\.)\s+/i.test(t));

  // 4) なければ長めの段落を定義候補に（60字超から）
  if (!defsCandidates.length) {
    defsCandidates = paras.filter(t => t.length > 60).slice(0, 3);
  }

  // 5) さらに無ければ meta/og:description を採用
  if (!defsCandidates.length) {
    const meta = doc.querySelector('meta[name="description"]')?.content ||
                 doc.querySelector('meta[property="og:description"]')?.content || "";
    if (meta) defsCandidates = [meta.trim()];
  }

  const definitions = H.bullets(defsCandidates, 2); // 先頭2件を箇条書き

  return {
    source: "wordspy",
    word: word || "(unknown)",
    pronunciation: "",
    excerpt: "",
    definitions,
    examples: "",
    url: finalURL
  };
}
// --- Word Spy ここまで

// --- Vocabulary.com WOTD（"Dictionary"誤検出回避＋本文スコープ＋二段抽出） ---
async function fetchVocabularyWOTD() {
  const base = 'https://www.vocabulary.com';
  const url  = `${base}/word-of-the-day/`;

  const html = await fetch(url, { credentials: 'omit' }).then(r => {
    if (!r.ok) throw new Error(`Vocabulary WOTD HTTP ${r.status}`);
    return r.text();
  });
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // 本文スコープ（ヘッダ/フッタのナビは見ない）
  const scope = doc.querySelector('article, main, #content, .content') || doc;

  // href から /dictionary/<slug> を抜く
  const slugFromHref = (href) => {
    const m = (href || '').match(/\/dictionary\/([A-Za-z][A-Za-z\-']+)(?:\/|$)/);
    return m ? decodeURIComponent(m[1]).replace(/-+/g, ' ').trim() : '';
  };

  // 1) 本文スコープ内の候補 a[href*="/dictionary/"] を収集（"Dictionary" テキストは除外）
  let word = '';
  let dictURL = '';
  const candidates = Array.from(scope.querySelectorAll('a[href*="/dictionary/"]'))
    .map(a => ({
      a,
      href: a.getAttribute('href') || '',
      text: (a.textContent || '').trim()
    }))
    .filter(x => slugFromHref(x.href))                         // /dictionary/<slug> を持つ
    .filter(x => !/^\s*Dictionary\s*$/i.test(x.text));        // “Dictionary” ナビは除外

  // 一致度でスコアリング：テキスト==slug を最優先→hrefが短いものを優先
  if (candidates.length) {
    candidates.sort((x, y) => {
      const sx = (x.text.toLowerCase() === slugFromHref(x.href).toLowerCase()) ? 0 : 1;
      const sy = (y.text.toLowerCase() === slugFromHref(y.href).toLowerCase()) ? 0 : 1;
      if (sx !== sy) return sx - sy;
      return x.href.length - y.href.length;
    });
    const pick = candidates[0];
    word = slugFromHref(pick.href);
    if (pick.text && /^[A-Za-z][A-Za-z\-'\s]*$/.test(pick.text)) {
      word = pick.text; // テキストが綺麗ならそちらを採用
    }
    dictURL = pick.href.startsWith('http') ? pick.href : new URL(pick.href, base).toString();
  }

  // 2) フォールバック：ページ全体の HTML から最初の /dictionary/<slug> を拾う
  if (!word) {
    const m = html.match(/\/dictionary\/([A-Za-z\-']+)/);
    if (m) {
      word = decodeURIComponent(m[1]).replace(/-+/g, ' ').trim();
      dictURL = `${base}/dictionary/${m[1]}`;
    }
  }

  // ── blurb 抽出（宣伝文回避→本文→meta→辞書ページの順） ──
  const isPromo = (s) => /\bBuild your vocabulary\b/i.test(s)
    || /\bGet the Word of the Day in your inbox\b/i.test(s)
    || /\bVocabulary\.com\b.+(helps you|mailing list)/i.test(s);

  // 本文から
  let blurb = '';
  const pList = Array.from(scope.querySelectorAll('p, .blurb, .dek'))
    .map(n => (n.textContent || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  blurb = pList.find(t => t.length > 60 && !isPromo(t)) || '';

  // meta から
  if (!blurb) {
    const metas = [
      doc.querySelector('meta[name="description"]')?.getAttribute('content'),
      doc.querySelector('meta[property="og:description"]')?.getAttribute('content'),
      doc.querySelector('meta[name="twitter:description"]')?.getAttribute('content')
    ].filter(Boolean);
    const m = metas.find(s => s && !isPromo(s));
    if (m) blurb = m.trim();
  }

  // 辞書ページから（必要時のみ追加フェッチ）
  if (!blurb && dictURL) {
    try {
      const dhtml = await fetch(dictURL, { credentials: 'omit' }).then(r => r.text());
      const ddoc  = new DOMParser().parseFromString(dhtml, 'text/html');

      // a) meta description
      const dmeta = ddoc.querySelector('meta[name="description"]')?.getAttribute('content') || '';
      if (dmeta && !isPromo(dmeta)) blurb = dmeta.trim();

      // b) 定義ブロック候補
      if (!blurb) {
        const defs = Array.from(ddoc.querySelectorAll(
          '.definitions .definition, #definitions .definition, .definition, .sense, .short, .blurb'
        ))
        .map(n => (n.textContent || '').trim().replace(/\s+/g, ' '))
        .filter(t => t && t.length > 30 && !isPromo(t));
        if (defs.length) blurb = defs[0];
      }

      // c) 本文の長文段落
      if (!blurb) {
        const dscope = ddoc.querySelector('article, main, #content, .content') || ddoc;
        const dp = Array.from(dscope.querySelectorAll('p'))
          .map(n => (n.textContent || '').trim().replace(/\s+/g, ' '))
          .find(t => t.length > 60 && !isPromo(t));
        if (dp) blurb = dp;
      }
    } catch {}
  }

  if (!word) throw new Error('Vocabulary.com WOTD: word not found');
  // blurb は見つからなくても '' で返してOK（UI側で空なら非表示になる想定）

  return {
    source: 'vocabulary',
    word,
    pronunciation: '',
    excerpt: '',
    definitions: blurb ? `• ${blurb}` : '',
    examples: '',
    url
  };
}
// --- Vocabulary.com ここまで

// --- Cambridge Dictionary WOTD（WOTD直→プロキシ→ホーム/USホーム経由で拾う多段フォールバック）---
async function fetchFromCambridge(){
  const base = "https://dictionary.cambridge.org";
  const norm = (s)=> (s||"").trim().replace(/\s+/g," ");
  const slugFromHref = (href)=>{
    const m = (href||"").match(/\/dictionary\/english\/([A-Za-z][A-Za-z\-']+)(?:\/|$)/i);
    return m ? decodeURIComponent(m[1]).replace(/-+/g," ").trim() : "";
  };
  const proxied = (u)=> "https://r.jina.ai/" + u.replace(/^https?:\/\//, "http://");

  // 指定URLで HTML→Document を取得（直 fetch できなければプロキシ）
  async function getDoc(u){
    try { return { doc: H.doc(await H.text(u)), url:u, via:"direct" }; }
    catch {
      const r = await fetch(proxied(u), { credentials:"omit" });
      if (!r.ok) throw new Error(`cambridge proxy ${r.status}`);
      return { doc: H.doc(await r.text()), url:u, via:"proxy" };
    }
  }

  // 候補URL（順に試す）
  const CANDIDATES = [
    `${base}/word-of-the-day/`,
    `${base}/dictionary/`,
    `${base}/us/dictionary/`
  ];

  // 本文から /dictionary/english/<slug> リンクを拾う（プロキシのプレーン出力にも対応）
  function pickEntryLink(doc, baseURL){
    const scope = doc.querySelector("article, main, #content, .content, body") || doc;
    const anchors = Array.from(scope.querySelectorAll('a[href*="/dictionary/english/"]'))
      .map(a => ({ href: a.getAttribute("href")||"", text: norm(a.textContent||"") }))
      .map(x => ({ ...x, slug: slugFromHref(x.href) }))
      .filter(x => x.slug)
      .filter(x => !/^\s*Cambridge\s+Dictionary\s*$/i.test(x.text));
    if (anchors.length){
      anchors.sort((x,y)=>{
        const sx = (x.text.toLowerCase() === x.slug.toLowerCase()) ? 0 : 1;
        const sy = (y.text.toLowerCase() === y.slug.toLowerCase()) ? 0 : 1;
        if (sx !== sy) return sx - sy;
        return x.href.length - y.href.length;
      });
      const p = anchors[0];
      const word = p.text && /^[A-Za-z][A-Za-z\-'\s]*$/.test(p.text) ? p.text : p.slug;
      const dictURL = p.href.startsWith("http") ? p.href : new URL(p.href, baseURL).toString();
      return { word, dictURL };
    }
    // アンカーが無い（プロキシのプレーン出力など）場合は生テキストから拾う
    const html = doc.documentElement?.outerHTML || "";
    const m = html.match(/\/dictionary\/english\/([A-Za-z\-']+)/);
    if (m) {
      const slug = decodeURIComponent(m[1]).replace(/-+/g," ").trim();
      return { word: slug, dictURL: `${base}/dictionary/english/${m[1]}` };
    }
    return null;
  }

  // 辞書エントリから IPA と定義を抽出（直→プロキシの順で試す）
  async function scrapeEntry(dictURL){
    async function tryGet(u){
      try { return H.doc(await H.text(u)); }
      catch { return H.doc(await (await fetch(proxied(u))).text()); }
    }
    try{
      const ddoc = await tryGet(dictURL);
      const pron = ddoc.querySelector(".ipa")?.textContent?.trim() || "";
      // 通常の定義クラス → 無ければ長文<p>
      let lines = Array.from(ddoc.querySelectorAll(".def, .ddef_d, .def-block .def, .def-body .def, .entry .def"))
        .map(n => norm(n.textContent)).filter(t => t && t.length>10 && !/Add to word list/i.test(t));
      if (!lines.length) {
        lines = Array.from(ddoc.querySelectorAll("p")).map(n=>norm(n.textContent)).filter(t=>t.length>60).slice(0,3);
      }
      const seen = new Set();
      lines = lines.filter(t => { const k=t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
      return { pron, defs: H.bullets(lines, 2) };
    }catch{
      return { pron:"", defs:"" };
    }
  }

  // 実行：候補ページを順に当たり、最初に見つかったエントリで返す
  try{
    let picked = null, lastURL = CANDIDATES[0];
    for (const u of CANDIDATES){
      lastURL = u;
      try{
        const { doc, url } = await getDoc(u);
        const p = pickEntryLink(doc, url);
        if (p) { picked = p; break; }
      }catch(e){
        // 次の候補へ（r.jina.ai 451 などはここでスキップ）
      }
    }
    if (!picked){
      return {
        source:"cambridge", word:"(unavailable)", pronunciation:"", excerpt:"",
        definitions:"• Could not locate today’s entry link on Cambridge page (WOTD/home both blocked).",
        examples:"", url: lastURL
      };
    }
    const { pron, defs } = await scrapeEntry(picked.dictURL);
    return {
      source:"cambridge",
      word: picked.word || "(unknown)",
      pronunciation: pron,
      excerpt:"",
      definitions: defs,
      examples:"",
      url: picked.dictURL
    };
  }catch(e){
    return {
      source:"cambridge", word:"(unavailable)", pronunciation:"", excerpt:"",
      definitions:`• Cambridge fetch failed: ${e && e.message || e}`,
      examples:"", url: `${base}/dictionary/`
    };
  }
}
// --- Cambridge Dictionary ここまで

//Word of the day
async function fetchWOTD(source, key){
  try{
    switch (source) {
      case "dictionary.com": return await fetchFromDictionary();
      case "merriam-webster": return await fetchFromMW();
      case "oxford":         return await fetchFromOxford();
      case "awad":           return await fetchFromAWAD();
      case "nyt":            return await fetchFromNYT();
      case "wordnik":        return await fetchFromWordnik(key);
      case "wordspy":        return await fetchFromWordspy();  // ← ここ
      case 'vocabulary':     return await fetchVocabularyWOTD();
      case "cambridge":      return await fetchFromCambridge();
      default:               return await fetchFromDictionary();
    }
  } catch (e) { throw new Error(`${source}: ${e?.message||String(e)}`); }
}

async function loadForDate(day){
  try {
    renderLoading();
    // 任意日：フォールバック付きの統一取得
    const data = await getAnyWOTD(day);   // ← 既に実装済みならこれを呼ぶ
    render(data);
  } catch (e) {
    renderError(e);
  }
}

// ========== レンダリング ==========
function render(data){
  const { word, pronunciation, excerpt, definitions, examples, url, source } = data || {};
  if(sourceLink) sourceLink.href = url || "#";
  content.innerHTML = `
    <div class="word">${esc(word || "(no word)")}</div>
    ${pronunciation ? `<div class="pron">${esc(pronunciation)}</div>` : ""}
    ${excerpt ? `<div class="block">${esc(excerpt)}</div>` : ""}
    ${definitions ? `<div class="block">${esc(definitions)}</div>` : ""}
    ${examples ? `<div class="block">${esc(examples)}</div>` : ""}
    <div class="block" style="color:#6b7280;">source: ${esc(source || "-")}</div>
  `;
}
function renderList(items){
  if(!listEl) return;
  listEl.innerHTML = items.map(it=>{
    if(!it.ok) return `
      <div class="card">
        <h3>${esc(SOURCE_LABEL[it.source])} <small>(error)</small></h3>
        <div class="block error">${esc(it.error)}</div>
        <div class="meta"><span></span><div class="actions"><a href="options.html" target="_blank">Options</a></div></div>
      </div>`;
    const d=it.data||{}, url=d.url||"#";
    return `
      <div class="card">
        <h3>${esc(d.word || "(no word)")}</h3>
        <div class="block">${esc(d.definitions || "")}</div>
        <div class="meta">
          <small>${esc(SOURCE_LABEL[d.source || it.source])}</small>
          <div class="actions">
            <button data-use="${att(d.source || it.source)}">Use</button>
            <a href="${att(url)}" target="_blank" rel="noreferrer noopener">Open</a>
          </div>
        </div>
      </div>`;
  }).join("");
}
function renderLoading(){ content.innerHTML = `<div class="loading">Loading...</div>`; }
function renderError(err){ const msg = (err && (err.message || String(err))) || "Unknown error";
  content.innerHTML = `<div class="error">Failed to fetch.\n${esc(msg)}</div>`; if(sourceLink) sourceLink.href = "#"; }
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, (m)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }
function att(s){ const map={ "\"":"&quot;","'":"&#39;","<":"&lt;",">":"&gt;","\\":"\\\\" }; return String(s ?? "").replace(/["'<>\\]/g,(m)=>map[m]); }


// ===== Dev Console Helpers: 任意日の WOTD 取得 =====
(function(){
  // 日付を "YYYY-MM-DD" に正規化
  function ymd(day){
    if (day instanceof Date) return day.toISOString().slice(0,10);
    if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
    throw new Error('day must be "YYYY-MM-DD" or Date');
  }

  // 設定読み（Storageが使えない環境は chrome.storage.sync 直読み）
  async function getSettings(){
    try {
      if (typeof Storage?.getSync === 'function') return await Storage.getSync(KEY_SETTINGS);
    } catch {}
    return new Promise(r=>{
      if (chrome?.storage?.sync) chrome.storage.sync.get([KEY_SETTINGS], v=>r(v[KEY_SETTINGS]||{}));
      else r({});
    });
  }

  // Vocabulary.com（公式に日付URLあり）
  async function vocabWOTD(day){
    day = ymd(day);
    const base='https://www.vocabulary.com';
    const url = `${base}/word-of-the-day/${day}/`;
    const html = await fetch(url,{credentials:'omit'}).then(r=>{ if(!r.ok) throw new Error('Vocabulary '+r.status); return r.text(); });
    const doc  = H.doc(html);

    // 単語：/dictionary/<slug> だが、ナビの "Dictionary" は除外
    const a = Array.from(doc.querySelectorAll('a[href*="/dictionary/"]'))
      .find(x => {
        const href = x.getAttribute('href')||'';
        const txt  = (x.textContent||'').trim();
        if (/^\s*Dictionary\s*$/i.test(txt)) return false;
        return /\/dictionary\/[A-Za-z\-']+\/?$/.test(href) && !/\/dictionary\/?$/.test(href);
      });
    let word = '';
    if (a) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/dictionary\/([^\/?#]+)/);
      if (m) word = decodeURIComponent(m[1]).replace(/-+/g,' ').trim();
      const txt = (a.textContent||'').trim();
      if (txt && /^[A-Za-z][A-Za-z\-'\s]*$/.test(txt)) word = txt;
    }
    if (!word) {
      // 最後の保険：タイトルなど
      const t = (doc.querySelector('h1')?.textContent || doc.title || '').trim();
      const mm = /Word of the Day[:\s-]*([A-Za-z][A-Za-z\-']{1,})/i.exec(t);
      if (mm?.[1]) word = mm[1];
    }

    // 説明：meta desc → 長文<p>
    let defs = doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || '';
    if (!defs || defs.length < 40){
      const p = Array.from(doc.querySelectorAll('article p, main p, #content p, .content p'))
        .map(n=>(n.textContent||'').trim()).find(t=>t.length>60);
      if (p) defs = p;
    }

    return { source:'vocabulary', word: word||'(unknown)', pronunciation:'', excerpt:'', definitions: defs?('• '+defs):'', examples:'', url };
  }

// --- Wordnik（キー未設定でもフレンドリー返却に）---
async function wordnikWOTD(day){
  day = ymd(day);
  const s = await getSettings();
  const key = s?.wordnikKey;
  if(!key){
    return {
      source:'wordnik', word:'(unavailable)', pronunciation:'', excerpt:'',
      definitions:'• Set your Wordnik API key in Options to fetch arbitrary dates.',
      examples:'', url:'https://www.wordnik.com/words/'
    };
  }
  const url = `https://api.wordnik.com/v4/words.json/wordOfTheDay?date=${day}&api_key=${encodeURIComponent(key)}`;
  const j = await fetch(url,{credentials:'omit'}).then(r=>{ if(!r.ok) throw new Error('Wordnik '+r.status); return r.json(); });
  return {
    source:'wordnik', word:j.word||'(unknown)', pronunciation:(j.pronunciations||[])[0]?.raw||'',
    excerpt:'', definitions: H.bullets((j.definitions||[]).map(d=>d.text), 2),
    examples: (j.examples||[]).slice(0,2).map(e=>'• '+e.text).join('\n'),
    url: `https://www.wordnik.com/words/${encodeURIComponent(j.word||'')}`
  };
}


// --- Oxford（任意日：API必須。401/403でもthrowせず説明入りのオブジェクトを返す）---
async function oxfordWOTD(day){
  day = ymd(day);
  const s = await getSettings();
  const key = (s?.oxfordKey||'').trim();
  if(!key){
    return {
      source:'oxford', word:'(unavailable)', pronunciation:'', excerpt:'',
      definitions:'• Set your Oxford API key in Options to fetch arbitrary dates.',
      examples:'', url:'https://www.oxfordlearnersdictionaries.com/'
    };
  }

  const Hdr = { headers:{ 'Accept':'application/json', 'X-Api-Key': key } };

  // 1) 辞書一覧（ここで 401/403 が来ても throw しない）
  let dictsRaw = null, list = [];
  try {
    const dictsResp = await fetch('https://www.oxfordlearnersdictionaries.com/api/v1/dictionaries', Hdr);
    if (!dictsResp.ok) {
      if (dictsResp.status===401 || dictsResp.status===403) {
        return {
          source:'oxford', word:'(unavailable)', pronunciation:'', excerpt:'',
          definitions:`• Your Oxford API key does not permit Word of the Day preview (HTTP ${dictsResp.status}).`,
          examples:'', url:'https://www.oxfordlearnersdictionaries.com/'
        };
      }
      return {
        source:'oxford', word:'(error)', pronunciation:'', excerpt:'',
        definitions:`• Oxford dictionaries endpoint error: HTTP ${dictsResp.status}`,
        examples:'', url:'https://www.oxfordlearnersdictionaries.com/'
      };
    }
    dictsRaw = await dictsResp.json();
    list = Array.isArray(dictsRaw) ? dictsRaw : (dictsRaw.dictionaries||[]);
  } catch (e) {
    return {
      source:'oxford', word:'(error)', pronunciation:'', excerpt:'',
      definitions:`• Network/CORS error while listing dictionaries: ${e && e.message || e}`,
      examples:'', url:'https://www.oxfordlearnersdictionaries.com/'
    };
  }

  const pick = list.find(d=>/Advanced Learner/i.test(d.dictionaryName||'')) ||
               list.find(d=>/oald/i.test(d.dictionaryCode||'')) ||
               list[0];
  if(!pick){
    return {
      source:'oxford', word:'(unavailable)', pronunciation:'', excerpt:'',
      definitions:'• Oxford API returned no available dictionaries.',
      examples:'', url:'https://www.oxfordlearnersdictionaries.com/'
    };
  }

  // 2) 任意日の preview（ここでも 401/403 は説明を返す）
  try {
    const url = `https://www.oxfordlearnersdictionaries.com/api/v1/dictionaries/${encodeURIComponent(pick.dictionaryCode)}/wordoftheday/preview?day=${day}`;
    const r = await fetch(url, Hdr);
    if (!r.ok){
      if (r.status===401 || r.status===403){
        return {
          source:'oxford', word:'(unavailable)', pronunciation:'', excerpt:'',
          definitions:`• Your Oxford API key does not permit Word of the Day preview for this date (HTTP ${r.status}).`,
          examples:'', url:'https://www.oxfordlearnersdictionaries.com/'
        };
      }
      return {
        source:'oxford', word:'(error)', pronunciation:'', excerpt:'',
        definitions:`• Oxford WOTD endpoint error: HTTP ${r.status}`,
        examples:'', url:'https://www.oxfordlearnersdictionaries.com/'
      };
    }
    const j = await r.json();
    const word = (j.entryLabel||j.headword||'').trim();
    const defs = (j.textEntryPreview||j.htmlEntryPreview||'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
    return { source:'oxford', word: word||'(unknown)', pronunciation:'', excerpt:'', definitions: defs?('• '+defs):'', examples:'', url: j.entryUrl||null };
  } catch (e) {
    return {
      source:'oxford', word:'(error)', pronunciation:'', excerpt:'',
      definitions:`• Network/CORS error while fetching preview: ${e && e.message || e}`,
      examples:'', url:'https://www.oxfordlearnersdictionaries.com/'
    };
  }
}


// --- Dictionary.com（任意日対応：Prev/Next を辿って目的日へ到達）---
async function dictComWOTD(day){
  day = ymd(day);
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const toISO = (m)=>{ // "Friday, June 20, 2025" → "2025-06-20"
    const mm = m.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i)
            ||  m.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i);
    if(!mm) return null;
    const y=mm[3], mth=('0'+(MONTHS.findIndex(x=>new RegExp('^'+x,'i').test(mm[1]))+1)).slice(-2), d=('0'+mm[2]).slice(-2);
    return `${y}-${mth}-${d}`;
  };

  // 1) 今日のページ（ホーム or 直近ページ）から開始
  let url = `https://www.dictionary.com/e/word-of-the-day/`;

  // 2) 最長120ステップまで Prev/Next を辿る（約4ヶ月ぶん）
  const MAX = 120;
  for(let i=0;i<MAX;i++){
    const html = await fetch(url,{credentials:'omit'}).then(r=>{ if(!r.ok) throw new Error('Dictionary.com '+r.status); return r.text(); });
    const doc  = H.doc(html);

    // 現在ページの日付を本文テキストから拾う
    const iso = toISO(doc.body?.textContent || "");
    if(!iso) throw new Error('Dictionary.com: date parse failed');

    // 目的日に一致 → 単語と定義を抽出して返す
    if (iso === day){
      // 単語（見出し）
      let word = (doc.querySelector('h1')?.textContent || '').trim();
      if(!word){ // 予備
        const h = Array.from(doc.querySelectorAll("h1,h2,strong,em")).map(n=>(n.textContent||"").trim())
          .find(tx=>/^[A-Za-z][A-Za-z\-']{2,20}$/.test(tx));
        if (h) word = h;
      }
      // 定義・説明（記事の段落から抜粋）
      const paras = Array.from(doc.querySelectorAll("article p, article li"))
        .map(n=>(n.textContent||"").trim()).filter(Boolean);
      const defs  = H.bullets(paras, 2);

      return { source:'dictionary.com', word: word||'(unknown)', pronunciation:'', excerpt:'', definitions: defs, examples:'', url };
    }

    // 目的日が過去なら Prev、未来なら Next を辿る
    const go = (iso > day)
      ? Array.from(doc.querySelectorAll('a')).find(a=>/Previous/i.test(a.textContent||""))
      : Array.from(doc.querySelectorAll('a')).find(a=>/Next/i.test(a.textContent||""));

    if(!go) throw new Error('Dictionary.com: navigation link not found');
    const href = go.getAttribute('href') || '';
    url = href.startsWith('http') ? href : new URL(href, 'https://www.dictionary.com').toString();
  }
  throw new Error('Dictionary.com: too far from requested date (over 120 steps)');
}


async function safeGetWOTD(source, day){
  try { return await getWOTD(source, day); }
  catch (e) {
    return {
      source: String(source||''),
      word: '(error)',
      pronunciation: '',
      excerpt: '',
      definitions: `• ${e?.message || e}`,
      examples: '',
      url: ''
    };
  }
}
window.safeGetWOTD = safeGetWOTD;


  // 統一呼び出し
  async function getWOTD(source, day){
    const s = String(source||'').toLowerCase();
    if (s==='vocabulary')     return vocabWOTD(day);
    if (s==='wordnik')        return wordnikWOTD(day);
    if (s==='oxford')         return oxfordWOTD(day);
    if (s==='dictionary.com') return dictComWOTD(day);
    throw new Error('Unsupported source for arbitrary date: '+source);
  }

  async function getWOTDSelected(day){
    const s = await getSettings();
    return getWOTD(s?.source || 'dictionary.com', day);
  }

  // グローバル公開（Consoleから使いやすく）
  Object.assign(window, { getWOTD, getWOTDSelected });
})();

// ===== 任意日WOTDの自動フォールバック =====
// 優先順は必要に応じて並べ替えてOK
async function getAnyWOTD(day){
  const order = ['oxford','wordnik','vocabulary','dictionary.com'];
  for (const src of order){
    const r = await safeGetWOTD(src, day);
    if (r && r.word && r.word !== '(unavailable)' && r.word !== '(error)') return r;
  }
  return {
    source:'(none)', word:'(not found)', pronunciation:'', excerpt:'',
    definitions:'• No source returned data for this date.',
    examples:'', url:''
  };
}
window.getAnyWOTD = getAnyWOTD;


