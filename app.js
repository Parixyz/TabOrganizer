(() => {
  const state = {
    tabs: [],
    projects: [],
    windows: [],
    scopeValue: "currentWindow"
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", async () => {
    wireElements();
    if (!els.scopeSelect) return;
    await populateScopeOptions();
    bindTopActions();
    await refreshData();
  });

  function wireElements() {
    const ids = [
      "scopeSelect", "refreshBtn", "sortBtn", "organizeBtn", "saveLayoutBtn", "loadLayoutBtn", "openManagerBtn",
      "projectName", "projectColor", "addProjectBtn", "websitesList", "projectsList"
    ];
    for (const id of ids) {
      els[id] = document.getElementById(id);
    }
  }

  async function populateScopeOptions() {
    const windows = await chrome.windows.getAll({ populate: false });
    state.windows = windows;
    const select = els.scopeSelect;
    select.innerHTML = "";
    addOption(select, "currentWindow", "This window");
    addOption(select, "allWindows", "All windows");
    for (const w of windows) {
      addOption(select, `window:${w.id}`, `Window ${w.id}`);
    }
    select.value = state.scopeValue;
  }

  function addOption(select, value, label) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }

  function getScope() {
    const val = els.scopeSelect?.value || "currentWindow";
    if (val === "allWindows") return "allWindows";
    if (val.startsWith("window:")) return { windowId: Number(val.split(":")[1]) };
    return "currentWindow";
  }

  function bindTopActions() {
    els.scopeSelect.addEventListener("change", async () => {
      state.scopeValue = els.scopeSelect.value;
      await refreshData();
    });

    els.refreshBtn.addEventListener("click", refreshData);
    els.sortBtn.addEventListener("click", () => runAndRefresh("SORT_TABS"));
    els.organizeBtn.addEventListener("click", () => runAndRefresh("ORGANIZE"));
    els.saveLayoutBtn.addEventListener("click", () => runAndRefresh("SAVE_LAYOUT"));
    els.loadLayoutBtn.addEventListener("click", () => runAndRefresh("LOAD_LAYOUT"));
    els.openManagerBtn.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("manager.html") }));

    els.addProjectBtn.addEventListener("click", async () => {
      const name = (els.projectName.value || "").trim();
      if (!name) return;
      await sendMessage({ type: "CREATE_PROJECT", name, color: els.projectColor.value });
      els.projectName.value = "";
      await refreshData();
    });
  }

  async function runAndRefresh(type) {
    await sendMessage({ type, scope: getScope() });
    await refreshData();
  }

  async function refreshData() {
    const scope = getScope();
    let payload;
    try {
      payload = await sendMessage({ type: "GET_TABS", scope });
    } catch {
      payload = null;
    }

    if (!payload?.ok) {
      const tabs = await chrome.tabs.query(scope === "currentWindow" ? { currentWindow: true } : (scope.windowId ? { windowId: scope.windowId } : {}));
      const { projects } = await chrome.storage.local.get("projects");
      payload = { ok: true, tabs, projects: Array.isArray(projects) ? projects : [] };
    }

    state.tabs = payload.tabs || [];
    state.projects = Array.isArray(payload.projects) ? payload.projects : [];

    renderWebsites();
    renderProjects();
  }

  function renderWebsites() {
    els.websitesList.innerHTML = "";
    const grouped = new Map();
    for (const tab of state.tabs) {
      const host = safeHost(tab.url);
      if (!grouped.has(host)) grouped.set(host, []);
      grouped.get(host).push(tab);
    }

    if (grouped.size === 0) {
      els.websitesList.appendChild(empty("No tabs in scope."));
      return;
    }

    [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([host, tabs]) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-header">
          <div class="card-title">${escapeHtml(host)} <span class="small-muted">(${tabs.length})</span></div>
          <div class="card-actions"><button data-host-close="${escapeHtml(host)}">✕</button></div>
        </div>
      `;
      const list = document.createElement("div");
      tabs.forEach((tab) => list.appendChild(tabRow(tab, { removeMode: "none" })));
      card.appendChild(list);
      card.querySelector("[data-host-close]").addEventListener("click", async () => {
        await sendMessage({ type: "CLOSE_DOMAIN_TABS", host, scope: getScope() });
        await refreshData();
      });
      els.websitesList.appendChild(card);
    });
  }

  function renderProjects() {
    els.projectsList.innerHTML = "";

    const tabById = new Map(state.tabs.map((t) => [t.id, t]));
    const assigned = new Set();
    state.projects.forEach((p) => (p.tabIds || []).forEach((id) => assigned.add(id)));

    state.projects.forEach((project) => {
      const card = document.createElement("div");
      card.className = "card dropzone";
      card.dataset.projectId = project.id;

      card.innerHTML = `
        <div class="card-header">
          <div class="card-title"><span class="host-pill" style="background:${project.color}"></span>${escapeHtml(project.name)}</div>
          <div class="card-actions">
            <button data-organize>▦</button>
            <button data-close>✕</button>
            <button data-delete>🗑</button>
          </div>
        </div>
      `;

      const list = document.createElement("div");
      const tabs = (project.tabIds || []).map((id) => tabById.get(id)).filter(Boolean);
      if (!tabs.length) list.appendChild(empty("Drop tabs here."));
      tabs.forEach((tab) => list.appendChild(tabRow(tab, { projectId: project.id, removeMode: "minus" })));
      card.appendChild(list);

      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        card.classList.add("over");
      });
      card.addEventListener("dragleave", () => card.classList.remove("over"));
      card.addEventListener("drop", async (e) => {
        e.preventDefault();
        card.classList.remove("over");
        const tabId = Number(e.dataTransfer.getData("text/tab-id"));
        if (Number.isInteger(tabId)) {
          await sendMessage({ type: "ADD_TAB_TO_PROJECT", tabId, projectId: project.id });
          await refreshData();
        }
      });

      card.querySelector("[data-organize]").addEventListener("click", async () => {
        await sendMessage({ type: "ORGANIZE", scope: getScope() });
        await refreshData();
      });
      card.querySelector("[data-close]").addEventListener("click", async () => {
        await sendMessage({ type: "CLOSE_PROJECT_TABS", projectId: project.id, scope: getScope() });
        await refreshData();
      });
      card.querySelector("[data-delete]").addEventListener("click", async () => {
        await sendMessage({ type: "DELETE_PROJECT", projectId: project.id });
        await refreshData();
      });

      els.projectsList.appendChild(card);
    });

    const unassignedCard = document.createElement("div");
    unassignedCard.className = "card";
    unassignedCard.innerHTML = `
      <div class="card-header">
        <div class="card-title"><span class="host-pill" style="background:#f9c5d5"></span>Unassigned</div>
        <div class="card-actions"><button data-close-unassigned>✕</button></div>
      </div>
    `;
    const unassignedList = document.createElement("div");
    const unassignedTabs = state.tabs.filter((t) => !assigned.has(t.id));
    if (!unassignedTabs.length) unassignedList.appendChild(empty("No unassigned tabs."));
    unassignedTabs.forEach((tab) => unassignedList.appendChild(tabRow(tab, { removeMode: "none", draggable: true })));
    unassignedCard.appendChild(unassignedList);
    unassignedCard.querySelector("[data-close-unassigned]").addEventListener("click", async () => {
      await sendMessage({ type: "CLOSE_UNASSIGNED_TABS", scope: getScope() });
      await refreshData();
    });
    els.projectsList.appendChild(unassignedCard);
  }

  function tabRow(tab, opts = {}) {
    const row = document.createElement("div");
    row.className = "tab-row";
    row.draggable = opts.draggable !== false;
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/tab-id", String(tab.id));
    });

    const title = document.createElement("a");
    title.href = "#";
    title.className = "tab-title";
    title.textContent = tab.title || tab.url || `Tab ${tab.id}`;
    title.title = tab.url || "";
    title.addEventListener("click", async (e) => {
      e.preventDefault();
      await sendMessage({ type: "ACTIVATE_TAB", tabId: tab.id });
    });

    const go = document.createElement("button");
    go.textContent = "↗";
    go.className = "tab-btn";
    go.addEventListener("click", async () => sendMessage({ type: "ACTIVATE_TAB", tabId: tab.id }));

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "4px";

    if (opts.removeMode === "minus") {
      const remove = document.createElement("button");
      remove.textContent = "−";
      remove.className = "tab-btn";
      remove.addEventListener("click", async () => {
        await sendMessage({ type: "REMOVE_TAB_FROM_PROJECT", tabId: tab.id, projectId: opts.projectId });
        await refreshData();
      });
      right.appendChild(remove);
    }

    const close = document.createElement("button");
    close.textContent = "✕";
    close.className = "tab-btn";
    close.addEventListener("click", async () => {
      await sendMessage({ type: "CLOSE_TAB", tabId: tab.id });
      await refreshData();
    });
    right.appendChild(close);

    row.appendChild(title);
    row.appendChild(go);
    row.appendChild(right);
    return row;
  }

  function safeHost(url) {
    try { return new URL(url).hostname || "(no host)"; } catch { return "(invalid)"; }
  }

  function empty(text) {
    const e = document.createElement("div");
    e.className = "empty-state";
    e.textContent = text;
    return e;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function sendMessage(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(payload, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(err);
          return;
        }
        resolve(response);
      });
    });
  }
})();
