/* JAxMAPs Questionnaire Explorer. Offline, dependency-free, and provenance-aware. */
(function () {
  'use strict';
  const DEFAULTS = {query: '', study: '', year: '', substudy: '', category: '', subcategory: '', scale: '', domain: '', wave: '', saved: false, page: 1, size: 30};
  const FAVORITES_KEY = 'jaxmaps-question-favorites-v1';
  const FILTER_KEYS = ['study', 'year', 'substudy', 'category', 'subcategory', 'scale', 'domain'];
  const state = {...DEFAULTS};
  let root, data, questions = [], waves = [], byId, waveById, matchIndex, filtered = [], favorites = new Set(), mounted = false, dialog, currentQuestion = null, currentSource = '', returnFocus = null, searchTimer;
  const $ = s => root.querySelector(s);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const arr = v => Array.isArray(v) ? v : v == null || v === '' ? [] : [v];
  const normalize = v => String(v || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const num = v => Number(v || 0).toLocaleString('ja-JP');
  const domainLabel = v => (window.JAXMAPS && window.JAXMAPS.domain_labels && window.JAXMAPS.domain_labels[v]) || (data && data.taxonomy && data.taxonomy.domain_labels && data.taxonomy.domain_labels[v]) || v;
  const optionText = o => typeof o === 'object' && o ? [o.value ?? o.code, o.label ?? o.text ?? o.name].filter(v => v !== undefined && v !== null && v !== '').join(': ') : String(o ?? '');
  const sourceText = s => typeof s === 'string' ? s : s.name || s.filename || s.path || '';
  const categoryText = c => typeof c === 'string' ? c : [c.main, c.sub].filter(Boolean).join(' › ');
  const scaleText = s => typeof s === 'string' ? s : s.name || s.scale || '';
  const itemCount = q => arr(q.items).length || 1;
  const unique = values => [...new Set(values.filter(v => v !== null && v !== undefined && v !== '').map(String))];
  const lex = (a, b) => String(a).localeCompare(String(b), 'ja', {numeric: true});
  const questionNumber = q => q.display_number || q.number || q.question_number || '番号なし';
  const isNumberOnlyStem = q => Boolean(q.text) && (normalize(q.text) === normalize(q.number) || /^(?:q|sq|sc|問)\s*\d+(?:[-‐－ー][a-z0-9]+)*$/i.test(normalize(q.text)));
  const questionHeading = q => isNumberOnlyStem(q) ? (q.number_basis === 'derived_block' ? '同じ設問内の別ブロック' : '下位項目・選択肢を確認') : q.text || '設問文の記録なし';
  const numberNoteMarkup = q => q.number_basis === 'derived_block' ? `<p class="sv-detail-note">原資料の ${esc(q.original_question_number || q.number)} 内に続く別ブロックです。「第○ブロック」は閲覧用の補助表記です。設問文の前後関係は公式調査票の原文で確認できます。</p>` : '';
  const substudyLabel = v => ({general: '一般票', pregnancy: '妊産婦票', followup: '追跡票', follow_up: '追跡票', new: '新規票'})[v] || v;
  const hasDraft = q => q.is_draft || q.status === 'draft' || q.draft_item_count > 0 || arr(q.sources).some(s => s.status === 'draft') || arr(q.items).some(i => i.status === 'draft' || arr(i.source_statuses).includes('draft'));
  const statusLabel = q => q.status === 'mixed' ? '複数版' : q.is_draft || q.status === 'draft' ? 'ドラフト' : ['official_published', 'officially_published'].includes(q.status) ? '公式公開版' : q.status === 'final' ? '確定版表記あり' : q.status === 'unavailable' ? '未収載' : q.status === 'unverified' ? '状態未確認' : '';
  const statusMarkup = q => statusLabel(q) ? `<span class="sv-status-badge${q.is_draft || q.status === 'draft' ? ' is-draft' : ''}">${esc(statusLabel(q))}</span>` : '';
  const waveLabel = q => (waveById.get(q.wave_id) || {}).label || [q.study, q.year, q.substudy].filter(Boolean).join(' / ');
  const basisText = c => String((c && typeof c === 'object' && (c.basis || c.source_kind || c.method)) || '');
  function isTransferred(c) { return /transfer|machine|inferred|推定|転用|機械|照合|一致|mapped/i.test(basisText(c)); }
  function basisLabel(c) {
    const b = basisText(c);
    if (isTransferred(c)) return '機械照合・転用';
    if (/luke|聖路加|student|source|original|manual|直接|原表|分類表|人手/i.test(b)) return '聖路加の原表';
    return b ? '分類根拠あり' : '根拠未記載';
  }
  function categories(q) { return arr(q.categories); }
  function scales(q) { return arr(q.scales); }
  function getValues(q, key) {
    if (key === 'category') return categories(q).map(c => typeof c === 'string' ? c : c.main);
    if (key === 'subcategory') return categories(q).filter(c => !state.category || c.main === state.category).map(c => c.sub);
    if (key === 'scale') return scales(q).map(scaleText);
    if (key === 'domain') return arr(q.domains).map(d => typeof d === 'string' ? d : d.id || d.domain);
    return [String(q[key] ?? '')];
  }
  function matches(q, excludedKey) {
    if (state.wave && !['wave', 'study', 'year', 'substudy'].includes(excludedKey) && String(q.wave_id) !== state.wave) return false;
    if (state.saved && !favorites.has(String(q.id))) return false;
    for (const key of FILTER_KEYS) {
      if (key !== excludedKey && state[key] && !getValues(q, key).map(String).includes(state[key])) return false;
    }
    const terms = normalize(state.query).split(' ').filter(Boolean);
    return !terms.length || terms.every(term => q._search.includes(term));
  }
  function makeSearch(q) {
    return normalize([q.text, ...arr(q.text_variants).map(v => typeof v === 'string' ? v : v.text || ''), q.number, q.display_number, q.original_question_number, q.study, q.year, q.substudy, q.type, q.id,
      ...arr(q.options).map(optionText), ...arr(q.variable_names),
      ...arr(q.items).flatMap(i => [i.code, i.text, i.question_text, ...arr(i.options).map(optionText), ...arr(i.variable_names)]),
      ...categories(q).map(categoryText), ...scales(q).map(scaleText),
      ...arr(q.domains).map(domainLabel), ...arr(q.sources).map(sourceText)].join(' '));
  }
  function loadFavorites() {
    try { const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); favorites = new Set(arr(saved).map(String)); } catch (_) { favorites = new Set(); }
  }
  function saveFavorite(id) {
    if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites])); } catch (_) { announce('このブラウザでは保存を永続化できません。現在の画面では利用できます。'); }
    update();
    if (currentQuestion) { renderDetail(currentQuestion); dialog.querySelector('[data-sv-favorite]').focus(); } else { const star = [...root.querySelectorAll('[data-sv-favorite]')].find(b => b.dataset.svFavorite === id); if (star) star.focus(); }
  }
  function announce(message) { $('[data-sv-status]').textContent = message; }
  function writeHash() {
    const params = new URLSearchParams();
    Object.keys(DEFAULTS).forEach(key => {
      if (state[key] !== DEFAULTS[key] && state[key] !== '') params.set(key, String(state[key]));
    });
    if (currentQuestion) { params.set('question', String(currentQuestion.id)); params.set('source', currentSource); }
    const hash = '#survey' + (params.size ? '?' + params.toString() : '');
    if (location.hash !== hash) {
      try { history.replaceState(null, '', hash); } catch (_) { location.hash = hash; }
    }
  }
  function readHash() {
    if (!/^#survey(?:\?|$)/.test(location.hash)) return null;
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    Object.assign(state, DEFAULTS);
    Object.keys(DEFAULTS).forEach(key => {
      if (!params.has(key)) return;
      const val = params.get(key);
      state[key] = key === 'saved' ? val === 'true' : key === 'page' ? Math.max(1, parseInt(val, 10) || 1) : key === 'size' ? (val === 'all' ? 'all' : [30, 60, 120].includes(+val) ? +val : 30) : val;
    });
    return params.get('question');
  }
  function activateTab() {
    const button = document.querySelector('#tabs [data-tab="survey"]');
    if (button && !button.classList.contains('on')) button.click();
  }
  function selectOptions(key, title) {
    const counts = new Map();
    questions.filter(q => matches(q, key)).forEach(q => unique(getValues(q, key)).forEach(v => counts.set(v, (counts.get(v) || 0) + 1)));
    if (state[key] && !counts.has(state[key])) counts.set(state[key], 0);
    const values = [...counts.keys()].sort(key === 'year' ? (a, b) => Number(b) - Number(a) : lex);
    const select = $(`[data-sv-filter="${key}"]`);
    select.innerHTML = `<option value="">${esc(title)} (${num(values.length)})</option>` + values.map(v => `<option value="${esc(v)}"${state[key] === v ? ' selected' : ''}>${esc(key === 'domain' ? domainLabel(v) : key === 'substudy' ? substudyLabel(v) : v)} · ${num(counts.get(v))}</option>`).join('');
  }
  function chips(q) {
    let html = categories(q).slice(0, 2).map(c => `<span class="sv-tag ${isTransferred(c) ? 'sv-tag-transfer' : 'sv-tag-source'}" title="${esc(basisText(c) || '分類の根拠を詳細で確認')}">${esc(typeof c === 'string' ? c : c.sub || c.main)}<small>${esc(basisLabel(c))}</small></span>`).join('');
    html += scales(q).slice(0, 3).map(s => `<span class="sv-tag sv-tag-scale">${esc(scaleText(s))}${s.grade ? `<small>原表評価 ${esc(s.grade)}</small>` : ''}</span>`).join('');
    return html;
  }
  function renderMatrix() {
    const years = unique(waves.map(w => w.year)).sort((a, b) => Number(a) - Number(b));
    const studies = unique(waves.map(w => w.study)).sort(lex);
    const max = Math.max(1, ...waves.map(w => +w.question_count || 0));
    $('[data-sv-matrix]').innerHTML = `<div class="sv-matrix-scroll" tabindex="0" role="region" aria-label="年度別調査票一覧。横方向にスクロールできます"><table class="sv-matrix"><thead><tr><th scope="col">調査 / 実施年</th>${years.map(y => `<th scope="col"><button type="button" class="sv-year-button${state.year === y ? ' is-active' : ''}" data-sv-year="${esc(y)}">${esc(y)}</button></th>`).join('')}</tr></thead><tbody>${studies.map(study => `<tr><th scope="row"><span class="sv-study-label">${esc(study)}</span><small>${num(waves.filter(w => w.study === study).length)} 調査波</small></th>${years.map(year => {
      const cell = waves.filter(w => w.study === study && String(w.year) === year).sort((a, b) => lex(a.substudy || '', b.substudy || ''));
      return `<td>${cell.length ? cell.map(w => {
        const active = state.wave === String(w.id);
        const amount = Math.max(.08, Math.sqrt((+w.question_count || 0) / max));
        return `<button type="button" class="sv-wave${active ? ' is-active' : ''}${String(w.study).toUpperCase() === 'JASTIS' ? ' sv-wave-jastis' : ''}" data-sv-wave="${esc(w.id)}" aria-pressed="${active}" title="${esc(w.label || [w.study, w.year, w.substudy].filter(Boolean).join(' '))}：${num(w.question_count)} 設問群、${num(w.item_count)} 項目" style="--wave-intensity:${amount}"><span>${esc(substudyLabel(w.substudy) || '本調査')}</span><strong>${num(w.question_count)}<small> 設問群</small></strong><em>${num(w.item_count)} 項目</em>${statusMarkup(w)}${hasDraft(w) && w.status !== 'draft' ? '<small class="sv-draft-inline">ドラフトを含む</small>' : ''}</button>`;
      }).join('') : '<span class="sv-matrix-empty" title="このカタログには調査票の登録がありません">—<small>収載なし</small></span>'}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function renderActiveFilters() {
    const active = [];
    if (state.wave) active.push(['wave', (waveById.get(state.wave) || {}).label || state.wave]);
    FILTER_KEYS.forEach(key => { if (state[key]) active.push([key, key === 'domain' ? domainLabel(state[key]) : key === 'substudy' ? substudyLabel(state[key]) : state[key]]); });
    if (state.query) active.push(['query', `検索: ${state.query}`]);
    if (state.saved) active.push(['saved', '保存した設問']);
    $('[data-sv-active]').innerHTML = active.map(([key, value]) => `<button class="sv-filter-chip" type="button" data-sv-remove="${key}" aria-label="${esc(value)} の条件を解除">${esc(value)}<span aria-hidden="true">×</span></button>`).join('');
  }
  function card(q) {
    const saved = favorites.has(String(q.id));
    const count = itemCount(q);
    const otherYears = unique((matchIndex.get(q._match) || []).filter(x => x.year !== q.year).map(x => x.year));
    const items = arr(q.items).filter(i => i.text || i.code);
    return `<article class="sv-question" data-sv-card="${esc(q.id)}"><div class="sv-question-top"><div class="sv-question-meta"><span class="sv-study-pill${String(q.study).toUpperCase() === 'JASTIS' ? ' is-jastis' : ''}">${esc(q.study)}</span><span>${esc(q.year)}${q.substudy ? ' · ' + esc(substudyLabel(q.substudy)) : ''}</span><span class="sv-qnumber">${esc(questionNumber(q))}</span>${q.type ? `<span class="sv-type">${esc(q.type)}</span>` : ''}${statusMarkup(q)}${hasDraft(q) && q.status !== 'draft' ? '<span class="sv-draft-inline">ドラフトを含む</span>' : ''}</div><button type="button" class="sv-star${saved ? ' is-saved' : ''}" data-sv-favorite="${esc(q.id)}" aria-pressed="${saved}" aria-label="${esc(questionNumber(q))} ${saved ? 'を保存から削除' : 'を保存'}">${saved ? '★' : '☆'}</button></div><h3><button type="button" data-sv-detail="${esc(q.id)}">${esc(questionHeading(q))}</button></h3>${items.length ? `<ul class="sv-item-preview">${items.slice(0, 3).map(i => `<li>${i.code ? `<code>${esc(i.code)}</code>` : ''}${esc(i.text || '項目名の記録なし')}</li>`).join('')}${items.length > 3 ? `<li class="sv-more-items">ほか ${num(items.length - 3)} 項目 — 詳細ですべて表示</li>` : ''}</ul>` : ''}<div class="sv-tags">${chips(q)}</div><div class="sv-question-bottom"><span>${num(count)} 項目${arr(q.options).length ? ` / ${num(arr(q.options).length)} 選択肢` : ''}${otherYears.length ? ` · 同文の設問を ${num(otherYears.length)} 別年に収載` : ''}</span><button class="sv-detail-link" type="button" data-sv-detail="${esc(q.id)}">全文・選択肢・出典 <span aria-hidden="true">↗</span></button></div></article>`;
  }
  function renderResults() {
    const totalItems = filtered.reduce((n, q) => n + itemCount(q), 0);
    const pageSize = state.size === 'all' ? Math.max(1, filtered.length) : +state.size;
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    state.page = Math.max(1, Math.min(state.page, pages));
    const offset = (state.page - 1) * pageSize;
    const shown = filtered.slice(offset, offset + pageSize);
    $('[data-sv-count]').innerHTML = `<strong>${num(filtered.length)}</strong> 設問群 <span>/ ${num(totalItems)} 項目</span>`;
    $('[data-sv-result-context]').textContent = filtered.length ? `${num(unique(filtered.map(q => q.wave_id)).length)} 調査波・${num(unique(filtered.map(q => q.year)).length)} 年に収載` : '条件を変えて再検索できます';
    $('[data-sv-results]').innerHTML = shown.length ? shown.map(card).join('') : '<div class="sv-empty"><span aria-hidden="true">⌕</span><h3>この条件に一致する設問はありません</h3><p>表記を変えるか、絞り込みを解除してください。<br>この結果だけでは、調査で質問されていないとは判断できません。</p><button type="button" class="sv-button" data-sv-reset>条件をすべて解除</button></div>';
    $('[data-sv-pagination]').innerHTML = `<span>${filtered.length ? `${num(offset + 1)}–${num(Math.min(offset + pageSize, filtered.length))} / ${num(filtered.length)} 設問群` : '0 設問群'}</span><div><button type="button" class="sv-button" data-sv-page="1" ${state.page === 1 ? 'disabled' : ''} aria-label="最初のページ">«</button><button type="button" class="sv-button" data-sv-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>前へ</button><span class="sv-page-number">${num(state.page)} / ${num(pages)}</span><button type="button" class="sv-button" data-sv-page="${state.page + 1}" ${state.page === pages ? 'disabled' : ''}>次へ</button><button type="button" class="sv-button" data-sv-page="${pages}" ${state.page === pages ? 'disabled' : ''} aria-label="最後のページ">»</button></div>`;
    $('[data-sv-saved-count]').textContent = num([...favorites].filter(id => byId.has(id)).length);
    $('[data-sv-saved]').classList.toggle('is-active', state.saved);
    $('[data-sv-saved]').setAttribute('aria-pressed', String(state.saved));
    $('[data-sv-size]').value = String(state.size);
  }
  function update(write = true) {
    if (!mounted) return;
    filtered = questions.filter(q => matches(q));
    const fieldTitles = {study: 'すべての調査', year: 'すべての年', substudy: 'すべての対象・票', category: 'すべての大分類', subcategory: 'すべての小分類', scale: 'すべての尺度候補', domain: 'すべての研究領域'};
    FILTER_KEYS.forEach(key => selectOptions(key, fieldTitles[key]));
    $('[data-sv-query]').value = state.query;
    renderActiveFilters(); renderResults(); renderMatrix();
    if (write) writeHash();
  }
  function optionsMarkup(options, emptyMessage = '選択肢の記録なし') {
    const opts = arr(options);
    return opts.length ? `<ol class="sv-options">${opts.map(o => `<li>${esc(optionText(o))}</li>`).join('')}</ol>` : `<p class="sv-muted">${emptyMessage}</p>`;
  }
  function preferredSource(q) {
    const sources = arr(q.sources);
    return (sources.some(s => sourceText(s) === q.preferred_source_name) ? q.preferred_source_name : '') || sourceText(sources.find(s => ['official_published', 'officially_published'].includes(s.status)) || sources.find(s => s.status === 'final') || sources[0] || '');
  }
  function sourceView(q, sourceName = preferredSource(q)) {
    if (!sourceName) return {...q, options: commonOptions(arr(q.items))};
    const items = arr(q.items).filter(i => arr(i.source_names || i.source_name).includes(sourceName));
    const texts = unique(items.map(i => i.question_text));
    return {...q, items, text: texts.length === 1 ? texts[0] : q.text, options: commonOptions(items), _selected_source: sourceName};
  }
  function commonOptions(items) {
    if (!items.length || items.some(i => !arr(i.options).length)) return [];
    const first = JSON.stringify(items[0].options);
    return items.every(i => JSON.stringify(i.options) === first) ? items[0].options : [];
  }
  function sourceSelectorMarkup(q) {
    return `<div class="sv-source-selector"><label><span>表示する原資料</span><select data-sv-source aria-label="表示する原資料">${arr(q.sources).map(s => `<option value="${esc(sourceText(s))}"${currentSource === sourceText(s) ? ' selected' : ''}>${esc(sourceText(s))} (${esc(statusLabel(s) || s.kind || '出典')})</option>`).join('')}<option value=""${currentSource === '' ? ' selected' : ''}>すべての出典をまとめて表示</option></select></label><p>${currentSource ? '原資料を選ぶと、その資料に由来する項目・選択肢だけを表示します。公式公開資料がある場合は初期表示に優先しています。' : 'すべての出典を表示中。ドラフト・抽出方法・版の違いによる重複や差異を含むため、出典ごとの記録も確認してください。'}</p></div>`;
  }
  function officialTextMarkup() {
    const source = arr(window.JAXSURVEYSOURCES && window.JAXSURVEYSOURCES.sources).find(s => s.name === currentSource);
    if (!source || !source.text) return '';
    return `<details class="sv-original-text" data-sv-source-text="${esc(source.name)}"><summary>公式調査票の原文を読む（全文）</summary><p>${esc(source.name)}${source.url && /^https?:\/\//i.test(source.url) ? ` · <a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">公式ファイルを開く</a>` : ''}</p><div data-sv-source-text-body></div></details>`;
  }
  function fullItemsMarkup(q) {
    const items = arr(q.items);
    return `${arr(q.options).length ? `<section class="sv-detail-section"><h3>表示中の項目に共通する選択肢</h3><p class="sv-muted">選択中の原資料で、すべての表示項目に同じ選択肢が記録されています。</p>${optionsMarkup(q.options)}</section>` : ''}<section class="sv-detail-section"><h3>設問内の項目 <span>${num(itemCount(q))} 項目</span></h3>${items.length ? items.map((item, index) => `<article class="sv-full-item"><div class="sv-full-item-head"><span class="sv-item-index">${index + 1}</span><div>${item.code ? `<code>${esc(item.code)}</code>` : ''}<h4>${esc(item.text || '単独の設問（上の設問文を参照）')}</h4></div></div>${arr(item.variable_names).length ? `<div class="sv-variables"><span>変数名</span>${arr(item.variable_names).map(v => `<code>${esc(v)}</code>`).join('')}</div>` : ''}${item.type ? `<span class="sv-item-format">回答形式: ${esc(item.type)}</span>` : ''}${arr(item.options).length ? optionsMarkup(item.options) : '<p class="sv-muted">この項目には個別の選択肢の記録がありません</p>'}${item.options_complete === false ? '<p class="sv-option-note">選択肢は抽出記録です。完全性は原資料で確認してください。</p>' : ''}<p class="sv-item-source">出典: ${esc(q._selected_source || arr(item.source_names || item.source_name).join(' / ') || '記録なし')}</p>${item.question_text && normalize(item.question_text) !== normalize(q.text) ? `<details class="sv-item-origin"><summary>この項目の出典に記録された設問文</summary><p>${esc(item.question_text)}</p></details>` : ''}${arr(item.source_names || item.source_name).length || arr(item.source_item_ids).length ? `<details class="sv-item-origin"><summary>この項目の出典・元 ID</summary>${arr(item.source_names || item.source_name).map(name => `<p>${esc(name)}</p>`).join('')}<p class="sv-record-id">${arr(item.source_item_ids).map(esc).join(' / ')}</p></details>` : ''}</article>`).join('') : `<p class="sv-muted">下位項目の記録はありません。設問群を 1 項目として数えています。</p>${!arr(q.options).length ? optionsMarkup([]) : ''}`}</section>`;
  }
  function referencesMarkup(references) {
    return arr(references).map(r => {
      const value = typeof r === 'object' && r ? r.url || r.title || JSON.stringify(r) : String(r);
      return /^https?:\/\//i.test(value) ? `<li><a href="${esc(value)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a></li>` : `<li>${esc(value)}</li>`;
    }).join('');
  }
  function provenanceMarkup(q) {
    return `<section class="sv-detail-section"><h3>分類・尺度の根拠</h3><p class="sv-detail-note">聖路加の分類表に直接記載された情報と、設問文の機械照合による転用を区別します。尺度名の記載だけでは、標準版の全項目・採点法が揃っていることを保証しません。</p>${categories(q).length ? categories(q).map(c => `<div class="sv-provenance-row"><div><span class="sv-provenance-badge${isTransferred(c) ? ' is-transfer' : ''}">${esc(basisLabel(c))}</span><strong>${esc(categoryText(c))}</strong></div>${basisText(c) ? `<p>${esc(basisText(c))}</p>` : ''}${c.confidence != null ? `<p class="sv-muted">照合の確信度: ${esc(c.confidence)}（尺度の妥当性評価ではありません）</p>` : ''}${c.source ? `<p class="sv-muted">${esc(typeof c.source === 'string' ? c.source : sourceText(c.source))}</p>` : ''}</div>`).join('') : '<p class="sv-muted">この設問には分類表との対応の記録がありません。</p>'}${scales(q).map(s => `<div class="sv-provenance-row sv-scale-record"><strong>${esc(scaleText(s))}</strong>${s.grade ? `<span class="sv-tag sv-tag-scale">原表の評価: ${esc(s.grade)}</span>` : ''}${s.basis ? `<p>${esc(s.basis)}</p>` : ''}${s.validation ? `<p>原表の妥当性確認メモ: ${esc(s.validation)}</p>` : ''}${s.source_workbook ? `<p class="sv-muted">分類・尺度の原表: ${esc(s.source_workbook)}${arr(s.source_rows).length ? ' / 行 ' + esc(arr(s.source_rows).join(', ')) : ''}</p>` : ''}${arr(s.references).length ? `<ul class="sv-references">${referencesMarkup(s.references)}</ul>` : ''}</div>`).join('')}</section><section class="sv-detail-section"><h3>収載元</h3>${arr(q.sources).length ? `<ul class="sv-source-list">${arr(q.sources).map(s => `<li><span>${s.url && /^https?:\/\//i.test(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(sourceText(s))}</a>` : esc(sourceText(s))}</span>${statusMarkup(s)}${s.kind ? `<small>${esc(s.kind)}</small>` : ''}${s.sheet ? `<small>シート: ${esc(s.sheet)}</small>` : ''}${s.row ? `<small>行: ${esc(s.row)}</small>` : ''}</li>`).join('')}</ul>` : '<p class="sv-muted">出典ファイルの記録なし</p>'}<p class="sv-record-id">レコード ID: ${esc(q.id)}</p></section>`;
  }
  function signature(q) { return JSON.stringify({options: arr(q.options).map(optionText), items: arr(q.items).map(i => ({text: normalize(i.text), options: arr(i.options).map(optionText)}))}); }
  function matchesMarkup(q) {
    if (isNumberOnlyStem(q)) return '';
    const matchesList = (matchIndex.get(q._match) || []).filter(x => x.id !== q.id).sort((a, b) => Number(a.year) - Number(b.year) || lex(a.study, b.study));
    const currentSignature = signature(q);
    return `<section class="sv-detail-section sv-comparison-section"><h3>同文の設問を比較 <span>${num(matchesList.length)} 別レコード</span></h3><p class="sv-detail-note">表記を正規化した設問文で照合しています。対象・期間・下位項目・選択肢は別に確認してください。同じ設問文でも同じ尺度や変数とは限りません。</p>${matchesList.length ? matchesList.map(raw => { const other = sourceView(raw); return `<details class="sv-comparison" data-sv-compare="${esc(other.id)}"><summary><span><b>${esc(waveLabel(other))}</b><small>${esc(questionNumber(other))} · ${num(itemCount(other))} 項目</small></span><em class="${currentSignature === signature(other) ? 'sv-match-same' : 'sv-match-different'}">${currentSignature === signature(other) ? '下位項目・選択肢も一致' : '下位項目・選択肢を確認'}</em></summary><div class="sv-comparison-body"></div></details>`; }).join('') : '<p class="sv-muted">カタログ内に同文の別レコードはありません。類似する質問はキーワード検索で探せます。</p>'}</section>`;
  }
  function variantsMarkup(q) {
    const variants = arr(q.text_variants).map(v => typeof v === 'string' ? {text: v} : v).filter(v => v.text && v.text !== q.text);
    return variants.length ? `<section class="sv-detail-section"><h3>出典ごとの設問文の表記 <span>${num(variants.length)} 表記</span></h3>${variants.map(v => `<details class="sv-text-variant"><summary>${esc(v.source_name || v.source || '別出典の設問文')}</summary><p>${esc(v.text)}</p></details>`).join('')}</section>` : '';
  }
  function domainsMarkup(q) {
    const matches = arr(q.domain_matches);
    const grades = arr(q.validation_grades);
    if (!matches.length && !grades.length && !arr(q.domains).length) return '';
    return `<section class="sv-detail-section"><h3>研究領域・原表の評価</h3>${grades.length ? `<p class="sv-detail-note">聖路加の原表に記載された評価: <b>${esc(grades.join(' / '))}</b>。評価は元表の記録です。設問群全体やすべての調査年の妥当性を示すものではありません。</p>` : ''}${matches.length ? matches.map(m => `<div class="sv-provenance-row"><strong>${esc(domainLabel(m.domain))}</strong><p>${esc(m.basis || (data.taxonomy && data.taxonomy.domain_basis) || '対応の根拠未記載')}</p>${m.confidence != null ? `<p class="sv-muted">分類の確信度: ${esc(m.confidence)}</p>` : ''}</div>`).join('') : arr(q.domains).map(d => `<div class="sv-provenance-row"><strong>${esc(domainLabel(d))}</strong><p>${esc((data.taxonomy && data.taxonomy.domain_basis) || '領域との対応根拠はカタログの元情報を参照')}</p></div>`).join('')}</section>`;
  }
  function domainLinksMarkup(q) {
    const domains = unique(arr(q.domains).map(d => typeof d === 'string' ? d : d.id || d.domain));
    if (!domains.length) return '';
    return `<nav class="sv-map-links" aria-label="この領域の概念マップを見る"><span class="sv-muted">この領域の概念マップを見る</span><div class="sv-dialog-actions">${domains.map(id => `<button type="button" class="sv-button" data-sv-map-domain="${esc(id)}" aria-label="${esc(domainLabel(id))}の概念マップを見る">${esc(domainLabel(id))} <span aria-hidden="true">→</span></button>`).join('')}</div></nav>`;
  }
  function papersMarkup(q) {
    const domains = new Set(arr(q.domains));
    const papers = arr(window.JAXMAPS && window.JAXMAPS.papers).filter(p => domains.has(p.exposure_domain) || domains.has(p.outcome_domain)).sort((a, b) => Number(b.year) - Number(a.year));
    if (!papers.length) return '';
    const paperRows = list => list.map(p => `<article class="sv-related-paper"><button type="button" data-sv-paper="${esc(p.paper_id)}">${esc(p.title || p.paper_id)}</button><p>${esc([p.first_author, p.year, p.journal].filter(Boolean).join(' · '))}</p><span>${esc([domainLabel(p.exposure_domain), domainLabel(p.outcome_domain)].filter(Boolean).join(' → '))}</span></article>`).join('');
    return `<section class="sv-detail-section"><h3>同じ概念を扱う論文 <span>${num(papers.length)} 本</span></h3><p class="sv-detail-note">研究領域の対応から表示しています。この質問・調査年をその論文で使用したことを確認した一覧ではありません。機械分類を含みます。</p>${paperRows(papers.slice(0, 10))}${papers.length > 10 ? `<details class="sv-related-more"><summary>残り ${num(papers.length - 10)} 本を表示</summary>${paperRows(papers.slice(10))}</details>` : ''}</section>`;
  }
  function renderDetail(originalQuestion) {
    currentQuestion = originalQuestion;
    const q = sourceView(originalQuestion, currentSource);
    const saved = favorites.has(String(q.id));
    dialog.querySelector('[data-sv-dialog-content]').innerHTML = `<div class="sv-dialog-heading"><div class="sv-question-meta"><span class="sv-study-pill${String(q.study).toUpperCase() === 'JASTIS' ? ' is-jastis' : ''}">${esc(q.study)}</span><span>${esc(q.year)}${q.substudy ? ' · ' + esc(substudyLabel(q.substudy)) : ''}</span><span class="sv-qnumber">${esc(questionNumber(q))}</span>${q.type ? `<span>${esc(q.type)}</span>` : ''}${statusMarkup(q)}</div>${hasDraft(q) ? '<p class="sv-draft-notice">この設問にはドラフト版の記録を含みます。確定版と異なる可能性があるため、項目の出典を確認してください。</p>' : ''}<h2 id="sv-dialog-title">${esc(questionHeading(q))}</h2>${numberNoteMarkup(q)}<div class="sv-dialog-actions"><button class="sv-button${saved ? ' is-active' : ''}" type="button" data-sv-favorite="${esc(q.id)}" aria-pressed="${saved}">${saved ? '★ 保存済み' : '☆ この設問を保存'}</button><button class="sv-button" type="button" data-sv-copy-link>設問へのリンクをコピー</button><button class="sv-button" type="button" data-sv-current-json>この設問の JSON</button></div>${arr(q.variable_names).length ? `<div class="sv-variables"><span>変数名</span>${arr(q.variable_names).map(v => `<code>${esc(v)}</code>`).join('')}</div>` : ''}</div>${domainLinksMarkup(originalQuestion)}${sourceSelectorMarkup(originalQuestion)}${officialTextMarkup()}${variantsMarkup(originalQuestion)}${fullItemsMarkup(q)}${matchesMarkup(q)}${domainsMarkup(originalQuestion)}${provenanceMarkup(originalQuestion)}${papersMarkup(originalQuestion)}`;
  }
  function showDetail(id, sourceName) {
    const q = byId.get(String(id));
    if (!q) return;
    if (!dialog.open) returnFocus = document.activeElement;
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    currentSource = sourceName !== undefined ? sourceName : params.get('question') === q.id && params.has('source') ? params.get('source') : preferredSource(q);
    if (currentSource && !arr(q.sources).some(s => sourceText(s) === currentSource)) currentSource = preferredSource(q);
    renderDetail(q);
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    dialog.querySelector('[data-sv-close]').focus();
    writeHash();
  }
  function cleanQuestion(q) {
    const result = {};
    Object.keys(q).forEach(key => { if (!key.startsWith('_')) result[key] = q[key]; });
    return result;
  }
  function download(name, contents, type) {
    const url = URL.createObjectURL(new Blob([contents], {type}));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function csvCell(v) {
    let text = String(v ?? '');
    if (/^\s*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function exportData(format, single) {
    const records = single ? [single] : questions.filter(q => matches(q));
    const now = new Date().toISOString().slice(0, 10);
    const basename = `JAxMAPs-questionnaire-${single ? single.id.replace(/[^a-zA-Z0-9_-]/g, '_') : 'filtered'}-${now}`;
    if (format === 'json') {
      const relevantWaves = new Set(records.map(q => q.wave_id));
      download(basename + '.json', JSON.stringify({meta: data.meta, exported_at: new Date().toISOString(), filters: {...state}, question_count: records.length, item_count: records.reduce((n, q) => n + itemCount(q), 0), waves: waves.filter(w => relevantWaves.has(w.id)), questions: records.map(cleanQuestion)}, null, 2), 'application/json;charset=utf-8');
    } else {
      const header = ['設問ID', '調査', '実施年', '対象・調査票', '表示用設問番号', '原資料の質問番号', '番号の根拠', '設問識別キー', '設問文', '回答形式', '項目コード', '項目文', '変数名', '選択肢', '設問共通の選択肢', '分類', '分類根拠', '尺度候補', '尺度の根拠・評価', '研究領域', '項目出典', '出典別元項目ID', '項目出典の状態', '設問群の全出典'];
      const rows = records.flatMap(q => (arr(q.items).length ? q.items : [{}]).map(i => [q.id, q.study, q.year, q.substudy, questionNumber(q), q.original_question_number || q.number, q.number_basis || 'original', q.number, isNumberOnlyStem(q) ? '' : q.text, q.type, i.code, i.text, [...arr(q.variable_names), ...arr(i.variable_names)].join(' | '), arr(i.options).map(optionText).join(' | '), arr(q.options).map(optionText).join(' | '), categories(q).map(categoryText).join(' | '), categories(q).map(c => [basisLabel(c), basisText(c)].filter(Boolean).join(': ')).join(' | '), scales(q).map(scaleText).join(' | '), scales(q).map(s => [s.grade, s.basis].filter(Boolean).join(': ')).join(' | '), arr(q.domains).map(domainLabel).join(' | '), arr(i.source_names || i.source_name).join(' | '), arr(i.source_item_ids).join(' | '), arr(i.source_statuses || i.status).map(status => statusLabel({status})).join(' | '), arr(q.sources).map(sourceText).join(' | ')]));
      download(basename + '.csv', '\uFEFF' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
    }
    announce(`${num(records.length)} 設問群を書き出しました。`);
  }
  async function copyLink() {
    writeHash();
    let copied = false;
    try { await navigator.clipboard.writeText(location.href); copied = true; }
    catch (_) {
      const field = document.createElement('textarea'); field.value = location.href; field.className = 'sv-copy-buffer'; dialog.append(field); field.select();
      try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
      field.remove();
    }
    announce(copied ? '設問へのリンクをコピーしました。' : 'アドレスバーの URL をコピーすると、同じ設問を開けます。');
    const button = dialog.querySelector('[data-sv-copy-link]'); if (button) button.textContent = copied ? 'リンクをコピーしました' : 'アドレスバーから URL をコピー';
  }
  function onClick(event) {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.hasAttribute('data-sv-close')) { dialog.close(); return; }
    if (target.hasAttribute('data-sv-detail')) { showDetail(target.dataset.svDetail); return; }
    if (target.hasAttribute('data-sv-favorite')) { saveFavorite(target.dataset.svFavorite); return; }
    if (target.hasAttribute('data-sv-paper')) { if (window.JAxMAPs && window.JAxMAPs.openPaper) { dialog.close(); currentQuestion = null; history.replaceState(null, '', '#list'); window.JAxMAPs.openPaper(target.dataset.svPaper); } return; }
    if (target.hasAttribute('data-sv-map-domain')) { if (window.JAxMAPs && window.JAxMAPs.openDomain) { dialog.close(); currentQuestion = null; window.JAxMAPs.openDomain(target.dataset.svMapDomain); } return; }
    if (target.hasAttribute('data-sv-copy-link')) { copyLink(); return; }
    if (target.hasAttribute('data-sv-current-json')) { exportData('json', currentQuestion); return; }
    if (target.hasAttribute('data-sv-export')) { exportData(target.dataset.svExport); return; }
    if (target.hasAttribute('data-sv-reset')) Object.assign(state, DEFAULTS);
    else if (target.hasAttribute('data-sv-wave')) { const w = waveById.get(target.dataset.svWave); Object.assign(state, DEFAULTS, {wave: String(w.id), study: String(w.study), year: String(w.year), substudy: String(w.substudy || '')}); }
    else if (target.hasAttribute('data-sv-year')) Object.assign(state, DEFAULTS, {year: target.dataset.svYear});
    else if (target.hasAttribute('data-sv-saved')) { state.saved = !state.saved; state.page = 1; }
    else if (target.hasAttribute('data-sv-remove')) { const key = target.dataset.svRemove; state[key] = DEFAULTS[key]; state.page = 1; if (['study', 'year', 'substudy'].includes(key)) state.wave = ''; if (key === 'category') state.subcategory = ''; }
    else if (target.hasAttribute('data-sv-page')) { state.page = +target.dataset.svPage; }
    else return;
    update();
    if (target.hasAttribute('data-sv-page') || target.hasAttribute('data-sv-wave') || target.hasAttribute('data-sv-year')) $('[data-sv-results-heading]').scrollIntoView({block: 'start', behavior: 'smooth'});
  }
  function mount() {
    if (mounted) return true;
    root = document.getElementById('survey-root'); data = window.JAXSURVEY;
    if (!root || !data) return false;
    questions = arr(data.questions).map(q => ({...q, id: String(q.id), wave_id: String(q.wave_id), items: arr(q.items)}));
    waves = arr(data.waves).map(w => ({...w, id: String(w.id)}));
    byId = new Map(questions.map(q => [q.id, q])); waveById = new Map(waves.map(w => [w.id, w])); matchIndex = new Map();
    questions.forEach(q => { q._search = makeSearch(q); q._match = isNumberOnlyStem(q) ? '' : q.match_key || normalize(q.text); if (q._match) { if (!matchIndex.has(q._match)) matchIndex.set(q._match, []); matchIndex.get(q._match).push(q); } });
    waves.forEach(w => { const qs = questions.filter(q => q.wave_id === w.id); w.question_count = qs.length; w.item_count = qs.reduce((n, q) => n + itemCount(q), 0); });
    loadFavorites();
    const years = unique(questions.map(q => q.year)).sort((a, b) => Number(a) - Number(b));
    const sourceCount = unique(questions.flatMap(q => arr(q.sources).map(sourceText))).length;
    root.classList.add('sv-explorer');
    root.innerHTML = `<header class="sv-hero"><div><span class="sv-eyebrow">QUESTIONNAIRE ATLAS</span><h2>年をたどり、<br class="sv-mobile-break">質問を読み解く。</h2><p>JACSIS / JASTIS の設問文・下位項目・選択肢を、調査年とテーマから探せます。<br>聖路加で作成した分類・尺度の情報を、元の根拠とともに引き継いでいます。</p></div><div class="sv-hero-stats"><div><strong>${num(questions.length)}</strong><span>設問群</span></div><div><strong>${num(questions.reduce((n, q) => n + itemCount(q), 0))}</strong><span>下位項目を含む項目</span></div><div><strong>${num(waves.filter(w => w.question_count > 0).length)}</strong><span>設問を収載した調査波</span></div><div><strong>${years.length ? esc(years[0]) + '<small>–</small>' + esc(years[years.length - 1]) : '—'}</strong><span>収載されている実施年</span></div></div></header><div class="sv-content"><details class="sv-overview" open><summary><span><b>年度別の調査票</b><small>各タイルから、その年・対象の全設問へ</small></span><span class="sv-overview-count">${num(sourceCount)} 収載元ファイル</span></summary><div data-sv-matrix></div><p class="sv-matrix-note"><i class="sv-legend-dot"></i>JACSIS <i class="sv-legend-dot sv-legend-jastis"></i>JASTIS <span>設問群＝番号・設問文単位 / 項目＝下位項目を含む表示単位。出典間で完全に一致する項目は統合。「収載なし」は未実施を意味しません。</span></p></details><section class="sv-search-panel" aria-label="調査票の検索と絞り込み"><div class="sv-search-row"><label class="sv-search-input"><span>設問を検索</span><input data-sv-query type="search" placeholder="例：孤独、K6、生成AI、変数名…" aria-label="設問文・項目・選択肢・変数名を検索"><small>空白で区切ると、すべての語を含む設問を検索</small></label><button class="sv-button sv-saved-button" data-sv-saved type="button" aria-pressed="false"><span aria-hidden="true">☆</span> 保存した設問 <b data-sv-saved-count>0</b></button></div><div class="sv-filter-grid"><label><span>調査</span><select data-sv-filter="study" aria-label="調査"></select></label><label><span>実施年</span><select data-sv-filter="year" aria-label="実施年"></select></label><label><span>対象・調査票</span><select data-sv-filter="substudy" aria-label="対象・調査票"></select></label><label><span>大分類</span><select data-sv-filter="category" aria-label="大分類"></select></label><label><span>小分類</span><select data-sv-filter="subcategory" aria-label="小分類"></select></label><label><span>尺度候補</span><select data-sv-filter="scale" aria-label="尺度候補"></select></label><label><span>研究領域</span><select data-sv-filter="domain" aria-label="研究領域"></select></label></div><div class="sv-filter-bottom"><div data-sv-active class="sv-active-filters"></div><button type="button" class="sv-text-button" data-sv-reset>条件をリセット</button></div></section><section class="sv-results-section"><header class="sv-results-header" data-sv-results-heading><div><h2 data-sv-count></h2><p data-sv-result-context></p></div><div class="sv-result-actions"><label>表示件数<select data-sv-size aria-label="1ページの表示件数"><option value="30">30 件</option><option value="60">60 件</option><option value="120">120 件</option><option value="all">すべて表示</option></select></label><button class="sv-button" type="button" data-sv-export="csv" title="ページにかかわらず、現在の条件に一致するすべての設問を出力">CSV 出力</button><button class="sv-button" type="button" data-sv-export="json" title="出典と分類の根拠を含む全レコードを出力">JSON 出力</button></div></header><p class="sv-coverage-note">表示と出力は収載済みの調査票の範囲です。${esc(data.meta && data.meta.type_note || '')} 分類のない設問も全文検索できます。${data.meta && data.meta.source_item_count ? `出典別の ${num(data.meta.source_item_count)} 行から完全一致の重複をまとめ、元 ID を保持しています。` : ''}</p><div data-sv-results class="sv-results"></div><nav class="sv-pagination" data-sv-pagination aria-label="検索結果のページ"></nav></section><div class="sv-status" data-sv-status role="status" aria-live="polite"></div></div><dialog class="sv-dialog" aria-labelledby="sv-dialog-title"><div class="sv-dialog-toolbar"><span>QUESTION DETAIL</span><button type="button" class="sv-button" data-sv-close aria-label="設問詳細を閉じる">閉じる <span aria-hidden="true">×</span></button></div><div data-sv-dialog-content></div></dialog>`;
    dialog = $('dialog');
    root.addEventListener('click', onClick);
    root.addEventListener('change', event => {
      const target = event.target;
      if (target.hasAttribute('data-sv-source')) { currentSource = target.value; renderDetail(currentQuestion); writeHash(); dialog.querySelector('[data-sv-source]').focus(); }
      if (target.hasAttribute('data-sv-filter')) { const key = target.dataset.svFilter; state[key] = target.value; state.page = 1; if (['study', 'year', 'substudy'].includes(key)) state.wave = ''; if (key === 'category') state.subcategory = ''; update(); }
      if (target.hasAttribute('data-sv-size')) { state.size = target.value === 'all' ? 'all' : +target.value; state.page = 1; update(); }
    });
    $('[data-sv-query]').addEventListener('input', event => { state.query = event.target.value; state.page = 1; clearTimeout(searchTimer); searchTimer = setTimeout(update, 180); });
    dialog.addEventListener('close', () => { currentQuestion = null; if (/^#survey(?:\?|$)/.test(location.hash) && (!document.querySelector('#tabs [data-tab="survey"]') || document.querySelector('#tabs [data-tab="survey"]').classList.contains('on'))) writeHash(); if (returnFocus && returnFocus.isConnected) returnFocus.focus(); });
    dialog.addEventListener('toggle', event => { const comparison = event.target; if (comparison.matches('[data-sv-source-text]') && comparison.open && !comparison.dataset.loaded) { const source = arr(window.JAXSURVEYSOURCES && window.JAXSURVEYSOURCES.sources).find(s => s.name === comparison.dataset.svSourceText); if (source) { const pre = document.createElement('pre'); pre.textContent = source.text; pre.tabIndex = 0; pre.setAttribute('aria-label', '公式調査票の原文全文'); comparison.querySelector('[data-sv-source-text-body]').append(pre); comparison.dataset.loaded = 'true'; } return; } if (!comparison.matches('[data-sv-compare]') || !comparison.open || comparison.dataset.loaded) return; const raw = byId.get(comparison.dataset.svCompare); if (!raw) return; const other = sourceView(raw); comparison.querySelector('.sv-comparison-body').innerHTML = `<p class="sv-comparison-stem">${esc(other.text)}</p><p class="sv-item-source">表示出典: ${esc(other._selected_source || 'すべて')}</p>${fullItemsMarkup(other)}<button class="sv-button" type="button" data-sv-detail="${esc(other.id)}">この設問の出典・分類も開く</button>`; comparison.dataset.loaded = 'true'; }, true);
    dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
    window.addEventListener('hashchange', () => { if (/^#survey(?:\?|$)/.test(location.hash)) { const id = readHash(); activateTab(); update(false); if (id) showDetail(id); else if (dialog.open) dialog.close(); } else if (dialog.open) dialog.close(); });
    mounted = true;
    const id = readHash(); update(false);
    if (/^#survey(?:\?|$)/.test(location.hash)) { activateTab(); if (id) showDetail(id); }
    return true;
  }
  function open(options = {}) {
    if (!mount()) return false;
    Object.assign(state, DEFAULTS);
    Object.keys(DEFAULTS).forEach(key => { if (options[key] != null) state[key] = key === 'saved' ? Boolean(options[key]) : key === 'page' || key === 'size' ? options[key] : String(options[key]); });
    if (options.q != null) state.query = String(options.q);
    if (options.wave_id != null) state.wave = String(options.wave_id);
    state.size = state.size === 'all' ? 'all' : [30, 60, 120].includes(+state.size) ? +state.size : 30;
    state.page = Math.max(1, parseInt(state.page, 10) || 1);
    activateTab(); update();
    if (options.question || options.id) showDetail(options.question || options.id, options.source);
    return true;
  }
  window.JAxSurvey = {mount, open, getState: () => ({...state}), getFilteredQuestions: () => filtered.map(cleanQuestion), export: format => exportData(format === 'csv' ? 'csv' : 'json')};
})();
