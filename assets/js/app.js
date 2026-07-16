/* ============================================================
   WediBoard 앱 로직
   구성: 1)유틸/상태 2)저장 3)라우팅 4)상담 대시보드 5)고객 관리
        6)마케팅 성과 7)콘텐츠 8)캘린더 9)알림 10)데이터(엑셀)
        11)부팅
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

  // 대한민국 공휴일 (2025~2027) — 음력·대체공휴일 포함. 연도 추가 시 여기만 수정하면 됩니다.
  const HOLIDAYS = {
    // 2025
    "2025-01-01": "신정", "2025-01-28": "설날", "2025-01-29": "설날", "2025-01-30": "설날",
    "2025-03-01": "삼일절", "2025-03-03": "대체공휴일",
    "2025-05-05": "어린이날·부처님오신날", "2025-05-06": "대체공휴일",
    "2025-06-06": "현충일", "2025-08-15": "광복절",
    "2025-10-03": "개천절", "2025-10-05": "추석", "2025-10-06": "추석", "2025-10-07": "추석", "2025-10-08": "대체공휴일",
    "2025-10-09": "한글날", "2025-12-25": "성탄절",
    // 2026
    "2026-01-01": "신정", "2026-02-16": "설날", "2026-02-17": "설날", "2026-02-18": "설날",
    "2026-03-01": "삼일절", "2026-03-02": "대체공휴일",
    "2026-05-05": "어린이날", "2026-05-24": "부처님오신날", "2026-05-25": "대체공휴일",
    "2026-06-06": "현충일", "2026-08-15": "광복절", "2026-08-17": "대체공휴일",
    "2026-09-24": "추석", "2026-09-25": "추석", "2026-09-26": "추석", "2026-09-28": "대체공휴일",
    "2026-10-03": "개천절", "2026-10-05": "대체공휴일", "2026-10-09": "한글날", "2026-12-25": "성탄절",
    // 2027
    "2027-01-01": "신정", "2027-02-06": "설날", "2027-02-07": "설날", "2027-02-08": "설날",
    "2027-03-01": "삼일절", "2027-05-05": "어린이날", "2027-05-13": "부처님오신날",
    "2027-06-06": "현충일", "2027-06-07": "대체공휴일", "2027-08-15": "광복절", "2027-08-16": "대체공휴일",
    "2027-09-14": "추석", "2027-09-15": "추석", "2027-09-16": "추석",
    "2027-10-03": "개천절", "2027-10-04": "대체공휴일", "2027-10-09": "한글날", "2027-12-25": "성탄절",
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
    checklists: {},     // { [reservationId]: { values:{...}, updatedAt } } — 예식 체크리스트
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
      if (!state.checklists || typeof state.checklists !== "object" || Array.isArray(state.checklists)) state.checklists = {};
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
    if (viewId === "view-dashboard") renderDashboardChart();
    if (viewId === "view-contract") renderContract();
    if (viewId === "view-customers") renderCustomers();
    if (viewId === "view-home") renderHome();
    if (viewId === "view-wedding") { renderWeddingCalendar(); renderWeddingDayList(); }
    if (viewId === "view-checklist") renderChecklist();
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

  /* ---------- 홈 · 메인 화면 ---------- */
  function renderHome() {
    const now = nowDate();
    const today = ymd(now);
    const mk = today.slice(0, 7);
    const WD = ["일", "월", "화", "수", "목", "금", "토"];
    const dateEl = $("#home-date");
    if (dateEl) dateEl.textContent = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${WD[now.getDay()]})`;

    const openStatuses = new Set(["new", "booked", "consulting", "quoted", "reviewing"]);
    $("#home-kpi-consult").textContent = num(state.reservations.filter((r) => r.date === today).length);
    $("#home-kpi-waiting").textContent = num(state.reservations.filter((r) => ["quoted", "reviewing"].includes(normStatus(r.status))).length);
    $("#home-kpi-contact").textContent = num(state.reservations.filter((r) => r.next === today && openStatuses.has(normStatus(r.status))).length);
    $("#home-kpi-contract").textContent = num(state.reservations.filter((r) => (r.date || "").startsWith(mk) && isContracted(r)).length);

    // 다가오는 상담 일정 (오늘 이후, 가까운 순 5건)
    const up = $("#home-upcoming");
    const upcoming = state.reservations
      .filter((r) => (r.date || "") >= today)
      .sort((a, b) => ((a.date || "") + (a.time || "")).localeCompare((b.date || "") + (b.time || "")))
      .slice(0, 5);
    up.innerHTML = "";
    if (upcoming.length === 0) { up.innerHTML = `<li class="empty">예정된 일정이 없습니다.</li>`; }
    upcoming.forEach((r) => {
      const li = document.createElement("li");
      li.className = "clickable-li";
      const dd = r.date === today ? "오늘" : (r.date || "");
      li.innerHTML = `<span class="li-main"><strong>${dd} ${r.time || ""}</strong> ${escapeHtml(r.name)} ${statusBadge(r.status)}<br>
        <span class="li-sub">${r.kind || "상담"} · 담당 ${escapeHtml(r.manager || "미지정")}</span></span>`;
      li.addEventListener("click", () => openReservationModal(r));
      up.appendChild(li);
    });

    // 최근 등록 고객 (상담일 최신순 5건)
    const rc = $("#home-recent");
    const recent = state.reservations.slice()
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, 5);
    rc.innerHTML = "";
    if (recent.length === 0) { rc.innerHTML = `<li class="empty">등록된 고객이 없습니다.</li>`; }
    recent.forEach((r) => {
      const li = document.createElement("li");
      li.className = "clickable-li";
      li.innerHTML = `<span class="li-main"><strong>${escapeHtml(r.name)}</strong> ${statusBadge(r.status)}<br>
        <span class="li-sub">${escapeHtml(r.phone || r.phone2 || "연락처 없음")} · 상담 ${escapeHtml(r.date || "-")}</span></span>`;
      li.addEventListener("click", () => openReservationModal(r));
      rc.appendChild(li);
    });
  }

  /* ---------- 4) 상담 대시보드 (계약 성과·매출) ---------- */
  let contractChart = null, contractTrendChart = null, sourceChart = null;
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

    $("#kpi-total").textContent = num(list.length);
    $("#kpi-contracted").textContent = num(c);
    $("#kpi-rate").textContent = contractRate(c, f) + "%";

    // 담당자별 집계
    const byMgr = {};
    list.forEach((r) => {
      const m = (r.manager || "").trim() || "(미지정)";
      const g = (byMgr[m] = byMgr[m] || { total: 0, contracted: 0, progress: 0, failed: 0 });
      g.total++;
      if (isContracted(r)) g.contracted++;
      else if (isFailed(r)) g.failed++;
      else if (normStatus(r.status) !== "canceled") g.progress++;
    });
    const body = $("#contract-manager-body");
    body.innerHTML = "";
    const entries = Object.entries(byMgr).sort((a, b) => b[1].contracted - a[1].contracted);
    if (entries.length === 0) {
      body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--ink-soft)">고객 데이터가 없습니다. 고객을 등록하고 진행 상태를 지정하세요.</td></tr>`;
    }
    entries.forEach(([m, g]) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(m)}</td><td>${num(g.total)}</td>
        <td>${num(g.contracted)}</td><td>${num(g.progress)}</td><td>${num(g.failed)}</td>
        <td><strong>${contractRate(g.contracted, g.failed)}%</strong></td>`;
      body.appendChild(tr);
    });

    renderContractTrend();
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
      .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.time || "").localeCompare(b.time || ""));

    body.innerHTML = "";
    if (rows.length === 0) {
      body.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--ink-soft)">조건에 맞는 고객이 없습니다.</td></tr>`;
    }
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.className = "clickable-row";
      const phone = r.phone || r.phone2 || "-";
      tr.innerHTML = `
        <td>${escapeHtml(r.date || "-")}</td>
        <td><strong>${escapeHtml(r.name || "(무명)")}</strong></td>
        <td>${escapeHtml(phone)}</td>
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

    let html = `<div class="cal-weekdays">${["일","월","화","수","목","금","토"].map((d, i) => `<div class="${i === 0 ? "wsun" : i === 6 ? "wsat" : ""}">${d}</div>`).join("")}</div><div class="cal-days">`;
    const prevDays = new Date(calYear, calMonth, 0).getDate();
    for (let i = startDay - 1; i >= 0; i--) html += `<div class="cal-cell other">${prevDays - i}</div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dow = new Date(calYear, calMonth, d).getDay();
      const holi = HOLIDAYS[dateStr];
      const count = state.reservations.filter((r) => r.date === dateStr).length;
      const cls = ["cal-cell"];
      if (dateStr === todayStr) cls.push("today");
      if (dateStr === selectedDate) cls.push("selected");
      if (holi || dow === 0) cls.push("sun");
      else if (dow === 6) cls.push("sat");
      html += `<button class="${cls.join(" ")}" data-date="${dateStr}">` +
        `<span class="cal-daynum">${d}</span>` +
        (holi ? `<span class="cal-holi">${holi}</span>` : "") +
        (count ? `<span class="cal-dot">${count}건</span>` : "") +
        `</button>`;
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
      const src = (r.source || "").trim();
      const srcText = src
        ? (src === "컨설팅" && r.consultCompany ? `컨설팅 · ${escapeHtml(r.consultCompany)}` : escapeHtml(src))
        : "미상";
      li.innerHTML = `<span class="li-main"><strong>${r.time || ""}</strong> ${escapeHtml(r.name)} ${statusBadge(r.status)}<br>
        <span class="li-sub">${r.kind || "상담"} · ${escapeHtml(r.phone || "연락처 없음")} · 담당 ${escapeHtml(r.manager || "미지정")}<br>
        유입경로: ${srcText}</span></span>
        <button title="수정">✏️</button>`;
      li.querySelector("button").addEventListener("click", () => openReservationModal(r));
      ul.appendChild(li);
    });
  }

  /* ---------- 8-1) 예식 캘린더 (계약 완료 커플, 예식일 기준) ---------- */
  let wedYear, wedMonth, wedSelected = null;
  function initWeddingCal(d) { wedYear = d.getFullYear(); wedMonth = d.getMonth(); }
  // 예식일 기준 계약 완료 커플
  const weddingsOn = (dateStr) => state.reservations.filter((r) => r.wedding === dateStr && isContracted(r));

  function renderWeddingCalendar() {
    const grid = $("#wedding-grid");
    if (!grid) return;
    if (wedYear == null) initWeddingCal(nowDate());
    $("#wed-title").textContent = `${wedYear}. ${String(wedMonth + 1).padStart(2, "0")}`;
    const startDay = new Date(wedYear, wedMonth, 1).getDay();
    const daysInMonth = new Date(wedYear, wedMonth + 1, 0).getDate();
    const todayStr = ymd(nowDate());

    let monthCount = 0;
    let html = `<div class="cal-weekdays">${["일","월","화","수","목","금","토"].map((d, i) => `<div class="${i === 0 ? "wsun" : i === 6 ? "wsat" : ""}">${d}</div>`).join("")}</div><div class="cal-days">`;
    const prevDays = new Date(wedYear, wedMonth, 0).getDate();
    for (let i = startDay - 1; i >= 0; i--) html += `<div class="cal-cell other">${prevDays - i}</div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${wedYear}-${String(wedMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dow = new Date(wedYear, wedMonth, d).getDay();
      const holi = HOLIDAYS[dateStr];
      const count = weddingsOn(dateStr).length;
      monthCount += count;
      const cls = ["cal-cell"];
      if (dateStr === todayStr) cls.push("today");
      if (dateStr === wedSelected) cls.push("selected");
      if (holi || dow === 0) cls.push("sun");
      else if (dow === 6) cls.push("sat");
      html += `<button class="${cls.join(" ")}" data-date="${dateStr}">` +
        `<span class="cal-daynum">${d}</span>` +
        (holi ? `<span class="cal-holi">${holi}</span>` : "") +
        (count ? `<span class="cal-dot wed-dot">💍${count}</span>` : "") +
        `</button>`;
    }
    html += `</div>`;
    grid.innerHTML = html;
    grid.querySelectorAll(".cal-cell[data-date]").forEach((cell) => {
      cell.addEventListener("click", () => { wedSelected = cell.dataset.date; renderWeddingCalendar(); renderWeddingDayList(); });
    });
    $("#wed-monthcount").textContent = `이 달 예식 ${monthCount}건`;
  }

  function renderWeddingDayList() {
    const title = $("#wed-daylist-title");
    const ul = $("#wed-daylist-items");
    if (!wedSelected) { title.textContent = "날짜를 선택하세요"; ul.innerHTML = ""; return; }
    title.textContent = `${wedSelected} 예식`;
    const items = weddingsOn(wedSelected);
    ul.innerHTML = "";
    if (items.length === 0) { ul.innerHTML = `<li class="empty">예정된 예식이 없습니다.</li>`; return; }
    items.forEach((r) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="li-main"><strong>${escapeHtml(r.name)}</strong> ${statusBadge(r.status)}<br>
        <span class="li-sub">${escapeHtml(r.venue || "예식장 미정")}${r.region ? " · " + escapeHtml(r.region) : ""}${r.guests ? " · 하객 " + num(r.guests) + "명" : ""}<br>
        ${escapeHtml(r.phone || r.phone2 || "연락처 없음")} · 담당 ${escapeHtml(r.manager || "미지정")}</span></span>
        <button title="수정">✏️</button>`;
      li.querySelector("button").addEventListener("click", () => openReservationModal(r));
      ul.appendChild(li);
    });
  }

  /* ---------- 8-2) 예식 체크리스트 (연구공원 웨딩홀 예식 최종 체크리스트) ---------- */
  const CK_PLACE = "연구공원웨딩홀 1층 컨벤션홀";
  let checklistResId = null;   // 현재 선택된 커플(예약) id

  // 체크리스트 구성 — 원본 엑셀(예식 최종 체크리스트) 항목 기준
  // item.t: "field"(입력) | "choice"(선택지) | "note"(안내문)
  //  - field:  {k, label, input:"text|number", unit?, auto?, def?, ph?, extra?}
  //  - choice: {k, label, opts:[{label, f?:fill입력여부, ph?}]}
  //  - note:   {text, warn?}
  const CHECKLIST = [
    { sec: "예식 기본정보", items: [
      { t: "field", k: "schedule", label: "예식일정", input: "text", auto: "schedule", ph: "예: 2026년 8월 25일 (토) 3시" },
      { t: "field", k: "place", label: "장소", input: "text", auto: "place" },
      { t: "field", k: "groom", label: "신 랑", input: "text", auto: "groom", extra: { k: "groomRel", label: "관계", ph: "예: 장남" } },
      { t: "field", k: "groomFather", label: "신랑 父", input: "text", ph: "성함" },
      { t: "field", k: "groomMother", label: "신랑 母", input: "text", ph: "성함" },
      { t: "field", k: "bride", label: "신 부", input: "text", auto: "bride", extra: { k: "brideRel", label: "관계", ph: "예: 차녀" } },
      { t: "field", k: "brideFather", label: "신부 父", input: "text", ph: "성함" },
      { t: "field", k: "brideMother", label: "신부 母", input: "text", ph: "성함" },
      { t: "note", text: "＊ 양가 부모님 성함/관계 꼭 체크해주세요 — 안내판에 표기되는 내용입니다. (관계 예: 장남, 차녀 등)" },
    ]},
    { sec: "피로연 · 식사", items: [
      { t: "field", k: "banquetTime", label: "피로연장 이용시간", input: "text", def: "예식 30분 전부터 2시간", ph: "예: 2:30 ~ 4:30" },
      { t: "note", text: "피로연장은 예식 30분 전부터 2시간 이용하며, 마감 10분 전 공식 마감멘트를 실시합니다." },
      { t: "choice", k: "drink", label: "음 · 주류", opts: [{ label: "코스 (금액 기재)", f: true, ph: "₩" }] },
      { t: "note", text: "탄산음료(디스펜서)·맥주(병)+소주(병)는 냉장 보관 중 셀프로 제공됩니다." },
      { t: "field", k: "guaranteeAdult", label: "지불보증인원(대인)", input: "number", unit: "명" },
      { t: "field", k: "guaranteeChild", label: "지불보증인원(소인)", input: "number", unit: "명" },
      { t: "note", text: "소인 1인당 3,300원 · 미취학아동 무료 · 초등학생 소인 · 중학생부터 대인" },
      { t: "note", warn: true, text: "예식 10일 전에는 지불보증인원 변경이 불가하니 신중히 결정하세요. 여유분 식사는 보증인원 기준 10%입니다. 보증인원 미달 시 100% 지급, 초과 시 실제 식사 인원만큼 계산됩니다." },
    ]},
    { sec: "청첩장 · 식권", items: [
      { t: "field", k: "inviteGroom", label: "청첩장 (신랑)", input: "number", unit: "매" },
      { t: "field", k: "inviteBride", label: "청첩장 (신부)", input: "number", unit: "매" },
      { t: "field", k: "inviteTotal", label: "청첩장 총 수량", input: "number", unit: "매" },
      { t: "choice", k: "ticket", label: "식 권", opts: [{ label: "기본구성" }, { label: "신랑·신부님 준비" }] },
      { t: "note", text: "체크리스트 회신 시 준비하신 식권 사진을 첨부하여 메일(sw234567@naver.com) 또는 팩스(02-878-2465)로 보내주세요." },
      { t: "note", warn: true, text: "모든 식권에 양가 발권 표시가 필요합니다. 신랑/신부 도장 또는 사인 표기 후 검수 부탁드립니다. (다른 팀과의 중복 구분을 위해 꼭 필요합니다.)" },
    ]},
    { sec: "주례 · 폐백", items: [
      { t: "choice", k: "officiant", label: "주례섭외", opts: [{ label: "외부섭외", f: true, ph: "주례자 성함" }, { label: "주례 없는 예식" }] },
      { t: "choice", k: "pastor", label: "목사님(종교식)", opts: [{ label: "예" }, { label: "아니오" }] },
      { t: "field", k: "officiantNote", label: "주례 없는 예식 준비내용", input: "text", ph: "예: 사랑의 서약, 성혼선언, 덕담 등" },
      { t: "note", text: "주례 없는 예식은 식순을 개인 준비하며, 성혼선언문·혼인서약서 내용을 자세히 기재 부탁드립니다. 식순 변동 시 예약실로 알려주세요." },
      { t: "choice", k: "pyebaek", label: "폐 백", opts: [{ label: "유" }, { label: "무" }] },
      { t: "field", k: "pyebaekFee", label: "폐백수모비", input: "text", def: "50,000원" },
      { t: "note", text: "폐백수모비는 폐백을 마친 후 수모님께 직접 지불하시면 됩니다." },
      { t: "choice", k: "pyebaekFood", label: "폐백음식", opts: [{ label: "개인준비" }, { label: "연구공원 신청", f: true, ph: "종류" }] },
      { t: "note", text: "폐백 진행을 안 할 경우 사진 촬영 유/무를 선택하세요. 사진 촬영 시 수모비가 발생합니다. (인사 후 폐백으로 진행)" },
    ]},
    { sec: "스냅 · 비디오 · 영상", items: [
      { t: "choice", k: "snap", label: "스냅", opts: [{ label: "연구공원 신청" }, { label: "외부섭외" }] },
      { t: "choice", k: "video", label: "비디오", opts: [{ label: "연구공원 신청" }, { label: "외부섭외" }] },
      { t: "field", k: "pkgVendor", label: "패키지(스·드·메) 업체", input: "text", ph: "업체명" },
      { t: "choice", k: "live", label: "실시간 영상중계", opts: [{ label: "유" }, { label: "무" }] },
      { t: "field", k: "liveGroom", label: "└ 신랑측 매수", input: "number", unit: "매" },
      { t: "field", k: "liveBride", label: "└ 신부측 매수", input: "number", unit: "매" },
      { t: "choice", k: "preVideo", label: "식전동영상", opts: [{ label: "연구공원 신청" }, { label: "개인준비" }, { label: "상영안함" }] },
      { t: "note", text: "웨딩홀 스크린 상영용 3~4분 동영상. mp4 형식으로 예식주 수요일까지 sw234567@naver.com 전송. 연구공원 제작 시 예식 2주 전 사진 30~40장 메일. (전날·당일 테스트 불가)" },
      { t: "choice", k: "midVideo", label: "식중동영상", opts: [{ label: "유" }, { label: "무" }] },
    ]},
    { sec: "축가 · 연주 · 사회", items: [
      { t: "choice", k: "song", label: "축 가", opts: [{ label: "유" }, { label: "무" }, { label: "전체 MR 진행" }] },
      { t: "field", k: "songTitles", label: "축가 곡목", input: "text", ph: "1- / 2-" },
      { t: "note", text: "반주는 MR(mp3)로 준비, 예식주 수요일까지 sw234567@naver.com 전송. 무선 마이크 최대 2개 세팅 가능. (전날·당일 테스트 불가)" },
      { t: "choice", k: "music", label: "웨딩연주", opts: [{ label: "무" }, { label: "연구공원 신청", f: true, ph: "금액/호수" }] },
      { t: "note", text: "연주가 없을 경우 기본 MR로 진행됩니다. 피아노3중주 330,000원 / 재즈4중주 440,000원 / 남성4중창+피아노 550,000원" },
      { t: "choice", k: "mc", label: "사회자 섭외", opts: [{ label: "신랑님 친구", f: true, ph: "성함" }, { label: "외부섭외", f: true, ph: "업체/성함" }] },
    ]},
    { sec: "포토테이블 · 액자 · 버스 · 예도", items: [
      { t: "choice", k: "phototable", label: "포토테이블", opts: [{ label: "연구공원 신청", f: true, ph: "호수" }, { label: "개인준비" }, { label: "무" }] },
      { t: "note", text: "예식 당일 사진 5*7 Size 준비. 포토테이블 액자 최대 10개, 대형액자 이젤 최대 2개까지 준비해 드립니다." },
      { t: "field", k: "dpFrame", label: "대형 DP액자", input: "number", unit: "개" },
      { t: "field", k: "busGroom", label: "대형버스 (신랑측)", input: "text", ph: "대수 / 출발지" },
      { t: "field", k: "busBride", label: "대형버스 (신부측)", input: "text", ph: "대수 / 출발지" },
      { t: "choice", k: "yedo", label: "예도(들러리)", opts: [{ label: "있음" }, { label: "없음" }, { label: "연구공원 신청", f: true, ph: "종류" }] },
    ]},
    { sec: "홀 · 정산", items: [
      { t: "field", k: "hallFee", label: "홀대관료", input: "text", def: "무료 (폐백실 사용료 포함 · 원삼/족두리/사모/관대 등, 한복은 개인 준비)" },
      { t: "field", k: "deposit", label: "계약금", input: "number", unit: "원" },
      { t: "choice", k: "meal", label: "식대 결제", opts: [{ label: "½씩 결제" }, { label: "신랑측 전체" }, { label: "신부측 전체" }, { label: "신랑·신부 따로" }] },
      { t: "field", k: "option", label: "선택품목(옵션)", input: "text", ph: "옵션 내용" },
      { t: "note", warn: true, text: "정산 시 카드결제는 당일 한도를 필히 확인 바랍니다 (체크카드 포함). 화촉점화 에스코트·피로연장 인사 신청 시 110,000원." },
    ]},
  ];

  const CK_FOOT =
    "* 전체 내용 체크 후 예식 14일 전까지 메일로 보내주시기 바랍니다. 1차 점검 후 연락드리겠습니다.\n" +
    "* 예식 당일 성혼선언문·DP액자·포토테이블 사진은 정산 시 관계자분께 확인 후 인계합니다.\n" +
    "* 주차 무료 (낙성대 방향 서울대 후문). 서울대 정·후문 통과 시 통행료 1,500원이 부과됩니다.\n" +
    "* 문의: 연구공원 웨딩 예약실  T. 02-878-0465";

  const WDAY = ["일", "월", "화", "수", "목", "금", "토"];
  function fmtWeddingDate(s) {
    const d = parseYmd(s);
    if (!d) return s || "";
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WDAY[d.getDay()]})`;
  }

  // 예약 데이터에서 자동으로 채울 값
  function ckAuto(key, r) {
    switch (key) {
      case "schedule": return r.wedding ? fmtWeddingDate(r.wedding) : "";
      case "place": return r.venue || CK_PLACE;
      case "groom": return r.groom || "";
      case "bride": return r.bride || "";
      default: return "";
    }
  }

  // 계약 완료(또는 예식 완료) 커플 — 예식일 순 정렬
  function contractedCouples() {
    return state.reservations.filter(isContracted)
      .slice()
      .sort((a, b) => (a.wedding || "9999").localeCompare(b.wedding || "9999"));
  }

  // 저장값 + 자동값 병합 (저장값 우선, 빈 항목만 자동/기본값으로 채움)
  function ckValues(r) {
    const vals = {};
    CHECKLIST.forEach((sec) => sec.items.forEach((it) => {
      if (it.t !== "field") return;
      if (it.auto) { const a = ckAuto(it.auto, r); if (a) vals[it.k] = a; }
      else if (it.def) vals[it.k] = it.def;
    }));
    const saved = (state.checklists[r.id] || {}).values || {};
    Object.assign(vals, saved);
    return vals;
  }

  function ckFieldHtml(it, vals) {
    const type = it.input === "number" ? "number" : "text";
    let h = `<div class="ck-item"><span class="ck-label">${escapeHtml(it.label)}</span><div class="ck-controls">`;
    h += `<input class="ck-field-input${it.input === "number" ? " ck-num" : ""}" type="${type}" data-ck="${it.k}" value="${escapeAttr(vals[it.k] || "")}" placeholder="${escapeAttr(it.ph || "")}">`;
    if (it.unit) h += `<span class="ck-unit">${escapeHtml(it.unit)}</span>`;
    if (it.extra) {
      h += `<span class="ck-unit">${escapeHtml(it.extra.label)}</span>`;
      h += `<input class="ck-fill" type="text" data-ck="${it.extra.k}" value="${escapeAttr(vals[it.extra.k] || "")}" placeholder="${escapeAttr(it.extra.ph || "")}">`;
    }
    h += `</div></div>`;
    return h;
  }

  function ckChoiceHtml(it, vals) {
    let h = `<div class="ck-item"><span class="ck-label">${escapeHtml(it.label)}</span><div class="ck-controls">`;
    it.opts.forEach((o, i) => {
      const ck = `${it.k}__${i}`;
      const on = vals[ck] ? " checked" : "";
      h += `<label class="ck-opt"><input type="checkbox" data-ck="${ck}"${on}>${escapeHtml(o.label)}`;
      if (o.f) h += `<input class="ck-fill" type="text" data-ck="${ck}_t" value="${escapeAttr(vals[ck + "_t"] || "")}" placeholder="${escapeAttr(o.ph || "")}">`;
      h += `</label>`;
    });
    h += `</div></div>`;
    return h;
  }

  function ckNoteHtml(it) {
    return `<div class="ck-note${it.warn ? " warn" : ""}">${escapeHtml(it.text)}</div>`;
  }

  function renderChecklistSheet(r) {
    const sheet = $("#checklist-sheet");
    if (!sheet) return;
    const vals = ckValues(r);
    const subParts = [
      r.name || "(무명)",
      r.wedding ? "예식일 " + fmtWeddingDate(r.wedding) : "예식일 미정",
      r.venue || CK_PLACE,
      "담당 " + (r.manager || "미지정"),
    ];
    let h = `<div class="ck-head">
        <div class="ck-title">예 식 최 종 체 크 리 스 트</div>
        <div class="ck-sub">${escapeHtml(subParts.join("  ·  "))}</div>
      </div>`;
    CHECKLIST.forEach((sec) => {
      h += `<div class="ck-section"><h4>${escapeHtml(sec.sec)}</h4>`;
      sec.items.forEach((it) => {
        if (it.t === "field") h += ckFieldHtml(it, vals);
        else if (it.t === "choice") h += ckChoiceHtml(it, vals);
        else if (it.t === "note") h += ckNoteHtml(it);
      });
      h += `</div>`;
    });
    h += `<div class="ck-foot">${escapeHtml(CK_FOOT)}</div>`;
    sheet.innerHTML = h;

    const meta = state.checklists[r.id];
    $("#checklist-saved").textContent = meta && meta.updatedAt ? `최근 저장 ${meta.updatedAt}` : "자동 저장됨";
  }

  function renderChecklist() {
    const sel = $("#checklist-couple");
    const empty = $("#checklist-empty");
    const sheet = $("#checklist-sheet");
    if (!sel) return;
    const couples = contractedCouples();
    if (couples.length === 0) {
      sel.innerHTML = `<option value="">대상 커플 없음</option>`;
      empty.hidden = false; sheet.hidden = true;
      $("#checklist-saved").textContent = "";
      return;
    }
    empty.hidden = true; sheet.hidden = false;
    if (!couples.some((c) => c.id === checklistResId)) checklistResId = couples[0].id;
    sel.innerHTML = couples.map((c) =>
      `<option value="${c.id}">${escapeHtml((c.wedding || "예식일 미정") + " · " + (c.name || "(무명)"))}</option>`).join("");
    sel.value = checklistResId;
    renderChecklistSheet(state.reservations.find((x) => x.id === checklistResId));
  }

  // 현재 시트의 모든 입력값을 수집해 저장
  function collectAndSaveChecklist() {
    if (!checklistResId) return;
    const vals = {};
    $$("#checklist-sheet [data-ck]").forEach((el) => {
      const k = el.dataset.ck;
      if (el.type === "checkbox") { if (el.checked) vals[k] = true; }
      else if (el.value !== "") vals[k] = el.value;
    });
    state.checklists[checklistResId] = { values: vals, updatedAt: ymd(nowDate()) };
    save();
    const meta = state.checklists[checklistResId];
    $("#checklist-saved").textContent = `최근 저장 ${meta.updatedAt}`;
  }

  /* ---------- 고객/상담 모달 (캘린더·고객관리 공용) ---------- */
  function fillStatusOptions() {
    $("#res-status").innerHTML = STATUS_KEYS.map((k) => `<option value="${k}">${STATUS_KO[k]}</option>`).join("");
  }
  function toggleFailReason() {
    $("#res-failreason-wrap").hidden = $("#res-status").value !== "failed";
  }
  function toggleConsult() {
    const show = $("#res-source").value === "컨설팅";
    $("#res-consult-company-wrap").hidden = !show;
    $("#res-consult-manager-wrap").hidden = !show;
    $("#res-consult-phone-wrap").hidden = !show;
  }

  // 상담 시간 슬롯 (10:00 ~ 19:30, 30분 단위)
  const TIME_SLOTS = (() => {
    const arr = [];
    for (let h = 10; h <= 19; h++) { arr.push(`${String(h).padStart(2, "0")}:00`); arr.push(`${String(h).padStart(2, "0")}:30`); }
    return arr;
  })();
  // 특정 날짜에 이미 예약된 시간 집합 (현재 편집 중인 예약은 제외)
  function bookedTimesOn(dateStr, exceptId) {
    return new Set(state.reservations.filter((r) => r.date === dateStr && r.id !== exceptId && r.time).map((r) => r.time));
  }
  // 시간 드롭다운 렌더 — 예약된 시간은 (예약됨) 표시 + 선택 불가
  function populateTimeSlots(dateStr, exceptId, selected) {
    const sel = $("#res-time");
    const booked = bookedTimesOn(dateStr, exceptId);
    const slots = TIME_SLOTS.slice();
    if (selected && !slots.includes(selected)) slots.push(selected); // 구데이터 호환
    slots.sort();
    sel.innerHTML = slots.map((t) => {
      const isBooked = booked.has(t) && t !== selected;
      return `<option value="${t}"${isBooked ? " disabled" : ""}>${t}${isBooked ? " (예약됨)" : ""}</option>`;
    }).join("");
    // 기존 선택이 유효하면 유지, 아니면 첫 가용 슬롯 선택
    sel.value = (selected && !booked.has(selected)) ? selected : (slots.find((t) => !booked.has(t)) || "");
  }

  function openReservationModal(res) {
    const modal = $("#reservation-modal");
    modal.hidden = false;
    $("#reservation-modal-title").textContent = res ? "고객 정보 수정" : "고객 등록";
    $("#res-id").value = res ? res.id : "";
    // 신랑/신부 이름 — 구버전(합쳐진 고객명)은 구분자로 분리해 채움
    let groom = res ? (res.groom || "") : "";
    let bride = res ? (res.bride || "") : "";
    if (res && !groom && !bride && res.name) {
      const parts = String(res.name).split(/\s*[·,/&]\s*/);
      groom = parts[0] || ""; bride = parts[1] || "";
    }
    $("#res-groom").value = groom;
    $("#res-bride").value = bride;
    $("#res-phone").value = res ? (res.phone || "") : "";
    $("#res-phone2").value = res ? (res.phone2 || "") : "";
    $("#res-source").value = res ? (res.source || "") : "";
    $("#res-manager").value = res ? (res.manager || "") : "";
    $("#res-consult-company").value = res ? (res.consultCompany || "") : "";
    $("#res-consult-manager").value = res ? (res.consultManager || "") : "";
    $("#res-consult-phone").value = res ? (res.consultPhone || "") : "";
    $("#res-date").value = res ? (res.date || "") : (selectedDate || ymd(nowDate()));
    populateTimeSlots($("#res-date").value, res ? res.id : "", res ? (res.time || "") : "");
    $("#res-kind").value = res ? (res.kind || "상담") : "상담";
    $("#res-next").value = res ? (res.next || "") : "";
    $("#res-wedding").value = res ? (res.wedding || "") : "";
    $("#res-venue").value = res ? (res.venue || "") : "";
    $("#res-region").value = res ? (res.region || "") : "";
    $("#res-guests").value = res ? (res.guests || "") : "";
    $("#res-status").value = res ? normStatus(res.status) : "new";
    $("#res-failreason").value = res ? (res.failReason || "") : "";
    $("#res-memo").value = res ? (res.memo || "") : "";
    $("#btn-res-delete").hidden = !res;
    toggleFailReason();
    toggleConsult();
  }
  function closeReservationModal() { $("#reservation-modal").hidden = true; }

  function saveReservation(e) {
    e.preventDefault();
    const id = $("#res-id").value;
    const groom = $("#res-groom").value.trim();
    const bride = $("#res-bride").value.trim();
    if (!groom && !bride) { toast("신랑 또는 신부 이름을 입력하세요."); return; }
    // 같은 날짜·시간에 이미 예약이 있으면 저장 차단
    if (bookedTimesOn($("#res-date").value, id).has($("#res-time").value)) {
      toast("이미 예약된 시간입니다. 다른 시간을 선택하세요."); return;
    }
    const data = {
      groom, bride,
      name: [groom, bride].filter(Boolean).join(" · "),
      phone: $("#res-phone").value.trim(), phone2: $("#res-phone2").value.trim(),
      source: $("#res-source").value, manager: $("#res-manager").value.trim(),
      consultCompany: $("#res-source").value === "컨설팅" ? $("#res-consult-company").value.trim() : "",
      consultManager: $("#res-source").value === "컨설팅" ? $("#res-consult-manager").value.trim() : "",
      consultPhone: $("#res-source").value === "컨설팅" ? $("#res-consult-phone").value.trim() : "",
      date: $("#res-date").value, time: $("#res-time").value, kind: $("#res-kind").value,
      next: $("#res-next").value, wedding: $("#res-wedding").value,
      venue: $("#res-venue").value.trim(), region: $("#res-region").value.trim(),
      guests: Number($("#res-guests").value) || 0,
      status: $("#res-status").value,
      failReason: $("#res-status").value === "failed" ? $("#res-failreason").value : "",
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
    renderCalendar(); renderDayList(); renderContract(); renderCustomers(); renderHome();
    renderWeddingCalendar(); renderWeddingDayList(); renderChecklist();
    closeReservationModal();
    toast("고객 정보를 저장했습니다.");
  }

  function deleteReservation() {
    const id = $("#res-id").value;
    if (!confirm("이 고객 정보를 삭제할까요?")) return;
    state.reservations = state.reservations.filter((x) => x.id !== id);
    delete state.checklists[id];
    save(); renderCalendar(); renderDayList(); renderContract(); renderCustomers();
    renderHome(); renderWeddingCalendar(); renderWeddingDayList(); renderChecklist();
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
      고객명: r.name, 신랑이름: r.groom || "", 신부이름: r.bride || "",
      신랑연락처: r.phone, 신부연락처: r.phone2 || "",
      유입경로: r.source || "", 컨설팅회사: r.consultCompany || "", 컨설팅담당자: r.consultManager || "", 컨설팅연락처: r.consultPhone || "",
      담당자: r.manager || "", 상담일: r.date, 상담시간: r.time, 구분: r.kind,
      다음연락일: r.next || "", 예식예정일: r.wedding || "", 예식장: r.venue || "", 지역: r.region || "",
      하객수: r.guests || 0, 진행상태: STATUS_KO[normStatus(r.status)], 미체결사유: r.failReason || "",
      메모: r.memo || "",
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
        state.reservations = rRows.map((r) => {
          const g = String(r["신랑이름"] || ""), b = String(r["신부이름"] || "");
          const combined = [g, b].filter(Boolean).join(" · ");
          return {
          id: uid(),
          groom: g, bride: b,
          name: String(r["고객명"] || r["이름"] || combined),
          phone: String(r["신랑연락처"] || r["연락처"] || ""), phone2: String(r["신부연락처"] || ""),
          email: String(r["이메일"] || ""), source: String(r["유입경로"] || ""),
          consultCompany: String(r["컨설팅회사"] || ""), consultManager: String(r["컨설팅담당자"] || ""), consultPhone: String(r["컨설팅연락처"] || ""),
          manager: String(r["담당자"] || ""),
          date: String(r["상담일"] || r["날짜"] || ""), time: String(r["상담시간"] || r["시간"] || ""),
          kind: String(r["구분"] || "상담"), next: String(r["다음연락일"] || ""),
          wedding: String(r["예식예정일"] || ""), venue: String(r["예식장"] || ""), region: String(r["지역"] || ""),
          guests: Number(r["하객수"] || 0),
          status: STATUS_FROM_KO[String(r["진행상태"] || r["계약상태"] || "").trim()] || normStatus(r["진행상태"]),
          failReason: String(r["미체결사유"] || ""),
          budget: Number(r["예산(원)"] || 0), amount: Number(r["계약금액(원)"] || 0),
          memo: String(r["메모"] || ""),
          };
        });
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

  /* ---------- 렌더 총괄 ---------- */
  function renderAll() {
    renderHome();
    renderContract();
    renderCustomers();
    renderDashboard();
    drawContentCard();
    renderContentHistory();
    renderCalendar();
    renderDayList();
    renderWeddingCalendar();
    renderWeddingDayList();
    renderChecklist();
    renderNotifyHistory();
    renderNotifyOptions();
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
    // 홈 화면의 바로가기 버튼 (data-goto)
    $$("[data-goto]").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.goto)));
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

    // 예식 캘린더
    initWeddingCal(nowDate());
    $("#wed-prev").addEventListener("click", () => { wedMonth--; if (wedMonth < 0) { wedMonth = 11; wedYear--; } renderWeddingCalendar(); });
    $("#wed-next").addEventListener("click", () => { wedMonth++; if (wedMonth > 11) { wedMonth = 0; wedYear++; } renderWeddingCalendar(); });
    $("#wed-today").addEventListener("click", () => { initWeddingCal(nowDate()); wedSelected = ymd(nowDate()); renderWeddingCalendar(); renderWeddingDayList(); });
    // 예식 체크리스트
    $("#checklist-couple").addEventListener("change", (e) => {
      checklistResId = e.target.value;
      renderChecklistSheet(state.reservations.find((x) => x.id === checklistResId));
    });
    $("#checklist-sheet").addEventListener("input", collectAndSaveChecklist);
    $("#checklist-sheet").addEventListener("change", collectAndSaveChecklist);
    $("#btn-checklist-print").addEventListener("click", () => window.print());

    $("#reservation-form").addEventListener("submit", saveReservation);
    $("#res-status").addEventListener("change", toggleFailReason);
    $("#res-source").addEventListener("change", toggleConsult);
    // 날짜 변경 시 예약된 시간 슬롯을 다시 계산해 표시
    $("#res-date").addEventListener("change", () => {
      populateTimeSlots($("#res-date").value, $("#res-id").value, $("#res-time").value);
    });
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
        state.metrics = []; state.reservations = []; state.contents = []; state.notifyLogs = []; state.checklists = {};
        save(); renderAll(); toast("데이터를 초기화했습니다.");
      }
    });

    renderAll();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
