// src/fetchers/vocabulary.js
export async function fetchVocabularyWOTD() {
  const base = 'https://www.vocabulary.com';
  const url = `${base}/word-of-the-day/`;

  // 1) 当日ページを取得
  const html = await fetch(url, { credentials: 'omit' }).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });

  // パース
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // ── 単語: ページ上部に出る最初の辞書リンク（/dictionary/...）を拾う
  let word = null;
  const dictLink = doc.querySelector('a[href^="/dictionary/"]');
  if (dictLink) word = dictLink.textContent?.trim();

  // ── 説明文: 見出し直後の本文ブロックの最初の<p>を拾う（WotDの短い説明）
  // セレクタは将来変更に備えて包括的に
  let blurb = null;
  const candidatePs = Array.from(doc.querySelectorAll('main p, #content p, article p, .content p'));
  const firstMeaningLike = candidatePs.find(p => p.textContent && p.textContent.trim().length > 60);
  if (firstMeaningLike) blurb = firstMeaningLike.textContent.trim();

  // ── フォールバック: もし今日のページ構造が変わっていたらアーカイブから直近を辿る
  if (!word || !blurb) {
    const archHtml = await fetch(`${base}/word-of-the-day/archive/`).then(r => r.text());
    const m = archHtml.match(/\/word-of-the-day\/\d{4}-\d{2}-\d{2}/);
    if (m) {
      const dayUrl = base + m[0];
      const dayHtml = await fetch(dayUrl).then(r => r.text());
      const dayDoc = new DOMParser().parseFromString(dayHtml, 'text/html');
      const dLink = dayDoc.querySelector('a[href^="/dictionary/"]');
      if (dLink) word = dLink.textContent?.trim();
      const dPs = Array.from(dayDoc.querySelectorAll('main p, #content p, article p, .content p'));
      const dFirst = dPs.find(p => p.textContent && p.textContent.trim().length > 60);
      if (dFirst) blurb = dFirst.textContent.trim();
    }
  }

  if (!word) throw new Error('Vocabulary.com WOTD: word not found');
  // 返却フォーマット（既存の他サイトに揃える）
  return {
    source: 'vocabulary',
    word,
    pron: null, // WotD短文には発音が無いことが多い
    defs: [{ meaning: blurb || '', example: null }],
    url
  };
}
