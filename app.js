/* JAxMAPs ビューア
   構成は JP_Market_Vis（https://mattyamonaca.github.io/JP_Market_Vis/）に倣う。
   力学配置は外部ライブラリを使わず自前で計算する（42ノードなので総当たりで足りる。
   file:// でも動かしたいので CDN 依存を作らない）。

   守る約束:
   - 件数は論文数（paper_id の異なり）。資料数と混同しない。
   - 辺は question_type == association の主分類からのみ。タグの共起からは作らない。
   - 辺は「解析上の役割」であって因果ではない。円の大きさ・線の太さは論文数だけを表す。
   - 検索0件と「報告未発見」を区別する。
*/
const D = window.JAXMAPS;
const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
const paperById = Object.fromEntries(D.papers.map(p => [p.paper_id, p]));
const label = k => (D.domain_labels && D.domain_labels[k]) || k;
const paperUrl = p => p.doi ? "https://doi.org/" + p.doi : "";
function paperTitle(p,className="t") {
  const url=paperUrl(p), title=el(url?"a":"span",className,p.title);
  if(url){title.href=url;title.target="_blank";title.rel="noopener noreferrer";}
  return title;
}

/* 生成りの紙面で沈まないよう、彩度を落として明度差をつけた9色。 */
const GROUP_COLOR = {
  dependence_preference: "#a2521a", digital_information: "#2f6ca6", mental_psychological: "#6a4e96",
  relations_social: "#b13a6c", infection_prevention: "#1f7a64", healthcare_use: "#2d6b8f",
  lifestyle_physical: "#5d8a2f", family_sex: "#b3761e", work_socioeconomic: "#75594a",
};
const groupOf = {};
Object.entries(D.display_groups).forEach(([g, v]) => v.domains.forEach(d => (groupOf[d] = g)));
const colorOf = d => GROUP_COLOR[groupOf[d]] || "#8a8a90";
/* 尺度を領域ごとに表示する。 */
const SCALES_BY_DOMAIN = {};
(D.scales || []).forEach(s => { if (s.domain) (SCALES_BY_DOMAIN[s.domain] = SCALES_BY_DOMAIN[s.domain] || []).push(s); });
const hasScale = d => !!SCALES_BY_DOMAIN[d];
/* 調査票（JACSIS 2020/2021）の下位分類を領域ごとに引く */
const SURVEY_BY_DOMAIN = {};
(D.survey_crosswalk || []).forEach(r => { if (r.domain) (SURVEY_BY_DOMAIN[r.domain] = SURVEY_BY_DOMAIN[r.domain] || []).push(r); });

const state = { tab: "map", q: "", groups: new Set(), minPapers: 1, verified: false,
                sel: null, selEdge: null, listSel: null, study: "", wave: "" };

function searchText(value) {
  return String(value || "").normalize("NFKC").toLowerCase()
    .replace(/https?:\/\/(?:dx\.)?doi\.org\//g, "").replace(/\bdoi:\s*/g, "")
    .replace(/[,、]/g, " ");
}
function paperSearchText(p) {
  return searchText([p.title,p.first_author,p.first_author_full,...(p.authors||[]),
    p.journal,p.journal_abbreviation,...(p.journal_aliases||[]),p.doi,
    ...(p.search_aliases||[]),...(p.documents||[]),label(p.exposure_domain),
    label(p.outcome_domain),...(p.tags||[]).map(label)].join(" "));
}
function paperMatches(p) {
  if (p.doc_kind !== "paper") return false;
  if (state.verified && !p.waves_verified?.length) return false;
  if (state.study && p.study !== "both" && !(p.study || "").toUpperCase().includes(state.study)) return false;
  const waves = p.waves_verified?.length ? p.waves_verified : (p.waves_yes || []);
  if (state.wave && !waves.some(w => String(w).includes(state.wave))) return false;
  if (state.q) {
    const hay = paperSearchText(p);
    if (!searchText(state.q).split(/\s+/).filter(Boolean).every(t => hay.includes(t))) return false;
  }
  return true;
}
function filteredPapers() {
  return D.papers.filter(p => paperMatches(p) && (!state.groups.size || state.groups.has(groupOf[p.exposure_domain]) || state.groups.has(groupOf[p.outcome_domain]))).sort((a,b) => (b.year||0)-(a.year||0));
}
function searchResults(g = buildGraph()) {
  const papers = filteredPapers();
  const mapped = new Set(g.edges.flatMap(e => e.ids));
  return {papers, mappedCount: papers.filter(p => mapped.has(p.paper_id)).length};
}
function openPaperList() {
  state.tab = "list"; state.listSel = null; state.sel = state.selEdge = null;
  history.replaceState(null, "", "#list"); refresh(false);
  document.querySelector('#tabs button[data-tab="list"]')?.focus();
}
function renderSearchSummary(g) {
  let box = $("#paper-search-summary");
  if (!box) {
    const stage = $(".content-stage"); if (!stage) return;
    box = el("section", "academic-notice-banner"); box.id = "paper-search-summary";
    const text = el("p", "guide-text"); text.setAttribute("role", "status");
    const button = el("button", "btn-reset", "論文一覧で見る →");
    button.type = "button"; button.onclick = openPaperList;
    box.append(text, button); stage.prepend(box);
  }
  const active = !!state.q.trim() && ["map", "matrix"].includes(state.tab);
  box.style.display = active ? "" : "none";
  if (!active) return;
  const {papers, mappedCount} = searchResults(g);
  box.firstChild.textContent = `検索に一致 ${papers.length} 論文（マップ表示 ${mappedCount} 論文）`;
  box.lastChild.disabled = !papers.length;
}
function openSurvey(filters={}) {
  state.tab="survey"; refresh(false); window.JAxSurvey?.open(filters);
}
function openDomain(id) {
  if (!Object.hasOwn(D.domains,id)) return;
  document.querySelector("#reset").click();
  state.tab="map"; state.sel=id; state.selEdge=null;
  history.replaceState(null,"","#map?domain="+encodeURIComponent(id));
  refresh(true);
}
window.JAxMAPs = {openSurvey,openDomain, openPaper(id) {document.querySelector("#reset").click();state.tab="list";state.listSel=id;state.sel=state.selEdge=null;history.replaceState(null,"","#list");refresh(false);document.querySelector(".card.on")?.scrollIntoView({block:"center"});}};

/* ---------- グラフの組み立て ---------- */
function buildGraph() {
  const edges = [];
  Object.entries(D.pairs).forEach(([k, ids]) => {
    const [s, t] = k.split("|");
    const kept = [...new Set(ids)].filter(id => paperById[id] && paperMatches(paperById[id]));
    if (kept.length < state.minPapers) return;
    if (state.groups.size && !(state.groups.has(groupOf[s]) || state.groups.has(groupOf[t]))) return;
    edges.push({ s, t, ids: kept, n: kept.length });
  });
  const deg = {};
  edges.forEach(e => { [e.s,e.t].forEach(d => {deg[d] ||= new Set(); e.ids.forEach(id => deg[d].add(id));}); });
  const nodes = Object.keys(deg).map(id => ({ id, n: deg[id].size }));
  return { nodes, edges };
}

/* ---------- 力学配置（自前） ---------- */
const sim = { nodes: [], edges: [], byId: {}, tx: 0, ty: 0, k: 1, running: 0 };
function layout(g, keepPos) {
  const prev = keepPos ? Object.fromEntries(sim.nodes.map(n => [n.id, n])) : {};
  sim.nodes = g.nodes.map((n, i) => {
    const o = prev[n.id];
    const a = (i / g.nodes.length) * Math.PI * 2;
    return { ...n, x: o ? o.x : Math.cos(a) * 180, y: o ? o.y : Math.sin(a) * 180, vx: 0, vy: 0, fixed: false };
  });
  sim.byId = Object.fromEntries(sim.nodes.map(n => [n.id, n]));
  sim.edges = g.edges.map(e => ({ ...e, a: sim.byId[e.s], b: sim.byId[e.t] }));
  sim.running = 220;
}
function step() {
  const N = sim.nodes;
  for (let i = 0; i < N.length; i++) {
    const a = N[i];
    for (let j = i + 1; j < N.length; j++) {
      const b = N[j];
      let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy || 0.01;
      const f = 9000 / d2, d = Math.sqrt(d2);
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
    }
    a.vx -= a.x * 0.006; a.vy -= a.y * 0.006;   // 中心へ引き戻す
  }
  sim.edges.forEach(e => {
    if (e.a === e.b) return;                      // 自己ループは力を出さない
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
    const d = Math.hypot(dx, dy) || 0.01;
    const target = 165 + 70 / Math.sqrt(e.n);
    const f = (d - target) * 0.012 * Math.min(3, Math.log2(e.n + 1) + 1);
    const fx = (dx / d) * f, fy = (dy / d) * f;
    e.a.vx += fx; e.a.vy += fy; e.b.vx -= fx; e.b.vy -= fy;
  });
  N.forEach(n => { if (n.fixed) { n.vx = n.vy = 0; return; } n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx; n.y += n.vy; });
}

/* ---------- 描画 ---------- */
let cv, ctx, dpr = window.devicePixelRatio || 1;
function fit() {
  if (!sim.nodes.length) return;
  const xs = sim.nodes.map(n => n.x), ys = sim.nodes.map(n => n.y);
  const w = cv.clientWidth, h = cv.clientHeight;
  const bw = Math.max(1, Math.max(...xs) - Math.min(...xs)), bh = Math.max(1, Math.max(...ys) - Math.min(...ys));
  sim.k = Math.min(w / (bw + 190), h / (bh + 190), 2.2);
  sim.tx = w / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * sim.k;
  sim.ty = h / 2 - ((Math.max(...ys) + Math.min(...ys)) / 2) * sim.k;
}
const rad = n => 5 + Math.sqrt(n.n) * 2.6;
function draw() {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = w * dpr; cv.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.save(); ctx.translate(sim.tx, sim.ty); ctx.scale(sim.k, sim.k);
  sim.edges.forEach(e => {
    const on = state.sel && (e.s === state.sel || e.t === state.sel);
    const dim = state.sel && !on;
    ctx.globalAlpha = dim ? 0.07 : 0.45;
    ctx.strokeStyle = colorOf(e.s);
    ctx.lineWidth = Math.min(7, 0.7 + Math.log2(e.n + 1) * 1.5);
    ctx.beginPath();
    if (e.a === e.b) { ctx.arc(e.a.x + 14, e.a.y - 14, 13, 0, Math.PI * 2); }
    else { ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); }
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  const sorted = [...sim.nodes].sort((a, b) => a.n - b.n);
  sorted.forEach(n => {
    const dim = state.sel && n.id !== state.sel && !sim.edges.some(e => (e.s === state.sel && e.t === n.id) || (e.t === state.sel && e.s === n.id));
    ctx.globalAlpha = dim ? 0.15 : 1;
    ctx.beginPath(); ctx.arc(n.x, n.y, rad(n), 0, Math.PI * 2);
    ctx.fillStyle = colorOf(n.id); ctx.fill();
    ctx.lineWidth = n.id === state.sel ? 2.5 : 1;
    ctx.strokeStyle = n.id === state.sel ? "#14171c" : "#e9e7df"; ctx.stroke();
    if (hasScale(n.id)) {           // 検証済み尺度で測られている概念
      ctx.beginPath(); ctx.arc(n.x, n.y, rad(n) + 3.2, 0, Math.PI * 2);
      ctx.lineWidth = 1.2; ctx.strokeStyle = "#14171c"; ctx.globalAlpha = dim ? 0.12 : 0.55; ctx.stroke();
      ctx.globalAlpha = dim ? 0.15 : 1;
    }
  });
  const top = [...sim.nodes].sort((a, b) => b.n - a.n);
  ctx.globalAlpha = 1;
  const fs = Math.max(10, Math.min(13, 12 / sim.k));
  ctx.font = `${fs}px -apple-system,"Hiragino Sans",sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const placed = [];   // 画面座標での占有矩形。重なるラベルは描かない
  const overlap = (r) => placed.some(q => !(r.x2 < q.x1 || r.x1 > q.x2 || r.y2 < q.y1 || r.y1 > q.y2));
  top.forEach(n => {
    const dim = state.sel && n.id !== state.sel && !sim.edges.some(e => (e.s === state.sel && e.t === n.id) || (e.t === state.sel && e.s === n.id));
    if (dim) return;
    const txt = label(n.id);
    const wpx = ctx.measureText(txt).width;
    const sx = n.x * sim.k + sim.tx, sy = (n.y - rad(n)) * sim.k + sim.ty - 9;
    const half = (wpx * 1) / 2 + 3;
    const box = { x1: sx - half, x2: sx + half, y1: sy - 9, y2: sy + 9 };
    if (overlap(box)) return;
    placed.push(box);
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${fs}px -apple-system,"Hiragino Sans",sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(233,231,223,.92)";
    ctx.fillRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1);
    ctx.fillStyle = "#14171c"; ctx.fillText(txt, sx, sy);
    ctx.restore();
  });
  ctx.restore();
}
function tick() {
  if (state.tab === "map" && sim.running > 0) { step(); sim.running--; if (sim.running % 12 === 0) fit(); }
  if (state.tab === "map") draw(); requestAnimationFrame(tick);
}
const toWorld = (mx, my) => ({ x: (mx - sim.tx) / sim.k, y: (my - sim.ty) / sim.k });
function hit(mx, my) {
  const p = toWorld(mx, my);
  return sim.nodes.find(n => Math.hypot(n.x - p.x, n.y - p.y) <= rad(n) + 4);
}

/* ---------- 画面 ---------- */
function renderStats() {
  const g = buildGraph();
  const shown = new Set(); g.edges.forEach(e => e.ids.forEach(i => shown.add(i)));
  $("#stats").innerHTML = "";
  [["表示中の概念", g.nodes.length, `全${Object.keys(D.domains).length}領域`],
   ["関連を扱う論文", shown.size, `全${D.meta.n_papers}論文`],
   ["質問項目", window.JAXSURVEY?.meta?.item_count || (window.JAXSURVEY?.questions||[]).reduce((n,q)=>n+q.items.length,0), "年度別に閲覧"]]
    .forEach(([k, v, sub]) => {
      const d = el("div", "stat"); d.append(el("b", null, Number(v).toLocaleString("ja-JP")), el("span", null, k), el("small", null, sub));
      $("#stats").append(d);
    });
  return g;
}
function renderGroups() {
  const g = $("#groups"); g.innerHTML = "";
  Object.entries(D.display_groups).forEach(([k, v]) => {
    const n = D.papers.filter(p => paperMatches(p) && (v.domains.includes(p.exposure_domain) || v.domains.includes(p.outcome_domain))).length;
    const b = el("button", "chip" + (state.groups.has(k) ? " on" : ""));
    b.style.setProperty("--c", GROUP_COLOR[k]);
    b.append(el("span", "nm", v.label), el("span", "ct", String(n)));
    b.onclick = () => { state.groups.has(k) ? state.groups.delete(k) : state.groups.add(k); refresh(true); };
    g.append(b);
  });
}
function renderDetail() {
  const d = $("#detail"); d.innerHTML = "";
  if (state.selEdge) {
    const e = state.selEdge;
    d.append(el("h3", null, `${label(e.s)} → ${label(e.t)}`));
    d.append(el("p", "muted small", `${e.ids.length} 論文`));
    e.ids.forEach(id => {
      const p = paperById[id]; const c = el("div", "mini");
      c.append(paperTitle(p));
      c.append(el("div", "m", [p.first_author_full || p.first_author, p.journal, p.year].filter(Boolean).join(" · ")));
      const info=el("button","paper-details","調査情報を見る");
      info.onclick=()=>{state.listSel=id;state.sel=state.selEdge=null;renderDetail();};
      c.append(info);
      d.append(c);
    });
    return;
  }
  if (state.sel) {
    const nd = sim.byId[state.sel];
    d.append(el("h3", null, label(state.sel)));
    d.append(el("p", "muted small", D.domains[state.sel] || ""));
    d.append(el("p", null, `この概念に触れる関連の問い: ${nd ? nd.n : 0} 論文`));
    const qb=el("button","survey-jump","この概念の質問を年度別に見る →"); qb.onclick=()=>openSurvey({domain:state.sel});d.append(qb);
    const sc = SCALES_BY_DOMAIN[state.sel] || [];
    if (sc.length) {
      d.append(el("h4", "sub-h", "関連する尺度"));
      sc.forEach(s => {
        const c = el("div", "mini");
        c.append(el("div", "t", s.scale + (s.aliases && s.aliases.length ? `（別表記: ${s.aliases.join("、")}）` : "")));
        c.append(el("div", "m", `調査年 ${s.years.join("・")} · 質問を見る →`));
        c.onclick=()=>openSurvey({scale:s.scale});
        d.append(c);
      });
      d.append(el("h4", "sub-h", "この概念が現れる関連"));
    }
    const sv = SURVEY_BY_DOMAIN[state.sel] || [];
    if (sv.length) {
      d.append(el("h4", "sub-h", "調査票での位置づけ（JACSIS 2020／2021）"));
      sv.sort((x, y) => y.n_survey_items - x.n_survey_items).slice(0, 6).forEach(r => {
        const c = el("div", "mini");
        c.append(el("div", "t", r.subcategory));
        c.append(el("div", "m", `${r.main_category}／${r.n_survey_items}項目`));
        d.append(c);
      });
      d.append(el("p", "muted small", D.survey_coverage_note));
    }
    const es = sim.edges.filter(e => e.s === state.sel || e.t === state.sel).sort((a, b) => b.n - a.n);
    es.forEach(e => {
      const c = el("div", "mini");
      c.append(el("div", "t", `${label(e.s)} → ${label(e.t)}`), el("div", "m", `${e.n} 論文`));
      c.tabIndex=0;c.setAttribute("role","button");c.onkeydown=ev=>{if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();c.click();}};
      c.onclick = () => { state.selEdge = e; renderDetail(); };
      d.append(c);
    });
    return;
  }
  const p = state.listSel && paperById[state.listSel];
  if (!p) { d.append(el("p", "muted", "円か線を選ぶと、ここに内訳が出ます。")); return; }
  const heading=el("h3");heading.append(paperTitle(p,"paper-title"));d.append(heading);
  d.append(el("div", "m", [p.first_author_full || p.first_author, p.journal, p.year].filter(Boolean).join(" · ")));
  if (p.doi) { const a = el("a", "doi", "論文を開く ↗"); a.href = paperUrl(p); a.target = "_blank"; a.rel="noopener noreferrer"; d.append(a); }
  const box = el("div", "kvs");
  const kv = (k, v) => { const r = el("div", "kv"); r.append(el("span", "k", k), el("span", "v", String(v))); box.append(r); };
  kv("問いの型", D.question_types[p.question_type] || p.question_type);
  kv("主曝露", D.domains[p.exposure_domain] || D.role_unresolved[p.exposure_domain] || p.exposure_domain);
  kv("主アウトカム", D.domains[p.outcome_domain] || D.role_unresolved[p.outcome_domain] || p.outcome_domain);
  kv("対象集団", D.populations[p.population] || p.population);
  kv("デザイン", D.designs[p.design] || p.design);
  kv("調査", p.study);
  kv("調査年", (p.waves_verified?.length?p.waves_verified:p.waves_yes).map(y=>y+"年").join("、") || "未確認");
  kv("効果推定値の報告", p.has_effect_estimate);
  d.append(box);
  const wb=el("button","survey-jump","関連する調査年の質問を探す →");
  wb.onclick=()=>{const waves=p.waves_verified?.length?p.waves_verified:p.waves_yes;const year=String(waves?.[0]||"").match(/20\d{2}/)?.[0];openSurvey({year:year||"",study:["JACSIS","JASTIS"].includes(p.study?.toUpperCase())?p.study.toUpperCase():""});};d.append(wb);
  d.append(el("p", "muted small", "結果（推定値・信頼区間）は第一版では未収載です。数値は自動生成せず、原著で確認してください。"));
}
function renderList() {
  const box = $("#listpane"); box.innerHTML = "";
  const rows = filteredPapers();
  $("#listcount").textContent = `${rows.length} 論文`;
  if (!rows.length) {
    const e = el("div", "empty");
    e.append(el("p", "big", "現在の検索条件に一致する登録がありません"));
    e.append(el("p", "muted small", "これは「この組合せの研究が存在しない」という意味ではありません。収載範囲と確認状態を確かめてください。"));
    box.append(e); return;
  }
  rows.forEach(p => {
    const c = el("article", "card" + (state.listSel === p.paper_id ? " on" : ""));
    const t = paperTitle(p);
    if (p.title_is_filename) t.append(el("span", "warn", "書誌未整備"));
    c.append(t, el("div", "m", [p.first_author_full || p.first_author, p.journal, p.year].filter(Boolean).join(" · ")));
    const pr = el("div", "pair");
    pr.append(el("span", "dom", label(p.exposure_domain)), el("span", "arrow", "→"), el("span", "dom", label(p.outcome_domain)));
    pr.querySelectorAll(".dom")[0].style.background = colorOf(p.exposure_domain) + "22";
    pr.querySelectorAll(".dom")[1].style.background = colorOf(p.outcome_domain) + "22";
    c.append(pr);
    const m2 = el("div", "m2");
    m2.append(el("span", "tag", (D.question_types[p.question_type] || "").split("（")[0] || p.question_type));
    m2.append(el("span", "tag", p.study));
    const years=p.waves_verified?.length?p.waves_verified:p.waves_yes;
    if (years.length) m2.append(el("span", "tag", "調査年 " + years.map(y=>y+"年").join("・")));
    m2.append(el("span", "badge " + (p.waves_verified ? "ok" : "machine"), p.waves_verified ? "調査年確認済み" : "調査年未確認"));
    c.append(m2);
    const info=el("button","paper-details","調査情報を見る");
    info.onclick = () => { state.listSel = p.paper_id; state.sel = null; state.selEdge = null; refresh(); };
    c.append(info);
    box.append(c);
  });
}
function renderData() {
  const box = $("#datapane"); box.innerHTML = "";
  const sec = (t) => { const h = el("h3", null, t); box.append(h); };
  sec("収載と確認の状態");
  const t1 = el("div", "kvs");
  const kv = (p, k, v) => { const r = el("div", "kv"); r.append(el("span", "k", k), el("span", "v", String(v))); p.append(r); };
  kv(t1, "論文（paper_id の異なり）", D.meta.n_papers);
  kv(t1, "資料（PDF）", D.meta.n_documents);
  kv(t1, "DOIで同定できた論文", D.meta.n_papers_by_doi);
  kv(t1, "同定が暫定の論文", D.meta.n_papers_provisional);
  kv(t1, "調査年を本文確認した論文", D.meta.n_wave_verified);
  kv(t1, "関連の辺に数えた問いの型", D.meta.counted_question_type);
  box.append(t1);
  sec("関連に数えなかった論文");
  box.append(el("p", "muted small", "除外ではありません。関連の証拠として数えない、という意味です。"));
  const t2 = el("div", "kvs");
  Object.entries(D.pairs_excluded).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => kv(t2, k, v + " 論文"));
  box.append(t2);
  sec("尺度一覧");
  const st = el("div", "kvs");
  (D.scales || []).forEach(s => kv(st, s.scale.slice(0, 30),
    `${s.years.join("・")}年｜${s.domain ? (D.domain_labels[s.domain] || s.domain) : "その他"}`));
  box.append(st);
  sec("調査票にあり、この索引で主分類の登録がない内容");
  box.append(el("p", "muted small", D.survey_crosswalk_note));
  const un = (D.survey_crosswalk || []).filter(r => r.n_papers_as_main === 0)
    .sort((a, b) => b.n_survey_items - a.n_survey_items);
  const ut = el("div", "kvs");
  un.forEach(r => kv(ut, `${r.n_survey_items}項目`, `[${r.main_category}] ${r.subcategory}`));
  box.append(ut);
  sec("2020／2021の調査票に対応分類が無い領域");
  box.append(el("p", "muted small", "この表は JACSIS 2020・2021 しか扱っていない。対応が無いことは、後年の調査や JASTIS で追加された項目であることを意味する場合が多い。下の件数は、この索引に登録された主曝露・主アウトカムの論文数です。"));
  const dt = el("div", "kvs");
  (D.domains_not_in_2020_2021_survey || []).forEach(x => kv(dt, x.label, `主問いにした論文 ${x.n_papers_as_main} 本`));
  box.append(dt);
  sec("空白の読み方");
  box.append(el("p", "small", D.meta.empty_cell_label));
}
function refresh(relayout) {
  const g = renderStats(); renderGroups(); renderSearchSummary(g);
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === state.tab));
  document.body.classList.toggle("survey-mode",state.tab==="survey");
  document.querySelector(".control-console").hidden=state.tab==="survey";
  ["map", "matrix", "survey", "list", "data"].forEach(t => $("#pane-" + t).style.display = state.tab === t ? "" : "none");
  if (state.tab === "map") { if (relayout !== false) layout(g, true); }
  if (state.tab === "list") renderList();
  if (state.tab === "data") renderData();
  if (state.tab === "matrix") renderMatrix();
  if (state.tab === "survey") window.JAxSurvey?.mount();
  if (state.selEdge) {const edge=g.edges.find(e=>e.s===state.selEdge.s&&e.t===state.selEdge.t);state.selEdge=edge||null;}
  if (state.sel && !Object.hasOwn(D.domains,state.sel)) state.sel=null;
  renderDetail();
}

window.addEventListener("DOMContentLoaded", () => {
  cv = $("#cv"); ctx = cv.getContext("2d");
  const years=[...new Set(D.papers.flatMap(p=>(p.waves_verified?.length?p.waves_verified:p.waves_yes||[])).flatMap(w=>String(w).match(/20\d{2}/g)||[]))].sort();
  years.forEach(y=>{const o=el("option",null,y);o.value=y;$("#paper-wave").append(o);});
  $("#paper-study").onchange=e=>{state.study=e.target.value;refresh(true);};
  $("#paper-wave").onchange=e=>{state.wave=e.target.value;refresh(true);};
  $("#export-svg").onclick=exportMapSVG;
  $("#export-papers").onclick=exportPapers;
  const readViewHash=()=>{const [t,params=""]=location.hash.slice(1).split("?");if(["map","matrix","survey","list","data"].includes(t)){state.tab=t;const id=new URLSearchParams(params).get("domain");if(t==="map"&&id&&Object.hasOwn(D.domains,id)){state.sel=id;state.selEdge=null;}}};
  window.addEventListener("hashchange",()=>{readViewHash();refresh(state.tab==="map");});
  readViewHash();
  $("#q").placeholder = "タイトル・著者名・誌名／略称・DOI・領域";
  $("#q").oninput = e => { state.q = e.target.value; refresh(true); };
  $("#minp").oninput = e => { state.minPapers = +e.target.value; $("#minplabel").textContent = e.target.value; refresh(true); };
  $("#verified").onchange = e => { state.verified = e.target.checked; refresh(true); };
  $("#reset").onclick = () => { state.q = ""; $("#q").value = ""; state.groups.clear(); state.minPapers = 1; $("#minp").value = 1; $("#minplabel").textContent = "1"; state.verified = false; $("#verified").checked = false; state.study=state.wave="";$("#paper-study").value=$("#paper-wave").value="";state.listSel=null;state.sel = state.selEdge = null; refresh(true); };
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => { state.tab = b.dataset.tab; if(state.tab!=="survey")history.replaceState(null,"","#"+state.tab);refresh(state.tab === "map"); });
  $("#zin").onclick = () => { sim.k *= 1.25; };
  $("#zout").onclick = () => { sim.k /= 1.25; };
  $("#zfit").onclick = () => { fit(); };
  let drag = null, pan = null;
  cv.addEventListener("mousedown", ev => {
    const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const n = hit(mx, my);
    if (n) { drag = n; n.fixed = true; } else pan = { x: ev.clientX, y: ev.clientY, tx: sim.tx, ty: sim.ty };
  });
  window.addEventListener("mousemove", ev => {
    if (drag) { const r = cv.getBoundingClientRect(); const p = toWorld(ev.clientX - r.left, ev.clientY - r.top); drag.x = p.x; drag.y = p.y; sim.running = Math.max(sim.running, 40); }
    else if (pan) { sim.tx = pan.tx + (ev.clientX - pan.x); sim.ty = pan.ty + (ev.clientY - pan.y); }
  });
  window.addEventListener("mouseup", () => { if (drag) drag.fixed = false; drag = null; pan = null; });
  cv.addEventListener("click", ev => {
    const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const n = hit(mx, my);
    if (n) { state.sel = state.sel === n.id ? null : n.id; state.selEdge = null; }
    else {
      const p = toWorld(mx, my);
      let best = null, bd = 7 / sim.k;
      sim.edges.forEach(e => {
        if (e.a === e.b) return;
        const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, L2 = dx * dx + dy * dy;
        let t = ((p.x - e.a.x) * dx + (p.y - e.a.y) * dy) / L2; t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(p.x - (e.a.x + t * dx), p.y - (e.a.y + t * dy));
        if (d < bd) { bd = d; best = e; }
      });
      if (best) { state.selEdge = best; state.sel = null; } else { state.sel = null; state.selEdge = null; }
    }
    renderDetail(); draw();
  });
  cv.addEventListener("wheel", ev => {
    ev.preventDefault();
    const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const before = toWorld(mx, my);
    sim.k *= ev.deltaY < 0 ? 1.1 : 1 / 1.1;
    sim.k = Math.max(0.2, Math.min(5, sim.k));
    const after = toWorld(mx, my);
    sim.tx += (after.x - before.x) * sim.k; sim.ty += (after.y - before.y) * sim.k;
  }, { passive: false });
  $("#foot").textContent = `JACSIS / JASTIS ｜ ${D.meta.n_papers}論文 ｜ 関連の線は因果関係を示しません。`;
  const g = renderStats(); layout(g, false); refresh(false); tick();
});


function downloadFile(name,text,type) {
  const url=URL.createObjectURL(new Blob([text],{type}));
  const a=el("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function csvCell(v) {const s=String(v??"");return '"'+(/^[=+@-]/.test(s)?"'":"")+s.replace(/"/g,'""')+'"';}
function exportPapers() {
  const rows=[["タイトル","著者","誌名","出版年","調査","調査年","主曝露","主アウトカム","確認状態","DOI"],...filteredPapers().map(p=>[p.title,p.first_author_full || p.first_author,p.journal,p.year,p.study,(p.waves_verified?.length?p.waves_verified:p.waves_yes||[]).join(" / "),label(p.exposure_domain),label(p.outcome_domain),p.verification,p.doi])];
  downloadFile("JAxMAPs-papers.csv","\uFEFF"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n"),"text/csv;charset=utf-8");
}
function renderMatrix() {
  const box=$("#matrixpane");box.replaceChildren();const g=buildGraph();
  box.append(el("h2",null,"曝露 × アウトカム"),el("p","panel-desc","各セルは、選択中の条件に合う論文数です。行が主曝露、列が主アウトカム。セルで論文を、概念名でマップと質問への入口を開きます。"));
  box.append(el("p","muted small","空欄は主分類の登録なし／詳細未確認です。研究の不存在や因果関係を示すものではありません。"));
  if(!g.nodes.length){box.append(el("div","empty","この条件に合う関連の登録がありません。条件を解除して確認してください。"));return;}
  const domains=g.nodes.sort((a,b)=>b.n-a.n).map(n=>n.id);const edges=Object.fromEntries(g.edges.map(e=>[e.s+"|"+e.t,e]));
  const scroll=el("div","matrix-scroll");const table=el("table","relation-matrix");table.setAttribute("aria-label","主曝露と主アウトカム別の論文数");
  const thead=el("thead");const hr=el("tr");const corner=el("th",null,"曝露 ↓ / アウトカム →");hr.append(corner);
  domains.forEach(d=>{const th=el("th");const btn=el("button","matrix-domain",label(d));btn.onclick=()=>openDomain(d);th.append(btn);th.scope="col";th.style.borderTopColor=colorOf(d);hr.append(th);});thead.append(hr);table.append(thead);
  const tbody=el("tbody");domains.forEach(a=>{const tr=el("tr");const th=el("th",null,label(a));th.scope="row";tr.append(th);domains.forEach(b=>{const td=el("td");const e=edges[a+"|"+b];if(e){const btn=el("button",null,String(e.n));btn.style.background=`rgba(29,70,108,${Math.min(.85,.16+Math.log2(e.n+1)*.13)})`;btn.style.color=e.n>3?"white":"#17344d";btn.setAttribute("aria-label",`${label(a)}から${label(b)}、${e.n}論文`);btn.onclick=()=>{state.sel=null;state.selEdge=e;renderDetail();};td.append(btn);}else{td.textContent="·";td.title="主分類の登録なし／詳細未確認";}tr.append(td);});tbody.append(tr);});table.append(tbody);scroll.append(table);box.append(scroll);
}
function exportMapSVG() {
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
  if(!sim.nodes.length)return;
  const minX=Math.min(...sim.nodes.map(n=>n.x))-140,maxX=Math.max(...sim.nodes.map(n=>n.x))+140;
  const minY=Math.min(...sim.nodes.map(n=>n.y))-100,maxY=Math.max(...sim.nodes.map(n=>n.y))+100;
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY-60} ${maxX-minX} ${maxY-minY+100}" width="1800" role="img"><title>JAxMAPs 概念の関連マップ</title><rect x="${minX}" y="${minY-60}" width="${maxX-minX}" height="${maxY-minY+100}" fill="#f8f7f4"/><g font-family="sans-serif">`;
  svg+=`<text x="${minX+20}" y="${minY-25}" font-size="22" font-weight="700">JAxMAPs | JACSIS / JASTIS</text>`;
  sim.edges.forEach(e=>{const attr=`fill="none" stroke="${colorOf(e.s)}" stroke-opacity=".35" stroke-width="${Math.min(7,.7+Math.log2(e.n+1)*1.5)}"`;svg+=e.s===e.t?`<circle cx="${e.a.x+14}" cy="${e.a.y-14}" r="13" ${attr}/>`:`<line x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}" ${attr}/>`;});
  sim.nodes.forEach(n=>{svg+=`<circle cx="${n.x}" cy="${n.y}" r="${rad(n)}" fill="${colorOf(n.id)}"/><text x="${n.x}" y="${n.y-rad(n)-9}" text-anchor="middle" font-size="13" paint-order="stroke" stroke="#f8f7f4" stroke-width="4" stroke-linejoin="round" fill="#14171c">${esc(label(n.id))} (${n.n})</text>`;});
  svg+=`<text x="${minX+20}" y="${maxY+10}" font-size="11">円・線は論文数。線は解析上の役割を示し、因果を意味しません。調査 ${esc(state.study||"すべて")} / 年 ${esc(state.wave||"すべて")}</text></g></svg>`;
  downloadFile("JAxMAPs-map.svg",svg,"image/svg+xml;charset=utf-8");
}
