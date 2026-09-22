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
  const itemCount = q => q.rights_restricted ? 0 : arr(q.items).length || 1;
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
  const basisKey = c => String((c && typeof c === 'object' && (c.basis || c.source_kind || c.method)) || '');
  const basisText = c => ({stluke_direct: '参照表に直接記載', stluke_exact_text_transfer: '参照表の設問文・項目との一致による対応'})[basisKey(c)] || basisKey(c);
  function isTransferred(c) { return /transfer|machine|inferred|推定|転用|機械|照合|一致|mapped/i.test(basisKey(c)); }
  function basisLabel(c) {
    const b = basisKey(c);
    if (isTransferred(c)) return '機械照合・転用';
    if (/luke|student|source|original|manual|直接|原表|分類表|人手/i.test(b)) return '参照表に直接記載';
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
    if (q.rights_restricted) return normalize([q.study, q.year, q.substudy, q.number, q.display_number, ...restrictedScaleNames(q)].join(' '));
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
    return categories(q).slice(0, 2).map(c => `<span class="sv-tag sv-tag-source">${esc(typeof c === 'string' ? c : c.sub || c.main)}</span>`).join('') + scales(q).slice(0, 3).map(s => `<span class="sv-tag sv-tag-scale">${esc(scaleText(s))}</span>`).join('');
  }
  function renderMatrix() {
    const years = unique(waves.map(w => w.year)).sort((a, b) => Number(a) - Number(b));
    const studies = unique(waves.map(w => w.study)).sort(lex);
    const max = Math.max(1, ...waves.map(w => +w.question_count || 0));
    $('[data-sv-matrix]').innerHTML = `<div class="sv-matrix-scroll" tabindex="0" role="region" aria-label="年度別調査票一覧。横方向にスクロールできます"><table class="sv-matrix"><thead><tr><th scope="col">調査 / 実施年</th>${years.map(y => `<th scope="col"><button type="button" class="sv-year-button${state.year === y ? ' is-active' : ''}" data-sv-year="${esc(y)}">${esc(y)}</button></th>`).join('')}</tr></thead><tbody>${studies.map(study => `<tr><th scope="row"><span class="sv-study-label">${esc(study)}</span><small>${num(waves.filter(w => w.study === study).length)} 調査票</small></th>${years.map(year => {
      const cell = waves.filter(w => w.study === study && String(w.year) === year).sort((a, b) => lex(a.substudy || '', b.substudy || ''));
      return `<td>${cell.length ? cell.map(w => {
        const active = state.wave === String(w.id);
        const amount = Math.max(.08, Math.sqrt((+w.question_count || 0) / max));
        return `<button type="button" class="sv-wave${active ? ' is-active' : ''}${String(w.study).toUpperCase() === 'JASTIS' ? ' sv-wave-jastis' : ''}" data-sv-wave="${esc(w.id)}" aria-pressed="${active}" title="${esc(w.label || [w.study, w.year, w.substudy].filter(Boolean).join(' '))}：${num(w.question_count)} 設問群、${num(w.item_count)} 項目" style="--wave-intensity:${amount}"><span>${esc(substudyLabel(w.substudy) || '本調査')}</span>${!w.question_count && officialUrl(w.official_url) ? '<strong><small>公式調査票</small></strong><em>内容を確認 →</em>' : `<strong>${num(w.question_count)}<small> 設問群</small></strong>${w.item_count ? `<em>${num(w.item_count)} 項目</em>` : ''}`}</button>`;
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
  function restrictedScaleNames(q) {
    return unique([...arr(q.rights_scale_names), ...scales(q).map(scaleText)]);
  }
  function officialUrl(value) {
    return /^https?:\/\/(?:jacsis-study\.jp|jastis-study\.jp)(?:\/|$)/i.test(String(value || '')) ? String(value) : '';
  }
  function questionOfficialUrl(q) {
    return arr(q.sources).map(source => officialUrl(source.url)).find(Boolean) || '';
  }
  function restrictedQuestionMarkup(q, detailed = false) {
    const title = esc(restrictedScaleNames(q).join(' / ') || '尺度');
    const url = questionOfficialUrl(q);
    return `<${detailed ? 'div class="sv-dialog-heading"' : `article class="sv-question" data-sv-card="${esc(q.id)}"`}><div class="sv-question-meta"><span class="sv-study-pill">${esc(q.study)}</span><span>${esc(q.year)}${q.substudy ? ' · ' + esc(substudyLabel(q.substudy)) : ''}</span><span class="sv-qnumber">${esc(questionNumber(q))}</span></div>${detailed ? `<h2 id="sv-dialog-title">${title}</h2>` : `<h3>${title}</h3>`}<p>本文は公式調査票で確認</p>${url ? `<a class="sv-detail-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">調査票を開く <span aria-hidden="true">↗</span></a>` : ''}</${detailed ? 'div' : 'article'}>`;
  }
  function selectedExternalWave() {
    const wave = waveById.get(state.wave);
    return wave && !wave.question_count && officialUrl(wave.official_url) ? wave : null;
  }
  function emptyResultsMarkup() {
    const wave = selectedExternalWave();
    if (wave) return `<div class="sv-empty"><h3>${esc(wave.label || [wave.study, wave.year, substudyLabel(wave.substudy)].filter(Boolean).join(' '))}</h3><p>公式サイトで質問を確認できます。</p><a class="sv-button" href="${esc(officialUrl(wave.official_url))}" target="_blank" rel="noopener noreferrer">公式調査票を開く</a></div>`;
    return '<div class="sv-empty"><span aria-hidden="true">⌕</span><h3>この条件に一致する設問はありません</h3><p>表記を変えるか、絞り込みを解除してください。</p><button type="button" class="sv-button" data-sv-reset>条件をすべて解除</button></div>';
  }
  function card(q) {
    if (q.rights_restricted) return restrictedQuestionMarkup(q);
    const saved = favorites.has(String(q.id));
    const count = itemCount(q);
    const otherYears = unique((matchIndex.get(q._match) || []).filter(x => x.year !== q.year).map(x => x.year));
    const items = arr(q.items).filter(i => i.text || i.code);
    return `<article class="sv-question" data-sv-card="${esc(q.id)}"><div class="sv-question-top"><div class="sv-question-meta"><span class="sv-study-pill${String(q.study).toUpperCase() === 'JASTIS' ? ' is-jastis' : ''}">${esc(q.study)}</span><span>${esc(q.year)}${q.substudy ? ' · ' + esc(substudyLabel(q.substudy)) : ''}</span><span class="sv-qnumber">${esc(questionNumber(q))}</span>${q.type ? `<span class="sv-type">${esc(q.type)}</span>` : ''}</div><button type="button" class="sv-star${saved ? ' is-saved' : ''}" data-sv-favorite="${esc(q.id)}" aria-pressed="${saved}" aria-label="${esc(questionNumber(q))} ${saved ? 'を保存から削除' : 'を保存'}">${saved ? '★' : '☆'}</button></div><h3><button type="button" data-sv-detail="${esc(q.id)}">${esc(questionHeading(q))}</button></h3>${items.length ? `<ul class="sv-item-preview">${items.slice(0, 3).map(i => `<li>${i.code ? `<code>${esc(i.code)}</code>` : ''}${esc(i.text || '項目名の記録なし')}</li>`).join('')}${items.length > 3 ? `<li class="sv-more-items">ほか ${num(items.length - 3)} 項目 — 詳細ですべて表示</li>` : ''}</ul>` : ''}<div class="sv-tags">${chips(q)}</div><div class="sv-question-bottom"><span>${num(count)} 項目${arr(q.options).length ? ` / ${num(arr(q.options).length)} 選択肢` : ''}${otherYears.length ? ` · 同文の設問を ${num(otherYears.length)} 別年に収載` : ''}</span><button class="sv-detail-link" type="button" data-sv-detail="${esc(q.id)}">全文・選択肢を見る <span aria-hidden="true">↗</span></button></div></article>`;
  }
  function renderResults() {
    const totalItems = filtered.reduce((n, q) => n + itemCount(q), 0);
    const pageSize = state.size === 'all' ? Math.max(1, filtered.length) : +state.size;
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    state.page = Math.max(1, Math.min(state.page, pages));
    const offset = (state.page - 1) * pageSize;
    const shown = filtered.slice(offset, offset + pageSize);
    const externalWave = selectedExternalWave();
    $('[data-sv-count]').innerHTML = externalWave ? '調査票を見る' : `<strong>${num(filtered.length)}</strong> 設問群${totalItems ? `<span>/ ${num(totalItems)} 項目</span>` : ''}`;
    $('[data-sv-result-context]').textContent = externalWave ? (externalWave.label || '') : filtered.length ? `${num(unique(filtered.map(q => q.wave_id)).length)} 調査票・${num(unique(filtered.map(q => q.year)).length)} 年に収載` : '条件を変えて再検索できます';
    $('[data-sv-results]').innerHTML = shown.length ? shown.map(card).join('') : emptyResultsMarkup();
    $('[data-sv-pagination]').innerHTML = `<span>${filtered.length ? `${num(offset + 1)}–${num(Math.min(offset + pageSize, filtered.length))} / ${num(filtered.length)} 設問群` : '0 設問群'}</span><div><button type="button" class="sv-button" data-sv-page="1" ${state.page === 1 ? 'disabled' : ''} aria-label="最初のページ">«</button><button type="button" class="sv-button" data-sv-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>前へ</button><span class="sv-page-number">${num(state.page)} / ${num(pages)}</span><button type="button" class="sv-button" data-sv-page="${state.page + 1}" ${state.page === pages ? 'disabled' : ''}>次へ</button><button type="button" class="sv-button" data-sv-page="${pages}" ${state.page === pages ? 'disabled' : ''} aria-label="最後のページ">»</button></div>`;
    if (externalWave) $('[data-sv-pagination]').innerHTML = '';
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
    if (q.rights_restricted) return cleanQuestion(q);
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
    const preferred = preferredSource(q);
    const sources = [...arr(q.sources)].sort((a, b) => Number(sourceText(b) === preferred) - Number(sourceText(a) === preferred));
    if (sources.length < 2) return '';
    return `<div class="sv-source-selector"><label><span>調査票の版</span><select data-sv-source aria-label="調査票の版">${sources.map((source, index) => {
      const official = source.public_verified || ['official_published', 'officially_published'].includes(source.status);
      const label = index === 0 ? (official ? '公式公開票' : '調査票') : `${official ? '公開票' : '調査票'}（別版${index}）`;
      return `<option value="${esc(sourceText(source))}"${currentSource === sourceText(source) ? ' selected' : ''}>${label}</option>`;
    }).join('')}<option value=""${currentSource === '' ? ' selected' : ''}>すべての版</option></select></label></div>`;
  }
  function officialTextMarkup() {
    const source = arr(window.JAXSURVEYSOURCES && window.JAXSURVEYSOURCES.sources).find(s => s.name === currentSource);
    if (!source) return '';
    if (source.rights_restricted || !source.text) return officialUrl(source.url) ? `<p><a class="sv-detail-link" href="${esc(officialUrl(source.url))}" target="_blank" rel="noopener noreferrer">調査票を開く</a></p>` : '';
    return `<details class="sv-original-text" data-sv-source-text="${esc(source.name)}"><summary>調査票の全文を読む</summary>${source.url && /^https?:\/\//i.test(source.url) ? `<p><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">調査票を開く</a></p>` : ''}<div data-sv-source-text-body></div></details>`;
  }
  function fullItemsMarkup(q) {
    const items = arr(q.items);
    return `${arr(q.options).length ? `<section class="sv-detail-section"><h3>共通の選択肢</h3>${optionsMarkup(q.options)}</section>` : ''}<section class="sv-detail-section"><h3>設問内の項目 <span>${num(itemCount(q))} 項目</span></h3>${items.length ? items.map((item, index) => `<article class="sv-full-item"><div class="sv-full-item-head"><span class="sv-item-index">${index + 1}</span><div>${item.code ? `<code>${esc(item.code)}</code>` : ''}<h4>${esc(item.text || '上の設問に回答')}</h4></div></div>${arr(item.variable_names).length ? `<div class="sv-variables"><span>変数名</span>${arr(item.variable_names).map(v => `<code>${esc(v)}</code>`).join('')}</div>` : ''}${item.type ? `<span class="sv-item-format">回答形式: ${esc(item.type)}</span>` : ''}${arr(item.options).length ? optionsMarkup(item.options) : ''}${item.question_text && normalize(item.question_text) !== normalize(q.text) ? `<details class="sv-item-origin"><summary>設問文</summary><p>${esc(item.question_text)}</p></details>` : ''}</article>`).join('') : ''}</section>`;
  }
  function classificationMarkup(q) {
    const categoryNames = unique(categories(q).map(categoryText));
    const scaleNames = unique(scales(q).map(scaleText));
    if (!categoryNames.length && !scaleNames.length) return '';
    return `<section class="sv-detail-section"><h3>分類・尺度</h3>${categoryNames.length ? `<div class="sv-tags">${categoryNames.map(name => `<span class="sv-tag sv-tag-source">${esc(name)}</span>`).join('')}</div>` : ''}${scaleNames.length ? `<div class="sv-tags">${scaleNames.map(name => `<span class="sv-tag sv-tag-scale">${esc(name)}</span>`).join('')}</div>` : ''}</section>`;
  }
  function signature(q) { return JSON.stringify({options: arr(q.options).map(optionText), items: arr(q.items).map(i => ({text: normalize(i.text), options: arr(i.options).map(optionText)}))}); }
  function matchesMarkup(q) {
    if (q.rights_restricted || isNumberOnlyStem(q)) return '';
    const matchesList = (matchIndex.get(q._match) || []).filter(x => x.id !== q.id && !x.rights_restricted).sort((a, b) => Number(a.year) - Number(b.year) || lex(a.study, b.study));
    const currentSignature = signature(q);
    return `<section class="sv-detail-section sv-comparison-section"><h3>同文の設問を比較 <span>${num(matchesList.length)} 件</span></h3>${matchesList.length ? matchesList.map(raw => { const other = sourceView(raw); return `<details class="sv-comparison" data-sv-compare="${esc(other.id)}"><summary><span><b>${esc(waveLabel(other))}</b><small>${esc(questionNumber(other))} · ${num(itemCount(other))} 項目</small></span><em class="${currentSignature === signature(other) ? 'sv-match-same' : 'sv-match-different'}">${currentSignature === signature(other) ? '下位項目・選択肢も一致' : '下位項目・選択肢を確認'}</em></summary><div class="sv-comparison-body"></div></details>`; }).join('') : '<p class="sv-muted">同文の質問は見つかりません。類似する質問はキーワードで探せます。</p>'}</section>`;
  }
  function variantsMarkup(q) {
    const variants = arr(q.text_variants).map(v => typeof v === 'string' ? {text: v} : v).filter(v => v.text && v.text !== q.text);
    return variants.length ? `<section class="sv-detail-section"><h3>設問文の別表記 <span>${num(variants.length)} 表記</span></h3>${variants.map(v => `<details class="sv-text-variant"><summary>別表記を読む</summary><p>${esc(v.text)}</p></details>`).join('')}</section>` : '';
  }
  function domainLinksMarkup(q) {
    const domains = unique(arr(q.domains).map(d => typeof d === 'string' ? d : d.id || d.domain));
    if (!domains.length) return '';
    return `<nav class="sv-map-links" aria-label="この領域の概念マップを見る"><span class="sv-muted">この領域の概念マップを見る</span><div class="sv-dialog-actions">${domains.map(id => `<button type="button" class="sv-button" data-sv-map-domain="${esc(id)}" aria-label="${esc(domainLabel(id))}の概念マップを見る">${esc(domainLabel(id))} <span aria-hidden="true">→</span></button>`).join('')}</div></nav>`;
  }
  function paperUrl(p) {
    const doi = String(p.doi || '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
    if (/^10\.\d{4,9}\/\S+$/.test(doi)) return 'https://doi.org/' + encodeURIComponent(doi).replace(/%2F/gi, '/');
    return /^https?:\/\//i.test(p.article_url || '') ? p.article_url : '';
  }
  function papersMarkup(q) {
    const domains = new Set(arr(q.domains));
    const papers = arr(window.JAXMAPS && window.JAXMAPS.papers).filter(p => p.doc_kind !== 'supplement' && p.doc_kind !== 'admin' &&
      (Array.isArray(p.map_domains) ? p.map_domains : [p.exposure_domain, p.outcome_domain]).some(d => domains.has(d))).sort((a, b) => Number(b.year) - Number(a.year));
    if (!papers.length) return '';
    const paperRows = list => list.map(p => {
      const url = paperUrl(p), title = esc(p.title || 'タイトル未登録');
      const topics = Array.isArray(p.map_domains) ? p.map_domains : [p.exposure_domain, p.outcome_domain];
      return `<article class="sv-related-paper">${url ? `<a class="sv-related-title" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : `<div class="sv-related-title">${title}</div>`}<p>${esc([p.first_author_full || p.first_author, p.year, p.journal].filter(Boolean).join(' · '))}</p><span>${esc(topics.map(domainLabel).filter(Boolean).join(' / '))}</span></article>`;
    }).join('');
    return `<section class="sv-detail-section"><h3>同じ概念を扱う論文 <span>${num(papers.length)} 本</span></h3>${paperRows(papers.slice(0, 10))}${papers.length > 10 ? `<details class="sv-related-more"><summary>残り ${num(papers.length - 10)} 本を表示</summary>${paperRows(papers.slice(10))}</details>` : ''}</section>`;
  }
  function renderDetail(originalQuestion) {
    currentQuestion = originalQuestion;
    if (originalQuestion.rights_restricted) { dialog.querySelector('[data-sv-dialog-content]').innerHTML = restrictedQuestionMarkup(originalQuestion, true); return; }
    const q = sourceView(originalQuestion, currentSource);
    const saved = favorites.has(String(q.id));
    dialog.querySelector('[data-sv-dialog-content]').innerHTML = `<div class="sv-dialog-heading"><div class="sv-question-meta"><span class="sv-study-pill${String(q.study).toUpperCase() === 'JASTIS' ? ' is-jastis' : ''}">${esc(q.study)}</span><span>${esc(q.year)}${q.substudy ? ' · ' + esc(substudyLabel(q.substudy)) : ''}</span><span class="sv-qnumber">${esc(questionNumber(q))}</span>${q.type ? `<span>${esc(q.type)}</span>` : ''}</div><h2 id="sv-dialog-title">${esc(questionHeading(q))}</h2><div class="sv-dialog-actions"><button class="sv-button${saved ? ' is-active' : ''}" type="button" data-sv-favorite="${esc(q.id)}" aria-pressed="${saved}">${saved ? '★ 保存済み' : '☆ この設問を保存'}</button><button class="sv-button" type="button" data-sv-copy-link>設問へのリンクをコピー</button><button class="sv-button" type="button" data-sv-current-json>この設問の JSON</button></div>${arr(q.variable_names).length ? `<div class="sv-variables"><span>変数名</span>${arr(q.variable_names).map(v => `<code>${esc(v)}</code>`).join('')}</div>` : ''}</div>${domainLinksMarkup(originalQuestion)}${sourceSelectorMarkup(originalQuestion)}${officialTextMarkup()}${variantsMarkup(originalQuestion)}${fullItemsMarkup(q)}${matchesMarkup(q)}${classificationMarkup(originalQuestion)}${papersMarkup(originalQuestion)}`;
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
    if (q.rights_restricted) { const names = restrictedScaleNames(q); return {id: q.id, wave_id: q.wave_id, study: q.study, year: q.year, substudy: q.substudy, number: q.number, display_number: q.display_number, original_question_number: q.original_question_number, number_basis: q.number_basis, rights_restricted: true, rights_scale_names: names, text: names.join(' / '), type: '', items: [], options: [], text_variants: [], sources: arr(q.sources).map(source => ({name: source.name, url: source.url, status: source.status, public_verified: source.public_verified})), scales: names.map(name => ({name})), domains: arr(q.domains), match_key: ''}; }
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
    const records = (single ? [single] : questions.filter(q => matches(q))).map(cleanQuestion);
    const now = new Date().toISOString().slice(0, 10);
    const basename = `JAxMAPs-questionnaire-${single ? single.id.replace(/[^a-zA-Z0-9_-]/g, '_') : 'filtered'}-${now}`;
    if (format === 'json') {
      const relevantWaves = new Set(records.map(q => q.wave_id));
      download(basename + '.json', JSON.stringify({meta: data.meta, exported_at: new Date().toISOString(), filters: {...state}, question_count: records.length, item_count: records.reduce((n, q) => n + itemCount(q), 0), waves: waves.filter(w => relevantWaves.has(w.id)), questions: records.map(cleanQuestion)}, null, 2), 'application/json;charset=utf-8');
    } else {
      const header = ['設問ID', '調査', '実施年', '対象・調査票', '表示用設問番号', '原資料の質問番号', '番号の根拠', '設問識別キー', '設問文', '回答形式', '項目コード', '項目文', '変数名', '選択肢', '設問共通の選択肢', '分類', '分類根拠', '尺度候補', '尺度の根拠・評価', '研究領域', '項目出典', '出典別元項目ID', '項目出典の状態', '設問群の全出典'];
      const rows = records.flatMap(q => (arr(q.items).length ? q.items : [{}]).map(i => [q.id, q.study, q.year, q.substudy, questionNumber(q), q.original_question_number || q.number, q.number_basis || 'original', q.number, isNumberOnlyStem(q) ? '' : q.text, q.type, i.code, i.text, [...arr(q.variable_names), ...arr(i.variable_names)].join(' | '), arr(i.options).map(optionText).join(' | '), arr(q.options).map(optionText).join(' | '), categories(q).map(categoryText).join(' | '), categories(q).map(c => [basisLabel(c), basisText(c)].filter(Boolean).join(': ')).join(' | '), scales(q).map(scaleText).join(' | '), scales(q).map(s => [s.grade, basisText(s)].filter(Boolean).join(': ')).join(' | '), arr(q.domains).map(domainLabel).join(' | '), arr(i.source_names || i.source_name).join(' | '), arr(i.source_item_ids).join(' | '), arr(i.source_statuses || i.status).map(status => statusLabel({status})).join(' | '), arr(q.sources).map(sourceText).join(' | ')]));
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
    questions.forEach(q => { q._search = makeSearch(q); q._match = q.rights_restricted || isNumberOnlyStem(q) ? '' : q.match_key || normalize(q.text); if (q._match) { if (!matchIndex.has(q._match)) matchIndex.set(q._match, []); matchIndex.get(q._match).push(q); } });
    waves.forEach(w => { const qs = questions.filter(q => q.wave_id === w.id); w.question_count = qs.length; w.item_count = qs.reduce((n, q) => n + itemCount(q), 0); });
    loadFavorites();
    const years = unique(questions.map(q => q.year)).sort((a, b) => Number(a) - Number(b));
    root.classList.add('sv-explorer');
    root.innerHTML = `<header class="sv-hero"><div><span class="sv-eyebrow">QUESTIONNAIRE ATLAS</span><h2>年をたどり、<br class="sv-mobile-break">質問を読み解く。</h2><p>JACSIS / JASTIS の設問文・下位項目・選択肢を、調査年とテーマから探せます。</p></div><div class="sv-hero-stats"><div><strong>${num(questions.length)}</strong><span>設問群</span></div><div><strong>${num(questions.reduce((n, q) => n + itemCount(q), 0))}</strong><span>下位項目を含む項目</span></div><div><strong>${num(waves.filter(w => w.question_count > 0).length)}</strong><span>設問を収載した調査票</span></div><div><strong>${years.length ? esc(years[0]) + '<small>–</small>' + esc(years[years.length - 1]) : '—'}</strong><span>収載されている実施年</span></div></div></header><div class="sv-content"><details class="sv-overview" open><summary><span><b>年度別の調査票</b><small>各タイルから、その年・対象の全設問へ</small></span></summary><div data-sv-matrix></div><p class="sv-matrix-note"><i class="sv-legend-dot"></i>JACSIS <i class="sv-legend-dot sv-legend-jastis"></i>JASTIS <span>設問群と、その中の項目数を表示しています。</span></p></details><section class="sv-search-panel" aria-label="調査票の検索と絞り込み"><div class="sv-search-row"><label class="sv-search-input"><span>設問を検索</span><input data-sv-query type="search" placeholder="例：孤独、K6、生成AI、変数名…" aria-label="設問文・項目・選択肢・変数名を検索"><small>空白で区切ると、すべての語を含む設問を検索</small></label><button class="sv-button sv-saved-button" data-sv-saved type="button" aria-pressed="false"><span aria-hidden="true">☆</span> 保存した設問 <b data-sv-saved-count>0</b></button></div><div class="sv-filter-grid"><label><span>調査</span><select data-sv-filter="study" aria-label="調査"></select></label><label><span>実施年</span><select data-sv-filter="year" aria-label="実施年"></select></label><label><span>対象・調査票</span><select data-sv-filter="substudy" aria-label="対象・調査票"></select></label><label><span>大分類</span><select data-sv-filter="category" aria-label="大分類"></select></label><label><span>小分類</span><select data-sv-filter="subcategory" aria-label="小分類"></select></label><label><span>尺度候補</span><select data-sv-filter="scale" aria-label="尺度候補"></select></label><label><span>研究領域</span><select data-sv-filter="domain" aria-label="研究領域"></select></label></div><div class="sv-filter-bottom"><div data-sv-active class="sv-active-filters"></div><button type="button" class="sv-text-button" data-sv-reset>条件をリセット</button></div></section><section class="sv-results-section"><header class="sv-results-header" data-sv-results-heading><div><h2 data-sv-count></h2><p data-sv-result-context></p></div><div class="sv-result-actions"><label>表示件数<select data-sv-size aria-label="1ページの表示件数"><option value="30">30 件</option><option value="60">60 件</option><option value="120">120 件</option><option value="all">すべて表示</option></select></label><button class="sv-button" type="button" data-sv-export="csv" title="ページにかかわらず、現在の条件に一致するすべての設問を出力">CSV 出力</button><button class="sv-button" type="button" data-sv-export="json" title="現在の条件に一致するすべての質問を出力">JSON 出力</button></div></header><div data-sv-results class="sv-results"></div><nav class="sv-pagination" data-sv-pagination aria-label="検索結果のページ"></nav><p class="sv-coverage-note">${data.meta && data.meta.scope === 'public' ? '公開調査票の収載範囲を表示しています。' : '収載している調査票の質問を表示しています。'}</p></section><div class="sv-status" data-sv-status role="status" aria-live="polite"></div></div><dialog class="sv-dialog" aria-labelledby="sv-dialog-title"><div class="sv-dialog-toolbar"><span>QUESTION DETAIL</span><button type="button" class="sv-button" data-sv-close aria-label="設問詳細を閉じる">閉じる <span aria-hidden="true">×</span></button></div><div data-sv-dialog-content></div></dialog>`;
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
    dialog.addEventListener('toggle', event => { const comparison = event.target; if (comparison.matches('[data-sv-source-text]') && comparison.open && !comparison.dataset.loaded) { const source = arr(window.JAXSURVEYSOURCES && window.JAXSURVEYSOURCES.sources).find(s => s.name === comparison.dataset.svSourceText); if (source && !source.rights_restricted && source.text) { const pre = document.createElement('pre'); pre.textContent = source.text; pre.tabIndex = 0; pre.setAttribute('aria-label', '調査票の全文'); comparison.querySelector('[data-sv-source-text-body]').append(pre); comparison.dataset.loaded = 'true'; } return; } if (!comparison.matches('[data-sv-compare]') || !comparison.open || comparison.dataset.loaded) return; const raw = byId.get(comparison.dataset.svCompare); if (!raw) return; const other = sourceView(raw); comparison.querySelector('.sv-comparison-body').innerHTML = `<p class="sv-comparison-stem">${esc(other.text)}</p>${fullItemsMarkup(other)}<button class="sv-button" type="button" data-sv-detail="${esc(other.id)}">この質問を開く</button>`; comparison.dataset.loaded = 'true'; }, true);
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
