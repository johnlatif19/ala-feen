(() => {
  "use strict";

  const API = {
    me:           "/api/auth/me",
    logout:       "/api/auth/logout",
    stats:        "/api/dashboard/stats",
    routes:       "/api/routes",
    stations:     "/api/stations",
    transport:    "/api/transport-types",
    fares:        "/api/fares",
    complaints:   "/api/complaints",
    suggestions:  "/api/suggestions",
    users:        "/api/users",
    reports:      "/api/reports",
    governorates: "/api/governorates",
    cities:       "/api/cities",
    areas:        "/api/areas",
    logs:         "/api/admin-logs",
    search:       "/api/search",
    sync:         "/api/sync/metadata",
  };

  const THEME_KEY = "alafeen.theme";
  const CACHE_PREFIX = "alafeen.cache.";
  const QUEUE_KEY = "alafeen.queue";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    admin: null,
    route: "overview",
    online: navigator.onLine,
    lastSync: Date.now(),
    queueCount: 0,
  };

  const escapeHtml = (value) => {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  const fmtNumber = (n) =>
    new Intl.NumberFormat("ar-EG").format(Number(n) || 0);

  const fmtDate = (value) => {
    if (!value) return "-";
    const d = value.toDate ? value.toDate() : new Date(value);
    if (Number.isNaN(d.getTime())) return "-";
    return new Intl.DateTimeFormat("ar-EG", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  };

  const fmtTimeAgo = (ms) => {
    const diff = Math.max(0, Date.now() - ms);
    const sec = Math.round(diff / 1000);
    if (sec < 60) return "الآن";
    const min = Math.round(sec / 60);
    if (min < 60) return `منذ ${min} دقيقة`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `منذ ${hr} ساعة`;
    const day = Math.round(hr / 24);
    return `منذ ${day} يوم`;
  };

  const debounce = (fn, ms = 250) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  const getCsrfToken = () => {
    const match = document.cookie.match(/(?:^|;\s*)alafeen_csrf=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  };

  const cacheSet = (key, data) => {
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data }));
    } catch (_) {}
  };

  const cacheGet = (key) => {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.data !== undefined ? parsed.data : null;
    } catch (_) { return null; }
  };

  const queueAdd = (item) => {
    try {
      const list = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
      list.push({ ...item, at: Date.now() });
      localStorage.setItem(QUEUE_KEY, JSON.stringify(list));
      state.queueCount = list.length;
    } catch (_) {}
  };

  const queueList = () => {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
    catch (_) { return []; }
  };

  const queueClear = () => {
    try {
      localStorage.removeItem(QUEUE_KEY);
      state.queueCount = 0;
    } catch (_) {}
  };

  const apiRequest = async (path, options = {}) => {
    const method = options.method || "GET";
    const csrf = getCsrfToken();

    const headers = {
      "Content-Type": "application/json",
      ...(csrf && !["GET", "HEAD", "OPTIONS"].includes(method)
        ? { "x-csrf-token": csrf }
        : {}),
      ...(options.headers || {}),
    };

    const opts = {
      method,
      headers,
      credentials: "same-origin",
      body: options.body ? JSON.stringify(options.body) : undefined,
    };

    if (!navigator.onLine && method === "GET") {
      const cached = cacheGet(path);
      if (cached) return { ok: true, offline: true, data: cached };
      throw new Error("offline");
    }

    if (!navigator.onLine && method !== "GET") {
      queueAdd({ path, method, headers, body: options.body });
      return { ok: true, queued: true, data: null };
    }

    const res = await fetch(path, opts);

    if (res.status === 401) {
      window.location.replace("/login");
      throw new Error("unauthorized");
    }

    if (res.status === 403 && !["GET", "HEAD", "OPTIONS"].includes(method)) {
      window.location.replace("/login");
      throw new Error("csrf");
    }

    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }

    if (!res.ok) {
      const message = (data && (data.message || data.error)) || `فشل الطلب (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      err.payload = data;
      throw err;
    }

    if (method === "GET") cacheSet(path, data);

    return { ok: true, data };
  };

  const flushQueue = async () => {
    const items = queueList();
    if (!items.length) return;
    queueClear();

    for (const item of items) {
      try {
        await fetch(item.path, {
          method: item.method || "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": getCsrfToken(),
            ...(item.headers || {}),
          },
          credentials: "same-origin",
          body: item.body ? JSON.stringify(item.body) : undefined,
        });
      } catch (_) {
        queueAdd(item);
      }
    }
  };

  const toast = (message, tone = "info") => {
    const wrap = $("#toasts");
    if (!wrap) return;
    const el = document.createElement("div");
    el.className = `toast toast--${tone}`;
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateY(6px)";
      setTimeout(() => el.remove(), 220);
    }, 3200);
  };

  const openModal = ({ title, body, footer, large = false }) => {
    const modal = $("#modal");
    $("#modalTitle").textContent = title || "";
    $("#modalBody").innerHTML = body || "";
    $("#modalFoot").innerHTML = footer || "";
    const panel = $(".modal__panel", modal);
    panel.classList.toggle("modal__panel--lg", !!large);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  };

  const closeModal = () => {
    const modal = $("#modal");
    modal.hidden = true;
    $("#modalBody").innerHTML = "";
    $("#modalFoot").innerHTML = "";
    document.body.style.overflow = "";
  };

  document.addEventListener("click", (e) => {
    const closer = e.target.closest("[data-close]");
    if (!closer) return;
    if (closer.dataset.close === "modal") closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#modal").hidden) closeModal();
  });

  const applyTheme = (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    const toggle = $("#themeToggle");
    if (toggle) {
      const isDark = theme === "dark";
      toggle.setAttribute("aria-pressed", String(isDark));
      toggle.querySelector(".icon-btn__label").textContent = isDark ? "Light" : "Dark";
    }
  };

  const initTheme = () => {
    const stored = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = stored || (prefersDark ? "dark" : "light");
    applyTheme(theme);

    const toggle = $("#themeToggle");
    if (!toggle) return;
    toggle.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark"
        ? "light" : "dark";
      applyTheme(next);
      localStorage.setItem(THEME_KEY, next);
    });
  };

  const setOnline = (online) => {
    state.online = online;
    const indicator = $("#connIndicator");
    const banner = $("#offlineBanner");
    if (indicator) {
      indicator.dataset.state = online ? "online" : "offline";
      $(".conn__label", indicator).textContent = online ? "متصل" : "غير متصل";
    }
    if (banner) banner.hidden = online;
    if (online) flushQueue();
  };

  const setSyncTime = (ts = Date.now()) => {
    state.lastSync = ts;
    const el = $("#syncTime");
    if (el) el.textContent = fmtTimeAgo(ts);
  };

  const setBadge = (count) => {
    const badge = document.querySelector('[data-badge="complaints"]');
    if (!badge) return;
    if (count > 0) { badge.hidden = false; badge.textContent = String(count); }
    else badge.hidden = true;
  };

  const setActiveNav = (route) => {
    $$(".nav-item").forEach((el) => {
      const active = el.dataset.route === route;
      if (active) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });
  };

  const navigate = (route) => {
    state.route = route;
    setActiveNav(route);
    closeSidebar();
    render(route);
    history.replaceState(null, "", `#${route}`);
  };

  const openSidebar = () => {
    const sb = $("#sidebar");
    sb.dataset.open = "true";
    $("#menuToggle").setAttribute("aria-expanded", "true");
  };

  const closeSidebar = () => {
    const sb = $("#sidebar");
    sb.dataset.open = "false";
    $("#menuToggle").setAttribute("aria-expanded", "false");
  };

  const statusBadge = (status) => {
    const map = {
      new: "جديد", reviewing: "قيد المراجعة", verified: "مؤكد",
      rejected: "مرفوض", resolved: "تم الحل",
    };
    return `<span class="badge badge--${status}">${map[status] || status}</span>`;
  };

  const priorityBadge = (p) => {
    const map = { low: "منخفضة", medium: "متوسطة", high: "عالية", critical: "حرجة" };
    return `<span class="badge badge--p-${p}">${map[p] || p}</span>`;
  };

  const activeBadge = (active) =>
    active
      ? `<span class="badge badge--active">مفعّل</span>`
      : `<span class="badge badge--inactive">معطّل</span>`;

  const pageHead = ({ title, desc, actions = "" }) => `
    <div class="page__head">
      <div>
        <h1 class="page__title">${escapeHtml(title)}</h1>
        ${desc ? `<p class="page__desc">${escapeHtml(desc)}</p>` : ""}
      </div>
      ${actions ? `<div class="page__actions">${actions}</div>` : ""}
    </div>
  `;

  const emptyState = (msg) => `<div class="empty">${escapeHtml(msg)}</div>`;

  const skeletonCards = (n) =>
    Array.from({ length: n }).map(() =>
      `<div class="card"><div class="skeleton" style="width:60%"></div><div class="skeleton" style="width:40%;margin-top:10px;height:22px"></div></div>`
    ).join("");

  const chartInstances = {};

  const destroyChart = (id) => {
    if (chartInstances[id]) {
      chartInstances[id].destroy();
      delete chartInstances[id];
    }
  };

  /* =========================================================
     OVERVIEW
     ========================================================= */

  const renderStatusChart = (stats) => {
    const canvas = document.getElementById("chartStatus");
    if (!canvas || typeof Chart === "undefined") return;
    destroyChart("status");
    const ctx = canvas.getContext("2d");
    chartInstances.status = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["جديدة", "مراجعة", "مؤكدة", "مرفوضة", "محلولة"],
        datasets: [{
          data: [
            stats.newComplaints || 0,
            stats.reviewingComplaints || 0,
            stats.verifiedComplaints || 0,
            stats.rejectedComplaints || 0,
            stats.resolvedComplaints || 0,
          ],
          backgroundColor: ["#1E6BFF", "#F7B731", "#10B981", "#DC2626", "#0D2B4C"],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: { font: { family: "Cairo" }, boxWidth: 12, padding: 12 },
          },
        },
      },
    });
  };

  const renderTrendChart = (stats) => {
    const canvas = document.getElementById("chartTrend");
    if (!canvas || typeof Chart === "undefined") return;
    destroyChart("trend");
    const series = Array.isArray(stats.trend7d) ? stats.trend7d : [];
    const ctx = canvas.getContext("2d");
    chartInstances.trend = new Chart(ctx, {
      type: "bar",
      data: {
        labels: series.map((d) => d.label),
        datasets: [{
          label: "بلاغات",
          data: series.map((d) => d.count || 0),
          backgroundColor: "#1E6BFF",
          borderRadius: 6,
          maxBarThickness: 40,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0, font: { family: "Inter" } } },
          x: { ticks: { font: { family: "Cairo" } } },
        },
      },
    });
  };

  let overviewMap = null;
  const initOverviewMap = (stats) => {
    const el = $("#overviewMap");
    if (!el || typeof L === "undefined") return;
    if (overviewMap) { overviewMap.remove(); overviewMap = null; }
    overviewMap = L.map(el, { zoomControl: true }).setView([26.8206, 30.8025], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(overviewMap);

    const points = Array.isArray(stats && stats.mapPoints) ? stats.mapPoints : [];
    points.forEach((p) => {
      if (typeof p.lat !== "number" || typeof p.lng !== "number") return;
      L.circleMarker([p.lat, p.lng], {
        radius: 6, color: "#1E6BFF", fillColor: "#1E6BFF", fillOpacity: 0.5, weight: 2,
      }).addTo(overviewMap).bindPopup(escapeHtml(p.title || "بلاغ"));
    });
  };

  const renderOverview = async () => {
    const content = $("#content");
    content.innerHTML = pageHead({
      title: "الرئيسية",
      desc: "نظرة عامة على حالة المنصة",
    }) + `<div class="cards" id="overviewCards">${skeletonCards(9)}</div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel__head"><h2 class="panel__title">الشكاوى حسب الحالة</h2></div>
          <div class="panel__body"><div class="chart-box"><canvas id="chartStatus"></canvas></div></div>
        </div>
        <div class="panel">
          <div class="panel__head"><h2 class="panel__title">آخر 7 أيام</h2></div>
          <div class="panel__body"><div class="chart-box"><canvas id="chartTrend"></canvas></div></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel__head"><h2 class="panel__title">خريطة البلاغات</h2></div>
        <div class="panel__body"><div class="map-box" id="overviewMap"></div></div>
      </div>
      <div class="panel">
        <div class="panel__head"><h2 class="panel__title">آخر الشكاوى والاقتراحات</h2></div>
        <div class="panel__body" id="recentComplaints"></div>
      </div>`;

    let stats = null;
    try {
      const res = await apiRequest(API.stats);
      stats = res.data;
    } catch (_) {
      stats = cacheGet(API.stats);
    }
    if (!stats) stats = {};

    const cards = [
      ["إجمالي المستخدمين", stats.totalUsers, "accent-blue"],
      ["المستخدمون النشطون", stats.activeUsers, "accent-green"],
      ["شكاوى جديدة", stats.newComplaints, "accent-red"],
      ["قيد المراجعة", stats.reviewingComplaints, "accent-yellow"],
      ["تم حلها", stats.resolvedComplaints, "accent-green"],
      ["خطوط المواصلات", stats.totalRoutes, "accent-blue"],
      ["المحطات والمواقف", stats.totalStations, "accent-blue"],
      ["وسائل النقل", stats.totalTransportTypes, "accent-blue"],
      ["آخر تحديث", stats.lastUpdated ? fmtDate(stats.lastUpdated) : "-", "accent-yellow"],
    ];

    const container = $("#overviewCards");
    if (container) {
      container.innerHTML = cards.map(([label, value, accent]) => `
        <div class="card card--${accent}">
          <div class="card__label">${escapeHtml(label)}</div>
          <div class="card__value">${typeof value === "number" ? fmtNumber(value) : escapeHtml(value ?? "-")}</div>
        </div>
      `).join("");
    }

    renderStatusChart(stats);
    renderTrendChart(stats);

    try {
      const res = await apiRequest(API.complaints + "?limit=8&sort=createdAt:desc");
      const items = (res.data && (res.data.items || res.data)) || [];
      const box = $("#recentComplaints");
      if (!box) return;
      if (!items.length) { box.innerHTML = emptyState("لا توجد بلاغات حديثة"); return; }
      box.innerHTML = `
        <div class="table-wrap">
          <table class="table">
            <thead><tr>
              <th>النوع</th><th>العنوان</th><th>الحالة</th><th>الأولوية</th><th>التاريخ</th>
            </tr></thead>
            <tbody>
              ${items.map((it) => `
                <tr data-id="${escapeHtml(it.id)}" data-kind="complaint">
                  <td>${escapeHtml(it.type || "-")}</td>
                  <td class="col-wrap">${escapeHtml(it.title || "-")}</td>
                  <td>${statusBadge(it.status || "new")}</td>
                  <td>${priorityBadge(it.priority || "low")}</td>
                  <td>${fmtDate(it.createdAt)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>`;
      $$("#recentComplaints tbody tr").forEach((tr) => {
        tr.style.cursor = "pointer";
        tr.addEventListener("click", () => navigate("complaints"));
      });
    } catch (_) {
      const box = $("#recentComplaints");
      if (box) box.innerHTML = emptyState("تعذر تحميل الشكاوى");
    }

    initOverviewMap(stats);
  };

  /* =========================================================
     COMPLAINTS
     ========================================================= */

  const openComplaint = async (id) => {
    openModal({
      title: "تفاصيل البلاغ",
      large: true,
      body: `<div style="padding:12px"><div class="skeleton" style="width:60%"></div><div class="skeleton" style="width:40%;margin-top:10px"></div></div>`,
    });

    try {
      const res = await apiRequest(`${API.complaints}/${encodeURIComponent(id)}`);
      const c = res.data && res.data.item ? res.data.item : (res.data || {});
      const images = Array.isArray(c.images) ? c.images : [];

      const body = `
        <dl class="kv">
          <dt>النوع</dt><dd>${escapeHtml(c.type || "-")}</dd>
          <dt>العنوان</dt><dd>${escapeHtml(c.title || "-")}</dd>
          <dt>الوصف</dt><dd>${escapeHtml(c.description || "-")}</dd>
          <dt>الموقع</dt><dd>${escapeHtml(c.location || "-")}</dd>
          <dt>وسيلة النقل</dt><dd>${escapeHtml(c.transportType || "-")}</dd>
          <dt>الحالة</dt><dd>${statusBadge(c.status || "new")}</dd>
          <dt>الأولوية</dt><dd>${priorityBadge(c.priority || "low")}</dd>
          <dt>التأكيدات</dt><dd>${fmtNumber(c.confirmations || 0)}</dd>
          <dt>مؤكد</dt><dd>${c.verified ? "نعم" : "لا"}</dd>
          <dt>تاريخ الإنشاء</dt><dd>${fmtDate(c.createdAt)}</dd>
          <dt>آخر تحديث</dt><dd>${fmtDate(c.updatedAt)}</dd>
          <dt>ملاحظة الإدارة</dt><dd>${escapeHtml(c.adminNote || "-")}</dd>
          <dt>سبب الحذف</dt><dd>${escapeHtml(c.deleteReason || "-")}</dd>
        </dl>
        ${images.length ? `
          <div style="margin-top:16px">
            <div class="card__label" style="margin-bottom:8px">الصور</div>
            <div class="images-grid">
              ${images.map((img) => {
                const url = typeof img === "string" ? img : (img.secure_url || img.url || "");
                return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="" /></a>`;
              }).join("")}
            </div>
          </div>` : ""}
        ${typeof c.latitude === "number" && typeof c.longitude === "number" ? `
          <div style="margin-top:16px">
            <div class="card__label" style="margin-bottom:8px">الموقع على الخريطة</div>
            <div class="map-box" id="complaintMap" style="height:260px"></div>
          </div>` : ""}
      `;

      const footer = `
        <button class="btn btn--ghost" data-action="status" data-value="reviewing">قيد المراجعة</button>
        <button class="btn btn--ghost" data-action="status" data-value="verified">تأكيد</button>
        <button class="btn btn--danger" data-action="spam">حذف نهائي</button>
        <button class="btn btn--primary" data-action="status" data-value="resolved">حل</button>
      `;

      $("#modalTitle").textContent = "تفاصيل البلاغ";
      $("#modalBody").innerHTML = body;
      $("#modalFoot").innerHTML = footer;

      if ($("#complaintMap") && typeof L !== "undefined") {
        const m = L.map("complaintMap").setView([c.latitude, c.longitude], 14);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap",
        }).addTo(m);
        L.marker([c.latitude, c.longitude]).addTo(m);
        setTimeout(() => m.invalidateSize(), 200);
      }

      $$("#modalFoot [data-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const action = btn.dataset.action;
          if (action === "status") {
            const value = btn.dataset.value;
            try {
              await apiRequest(`${API.complaints}/${encodeURIComponent(id)}`, {
                method: "PUT",
                body: { status: value },
              });
              toast("تم تحديث حالة البلاغ", "success");
              closeModal();
              renderComplaints();
            } catch (err) {
              toast(err.message || "تعذر التحديث", "error");
            }
          } else if (action === "spam") {
            openSpamConfirm(id);
          }
        });
      });
    } catch (err) {
      $("#modalBody").innerHTML = emptyState("تعذر تحميل التفاصيل");
    }
  };

  const openSpamConfirm = (id) => {
    const currentBody = $("#modalBody").innerHTML;
    openModal({
      title: "حذف البلاغ كـSpam",
      body: `
        <p style="margin-top:0">سيتم تعطيل البلاغ ولن يظهر في القوائم. السبب إلزامي ويسجّل في سجل العمليات.</p>
        <div class="form__group">
          <label class="form__label">سبب الحذف</label>
          <textarea class="form__textarea" id="spamReason" placeholder="مثال: بلاغ مكرر، محتوى مسيء، بيانات وهمية..."></textarea>
          <p class="form__error" id="spamError"></p>
        </div>
      `,
      footer: `
        <button class="btn btn--ghost" id="spamCancel">رجوع</button>
        <button class="btn btn--danger" id="spamConfirm">تأكيد الحذف</button>
      `,
    });

    $("#spamCancel").addEventListener("click", () => {
      $("#modalBody").innerHTML = currentBody;
      $("#modalFoot").innerHTML = `
        <button class="btn btn--ghost" data-action="status" data-value="reviewing">قيد المراجعة</button>
        <button class="btn btn--ghost" data-action="status" data-value="verified">تأكيد</button>
        <button class="btn btn--danger" data-action="spam">حذف نهائي</button>
        <button class="btn btn--primary" data-action="status" data-value="resolved">حل</button>
      `;
      closeModal();
      openComplaint(id);
    });

    $("#spamConfirm").addEventListener("click", async () => {
      const reason = $("#spamReason").value.trim();
      if (!reason) {
        $("#spamError").textContent = "السبب مطلوب";
        $("#spamError").dataset.visible = "true";
        return;
      }
      try {
        await apiRequest(`${API.complaints}/${encodeURIComponent(id)}`, {
          method: "DELETE",
          body: { reason },
        });
        toast("تم حذف البلاغ كـSpam", "success");
        closeModal();
        renderComplaints();
      } catch (err) {
        toast(err.message || "تعذر الحذف", "error");
      }
    });
  };

  const renderComplaints = async () => {
    const content = $("#content");
    content.innerHTML = pageHead({
      title: "الشكاوى والاقتراحات",
      desc: "إدارة بلاغات المستخدمين ومتابعتها",
      actions: `<button class="btn btn--ghost" id="refreshComplaints">تحديث</button>`,
    }) + `
      <div class="filters">
        <input class="filters__input" id="cSearch" placeholder="بحث بالعنوان أو الوصف..." />
        <select class="filters__select" id="cStatus">
          <option value="">كل الحالات</option>
          <option value="new">جديدة</option>
          <option value="reviewing">قيد المراجعة</option>
          <option value="verified">مؤكدة</option>
          <option value="rejected">مرفوضة</option>
          <option value="resolved">محلولة</option>
        </select>
        <select class="filters__select" id="cPriority">
          <option value="">كل الأولويات</option>
          <option value="low">منخفضة</option>
          <option value="medium">متوسطة</option>
          <option value="high">عالية</option>
          <option value="critical">حرجة</option>
        </select>
      </div>
      <div class="panel"><div id="complaintsList">${emptyState("جاري التحميل...")}</div></div>`;

    const load = async () => {
      const box = $("#complaintsList");
      if (!box) return;
      box.innerHTML = `<div style="padding:24px"><div class="skeleton" style="width:70%"></div><div class="skeleton" style="width:50%;margin-top:10px"></div></div>`;

      const params = new URLSearchParams();
      const s = $("#cSearch").value.trim();
      const st = $("#cStatus").value;
      const pr = $("#cPriority").value;
      if (s) params.set("q", s);
      if (st) params.set("status", st);
      if (pr) params.set("priority", pr);
      params.set("limit", "50");

      try {
        const res = await apiRequest(`${API.complaints}?${params.toString()}`);
        const items = (res.data && (res.data.items || res.data)) || [];
        if (!items.length) { box.innerHTML = emptyState("لا توجد بلاغات مطابقة"); return; }

        box.innerHTML = `
          <div class="table-wrap">
            <table class="table">
              <thead><tr>
                <th>النوع</th><th>العنوان</th><th>الحالة</th><th>الأولوية</th>
                <th>التأكيدات</th><th>الموقع</th><th>التاريخ</th><th></th>
              </tr></thead>
              <tbody>
                ${items.map((it) => `
                  <tr>
                    <td>${escapeHtml(it.type || "-")}</td>
                    <td class="col-wrap">${escapeHtml(it.title || "-")}</td>
                    <td>${statusBadge(it.status || "new")}</td>
                    <td>${priorityBadge(it.priority || "low")}</td>
                    <td>${fmtNumber(it.confirmations || 0)}</td>
                    <td>${escapeHtml(it.location || "-")}</td>
                    <td>${fmtDate(it.createdAt)}</td>
                    <td>
                      <button class="btn btn--ghost btn--sm" data-open="${escapeHtml(it.id)}">فتح</button>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>`;

        $$("[data-open]", box).forEach((btn) => {
          btn.addEventListener("click", () => openComplaint(btn.dataset.open));
        });
      } catch (_) {
        box.innerHTML = emptyState("تعذر تحميل الشكاوى");
      }
    };

    $("#refreshComplaints").addEventListener("click", load);
    $("#cSearch").addEventListener("input", debounce(load, 300));
    $("#cStatus").addEventListener("change", load);
    $("#cPriority").addEventListener("change", load);

    load();
  };

  /* =========================================================
     ROUTES
     ========================================================= */

  const renderRoutes = async () => {
    const content = $("#content");
    content.innerHTML = pageHead({
      title: "خطوط المواصلات",
      desc: "إدارة خطوط المترو والأتوبيس والميكروباص والقطار",
      actions: `<button class="btn btn--primary" id="addRoute">إضافة خط</button>`,
    }) + `
      <div class="filters">
        <input class="filters__input" id="rSearch" placeholder="بحث بالاسم أو نقطة البداية..." />
      </div>
      <div class="panel"><div id="routesList">${emptyState("جاري التحميل...")}</div></div>`;

    const load = async () => {
      const box = $("#routesList");
      const q = $("#rSearch").value.trim();
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      try {
        const res = await apiRequest(`${API.routes}?${params.toString()}`);
        const items = (res.data && (res.data.items || res.data)) || [];
        if (!items.length) { box.innerHTML = emptyState("لا توجد خطوط"); return; }
        box.innerHTML = `
          <div class="table-wrap">
            <table class="table">
              <thead><tr>
                <th>الاسم</th><th>الوسيلة</th><th>من</th><th>إلى</th>
                <th>المدة</th><th>السعر</th><th>الحالة</th><th></th>
              </tr></thead>
              <tbody>
                ${items.map((r) => `
                  <tr>
                    <td>${escapeHtml(r.name || "-")}</td>
                    <td>${escapeHtml(r.transportType || "-")}</td>
                    <td>${escapeHtml(r.startPoint || "-")}</td>
                    <td>${escapeHtml(r.endPoint || "-")}</td>
                    <td>${r.estimatedDuration ? escapeHtml(String(r.estimatedDuration)) + " د" : "-"}</td>
                    <td>${r.price != null ? escapeHtml(String(r.price)) + " ج.م" : "-"}</td>
                    <td>${activeBadge(!!r.active)}</td>
                    <td>
                      <button class="btn btn--ghost btn--sm" data-edit="${escapeHtml(r.id)}">تعديل</button>
                      <button class="btn btn--ghost btn--sm" data-toggle="${escapeHtml(r.id)}">${r.active ? "تعطيل" : "تفعيل"}</button>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>`;

        $$("[data-edit]", box).forEach((b) =>
          b.addEventListener("click", () => openRouteForm(items.find((x) => x.id === b.dataset.edit))));
        $$("[data-toggle]", box).forEach((b) =>
          b.addEventListener("click", async () => {
            const item = items.find((x) => x.id === b.dataset.toggle);
            try {
              await apiRequest(`${API.routes}/${encodeURIComponent(item.id)}`, {
                method: "PUT", body: { active: !item.active },
              });
              toast("تم التحديث", "success");
              load();
            } catch (err) { toast(err.message, "error"); }
          }));
      } catch (_) {
        box.innerHTML = emptyState("تعذر تحميل الخطوط");
      }
    };

    const openRouteForm = (item) => {
      const isEdit = !!item;
      const r = item || { name: "", transportType: "", startPoint: "", endPoint: "", estimatedDuration: "", price: "", active: true };
      openModal({
        title: isEdit ? "تعديل خط" : "إضافة خط",
        body: `
          <div class="form-grid">
            <div class="form__group form__group--full">
              <label class="form__label">الاسم</label>
              <input class="form__input" id="fName" value="${escapeHtml(r.name)}" />
            </div>
            <div class="form__group">
              <label class="form__label">وسيلة النقل</label>
              <input class="form__input" id="fTransport" value="${escapeHtml(r.transportType)}" />
            </div>
            <div class="form__group">
              <label class="form__label">المدة (دقائق)</label>
              <input class="form__input" id="fDuration" type="number" value="${escapeHtml(r.estimatedDuration)}" />
            </div>
            <div class="form__group">
              <label class="form__label">من</label>
              <input class="form__input" id="fStart" value="${escapeHtml(r.startPoint)}" />
            </div>
            <div class="form__group">
              <label class="form__label">إلى</label>
              <input class="form__input" id="fEnd" value="${escapeHtml(r.endPoint)}" />
            </div>
            <div class="form__group">
              <label class="form__label">السعر (ج.م)</label>
              <input class="form__input" id="fPrice" type="number" step="0.5" value="${escapeHtml(r.price)}" />
            </div>
            <div class="form__group">
              <label class="form__label">الحالة</label>
              <select class="form__select" id="fActive">
                <option value="true"${r.active ? " selected" : ""}>مفعّل</option>
                <option value="false"${!r.active ? " selected" : ""}>معطّل</option>
              </select>
            </div>
          </div>`,
        footer: `
          <button class="btn btn--ghost" data-close="modal">إلغاء</button>
          <button class="btn btn--primary" id="saveRoute">حفظ</button>`,
      });

      $("#saveRoute").addEventListener("click", async () => {
        const payload = {
          name: $("#fName").value.trim(),
          transportType: $("#fTransport").value.trim(),
          startPoint: $("#fStart").value.trim(),
          endPoint: $("#fEnd").value.trim(),
          estimatedDuration: Number($("#fDuration").value) || 0,
          price: Number($("#fPrice").value) || 0,
          active: $("#fActive").value === "true",
        };
        if (!payload.name) { toast("الاسم مطلوب", "warn"); return; }
        try {
          if (isEdit) {
            await apiRequest(`${API.routes}/${encodeURIComponent(r.id)}`, { method: "PUT", body: payload });
          } else {
            await apiRequest(API.routes, { method: "POST", body: payload });
          }
          toast("تم الحفظ", "success");
          closeModal();
          load();
        } catch (err) { toast(err.message, "error"); }
      });
    };

    $("#addRoute").addEventListener("click", () => openRouteForm(null));
    $("#rSearch").addEventListener("input", debounce(load, 300));
    load();
  };

  /* =========================================================
     STATIONS
     ========================================================= */

  const renderStations = async () => {
    const content = $("#content");
    content.innerHTML = pageHead({
      title: "المحطات والمواقف",
      desc: "إدارة محطات المترو والقطار والمواقف",
      actions: `<button class="btn btn--primary" id="addStation">إضافة محطة</button>`,
    }) + `
      <div class="filters">
        <input class="filters__input" id="sSearch" placeholder="بحث بالاسم..." />
      </div>
      <div class="panel"><div id="stationsList">${emptyState("جاري التحميل...")}</div></div>`;

    const load = async () => {
      const box = $("#stationsList");
      const q = $("#sSearch").value.trim();
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      try {
        const res = await apiRequest(`${API.stations}?${params.toString()}`);
        const items = (res.data && (res.data.items || res.data)) || [];
        if (!items.length) { box.innerHTML = emptyState("لا توجد محطات"); return; }
        box.innerHTML = `
          <div class="table-wrap">
            <table class="table">
              <thead><tr>
                <th>الاسم</th><th>المنطقة</th><th>المحافظة</th>
                <th>الإحداثيات</th><th>الحالة</th><th></th>
              </tr></thead>
              <tbody>
                ${items.map((s) => `
                  <tr>
                    <td>${escapeHtml(s.name || "-")}</td>
                    <td>${escapeHtml(s.area || "-")}</td>
                    <td>${escapeHtml(s.governorate || "-")}</td>
                    <td>${s.latitude != null && s.longitude != null ? `${escapeHtml(String(s.latitude))}, ${escapeHtml(String(s.longitude))}` : "-"}</td>
                    <td>${activeBadge(!!s.active)}</td>
                    <td>
                      <button class="btn btn--ghost btn--sm" data-edit="${escapeHtml(s.id)}">تعديل</button>
                      <button class="btn btn--ghost btn--sm" data-toggle="${escapeHtml(s.id)}">${s.active ? "تعطيل" : "تفعيل"}</button>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>`;

        $$("[data-edit]", box).forEach((b) =>
          b.addEventListener("click", () => openStationForm(items.find((x) => x.id === b.dataset.edit))));
        $$("[data-toggle]", box).forEach((b) =>
          b.addEventListener("click", async () => {
            const item = items.find((x) => x.id === b.dataset.toggle);
            try {
              await apiRequest(`${API.stations}/${encodeURIComponent(item.id)}`, {
                method: "PUT", body: { active: !item.active },
              });
              toast("تم التحديث", "success");
              load();
            } catch (err) { toast(err.message, "error"); }
          }));
      } catch (_) {
        box.innerHTML = emptyState("تعذر تحميل المحطات");
      }
    };

    const openStationForm = (item) => {
      const isEdit = !!item;
      const s = item || { name: "", area: "", governorate: "", latitude: "", longitude: "", active: true };
      openModal({
        title: isEdit ? "تعديل محطة" : "إضافة محطة",
        body: `
          <div class="form-grid">
            <div class="form__group form__group--full">
              <label class="form__label">الاسم</label>
              <input class="form__input" id="sName" value="${escapeHtml(s.name)}" />
            </div>
            <div class="form__group">
              <label class="form__label">المنطقة</label>
              <input class="form__input" id="sArea" value="${escapeHtml(s.area)}" />
            </div>
            <div class="form__group">
              <label class="form__label">المحافظة</label>
              <input class="form__input" id="sGov" value="${escapeHtml(s.governorate)}" />
            </div>
            <div class="form__group">
              <label class="form__label">Latitude</label>
              <input class="form__input" id="sLat" type="number" step="0.000001" value="${escapeHtml(s.latitude)}" dir="ltr" />
            </div>
            <div class="form__group">
              <label class="form__label">Longitude</label>
              <input class="form__input" id="sLng" type="number" step="0.000001" value="${escapeHtml(s.longitude)}" dir="ltr" />
            </div>
            <div class="form__group">
              <label class="form__label">الحالة</label>
              <select class="form__select" id="sActive">
                <option value="true"${s.active ? " selected" : ""}>مفعّل</option>
                <option value="false"${!s.active ? " selected" : ""}>معطّل</option>
              </select>
            </div>
          </div>`,
        footer: `
          <button class="btn btn--ghost" data-close="modal">إلغاء</button>
          <button class="btn btn--primary" id="saveStation">حفظ</button>`,
      });

      $("#saveStation").addEventListener("click", async () => {
        const payload = {
          name: $("#sName").value.trim(),
          area: $("#sArea").value.trim(),
          governorate: $("#sGov").value.trim(),
          latitude: Number($("#sLat").value),
          longitude: Number($("#sLng").value),
          active: $("#sActive").value === "true",
        };
        if (!payload.name) { toast("الاسم مطلوب", "warn"); return; }
        try {
          if (isEdit) await apiRequest(`${API.stations}/${encodeURIComponent(s.id)}`, { method: "PUT", body: payload });
          else await apiRequest(API.stations, { method: "POST", body: payload });
          toast("تم الحفظ", "success");
          closeModal();
          load();
        } catch (err) { toast(err.message, "error"); }
      });
    };

    $("#addStation").addEventListener("click", () => openStationForm(null));
    $("#sSearch").addEventListener("input", debounce(load, 300));
    load();
  };

  /* =========================================================
     TRANSPORT TYPES
     ========================================================= */

  const renderTransportTypes = async () => {
    const content = $("#content");
    content.innerHTML = pageHead({
      title: "وسائل المواصلات",
      desc: "المترو، الأتوبيس، الميكروباص، القطار وغيرها",
      actions: `<button class="btn btn--primary" id="addType">إضافة وسيلة</button>`,
    }) + `<div class="panel"><div id="typesList">${emptyState("جاري التحميل...")}</div></div>`;

    const load = async () => {
      const box = $("#typesList");
      try {
        const res = await apiRequest(API.transport);
        const items = (res.data && (res.data.items || res.data)) || [];
        if (!items.length) { box.innerHTML = emptyState("لا توجد وسائل"); return; }
        box.innerHTML = `
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>الاسم</th><th>المعرّف</th><th>الحالة</th><th></th></tr></thead>
              <tbody>
                ${items.map((t) => `
                  <tr>
                    <td>${escapeHtml(t.name || "-")}</td>
                    <td dir="ltr">${escapeHtml(t.slug || t.id || "-")}</td>
                    <td>${activeBadge(t.active !== false)}</td>
                    <td>
                      <button class="btn btn--ghost btn--sm" data-edit="${escapeHtml(t.id)}">تعديل</button>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>`;

        $$("[data-edit]", box).forEach((b) =>
          b.addEventListener("click", () => {
            const t = items.find((x) => x.id === b.dataset.edit);
            openModal({
              title: "تعديل وسيلة",
              body: `
                <div class="form-grid">
                  <div class="form__group form__group--full">
                    <label class="form__label">الاسم</label>
                    <input class="form__input" id="tName" value="${escapeHtml(t.name || "")}" />
                  </div>
                  <div class="form__group">
                    <label class="form__label">الحالة</label>
                    <select class="form__select" id="tActive">
                      <option value="true"${t.active !== false ? " selected" : ""}>مفعّل</option>
                      <option value="false"${t.active === false ? " selected" : ""}>معطّل</option>
                    </select>
                  </div>
                </div>`,
              footer: `
                <button class="btn btn--ghost" data-close="modal">إلغاء</button>
                <button class="btn btn--primary" id="saveType">حفظ</button>`,
            });
            $("#saveType").addEventListener("click", async () => {
              try {
                await apiRequest(`${API.transport}/${encodeURIComponent(t.id)}`, {
                  method: "PUT",
                  body: { name: $("#tName").value.trim(), active: $("#tActive").value === "true" },
                });
                toast("تم الحفظ", "success");
                closeModal();
                load();
              } catch (err) { toast(err.message, "error"); }
            });
          }));
      } catch (_) { box.innerHTML = emptyState("تعذر التحميل"); }
    };

    $("#addType").addEventListener("click", () => {
      openModal({
        title: "إضافة وسيلة",
        body: `
          <div class="form-grid">
            <div class="form__group form__group--full">
              <label class="form__label">الاسم</label>
              <input class="form__input" id="tName" />
            </div>
            <div class="form__group form__group--full">
              <label class="form__label">Slug (اختياري)</label>
              <input class="form__input" id="tSlug" dir="ltr" />
            </div>
          </div>`,
        footer: `
          <button class="btn btn--ghost" data-close="modal">إلغاء</button>
          <button class="btn btn--primary" id="saveType">حفظ</button>`,
      });
      $("#saveType").addEventListener("click", async () => {
        try {
          await apiRequest(API.transport, {
            method: "POST",
            body: { name: $("#tName").value.trim(), slug: $("#tSlug").value.trim() },
          });
          toast("تم الحفظ", "success");
          closeModal();
          load();
        } catch (err) { toast(err.message, "error"); }
      });
    });

    load();
  };

  /* =========================================================
     FARES
     ========================================================= */

  const renderFares = async () => {
    const content = $("#content");
    content.innerHTML = pageHead({
      title: "الأسعار",
      desc: "إدارة أسعار المواصلات وتحديثها",
      actions: `<button class="btn btn--primary" id="addFare">إضافة سعر</button>`,
    }) + `<div class="panel"><div id="faresList">${emptyState("جاري التحميل...")}</div></div>`;

    const load = async () => {
      const box = $("#faresList");
      try {
        const res = await apiRequest(API.fares);
        const items = (res.data && (res.data.items || res.data)) || [];
        if (!items.length) { box.innerHTML = emptyState("لا توجد أسعار"); return; }
        box.innerHTML = `
          <div class="table-wrap">
            <table class="table">
              <thead><tr>
                <th>الوسيلة</th><th>الخط</th><th>السعر</th><th>العملة</th>
                <th>ساري من</th><th>آخر تحديث</th><th></th>
              </tr></thead>
              <tbody>
                ${items.map((f) => {
                  const stale = f.lastUpdated && (Date.now() - new Date(f.lastUpdated).getTime()) > 90 * 24 * 3600 * 1000;
                  return `
                    <tr>
                      <td>${escapeHtml(f.transport || "-")}</td>
                      <td>${escapeHtml(f.route || "-")}</td>
                      <td>${f.price != null ? escapeHtml(String(f.price)) : "-"}</td>
                      <td>${escapeHtml(f.currency || "EGP")}</td>
                      <td>${fmtDate(f.effectiveFrom)}</td>
                      <td>${fmtDate(f.lastUpdated)} ${stale ? '<span class="badge badge--p-high">قديم</span>' : ""}</td>
                      <td><button class="btn btn--ghost btn--sm" data-edit="${escapeHtml(f.id)}">تعديل</button></td>
                    </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>`;

        $$("[data-edit]", box).forEach((b) =>
          b.addEventListener("click", () => {
            const f = items.find((x) => x.id === b.dataset.edit);
            openFareForm(f);
          }));
      } catch (_) { box.innerHTML = emptyState("تعذر التحميل"); }
    };

    const openFareForm = (f) => {
      const isEdit = !!f;
      const item = f || { transport: "", route: "", price: "", currency: "EGP", effectiveFrom: "" };
      openModal({
        title: isEdit ? "تعديل سعر" : "إضافة سعر",
        body: `
          <div class="form-grid">
            <div class="form__group">
              <label class="form__label">الوسيلة</label>
              <input class="form__input" id="fTransport" value="${escapeHtml(item.transport)}" />
            </div>
            <div class="form__group">
              <label class="form__label">الخط</label>
              <input class="form__input" id="fRoute" value="${escapeHtml(item.route)}" />
            </div>
            <div class="form__group">
              <label class="form__label">السعر</label>
              <input class="form__input" id="fPrice" type="number" step="0.5" value="${escapeHtml(item.price)}" />
            </div>
            <div class="form__group">
              <label class="form__label">العملة</label>
              <input class="form__input" id="fCurrency" value="${escapeHtml(item.currency || "EGP")}" dir="ltr" />
            </div>
            <div class="form__group form__group--full">
              <label class="form__label">ساري من (تاريخ)</label>
              <input class="form__input" id="fFrom" type="date" value="${item.effectiveFrom ? String(item.effectiveFrom).slice(0, 10) : ""}" />
            </div>
          </div>`,
        footer: `
          <button class="btn btn--ghost" data-close="modal">إلغاء</button>
          <button class="btn btn--primary" id="saveFare">حفظ</button>`,
      });
      $("#saveFare").addEventListener("click", async () => {
        const payload = {
          transport: $("#fTransport").value.trim(),
          route: $("#fRoute").value.trim(),
          price: Number($("#fPrice").value) || 0,
          currency: $("#fCurrency").value.trim() || "EGP",
          effectiveFrom: $("#fFrom").value || null,
        };
        try {
          if (isEdit) await apiRequest(`${API.fares}/${encodeURIComponent(item.id)}`, { method: "PUT", body: payload });
          else await apiRequest(API.fares, { method: "POST", body: payload });
          toast("تم الحفظ", "success");
          closeModal();
          load();
        } catch (err) { toast(err.message, "error"); }
      });
    };

    $("#addFare").addEventListener("click", () => openFareForm(null));
    load();
  };

  /* =========================================================
     GEO
     ========================================================= */

  const renderGeo = async () => {
    const content = $("#content");
    content.innerHTML = pageHead({
      title: "المناطق والمحافظات",
      desc: "تغطية جميع محافظات ومدن ومناطق مصر",
    }) + `
      <div class="grid-2">
        <div class="panel">
          <div class="panel__head"><h2 class="panel__title">المحافظات</h2></div>
          <div class="panel__body" id="govList">${emptyState("جاري التحميل...")}</div>
        </div>
        <div class="panel">
          <div class="panel__head"><h2 class="panel__title">المدن والمناطق</h2></div>
          <div class="panel__body" id="cityList">${emptyState("اختر محافظة لعرض المدن")}</div>
        </div>
      </div>`;

    try {
      const res = await apiRequest(API.governorates);
      const items = (res.data && (res.data.items || res.data)) || [];
      const box = $("#govList");
      if (!items.length) { box.innerHTML = emptyState("لا توجد محافظات"); return; }
      box.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px">
        ${items.map((g) => `<button class="btn btn--ghost btn--sm" data-gov="${escapeHtml(g.id)}">${escapeHtml(g.name || g.id)}</button>`).join("")}
      </div>`;
      $$("[data-gov]", box).forEach((b) =>
        b.addEventListener("click", async () => {
          const cityBox = $("#cityList");
          cityBox.innerHTML = emptyState("جاري التحميل...");
          try {
            const r = await apiRequest(`${API.cities}?governorateId=${encodeURIComponent(b.dataset.gov)}`);
            const cities = (r.data && (r.data.items || r.data)) || [];
            if (!cities.length) { cityBox.innerHTML = emptyState("لا توجد مدن"); return; }
            cityBox.innerHTML = `<ul style="list-style:none;padding:0;margin:0">
              ${cities.map((c) => `<li style="padding:8px 0;border-bottom:1px solid var(--c-border)">${escapeHtml(c.name || c.id)}</li>`).join("")}
            </ul>`;
          } catch (_) { cityBox.innerHTML = emptyState("تعذر التحميل"); }
        }));
    } catch (_) {
      $("#govList").innerHTML = emptyState("تعذر التحميل");
    }
  };

  /* =========================================================
     USERS
     ========================================================= */

  const renderUsers = async () => {
    const content = $("#content");
    content.innerHTML = pageHead({
      title: "المستخدمون",
      desc: "عرض حسابات المستخدمين المسجلين",
    }) + `
      <div class="filters">
        <input class="filters__input" id="uSearch" placeholder="بحث بالاسم أو البريد..." />
      </div>
      <div class="panel"><div id="usersList">${emptyState("جاري التحميل...")}</div></div>`;

    const load = async () => {
      const box = $("#usersList");
      const q = $("#uSearch").value.trim();
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      try {
        const res = await apiRequest(`${API.users}?${params.toString()}`);
        const items = (res.data && (res.data.items || res.data)) || [];
        if (!items.length) { box.innerHTML = emptyState("لا يوجد مستخدمون"); return; }
        box.innerHTML = `
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>الاسم</th><th>البريد</th><th>الهاتف</th><th>الحالة</th><th>تاريخ التسجيل</th></tr></thead>
              <tbody>
                ${items.map((u) => `
                  <tr>
                    <td>${escapeHtml(u.name || "-")}</td>
                    <td dir="ltr">${escapeHtml(u.email || "-")}</td>
                    <td dir="ltr">${escapeHtml(u.phone || "-")}</td>
                    <td>${activeBadge(u.active !== false)}</td>
                    <td>${fmtDate(u.createdAt)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>`;
      } catch (_) { box.innerHTML = emptyState("تعذر التحميل"); }
    };

    $("#uSearch").addEventListener("input", debounce(load, 300));
    load();
  };

  /* =========================================================
     STATS
     ========================================================= */

  const renderStats = async () => {
    const content = $("#content");
    content.innerHTML = pageHead({
      title: "الإحصائيات",
      desc: "مؤشرات المنصة التفصيلية",
    }) + `<div class="cards" id="statsCards">${skeletonCards(6)}</div>`;

    try {
      const res = await apiRequest(API.stats);
      const s = res.data || {};
      const cards = [
        ["إجمالي المستخدمين", s.totalUsers, "accent-blue"],
        ["مستخدمون نشطون", s.activeUsers, "accent-green"],
        ["إجمالي الشكاوى", s.totalComplaints, "accent-yellow"],
        ["شكاوى محلولة", s.resolvedComplaints, "accent-green"],
        ["إجمالي الخطوط", s.totalRoutes, "accent-blue"],
        ["إجمالي المحطات", s.totalStations, "accent-blue"],
      ];
      $("#statsCards").innerHTML = cards.map(([l, v, a]) => `
        <div class="card card--${a}">
          <div class="card__label">${escapeHtml(l)}</div>
          <div class="card__value">${typeof v === "number" ? fmtNumber(v) : escapeHtml(v ?? "-")}</div>
        </div>
      `).join("");
    } catch (_) { $("#statsCards").innerHTML = emptyState("تعذر التحميل"); }
  };

  /* =========================================================
     LOGS
     ========================================================= */

  const renderLogs = async () => {
    const content = $("#content");
    content.innerHTML = pageHead({
      title: "سجل العمليات",
      desc: "آخر العمليات التي قام بها المسؤولون",
    }) + `<div class="panel"><div id="logsList">${emptyState("جاري التحميل...")}</div></div>`;

    try {
      const res = await apiRequest(`${API.logs}?limit=100`);
      const items = (res.data && (res.data.items || res.data)) || [];
      const box = $("#logsList");
      if (!items.length) { box.innerHTML = emptyState("لا توجد سجلات"); return; }
      box.innerHTML = `
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>الوقت</th><th>المسؤول</th><th>العملية</th><th>المورد</th><th>IP</th></tr></thead>
            <tbody>
              ${items.map((l) => `
                <tr>
                  <td>${fmtDate(l.timestamp)}</td>
                  <td>${escapeHtml(l.adminId || "-")}</td>
                  <td>${escapeHtml(l.action || "-")}</td>
                  <td>${escapeHtml(l.resource || "-")}${l.resourceId ? ` <span dir="ltr" style="color:var(--c-text-muted)">${escapeHtml(l.resourceId)}</span>` : ""}</td>
                  <td dir="ltr">${escapeHtml(l.ip || "-")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>`;
    } catch (_) { $("#logsList").innerHTML = emptyState("تعذر التحميل"); }
  };

  /* =========================================================
     SETTINGS
     ========================================================= */

  const renderSettings = () => {
    const content = $("#content");
    content.innerHTML = pageHead({
      title: "الإعدادات",
      desc: "تفضيلات الحساب والنظام",
    }) + `
      <div class="panel">
        <div class="panel__head"><h2 class="panel__title">تفضيلات العرض</h2></div>
        <div class="panel__body">
          <div class="form__group">
            <label class="form__label">الوضع</label>
            <button class="btn btn--ghost" id="settingsTheme">تبديل الوضع الليلي / النهاري</button>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel__head"><h2 class="panel__title">معلومات الحساب</h2></div>
        <div class="panel__body">
          <dl class="kv">
            <dt>اسم المستخدم</dt><dd>${escapeHtml((state.admin && state.admin.username) || "-")}</dd>
            <dt>الدور</dt><dd>${escapeHtml((state.admin && state.admin.role) || "admin")}</dd>
          </dl>
        </div>
      </div>`;
    $("#settingsTheme").addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      localStorage.setItem(THEME_KEY, next);
    });
  };

  /* =========================================================
     ROUTER
     ========================================================= */

  const render = (route) => {
    switch (route) {
      case "overview":        return renderOverview();
      case "complaints":      return renderComplaints();
      case "routes":          return renderRoutes();
      case "stations":        return renderStations();
      case "transport-types": return renderTransportTypes();
      case "fares":           return renderFares();
      case "geo":             return renderGeo();
      case "users":           return renderUsers();
      case "stats":           return renderStats();
      case "logs":            return renderLogs();
      case "settings":        return renderSettings();
      default:                return renderOverview();
    }
  };

  /* =========================================================
     BOOT
     ========================================================= */

  const loadAdmin = async () => {
    try {
      const res = await apiRequest(API.me);
      state.admin = res.data && (res.data.admin || res.data) || null;
      if (state.admin && state.admin.username) {
        $("#userName").textContent = state.admin.username;
      }
    } catch (_) {}
  };

  const loadBadge = async () => {
    try {
      const res = await apiRequest(`${API.complaints}?status=new&limit=1`);
      const count = (res.data && (res.data.total ?? (res.data.items || []).length)) || 0;
      setBadge(count);
    } catch (_) {}
  };

  const loadSyncMeta = async () => {
    try {
      const res = await apiRequest(API.sync);
      const at = res.data && res.data.lastSync;
      if (at) setSyncTime(new Date(at).getTime());
    } catch (_) {}
  };

  const handleLogout = async () => {
    try { await apiRequest(API.logout, { method: "POST" }); } catch (_) {}
    window.location.replace("/login");
  };

  const initSearch = () => {
    const input = $("#globalSearch");
    const results = $("#searchResults");
    if (!input || !results) return;

    const run = debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) { results.hidden = true; results.innerHTML = ""; return; }
      try {
        const res = await apiRequest(`${API.search}?q=${encodeURIComponent(q)}`);
        const data = res.data || {};
        const groups = [
          ["routes", "خطوط"],
          ["stations", "محطات"],
          ["complaints", "شكاوى"],
          ["users", "مستخدمون"],
          ["governorates", "محافظات"],
          ["transport", "وسائل"],
        ];
        const html = groups.map(([key, label]) => {
          const items = Array.isArray(data[key]) ? data[key] : [];
          if (!items.length) return "";
          return `
            <div class="search-group">
              <div class="search-group__title">${label}</div>
              ${items.slice(0, 5).map((it) => `
                <button class="search-item" data-kind="${key}">${escapeHtml(it.name || it.title || it.username || it.id)}</button>
              `).join("")}
            </div>`;
        }).join("");
        results.innerHTML = html || `<div class="search-empty">لا نتائج</div>`;
        results.hidden = false;
      } catch (_) {
        results.innerHTML = `<div class="search-empty">تعذر البحث</div>`;
        results.hidden = false;
      }
    }, 280);

    input.addEventListener("input", run);
    input.addEventListener("focus", () => {
      if (input.value.trim().length >= 2) results.hidden = false;
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".topbar__search")) results.hidden = true;
    });
  };

  const boot = async () => {
    initTheme();
    initSearch();

    $("#menuToggle").addEventListener("click", () => {
      const sb = $("#sidebar");
      if (sb.dataset.open === "true") closeSidebar(); else openSidebar();
    });
    $("#logoutBtn").addEventListener("click", handleLogout);

    $$(".nav-item").forEach((el) => {
      el.addEventListener("click", () => navigate(el.dataset.route));
    });

    window.addEventListener("online", () => { setOnline(true); setSyncTime(); });
    window.addEventListener("offline", () => setOnline(false));

    document.addEventListener("click", (e) => {
      const sb = $("#sidebar");
      if (sb.dataset.open === "true" && !e.target.closest("#sidebar") && !e.target.closest("#menuToggle")) {
        closeSidebar();
      }
    });

    setOnline(navigator.onLine);
    setSyncTime();

    await loadAdmin();
    loadBadge();
    loadSyncMeta();

    setInterval(() => {
      const el = $("#syncTime");
      if (el) el.textContent = fmtTimeAgo(state.lastSync);
    }, 60_000);

    const hash = window.location.hash.replace("#", "");
    navigate(hash || "overview");
  };

  document.addEventListener("DOMContentLoaded", boot);
})();
