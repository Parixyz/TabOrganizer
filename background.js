chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(["projects", "layouts"]);
  await chrome.storage.local.set({
    projects: Array.isArray(current.projects) ? current.projects : [],
    layouts: current.layouts && typeof current.layouts === "object" ? current.layouts : {}
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const type = message?.type;
    const scope = message?.scope;
    const sourceWindowId = sender?.tab?.windowId;
    console.log("[Pastel Tab Projects] message:", type, message);
    switch (type) {
      case "GET_TABS": {
        const tabs = await getTabsInScope(scope, sourceWindowId);
        const projects = await getProjects();
        sendResponse({ ok: true, tabs, projects });
        break;
      }
      case "CREATE_PROJECT": {
        const projects = await getProjects();
        const project = {
          id: crypto.randomUUID(),
          name: (message.name || "New Project").trim() || "New Project",
          color: message.color || "#f8a5c2",
          tabIds: []
        };
        projects.push(project);
        await saveProjects(projects);
        sendResponse({ ok: true, projects });
        break;
      }
      case "SORT_TABS": {
        await sortTabsInScope(scope, sourceWindowId);
        sendResponse({ ok: true });
        break;
      }
      case "ORGANIZE": {
        await organizeScope(scope, sourceWindowId);
        sendResponse({ ok: true });
        break;
      }
      case "ADD_TAB_TO_PROJECT": {
        await addTabToProject(message.tabId, message.projectId);
        sendResponse({ ok: true });
        break;
      }
      case "REMOVE_TAB_FROM_PROJECT": {
        await removeTabFromProject(message.tabId, message.projectId);
        sendResponse({ ok: true });
        break;
      }
      case "CLOSE_PROJECT_TABS": {
        await closeProjectTabs(message.projectId, scope, sourceWindowId);
        sendResponse({ ok: true });
        break;
      }
      case "DELETE_PROJECT": {
        await deleteProject(message.projectId);
        sendResponse({ ok: true });
        break;
      }
      case "CLOSE_DOMAIN_TABS": {
        await closeDomainTabs(message.host, scope, sourceWindowId);
        sendResponse({ ok: true });
        break;
      }
      case "CLOSE_UNASSIGNED_TABS": {
        await closeUnassignedTabs(scope, sourceWindowId);
        sendResponse({ ok: true });
        break;
      }
      case "CLOSE_TAB": {
        await closeTab(message.tabId);
        sendResponse({ ok: true });
        break;
      }
      case "ACTIVATE_TAB": {
        await activateTab(message.tabId);
        sendResponse({ ok: true });
        break;
      }
      case "SAVE_LAYOUT": {
        await saveLayout(scope, sourceWindowId);
        sendResponse({ ok: true });
        break;
      }
      case "LOAD_LAYOUT": {
        await loadLayout(scope, sourceWindowId);
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: `Unknown message type: ${type}` });
    }
  })().catch((error) => {
    console.error("[Pastel Tab Projects] message handler error", error);
    sendResponse({ ok: false, error: String(error) });
  });

  return true;
});

async function getProjects() {
  const { projects } = await chrome.storage.local.get("projects");
  return Array.isArray(projects) ? projects : [];
}

async function saveProjects(projects) {
  const normalized = projects.map((p) => ({
    ...p,
    tabIds: uniqueNumbers(p.tabIds)
  }));
  await chrome.storage.local.set({ projects: normalized });
}

function uniqueNumbers(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((v) => Number.isInteger(v)))];
}

function parseHost(url) {
  try {
    return new URL(url).hostname || "(no host)";
  } catch {
    return "(invalid)";
  }
}

function isInternalUrl(url) {
  if (!url || typeof url !== "string") return true;
  return /^chrome:\/\//.test(url) || /^chrome-extension:\/\//.test(url) || /^about:/.test(url);
}

function isDividerTab(tab) {
  if (!tab?.url) return false;
  return tab.url.startsWith(chrome.runtime.getURL("divider.html"));
}

function hostAndTitleCompare(a, b) {
  const hostA = parseHost(a.url || "").toLowerCase();
  const hostB = parseHost(b.url || "").toLowerCase();
  if (hostA < hostB) return -1;
  if (hostA > hostB) return 1;
  return (a.title || "").localeCompare(b.title || "");
}

function stableClusterByHost(windowTabs, tabsSubset) {
  const subsetIds = new Set(tabsSubset.map((t) => t.id));
  const hostOrder = [];
  const seenHosts = new Set();

  for (const tab of windowTabs) {
    if (!subsetIds.has(tab.id)) continue;
    const host = parseHost(tab.url || "");
    if (!seenHosts.has(host)) {
      seenHosts.add(host);
      hostOrder.push(host);
    }
  }

  const byHost = new Map(hostOrder.map((h) => [h, []]));
  for (const tab of windowTabs) {
    if (!subsetIds.has(tab.id)) continue;
    const host = parseHost(tab.url || "");
    if (!byHost.has(host)) {
      byHost.set(host, []);
      hostOrder.push(host);
    }
    byHost.get(host).push(tab);
  }

  const result = [];
  for (const host of hostOrder) {
    result.push(...(byHost.get(host) || []));
  }
  return result;
}

async function resolveWindowIds(scope, sourceWindowId) {
  if (scope === "allWindows") {
    const wins = await chrome.windows.getAll({ populate: false });
    return wins.map((w) => w.id);
  }

  if (scope && typeof scope === "object" && Number.isInteger(scope.windowId)) {
    return [scope.windowId];
  }

    if (Number.isInteger(sourceWindowId)) return [sourceWindowId];

  try {
    const current = await chrome.windows.getLastFocused({ populate: false });
    if (Number.isInteger(current?.id)) return [current.id];
  } catch (error) {
    console.warn("resolveWindowIds fallback failed", error);
  }

  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tabs[0] && Number.isInteger(tabs[0].windowId)) return [tabs[0].windowId];
  const any = await chrome.windows.getAll({ populate: false });
  return any.length ? [any[0].id] : [];
}

async function getTabsInScope(scope, sourceWindowId) {
  const windowIds = await resolveWindowIds(scope, sourceWindowId);
  const all = [];
  for (const windowId of windowIds) {
    const tabs = await chrome.tabs.query({ windowId });
    all.push(...tabs);
  }
  return all.filter((t) => !isDividerTab(t));
}

async function sortTabsInScope(scope, sourceWindowId) {
  const windowIds = await resolveWindowIds(scope, sourceWindowId);
  for (const windowId of windowIds) {
    const tabs = await chrome.tabs.query({ windowId });
    const nonDivider = tabs.filter((t) => !isDividerTab(t));
    const dividerIds = tabs.filter(isDividerTab).map((t) => t.id);
    if (dividerIds.length) await chrome.tabs.remove(dividerIds);
    const sorted = [...nonDivider].sort(hostAndTitleCompare);
    await moveTabSequence(windowId, sorted.map((t) => t.id));
  }
}

async function addTabToProject(tabId, projectId) {
  if (!Number.isInteger(tabId)) return;
  const projects = await getProjects();
  for (const project of projects) {
    project.tabIds = uniqueNumbers(project.tabIds).filter((id) => id !== tabId);
  }
  const target = projects.find((p) => p.id === projectId);
  if (target && !target.tabIds.includes(tabId)) {
    target.tabIds.push(tabId);
  }
  await saveProjects(projects);
}

async function removeTabFromProject(tabId, projectId) {
  const projects = await getProjects();
  for (const project of projects) {
    if (project.id === projectId) {
      project.tabIds = uniqueNumbers(project.tabIds).filter((id) => id !== tabId);
    }
  }
  await saveProjects(projects);
}

async function deleteProject(projectId) {
  const projects = await getProjects();
  await saveProjects(projects.filter((p) => p.id !== projectId));
}

async function closeProjectTabs(projectId, scope, sourceWindowId) {
  const projects = await getProjects();
  const target = projects.find((p) => p.id === projectId);
  if (!target) return;
  const inScope = await getTabsInScope(scope, sourceWindowId);
  const scopedIds = new Set(inScope.map((t) => t.id));
  const toClose = uniqueNumbers(target.tabIds).filter((id) => scopedIds.has(id));
  await closeTabsBestEffort(toClose);
  target.tabIds = uniqueNumbers(target.tabIds).filter((id) => !toClose.includes(id));
  await saveProjects(projects);
}

async function closeDomainTabs(host, scope, sourceWindowId) {
  const tabs = await getTabsInScope(scope, sourceWindowId);
  const toClose = tabs.filter((t) => parseHost(t.url || "") === host).map((t) => t.id);
  await closeTabsBestEffort(toClose);
  await pruneClosedTabIds();
}

async function closeUnassignedTabs(scope, sourceWindowId) {
  const tabs = await getTabsInScope(scope, sourceWindowId);
  const assigned = await assignedTabSet();
  const toClose = tabs.filter((t) => !assigned.has(t.id)).map((t) => t.id);
  await closeTabsBestEffort(toClose);
  await pruneClosedTabIds();
}

async function closeTab(tabId) {
  if (Number.isInteger(tabId)) {
    await closeTabsBestEffort([tabId]);
    await pruneClosedTabIds();
  }
}

async function activateTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tabId, { active: true });
  } catch (error) {
    throw new Error(`Unable to activate tab ${tabId}: ${error.message || error}`);
  }
}

async function assignedTabSet() {
  const projects = await getProjects();
  const set = new Set();
  for (const p of projects) {
    for (const id of uniqueNumbers(p.tabIds)) set.add(id);
  }
  return set;
}

async function pruneClosedTabIds() {
  const tabs = await chrome.tabs.query({});
  const open = new Set(tabs.map((t) => t.id));
  const projects = await getProjects();
  for (const p of projects) {
    p.tabIds = uniqueNumbers(p.tabIds).filter((id) => open.has(id));
  }
  await saveProjects(projects);
}

async function closeTabsBestEffort(tabIds) {
  if (!Array.isArray(tabIds) || !tabIds.length) return;
  for (const tabId of tabIds) {
    try {
      await chrome.tabs.remove(tabId);
    } catch (error) {
      console.warn("Failed to close tab", tabId, error);
    }
  }
}

async function moveTabSequence(windowId, tabIds) {
  let targetIndex = 0;
  for (const tabId of tabIds) {
    try {
      await chrome.tabs.move(tabId, { windowId, index: targetIndex });
      targetIndex += 1;
    } catch (e) {
      console.warn("Failed to move tab", tabId, e);
    }
  }
}

async function createDivider(windowId, color, nextName, index) {
  const url = `${chrome.runtime.getURL("divider.html")}?color=${encodeURIComponent(color)}&name=${encodeURIComponent(nextName || "")}`;
  await chrome.tabs.create({
    windowId,
    index,
    active: false,
    pinned: false,
    url
  });
}

async function organizeWindow(windowId, projects) {
  let tabs = await chrome.tabs.query({ windowId });
  const dividerIds = tabs.filter(isDividerTab).map((t) => t.id);
  if (dividerIds.length) {
    await chrome.tabs.remove(dividerIds);
    tabs = await chrome.tabs.query({ windowId });
  }

  const tabById = new Map(tabs.map((t) => [t.id, t]));
  const sections = [];

  for (const project of projects) {
    const projectTabs = uniqueNumbers(project.tabIds)
      .map((id) => tabById.get(id))
      .filter(Boolean);
    sections.push({
      kind: "project",
      name: project.name,
      color: project.color,
      tabs: stableClusterByHost(tabs, projectTabs)
    });
  }

  const assigned = new Set(projects.flatMap((p) => uniqueNumbers(p.tabIds)));
  const unassignedTabs = tabs.filter((t) => !assigned.has(t.id));
  sections.push({
    kind: "unassigned",
    name: "Unassigned",
    color: "#f9c5d5",
    tabs: stableClusterByHost(tabs, unassignedTabs)
  });

  const flattened = [];
  for (const section of sections) {
    flattened.push(...section.tabs.map((t) => t.id));
  }
  await moveTabSequence(windowId, flattened);

  let insertIndex = 0;
  for (let i = 0; i < sections.length; i += 1) {
    insertIndex += sections[i].tabs.length;
    if (i < sections.length - 1) {
      const next = sections[i + 1];
      await createDivider(windowId, next.color, next.name, insertIndex);
      insertIndex += 1;
    }
  }
}

async function organizeScope(scope, sourceWindowId) {
  const windowIds = await resolveWindowIds(scope, sourceWindowId);
  const projects = await getProjects();
  for (const windowId of windowIds) {
    await organizeWindow(windowId, projects);
  }
}

async function saveLayout(scope, sourceWindowId) {
  const windowIds = await resolveWindowIds(scope, sourceWindowId);
  const tabs = await chrome.tabs.query({});
  const projects = await getProjects();
  const layoutsBlob = await chrome.storage.local.get("layouts");
  const layouts = layoutsBlob.layouts && typeof layoutsBlob.layouts === "object" ? layoutsBlob.layouts : {};

  for (const windowId of windowIds) {
    const windowTabs = tabs.filter((t) => t.windowId === windowId && !isInternalUrl(t.url) && !isDividerTab(t));
    layouts[String(windowId)] = {
      savedAt: new Date().toISOString(),
      tabs: windowTabs.map((t) => ({
        url: t.url,
        title: t.title || "",
        host: parseHost(t.url || "")
      })),
      projectsSnapshot: projects.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        tabIds: uniqueNumbers(p.tabIds).filter((id) => windowTabs.some((t) => t.id === id)),
        urls: uniqueNumbers(p.tabIds)
          .map((id) => windowTabs.find((t) => t.id === id)?.url)
          .filter(Boolean)
      }))
    };
  }

  await chrome.storage.local.set({ layouts });
}

async function loadLayout(scope, sourceWindowId) {
  const windowIds = await resolveWindowIds(scope, sourceWindowId);
  const { layouts } = await chrome.storage.local.get("layouts");
  if (!layouts || typeof layouts !== "object") return;

  const allProjects = await getProjects();

  for (const windowId of windowIds) {
    const key = String(windowId);
    const layout = layouts[key];
    if (!layout) continue;

    const existingTabs = await chrome.tabs.query({ windowId });
    const existingUrls = new Set(existingTabs.map((t) => t.url));

    for (const item of layout.tabs || []) {
      if (!item?.url || isInternalUrl(item.url)) continue;
      if (!existingUrls.has(item.url)) {
        await chrome.tabs.create({ windowId, url: item.url, active: false });
        existingUrls.add(item.url);
      }
    }

    const refreshedTabs = await chrome.tabs.query({ windowId });
    const byUrl = new Map();
    for (const tab of refreshedTabs) {
      if (!byUrl.has(tab.url)) byUrl.set(tab.url, []);
      byUrl.get(tab.url).push(tab.id);
    }

    for (const snapshot of layout.projectsSnapshot || []) {
      const target = allProjects.find((p) => p.id === snapshot.id);
      if (!target) continue;
      for (const url of snapshot.urls || []) {
        const ids = byUrl.get(url) || [];
        if (!ids.length) continue;
        const id = ids[0];
        for (const p of allProjects) {
          p.tabIds = uniqueNumbers(p.tabIds).filter((tabId) => tabId !== id);
        }
        target.tabIds.push(id);
      }
      target.tabIds = uniqueNumbers(target.tabIds);
    }
  }

  await saveProjects(allProjects);
  await organizeScope(scope, sourceWindowId);
}
