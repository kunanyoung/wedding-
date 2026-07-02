/* ============================================================
   WediBoard 앱 로직
   구성: 1)유틸/상태 2)저장 3)라우팅 4)상담 대시보드 5)고객 관리
        6)마케팅 성과 7)콘텐츠 8)캘린더 9)알림 10)데이터(엑셀)
        11)ROI 12)부팅
============================================================ */
(function () {
  "use strict";

  /* ---------- 1) 유틸 & 상태 ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => "id_" + Math.random().toString(36).slice(2, 9) + performance.now().toString(36).replace(".", "");
  const won = (n) => (Number(n) || 0).toLocaleString("ko-KR") + "원";
  const num = (n) => (Number(n) || 0).toLocaleString("ko-KR");

  // 진행 상태(9단계) 정의 — 색상은 요구사항 기준
  const STATUS = {
    new:        { ko: "신규 문의",      color: "#3b82f6" }, // 파랑
    booked:     { ko: "상담 예약",      color: "#38bdf8" }, // 하늘
    consulting: { ko: "상담 진행중",    color: "#eab308" }, // 노랑
    quoted:     { ko: "견적 발송",      color: "#f97316" }, // 주황
    reviewing:  { ko: "계약 검토중",    color: "#8b5cf6" }, // 보라
    contracted: { ko: "계약 완료",      color: "#22c55e" }, // 초록
    failed:     { ko: "계약 체결 안됨", color: "#ef4444" }, // 빨강
    canceled:   { ko: "상담 취소",      color: "#9ca3af" }, // 회색
    done:       { ko: "예식 완료",      color: "#15803d" }, // 진초록
  };
  const STATUS_KEYS = Object.keys(STATUS);
  const STATUS_KO = Object.fromEntries(STATUS_KEYS.map((k) => [k, STATUS[k].ko]));
  const STATUS_COLOR = Object.fromEntries(STATUS_KEYS.map((k) => [k, STATUS[k].color]));
  const STATUS_FROM_KO = Object.fromEntries(STATUS_KEYS.map((k) => [STATUS[k].ko, k]));
  // 레거시(구버전) 상태 매핑
  const LEGACY_STATUS = { pending: "new", "미정": "new", "체결": "contracted", "미체결": "failed" };
  const SUCCESS = new Set(["contracted", "done"]);   // 체결로 집계
  const normStatus = (s) => STATUS[s] ? s : (LEGACY_STATUS[s] || "new");
  const isContracted = (r) => SUCCESS.has(normStatus(r.status));
  const isFailed = (r) => normStatus(r.status) === "failed";
  const statusBadge = (s) => {
    const k = normStatus(s);
    return `<span class="status-badge" style="background:${STATUS_COLOR[k]}">${STATUS_KO[k]}</span>`;
  };

  const STORE_KEY = "wediboard_state_v1";

  // 앱 전역 데이터
  const state = {
    metrics: [],        // {id, channel, impressions, clicks, conversions, budget}
    reservations: [],   // {id, date, time, name, phone, phone2, email, source, kind,
                        //  memo, manager, status, failReason, next, wedding, venue,
                        //  region, guests, budget, amount}
    contents: [],       // {id, hall, title, savedAt}
    notifyLogs: [],     // {id, target, type, at}
  };

  function toast(msg) {
    const el = $("#global-toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.hidden = true), 2200);
  }

  /* ---------- 2) 저장 ---------- */
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    updateCacheInfo();
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) Object.assign(state, JSON.parse(raw));
      // 상태 값 정규화(레거시 호환)
      state.reservations.forEach((r) => { r.status = normStatus(r.status); });
    } catch (e) { console.warn("load 실패", e); }
  }
  function updateCacheInfo() {
    const el = $("#cache-info");
    if (!el) return;
    el.textContent = `고객 ${state.reservations.length}명 · 성과 ${state.metrics.length}행 · 콘텐츠 ${state.contents.length}개 · 알림 ${state.notifyLogs.length}건`;
  }

  /* ---------- 3) 라우팅 ---------- */
  function switchView(viewId) {
    $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === viewId));
    $$(".nav-item").forEach((n) => n.classList.toggle("is-active", n.dataset.view === viewId));
    closeNav();
    if (viewId === "view-notify") renderNotifyOptions();
    if (viewId === "view-roi") renderRoi();
    if (viewId === "view-dashboard") renderDashboardChart();
    if (viewId === "view-contract") renderContract();
    if (viewId === "view-customers") renderCustomers();
  }
  function openNav() { $("#app-nav").classList.add("is-open"); $("#nav-backdrop").hidden = false; }
  function closeNav() { $("#app-nav").classList.remove("is-open"); $("#nav-backdrop").hidden = true; }

  /* ---------- 날짜 헬퍼 ---------- */
  function nowDate() { return new Date(); }
  function ymd(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function startOfWeek(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function parseYmd(s) { const d = new Date((s || "") + "T00:00"); return isNaN(d) ? null : d; }

  /* ---------- 4) 상담 대시보드 (계약 성과·매출) ---------- */
  let contractChart = null, contractTrendChart = null, revenueTrendChart = null, sourceChart = null;
  let contractUnit = "month";   // "month" | "week" | "all"
  let contractRef = null;

  function contractRate(c, f) {
    const decided = c + f;
    return decided ? Math.round((c / decided) * 100) : 0;
  }

  function contractPeriod() {
    const ref = contractRef || nowDate();
    if (contractUnit === "week") {
      const ws = startOfWeek(ref), we = addDays(ws, 6);
      const list = state.reservations.filter((r) => { const d = parseYmd(r.date); return d && d >= ws && d <= we; });
      return { list, label: `${ymd(ws)} ~ ${ymd(we).slice(5)}` };
    }
    if (contractUnit === "month") {
      const mk = ymd(ref).slice(0, 7);
      const list = state.reservations.filter((r) => (r.date || "").startsWith(mk));
      return { list, label: `${mk.slice(0, 4)}년 ${Number(mk.slice(5))}월` };
    }
    return { list: state.reservations, label: "전체 기간" };
  }

  // 오늘 현황
  function renderTodayStatus() {
    const today = ymd(nowDate());
    const mk = today.slice(0, 7);
    const consultToday = state.reservations.filter((r) => r.date === today).length;
    const waiting = state.reservations.filter((r) => ["quoted", "reviewing"].includes(normStatus(r.status))).length;
    const openStatuses = new Set(["new", "booked", "consulting", "quoted", "reviewing"]);
    const contactToday = state.reservations.filter((r) => r.next === today && openStatuses.has(normStatus(r.status))).length;
    const monthContract = state.reservations.filter((r) => (r.date || "").startsWith(mk) && isContracted(r)).length;
    $("#kpi-today-consult").textContent = num(consultToday);
    $("#kpi-waiting").textContent = num(waiting);
    $("#kpi-today-contact").textContent = num(contactToday);
    $("#kpi-month-contract").textContent = num(monthContract);
  }

  // 기간별 체결 건수 추이
  function renderContractTrend() {
    if (typeof Chart === "undefined") return;
    const ctx = $("#contract-trend-canvas");
    if (!ctx) return;
    const unit = contractUnit === "week" ? "week" : "month";
    const ref = contractRef || nowDate();
    const N = 6;
    const labels = [], values = [];
    for (let i = N - 1; i >= 0; i--) {
      if (unit === "month") {
        const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
        const mk = ymd(d).slice(0, 7);
        labels.push(`${Number(mk.slice(5))}월`);
        values.push(state.reservations.filter((r) => (r.date || "").startsWith(mk) && isContracted(r)).length);
      } else {
        const ws = addDays(startOfWeek(ref), -7 * i), we = addDays(ws, 6);
        labels.push(ymd(ws).slice(5));
        values.push(state.reservations.filter((r) => { const dd = parseYmd(r.date); return dd && dd >= ws && dd <= we && isContracted(r); }).length);
      }
    }
    $("#contract-trend-title").textContent = unit === "week" ? "주별 계약(체결) 건수 — 최근 6주" : "월별 계약(체결) 건수 — 최근 6개월";
    const data = { labels, datasets: [{ label: "체결 건수", data: values, backgroundColor: STATUS_COLOR.contracted }] };
    if (contractTrendChart) { contractTrendChart.data = data; contractTrendChart.update(); return; }
    contractTrendChart = new Chart(ctx, {
      type: "bar", data,
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
    });
  }

  // 월별 매출 추이 (계약금액 합)
  function renderRevenueTrend() {
    if (typeof Chart === "undefined") return;
    const ctx = $("#revenue-trend-canvas");
    if (!ctx) return;
    const ref = contractRef || nowDate();
    const labels = [], values = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
      const mk = ymd(d).slice(0, 7);
      labels.push(`${Number(mk.slice(5))}월`);
      values.push(state.reservations
        .filter((r) => (r.date || "").startsWith(mk) && isContracted(r))
        .reduce((a, r) => a + (Number(r.amount) || 0), 0));
    }
    const data = { labels, datasets: [{ label: "계약 매출(원)", data: values, borderColor: "#c96b8e", backgroundColor: "rgba(201,107,142,.18)", fill: true, tension: .3 }] };
    if (revenueTrendChart) { revenueTrendChart.data = data; revenueTrendChart.update(); return; }
    revenueTrendChart = new Chart(ctx, {
      type: "line", data,
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => (v / 10000).toLocaleString() + "만" } } },
        plugins: { tooltip: { callbacks: { label: (c) => won(c.raw) } } },
      },
    });
  }

  // 유입경로별 비율 (해당 기간)
  function renderSourceChart(list) {
    if (typeof Chart === "undefined") return;
    const ctx = $("#source-chart-canvas");
    if (!ctx) return;
    const by = {};
    list.forEach((r) => { const s = (r.source || "").trim() || "미상"; by[s] = (by[s] || 0) + 1; });
    const labels = Object.keys(by);
    const palette = ["#c96b8e", "#7a86d1", "#eab308", "#22c55e", "#f97316", "#38bdf8", "#8b5cf6", "#9ca3af"];
    const data = {
      labels: labels.length ? labels : ["데이터 없음"],
      datasets: [{ data: labels.length ? labels.map((l) => by[l]) : [1], backgroundColor: palette }],
    };
    if (sourceChart) { sourceChart.data = data; sourceChart.update(); return; }
    sourceChart = new Chart(ctx, {
      type: "pie", data,
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } },
    });
  }

  function renderFailReasons(list) {
    const body = $("#fail-reason-body");
    body.innerHTML = "";
    const failed = list.filter(isFailed);
    if (failed.length === 0) {
      body.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--ink-soft)">미체결 건이 없습니다.</td></tr>`;
      return;
    }
    const by = {};
    failed.forEach((r) => { const s = (r.failReason || "").trim() || "미입력"; by[s] = (by[s] || 0) + 1; });
    Object.entries(by).sort((a, b) => b[1] - a[1]).forEach(([reason, cnt]) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(reason)}</td><td>${num(cnt)}</td><td>${Math.round((cnt / failed.length) * 100)}%</td>`;
      body.appendChild(tr);
    });
  }

  function renderContract() {
    const { list, label } = contractPeriod();
    $("#contract-period").textContent = label;

    renderTodayStatus();

    const c = list.filter(isContracted).length;
    const f = list.filter(isFailed).length;
    const revenue = list.filter(isContracted).reduce((a, r) => a + (Number(r.amount) || 0), 0);

    $("#kpi-total").textContent = num(list.length);
    $("#kpi-contracted").textContent = num(c);
    $("#kpi-rate").textContent = contractRate(c, f) + "%";
    $("#kpi-revenue").textContent = won(revenue);

    // 담당자별 집계
    const byMgr = {};
    list.forEach((r) => {
      const m = (r.manager || "").trim() || "(미지정)";
      const g = (byMgr[m] = byMgr[m] || { total: 0, contracted: 0, progress: 0, failed: 0, revenue: 0 });
      g.total++;
      if (isContracted(r)) { g.contracted++; g.revenue += Number(r.amount) || 0; }
      else if (isFailed(r)) g.failed++;
      else if (normStatus(r.status) !== "canceled") g.progress++;
    });
    const body = $("#contract-manager-body");
    body.innerHTML = "";
    const entries = Object.entries(byMgr).sort((a, b) => b[1].contracted - a[1].contracted);
    if (entries.length === 0) {
      body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--ink-soft)">고객 데이터가 없습니다. 고객을 등록하고 진행 상태를 지정하세요.</td></tr>`;
    }
    entries.forEach(([m, g]) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(m)}</td><td>${num(g.total)}</td>
        <td>${num(g.contracted)}</td><td>${num(g.progress)}</td><td>${num(g.failed)}</td>
        <td><strong>${contractRate(g.contracted, g.failed)}%</strong></td><td>${won(g.revenue)}</td>`;
      body.appendChild(tr);
    });

    renderContractTrend();
    renderRevenueTrend();
    renderSourceChart(list);
    renderFailReasons(list);

    // 상태 분포 도넛
    if (typeof Chart === "undefined") return;
    const ctx = $("#contract-chart-canvas");
    if (!ctx) return;
    const present = STATUS_KEYS.filter((k) => list.some((r) => normStatus(r.status) === k));
    const data = {
      labels: present.map((k) => STATUS_KO[k]),
      datasets: [{ data: present.map((k) => list.filter((r) => normStatus(r.status) === k).length), backgroundColor: present.map((k) => STATUS_COLOR[k]) }],
    };
    if (contractChart) { contractChart.data = data; contractChart.update(); return; }
    contractChart = new Chart(ctx, {
      type: "doughnut", data,
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } },
    });
  }

  /* ---------- 5) 고객 관리 (리스트 + 검색) ---------- */
  const custFilter = { q: "", status: "", manager: "" };

  function populateFilterOptions() {
    const statusSel = $("#cust-filter-status");
    statusSel.innerHTML = `<option value="">전체 상태</option>` +
      STATUS_KEYS.map((k) => `<option value="${k}">${STATUS_KO[k]}</option>`).join("");
    statusSel.value = custFilter.status;   // 선택값 복원
    const mgrSel = $("#cust-filter-manager");
    const mgrs = [...new Set(state.reservations.map((r) => (r.manager || "").trim()).filter(Boolean))].sort();
    mgrSel.innerHTML = `<option value="">전체 담당자</option>` +
      mgrs.map((m) => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join("");
    if (!mgrs.includes(custFilter.manager)) custFilter.manager = "";
    mgrSel.value = custFilter.manager;     // 선택값 복원
  }

  function renderCustomers() {
    populateFilterOptions();
    const body = $("#customers-table-body");
    const q = custFilter.q.trim().toLowerCase();
    const rows = state.reservations
      .filter((r) => {
        if (custFilter.status && normStatus(r.status) !== custFilter.status) return false;
        if (custFilter.manager && (r.manager || "").trim() !== custFilter.manager) return false;
        if (q) {
          const hay = `${r.name || ""} ${r.phone || ""} ${r.phone2 || ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    body.innerHTML = "";
    if (rows.length === 0) {
      body.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--ink-soft)">조건에 맞는 고객이 없습니다.</td></tr>`;
    }
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.className = "clickable-row";
      const phone = r.phone || r.phone2 || "-";
      tr.innerHTML = `
        <td><strong>${escapeHtml(r.name || "(무명)")}</strong></td>
        <td>${escapeHtml(phone)}</td>
        <td>${escapeHtml(r.date || "-")}</td>
        <td>${escapeHtml(r.wedding || "미정")}</td>
        <td>${escapeHtml(r.manager || "미지정")}</td>
        <td>${escapeHtml(r.source || "-")}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${escapeHtml(r.next || "-")}</td>
        <td><button class="row-edit" title="수정">✏️</button></td>`;
      tr.querySelector(".row-edit").addEventListener("click", () => openReservationModal(r));
      tr.addEventListener("click", (e) => { if (!e.target.closest("button")) openReservationModal(r); });
      body.appendChild(tr);
    });
    $("#customers-count").textContent = `총 ${rows.length}명 표시 (전체 ${state.reservations.length}명)`;
  }

  /* ---------- 6) 마케팅 성과 ---------- */
  let dashChart = null;

  function renderDashboardTable() {
    const body = $("#dashboard-table-body");
    body.innerHTML = "";
    if (state.metrics.length === 0) {
      body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--ink-soft)">데이터가 없습니다. “데이터 행 추가” 또는 엑셀 업로드로 시작하세요.</td></tr>`;
    }
    state.metrics.forEach((m) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input data-f="channel" value="${escapeAttr(m.channel)}" /></td>
        <td><input data-f="impressions" type="number" value="${m.impressions || 0}" /></td>
        <td><input data-f="clicks" type="number" value="${m.clicks || 0}" /></td>
        <td><input data-f="conversions" type="number" value="${m.conversions || 0}" /></td>
        <td><input data-f="budget" type="number" value="${m.budget || 0}" /></td>
        <td><button class="row-del" title="삭제">✕</button></td>`;
      tr.querySelectorAll("input").forEach((inp) => {
        inp.addEventListener("input", () => {
          const f = inp.dataset.f;
          m[f] = f === "channel" ? inp.value : Number(inp.value);
          save(); renderKpi(); renderDashboardChart();
        });
      });
      tr.querySelector(".row-del").addEventListener("click", () => {
        state.metrics = state.metrics.filter((x) => x.id !== m.id);
        save(); renderDashboard();
      });
      body.appendChild(tr);
    });
  }

  function renderKpi() {
    const sum = (f) => state.metrics.reduce((a, m) => a + (Number(m[f]) || 0), 0);
    $("#kpi-impressions").textContent = num(sum("impressions"));
    $("#kpi-clicks").textContent = num(sum("clicks"));
    $("#kpi-conversions").textContent = num(sum("conversions"));
    $("#kpi-budget").textContent = won(sum("budget"));
  }

  function renderDashboardChart() {
    if (typeof Chart === "undefined") return;
    const ctx = $("#dashboard-chart-canvas");
    if (!ctx) return;
    const labels = state.metrics.map((m) => m.channel || "(무명)");
    const data = {
      labels,
      datasets: [
        { label: "클릭수", data: state.metrics.map((m) => m.clicks || 0), backgroundColor: "#c96b8e" },
        { label: "문의전환", data: state.metrics.map((m) => m.conversions || 0), backgroundColor: "#7a86d1" },
      ],
    };
    if (dashChart) { dashChart.data = data; dashChart.update(); return; }
    dashChart = new Chart(ctx, {
      type: "bar", data,
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
    });
  }

  function renderDashboard() { renderDashboardTable(); renderKpi(); renderDashboardChart(); }

  function addMetricRow(preset) {
    state.metrics.push(Object.assign(
      { id: uid(), channel: "", impressions: 0, clicks: 0, conversions: 0, budget: 0 }, preset || {}));
    save(); renderDashboard();
  }

  function importMetricsFromSheet(rows) {
    const pick = (o, keys) => { for (const k of keys) if (o[k] != null) return o[k]; return ""; };
    rows.forEach((r) => {
      state.metrics.push({
        id: uid(),
        channel: String(pick(r, ["채널", "channel", "Channel"]) || ""),
        impressions: Number(pick(r, ["노출수", "impressions"]) || 0),
        clicks: Number(pick(r, ["클릭수", "clicks"]) || 0),
        conversions: Number(pick(r, ["문의전환", "전환", "conversions"]) || 0),
        budget: Number(pick(r, ["예산", "예산(원)", "budget"]) || 0),
      });
    });
    save(); renderDashboard();
    toast(`${rows.length}개 행을 불러왔습니다.`);
  }

  /* ---------- 7) 콘텐츠 제작 ---------- */
  let contentPhoto = null;

  function drawContentCard() {
    const cv = $("#content-canvas");
    const ctx = cv.getContext("2d");
    const W = cv.width, H = cv.height;
    const hall = $("#content-hall").value || "웨딩홀 이름";
    const title = $("#content-title").value || "메인 문구를 입력하세요";
    const desc = $("#content-desc").value || "서브 문구를 입력하세요";
    const color = $("#content-color").value;
    const template = $("#content-template").value;

    ctx.clearRect(0, 0, W, H);
    if (contentPhoto) {
      ctx.drawImage(contentPhoto, 0, 0, W, H);
      ctx.fillStyle = "rgba(0,0,0,.38)";
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    if (template === "minimal") ctx.textAlign = "left";
    const cx = template === "minimal" ? 60 : W / 2;

    ctx.font = "600 26px sans-serif";
    ctx.globalAlpha = .9;
    ctx.fillText(hall, cx, template === "bold" ? 120 : 140);
    ctx.globalAlpha = 1;

    ctx.font = (template === "bold" ? "800 " : "700 ") + (template === "bold" ? 56 : 44) + "px sans-serif";
    wrapText(ctx, title, cx, 300, W - 120, 58);

    ctx.font = "400 24px sans-serif";
    ctx.globalAlpha = .95;
    wrapText(ctx, desc, cx, 460, W - 140, 34);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(255,255,255,.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (template === "minimal") { ctx.moveTo(60, 540); ctx.lineTo(240, 540); }
    else { ctx.moveTo(W / 2 - 60, 540); ctx.lineTo(W / 2 + 60, 540); }
    ctx.stroke();
  }

  function wrapText(ctx, text, x, y, maxW, lh) {
    const words = String(text).split(/\s+/);
    let line = "", ly = y;
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, ly); line = w; ly += lh;
      } else line = test;
    }
    if (line) ctx.fillText(line, x, ly);
  }

  function renderContentHistory() {
    const ul = $("#content-history");
    ul.innerHTML = "";
    if (state.contents.length === 0) { ul.innerHTML = `<li class="empty">저장된 이력이 없습니다.</li>`; return; }
    state.contents.slice().reverse().forEach((c) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="li-main">${escapeHtml(c.title || "(제목없음)")}<br><span class="li-sub">${escapeHtml(c.hall)} · ${c.savedAt}</span></span>
                      <button title="삭제">✕</button>`;
      li.querySelector("button").addEventListener("click", () => {
        state.contents = state.contents.filter((x) => x.id !== c.id);
        save(); renderContentHistory();
      });
      ul.appendChild(li);
    });
  }

  /* ---------- 8) 캘린더 ---------- */
  let calYear, calMonth, selectedDate = null;

  function initCalendarToDate(d) { calYear = d.getFullYear(); calMonth = d.getMonth(); }

  function renderCalendar() {
    const grid = $("#calendar-grid");
    $("#cal-title").textContent = `${calYear}. ${String(calMonth + 1).padStart(2, "0")}`;
    const first = new Date(calYear, calMonth, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const todayStr = ymd(nowDate());

    let html = `<div class="cal-weekdays">${["일","월","화","수","목","금","토"].map((d) => `<div>${d}</div>`).join("")}</div><div class="cal-days">`;
    const prevDays = new Date(calYear, calMonth, 0).getDate();
    for (let i = startDay - 1; i >= 0; i--) html += `<div class="cal-cell other">${prevDays - i}</div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const count = state.reservations.filter((r) => r.date === dateStr).length;
      const cls = ["cal-cell"];
      if (dateStr === todayStr) cls.push("today");
      if (dateStr === selectedDate) cls.push("selected");
      html += `<button class="${cls.join(" ")}" data-date="${dateStr}">${d}${count ? `<br><span class="cal-dot">${count}건</span>` : ""}</button>`;
    }
    html += `</div>`;
    grid.innerHTML = html;
    grid.querySelectorAll(".cal-cell[data-date]").forEach((cell) => {
      cell.addEventListener("click", () => { selectedDate = cell.dataset.date; renderCalendar(); renderDayList(); });
    });
  }

  function renderDayList() {
    const title = $("#daylist-title");
    const ul = $("#daylist-items");
    if (!selectedDate) { title.textContent = "날짜를 선택하세요"; ul.innerHTML = ""; return; }
    title.textContent = `${selectedDate} 일정`;
    const items = state.reservations.filter((r) => r.date === selectedDate).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    ul.innerHTML = "";
    if (items.length === 0) { ul.innerHTML = `<li class="empty">예약이 없습니다.</li>`; return; }
    items.forEach((r) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="li-main"><strong>${r.time || ""}</strong> ${escapeHtml(r.name)} ${statusBadge(r.status)}<br>
        <span class="li-sub">${r.kind || "상담"} · ${escapeHtml(r.phone || "연락처 없음")} · 담당 ${escapeHtml(r.manager || "미지정")}</span></span>
        <button title="수정">✏️</button>`;
      li.querySelector("button").addEventListener("click", () => openReservationModal(r));
      ul.appendChild(li);
    });
  }

  /* ---------- 고객/상담 모달 (캘린더·고객관리 공용) ---------- */
  function fillStatusOptions() {
    $("#res-status").innerHTML = STATUS_KEYS.map((k) => `<option value="${k}">${STATUS_KO[k]}</option>`).join("");
  }
  function toggleFailReason() {
    $("#res-failreason-wrap").hidden = $("#res-status").value !== "failed";
  }

  function openReservationModal(res) {
    const modal = $("#reservation-modal");
    modal.hidden = false;
    $("#reservation-modal-title").textContent = res ? "고객 정보 수정" : "고객 등록";
    $("#res-id").value = res ? res.id : "";
    $("#res-name").value = res ? (res.name || "") : "";
    $("#res-email").value = res ? (res.email || "") : "";
    $("#res-phone").value = res ? (res.phone || "") : "";
    $("#res-phone2").value = res ? (res.phone2 || "") : "";
    $("#res-source").value = res ? (res.source || "") : "";
    $("#res-manager").value = res ? (res.manager || "") : "";
    $("#res-date").value = res ? (res.date || "") : (selectedDate || ymd(nowDate()));
    $("#res-time").value = res ? (res.time || "14:00") : "14:00";
    $("#res-kind").value = res ? (res.kind || "상담") : "상담";
    $("#res-next").value = res ? (res.next || "") : "";
    $("#res-wedding").value = res ? (res.wedding || "") : "";
    $("#res-venue").value = res ? (res.venue || "") : "";
    $("#res-region").value = res ? (res.region || "") : "";
    $("#res-guests").value = res ? (res.guests || "") : "";
    $("#res-status").value = res ? normStatus(res.status) : "new";
    $("#res-failreason").value = res ? (res.failReason || "") : "";
    $("#res-budget").value = res ? (res.budget || "") : "";
    $("#res-amount").value = res ? (res.amount || "") : "";
    $("#res-memo").value = res ? (res.memo || "") : "";
    $("#btn-res-delete").hidden = !res;
    toggleFailReason();
  }
  function closeReservationModal() { $("#reservation-modal").hidden = true; }

  function saveReservation(e) {
    e.preventDefault();
    const id = $("#res-id").value;
    const data = {
      name: $("#res-name").value.trim(), email: $("#res-email").value.trim(),
      phone: $("#res-phone").value.trim(), phone2: $("#res-phone2").value.trim(),
      source: $("#res-source").value, manager: $("#res-manager").value.trim(),
      date: $("#res-date").value, time: $("#res-time").value, kind: $("#res-kind").value,
      next: $("#res-next").value, wedding: $("#res-wedding").value,
      venue: $("#res-venue").value.trim(), region: $("#res-region").value.trim(),
      guests: Number($("#res-guests").value) || 0,
      status: $("#res-status").value,
      failReason: $("#res-status").value === "failed" ? $("#res-failreason").value : "",
      budget: Number($("#res-budget").value) || 0, amount: Number($("#res-amount").value) || 0,
      memo: $("#res-memo").value.trim(),
    };
    if (id) {
      const r = state.reservations.find((x) => x.id === id);
      if (r) Object.assign(r, data);
    } else {
      state.reservations.push(Object.assign({ id: uid() }, data));
    }
    save();
    selectedDate = data.date;
    initCalendarToDate(new Date(data.date + "T00:00"));
    renderCalendar(); renderDayList(); renderContract(); renderCustomers();
    closeReservationModal();
    toast("고객 정보를 저장했습니다.");
  }

  function deleteReservation() {
    const id = $("#res-id").value;
    if (!confirm("이 고객 정보를 삭제할까요?")) return;
    state.reservations = state.reservations.filter((x) => x.id !== id);
    save(); renderCalendar(); renderDayList(); renderContract(); renderCustomers();
    closeReservationModal();
    toast("삭제했습니다.");
  }

  /* ---------- 9) 알림 발송 ---------- */
  function renderNotifyOptions() {
    const sel = $("#notify-reservation");
    const sorted = state.reservations.slice().sort((a, b) => ((a.date || "") + (a.time || "")).localeCompare((b.date || "") + (b.time || "")));
    sel.innerHTML = sorted.length
      ? sorted.map((r) => `<option value="${r.id}">${r.date || ""} ${r.time || ""} · ${escapeHtml(r.name)}</option>`).join("")
      : `<option value="">등록된 예약이 없습니다</option>`;
    buildNotifyMessage();
  }

  function buildNotifyMessage() {
    const id = $("#notify-reservation").value;
    const type = $("#notify-type").value;
    const r = state.reservations.find((x) => x.id === id);
    const box = $("#notify-message");
    if (!r) { box.value = "예약을 먼저 등록하세요."; return; }
    const when = `${(r.date || "").replaceAll("-", ".")} ${r.time || ""}`;
    const templates = {
      confirm: `[웨딩홀 안내] ${r.name}님, 요청하신 ${r.kind || "상담"} 일정이 ${when}으로 확정되었습니다. 방문을 기다리겠습니다. 문의사항은 회신 부탁드립니다.`,
      change: `[웨딩홀 안내] ${r.name}님, ${r.kind || "상담"} 일정이 ${when}으로 변경되었습니다. 확인 부탁드립니다.`,
      remind: `[웨딩홀 안내] ${r.name}님, 내일 ${when}에 ${r.kind || "상담"}이 예정되어 있습니다. 잊지 말고 방문 부탁드립니다.`,
    };
    box.value = templates[type];
  }

  function renderNotifyHistory() {
    const ul = $("#notify-history-list");
    ul.innerHTML = "";
    if (state.notifyLogs.length === 0) { ul.innerHTML = `<li class="empty">발송 이력이 없습니다.</li>`; return; }
    state.notifyLogs.slice().reverse().forEach((l) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="li-main">${escapeHtml(l.target)}<br><span class="li-sub">${l.type} · ${l.at}</span></span>`;
      ul.appendChild(li);
    });
  }

  /* ---------- 10) 데이터 엑셀 ---------- */
  function exportAll() {
    if (typeof XLSX === "undefined") { toast("엑셀 라이브러리 로딩 중입니다. 잠시 후 다시 시도하세요."); return; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.reservations.map(({ id, ...r }) => ({
      고객명: r.name, 신랑연락처: r.phone, 신부연락처: r.phone2 || "", 이메일: r.email || "",
      유입경로: r.source || "", 담당자: r.manager || "", 상담일: r.date, 상담시간: r.time, 구분: r.kind,
      다음연락일: r.next || "", 예식예정일: r.wedding || "", 예식장: r.venue || "", 지역: r.region || "",
      하객수: r.guests || 0, 진행상태: STATUS_KO[normStatus(r.status)], 미체결사유: r.failReason || "",
      "예산(원)": r.budget || 0, "계약금액(원)": r.amount || 0, 메모: r.memo || "",
    }))), "고객");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.metrics.map(({ id, ...r }) => ({
      채널: r.channel, 노출수: r.impressions, 클릭수: r.clicks, 문의전환: r.conversions, "예산(원)": r.budget,
    }))), "성과");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.contents.map(({ id, ...r }) => r)), "콘텐츠");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.notifyLogs.map(({ id, ...r }) => r)), "알림이력");
    XLSX.writeFile(wb, `WediBoard_백업_${ymd(nowDate())}.xlsx`);
    toast("엑셀로 내보냈습니다.");
  }

  function importAll(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(e.target.result, { type: "array" });
      const sheet = (name) => wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name]) : [];
      const mRows = sheet("성과");
      const rRows = sheet("고객").length ? sheet("고객") : sheet("예약"); // 구버전 호환
      if (mRows.length) {
        state.metrics = mRows.map((r) => ({
          id: uid(), channel: String(r["채널"] || ""), impressions: Number(r["노출수"] || 0),
          clicks: Number(r["클릭수"] || 0), conversions: Number(r["문의전환"] || 0), budget: Number(r["예산(원)"] || 0),
        }));
      }
      if (rRows.length) {
        state.reservations = rRows.map((r) => ({
          id: uid(),
          name: String(r["고객명"] || r["이름"] || ""),
          phone: String(r["신랑연락처"] || r["연락처"] || ""), phone2: String(r["신부연락처"] || ""),
          email: String(r["이메일"] || ""), source: String(r["유입경로"] || ""),
          manager: String(r["담당자"] || ""),
          date: String(r["상담일"] || r["날짜"] || ""), time: String(r["상담시간"] || r["시간"] || ""),
          kind: String(r["구분"] || "상담"), next: String(r["다음연락일"] || ""),
          wedding: String(r["예식예정일"] || ""), venue: String(r["예식장"] || ""), region: String(r["지역"] || ""),
          guests: Number(r["하객수"] || 0),
          status: STATUS_FROM_KO[String(r["진행상태"] || r["계약상태"] || "").trim()] || normStatus(r["진행상태"]),
          failReason: String(r["미체결사유"] || ""),
          budget: Number(r["예산(원)"] || 0), amount: Number(r["계약금액(원)"] || 0),
          memo: String(r["메모"] || ""),
        }));
      }
      save(); renderAll();
      toast("엑셀 데이터를 복원했습니다.");
    };
    reader.readAsArrayBuffer(file);
  }

  function readSheetForMetrics(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(e.target.result, { type: "array" });
      const first = wb.Sheets[wb.SheetNames[0]];
      importMetricsFromSheet(XLSX.utils.sheet_to_json(first));
    };
    reader.readAsArrayBuffer(file);
  }

  /* ---------- 11) ROI ---------- */
  let roiChart = null;
  function renderRoi() {
    const body = $("#roi-table-body");
    body.innerHTML = "";
    const rows = state.metrics.map((m) => ({
      channel: m.channel || "(무명)", budget: m.budget || 0, conv: m.conversions || 0,
      cpa: m.conversions ? Math.round((m.budget || 0) / m.conversions) : null,
    }));
    if (rows.length === 0) {
      body.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--ink-soft)">마케팅 성과 데이터를 먼저 입력하세요.</td></tr>`;
    }
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(r.channel)}</td><td>${won(r.budget)}</td><td>${num(r.conv)}</td>
        <td>${r.cpa == null ? "-" : won(r.cpa)}</td>`;
      body.appendChild(tr);
    });
    if (typeof Chart === "undefined") return;
    const ctx = $("#roi-chart-canvas");
    const data = {
      labels: rows.map((r) => r.channel),
      datasets: [{ label: "전환당 비용(원)", data: rows.map((r) => r.cpa || 0), backgroundColor: "#7a86d1" }],
    };
    if (roiChart) { roiChart.data = data; roiChart.update(); return; }
    roiChart = new Chart(ctx, { type: "bar", data, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } } });
  }

  /* ---------- 렌더 총괄 ---------- */
  function renderAll() {
    renderContract();
    renderCustomers();
    renderDashboard();
    drawContentCard();
    renderContentHistory();
    renderCalendar();
    renderDayList();
    renderNotifyHistory();
    renderNotifyOptions();
    renderRoi();
    updateCacheInfo();
  }

  /* ---------- 이스케이프 ---------- */
  function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function escapeAttr(s) { return escapeHtml(s); }

  /* ---------- 12) 부팅 & 이벤트 바인딩 ---------- */
  function boot() {
    load();
    initCalendarToDate(nowDate());
    fillStatusOptions();

    // 내비게이션
    $$(".nav-item").forEach((n) => n.addEventListener("click", () => switchView(n.dataset.view)));
    $("#nav-toggle").addEventListener("click", openNav);
    $("#nav-backdrop").addEventListener("click", closeNav);

    // 고객 관리 검색/필터
    $("#cust-search").addEventListener("input", (e) => { custFilter.q = e.target.value; renderCustomers(); });
    $("#cust-filter-status").addEventListener("change", (e) => { custFilter.status = e.target.value; renderCustomers(); });
    $("#cust-filter-manager").addEventListener("change", (e) => { custFilter.manager = e.target.value; renderCustomers(); });
    $("#btn-add-customer").addEventListener("click", () => openReservationModal(null));

    // 마케팅 성과
    $("#btn-add-metric").addEventListener("click", () => addMetricRow());
    $("#btn-clear-metrics").addEventListener("click", () => { if (confirm("성과 데이터를 모두 비울까요?")) { state.metrics = []; save(); renderDashboard(); } });
    $("#dashboard-upload").addEventListener("change", (e) => { if (e.target.files[0]) readSheetForMetrics(e.target.files[0]); e.target.value = ""; });

    // 콘텐츠
    ["content-hall", "content-title", "content-desc", "content-color", "content-template"].forEach((id) =>
      $("#" + id).addEventListener("input", drawContentCard));
    $("#content-photo").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const img = new Image();
      img.onload = () => { contentPhoto = img; drawContentCard(); };
      img.src = URL.createObjectURL(f);
    });
    $("#btn-content-download").addEventListener("click", () => {
      const a = document.createElement("a");
      a.download = "wediboard_content.png";
      a.href = $("#content-canvas").toDataURL("image/png");
      a.click();
    });
    $("#btn-content-save").addEventListener("click", () => {
      state.contents.push({ id: uid(), hall: $("#content-hall").value, title: $("#content-title").value, savedAt: ymd(nowDate()) });
      save(); renderContentHistory(); toast("콘텐츠 이력에 저장했습니다.");
    });

    // 캘린더
    $("#cal-prev").addEventListener("click", () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); });
    $("#cal-next").addEventListener("click", () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); });
    $("#cal-today").addEventListener("click", () => { initCalendarToDate(nowDate()); selectedDate = ymd(nowDate()); renderCalendar(); renderDayList(); });
    $("#btn-add-reservation").addEventListener("click", () => openReservationModal(null));
    $("#reservation-form").addEventListener("submit", saveReservation);
    $("#res-status").addEventListener("change", toggleFailReason);
    $("#btn-res-delete").addEventListener("click", deleteReservation);
    $$("[data-close-modal]").forEach((el) => el.addEventListener("click", closeReservationModal));

    // 상담 대시보드 — 월별/주별 기간 선택
    contractRef = nowDate();
    function setUnit(u) {
      contractUnit = u;
      if (u !== "all" && !contractRef) contractRef = nowDate();
      $("#unit-month").classList.toggle("is-active", u === "month");
      $("#unit-week").classList.toggle("is-active", u === "week");
      renderContract();
    }
    $("#unit-month").addEventListener("click", () => setUnit("month"));
    $("#unit-week").addEventListener("click", () => setUnit("week"));
    $("#contract-all").addEventListener("click", () => setUnit("all"));
    $("#contract-prev").addEventListener("click", () => {
      if (contractUnit === "all") return setUnit("month");
      contractRef = contractUnit === "week"
        ? addDays(contractRef, -7)
        : new Date(contractRef.getFullYear(), contractRef.getMonth() - 1, 1);
      renderContract();
    });
    $("#contract-next").addEventListener("click", () => {
      if (contractUnit === "all") return setUnit("month");
      contractRef = contractUnit === "week"
        ? addDays(contractRef, 7)
        : new Date(contractRef.getFullYear(), contractRef.getMonth() + 1, 1);
      renderContract();
    });

    // 알림
    $("#notify-reservation").addEventListener("change", buildNotifyMessage);
    $("#notify-type").addEventListener("change", buildNotifyMessage);
    $("#btn-notify-copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($("#notify-message").value); toast("문구를 복사했습니다."); }
      catch { $("#notify-message").select(); document.execCommand("copy"); toast("문구를 복사했습니다."); }
    });
    $("#btn-notify-log").addEventListener("click", () => {
      const id = $("#notify-reservation").value;
      const r = state.reservations.find((x) => x.id === id);
      if (!r) { toast("대상 예약이 없습니다."); return; }
      state.notifyLogs.push({ id: uid(), target: `${r.name} (${r.date} ${r.time})`, type: $("#notify-type").selectedOptions[0].text, at: ymd(nowDate()) });
      save(); renderNotifyHistory(); toast("발송 기록을 남겼습니다.");
    });

    // 데이터
    $("#btn-export-all").addEventListener("click", exportAll);
    $("#data-import-file").addEventListener("change", (e) => { if (e.target.files[0]) importAll(e.target.files[0]); e.target.value = ""; });
    $("#btn-reset-data").addEventListener("click", () => {
      if (confirm("모든 데이터를 삭제합니다. 계속할까요?")) {
        state.metrics = []; state.reservations = []; state.contents = []; state.notifyLogs = [];
        save(); renderAll(); toast("데이터를 초기화했습니다.");
      }
    });

    renderAll();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
