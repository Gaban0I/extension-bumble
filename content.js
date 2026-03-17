const ENCOUNTERS_EVENT = "bumble-encounters-response";
const USER_SELECTOR = "h1.encounters-story-profile__user";
const NAME_SELECTOR = "span.encounters-story-profile__name";
const AGE_SELECTOR = "span.encounters-story-profile__age";
const BADGE_ID = "bumble-encounters-vote-indicator";
const PANEL_BUTTON_ID = "bumble-encounters-settings-button";
const PANEL_ID = "bumble-encounters-settings-panel";
const MAX_RESULTS = 80;

const SETTINGS_STORAGE_KEY = "bumbleEncountersSettings";
const FIELD_DEFINITIONS = [
  {
    id: "hasUserVoted",
    label: "has_user_voted",
    defaultValue: true
  },
  {
    id: "matchMessage",
    label: "match_message",
    defaultValue: true
  },
  {
    id: "theirVote",
    label: "their_vote",
    defaultValue: false
  },
  {
    id: "queueIndex",
    label: "position dans la file",
    defaultValue: false
  },
  {
    id: "allowCrush",
    label: "allow_crush",
    defaultValue: false
  },
  {
    id: "allowChatFromMatchScreen",
    label: "allow_chat_from_match_screen",
    defaultValue: false
  },
  {
    id: "gameMode",
    label: "game_mode",
    defaultValue: false
  },
  {
    id: "accessLevel",
    label: "access_level",
    defaultValue: false
  },
  {
    id: "userId",
    label: "user_id",
    defaultValue: false
  }
];

const state = {
  profiles: [],
  observer: null,
  renderTimer: null,
  settings: createDefaultSettings()
};

function createDefaultSettings() {
  return FIELD_DEFINITIONS.reduce((settings, field) => {
    settings[field.id] = field.defaultValue;
    return settings;
  }, {});
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get([SETTINGS_STORAGE_KEY], (result) => {
      const savedSettings = result?.[SETTINGS_STORAGE_KEY];
      const nextSettings = createDefaultSettings();

      if (savedSettings && typeof savedSettings === "object") {
        for (const field of FIELD_DEFINITIONS) {
          if (typeof savedSettings[field.id] === "boolean") {
            nextSettings[field.id] = savedSettings[field.id];
          }
        }
      }

      resolve(nextSettings);
    });
  });
}

function saveSettings() {
  chrome.storage.local.set({
    [SETTINGS_STORAGE_KEY]: state.settings
  });
}

function injectPageHook() {
  if (document.documentElement.dataset.bumbleEncountersHook === "1") {
    return;
  }

  document.documentElement.dataset.bumbleEncountersHook = "1";

  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("page-hook.js");
  script.async = false;
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

function normalizeName(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseAge(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function formatValue(value) {
  if (typeof value === "boolean") {
    return String(value);
  }

  if (value === null || value === undefined || value === "") {
    return "";
  }

  return String(value);
}

function extractProfiles(payload) {
  const bodies = Array.isArray(payload?.body) ? payload.body : [];
  const results = [];

  for (const body of bodies) {
    const encounters = body?.client_encounters;
    const items = Array.isArray(encounters?.results) ? encounters.results : [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const user = item?.user;
      const name = user?.name;
      const age = user?.age;

      if (!name || typeof age !== "number") {
        continue;
      }

      results.push({
        key: `${normalizeName(name)}::${age}`,
        name,
        age,
        userId: user?.user_id || "",
        accessLevel: user?.access_level ?? null,
        hasUserVoted: Boolean(item?.has_user_voted),
        matchMessage: typeof user?.match_message === "string" ? user.match_message : "",
        theirVote: user?.their_vote ?? null,
        allowCrush: user?.allow_crush ?? null,
        allowChatFromMatchScreen: user?.allow_chat_from_match_screen ?? null,
        gameMode: user?.game_mode ?? null,
        queueIndex: index,
        capturedAt: Date.now()
      });
    }
  }

  return results;
}

function mergeProfiles(nextProfiles) {
  if (!nextProfiles.length) {
    return;
  }

  const merged = [...nextProfiles, ...state.profiles];
  const deduped = [];
  const seen = new Set();

  for (const profile of merged) {
    const uniqueKey = `${profile.userId}::${profile.key}::${profile.queueIndex}`;
    if (seen.has(uniqueKey)) {
      continue;
    }

    seen.add(uniqueKey);
    deduped.push(profile);

    if (deduped.length >= MAX_RESULTS) {
      break;
    }
  }

  state.profiles = deduped;
  updateSettingsButtonState();
}

function getCurrentProfileFromDom() {
  const userNode = document.querySelector(USER_SELECTOR);
  const nameNode = userNode?.querySelector(NAME_SELECTOR) || null;
  const ageNode = userNode?.querySelector(AGE_SELECTOR) || null;

  if (!nameNode || !ageNode) {
    return null;
  }

  const name = nameNode.textContent || "";
  const age = parseAge(ageNode.textContent || "");

  if (!name.trim() || age === null) {
    return null;
  }

  return {
    nameNode,
    ageNode,
    name: name.trim(),
    age,
    key: `${normalizeName(name)}::${age}`
  };
}

function findBestMatch(currentProfile) {
  const matches = state.profiles.filter((profile) => profile.key === currentProfile.key);
  if (!matches.length) {
    return null;
  }

  matches.sort((left, right) => {
    if (left.queueIndex !== right.queueIndex) {
      return left.queueIndex - right.queueIndex;
    }

    return right.capturedAt - left.capturedAt;
  });

  return matches[0];
}

function createBadge() {
  const badge = document.createElement("div");
  badge.id = BADGE_ID;
  badge.style.display = "inline-flex";
  badge.style.alignItems = "center";
  badge.style.gap = "8px";
  badge.style.marginLeft = "10px";
  badge.style.padding = "6px 10px";
  badge.style.borderRadius = "999px";
  badge.style.fontSize = "12px";
  badge.style.fontWeight = "700";
  badge.style.lineHeight = "1.2";
  badge.style.verticalAlign = "middle";
  badge.style.maxWidth = "min(60vw, 420px)";
  badge.style.flexWrap = "wrap";
  badge.style.boxShadow = "0 2px 12px rgba(0, 0, 0, 0.18)";
  badge.style.border = "1px solid transparent";
  badge.style.fontFamily = "ui-sans-serif, system-ui, sans-serif";
  return badge;
}

function ensureBadge(anchorNode) {
  let badge = document.getElementById(BADGE_ID);
  if (!badge) {
    badge = createBadge();
  }

  if (badge.previousElementSibling !== anchorNode) {
    anchorNode.insertAdjacentElement("afterend", badge);
  }

  return badge;
}

function detachBadge() {
  const badge = document.getElementById(BADGE_ID);
  if (badge) {
    badge.remove();
  }
}

function buildVisibleParts(profile) {
  const parts = [];

  for (const field of FIELD_DEFINITIONS) {
    if (!state.settings[field.id]) {
      continue;
    }

    if (field.id === "matchMessage") {
      const matchMessage = profile.matchMessage.trim();
      if (!matchMessage) {
        continue;
      }

      parts.push(`${field.label}: ${matchMessage}`);
      continue;
    }

    const rawValue = profile[field.id];
    const formattedValue = formatValue(rawValue);

    if (!formattedValue) {
      continue;
    }

    if (field.id === "queueIndex") {
      parts.push(`${field.label}: ${profile.queueIndex + 1}`);
      continue;
    }

    parts.push(`${field.label}: ${formattedValue}`);
  }

  return parts;
}

function setBadgeState(badge, matchedProfile) {
  const voted = matchedProfile.hasUserVoted;
  const visibleParts = buildVisibleParts(matchedProfile);

  if (!visibleParts.length) {
    badge.style.display = "none";
    return;
  }

  badge.style.display = "inline-flex";
  badge.style.background = voted ? "rgba(33, 150, 83, 0.14)" : "rgba(255, 179, 0, 0.14)";
  badge.style.borderColor = voted ? "rgba(33, 150, 83, 0.35)" : "rgba(255, 179, 0, 0.35)";
  badge.style.color = "#1f1f1f";
  badge.textContent = visibleParts.join(" | ");
}

function render() {
  updateSettingsButtonState();

  const currentProfile = getCurrentProfileFromDom();
  if (!currentProfile) {
    detachBadge();
    return;
  }

  const matchedProfile = findBestMatch(currentProfile);
  if (!matchedProfile) {
    detachBadge();
    return;
  }

  const badge = ensureBadge(currentProfile.ageNode);
  setBadgeState(badge, matchedProfile);
}

function scheduleRender() {
  window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(render, 50);
}

function startDomObserver() {
  if (state.observer) {
    return;
  }

  state.observer = new MutationObserver(() => {
    scheduleRender();
  });

  state.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function createSettingsButton() {
  let button = document.getElementById(PANEL_BUTTON_ID);
  if (button) {
    return button;
  }

  button = document.createElement("button");
  button.id = PANEL_BUTTON_ID;
  button.type = "button";
  button.textContent = "Infos";
  button.style.position = "fixed";
  button.style.top = "16px";
  button.style.right = "16px";
  button.style.zIndex = "2147483647";
  button.style.border = "0";
  button.style.borderRadius = "999px";
  button.style.padding = "10px 14px";
  button.style.background = "#1f1f1f";
  button.style.color = "#ffffff";
  button.style.fontSize = "13px";
  button.style.fontWeight = "700";
  button.style.cursor = "pointer";
  button.style.boxShadow = "0 12px 30px rgba(0, 0, 0, 0.22)";
  button.style.fontFamily = "ui-sans-serif, system-ui, sans-serif";

  button.addEventListener("click", () => {
    const panel = ensureSettingsPanel();
    const isOpen = panel.dataset.open === "true";
    panel.dataset.open = isOpen ? "false" : "true";
    panel.style.display = isOpen ? "none" : "block";
  });

  document.documentElement.appendChild(button);
  return button;
}

function updateSettingsButtonState() {
  const button = document.getElementById(PANEL_BUTTON_ID);
  if (!button) {
    return;
  }

  button.textContent = `Infos (${state.profiles.length})`;
}

function createCheckboxRow(field) {
  const label = document.createElement("label");
  label.style.display = "flex";
  label.style.alignItems = "center";
  label.style.gap = "10px";
  label.style.justifyContent = "space-between";
  label.style.padding = "10px 12px";
  label.style.marginBottom = "8px";
  label.style.border = "1px solid rgba(0, 0, 0, 0.08)";
  label.style.borderRadius = "12px";
  label.style.cursor = "pointer";
  label.style.fontSize = "13px";
  label.style.color = "#222222";
  label.style.background = "#fafafa";

  const left = document.createElement("div");
  left.style.display = "flex";
  left.style.alignItems = "center";
  left.style.gap = "10px";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = Boolean(state.settings[field.id]);
  checkbox.dataset.fieldId = field.id;
  checkbox.style.width = "16px";
  checkbox.style.height = "16px";
  checkbox.style.minWidth = "16px";
  checkbox.style.minHeight = "16px";
  checkbox.style.margin = "0";
  checkbox.style.padding = "0";
  checkbox.style.opacity = "1";
  checkbox.style.display = "block";
  checkbox.style.visibility = "visible";
  checkbox.style.pointerEvents = "auto";
  checkbox.style.accentColor = "#111111";
  checkbox.style.appearance = "auto";
  checkbox.style.webkitAppearance = "checkbox";
  checkbox.style.flexShrink = "0";
  checkbox.style.cursor = "pointer";

  const text = document.createElement("span");
  text.textContent = field.label;
  text.style.flex = "1";
  text.style.fontWeight = "500";

  const status = document.createElement("span");
  status.style.fontSize = "11px";
  status.style.fontWeight = "800";
  status.style.borderRadius = "999px";
  status.style.padding = "4px 8px";
  status.style.flexShrink = "0";

  const refreshRowState = () => {
    const enabled = checkbox.checked;
    label.style.background = enabled ? "rgba(33, 150, 83, 0.08)" : "#fafafa";
    label.style.borderColor = enabled ? "rgba(33, 150, 83, 0.28)" : "rgba(0, 0, 0, 0.08)";
    text.style.fontWeight = enabled ? "800" : "500";
    status.textContent = enabled ? "ON" : "OFF";
    status.style.background = enabled ? "rgba(33, 150, 83, 0.14)" : "rgba(0, 0, 0, 0.06)";
    status.style.color = enabled ? "#1f6f43" : "#666666";
  };
  checkbox.__refreshRowState = refreshRowState;

  checkbox.addEventListener("change", () => {
    state.settings[field.id] = checkbox.checked;
    refreshRowState();
    saveSettings();
    scheduleRender();
  });

  left.appendChild(checkbox);
  left.appendChild(text);
  label.appendChild(left);
  label.appendChild(status);
  refreshRowState();

  return label;
}

function ensureSettingsPanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) {
    return panel;
  }

  panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.dataset.open = "false";
  panel.style.position = "fixed";
  panel.style.top = "64px";
  panel.style.right = "16px";
  panel.style.zIndex = "2147483647";
  panel.style.width = "320px";
  panel.style.maxWidth = "calc(100vw - 32px)";
  panel.style.maxHeight = "70vh";
  panel.style.overflowY = "auto";
  panel.style.display = "none";
  panel.style.background = "#ffffff";
  panel.style.border = "1px solid rgba(0, 0, 0, 0.08)";
  panel.style.borderRadius = "18px";
  panel.style.padding = "14px 16px";
  panel.style.boxShadow = "0 18px 45px rgba(0, 0, 0, 0.22)";
  panel.style.fontFamily = "ui-sans-serif, system-ui, sans-serif";

  const title = document.createElement("div");
  title.textContent = "Infos a afficher";
  title.style.fontSize = "15px";
  title.style.fontWeight = "800";
  title.style.color = "#111111";

  const subtitle = document.createElement("div");
  subtitle.textContent = "Coche ou decoche les champs visibles sur le profil courant.";
  subtitle.style.marginTop = "4px";
  subtitle.style.marginBottom = "12px";
  subtitle.style.fontSize = "12px";
  subtitle.style.lineHeight = "1.4";
  subtitle.style.color = "#5a5a5a";

  const fieldsContainer = document.createElement("div");
  for (const field of FIELD_DEFINITIONS) {
    fieldsContainer.appendChild(createCheckboxRow(field));
  }

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  actions.style.marginTop = "14px";

  const selectAllButton = document.createElement("button");
  selectAllButton.type = "button";
  selectAllButton.textContent = "Tout cocher";
  applySecondaryButtonStyle(selectAllButton);
  selectAllButton.addEventListener("click", () => {
    for (const field of FIELD_DEFINITIONS) {
      state.settings[field.id] = true;
    }

    syncPanelCheckboxes();
    saveSettings();
    scheduleRender();
  });

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.textContent = "Par defaut";
  applySecondaryButtonStyle(resetButton);
  resetButton.addEventListener("click", () => {
    state.settings = createDefaultSettings();
    syncPanelCheckboxes();
    saveSettings();
    scheduleRender();
  });

  actions.appendChild(selectAllButton);
  actions.appendChild(resetButton);

  panel.appendChild(title);
  panel.appendChild(subtitle);
  panel.appendChild(fieldsContainer);
  panel.appendChild(actions);

  document.documentElement.appendChild(panel);
  return panel;
}

function applySecondaryButtonStyle(button) {
  button.style.border = "1px solid rgba(0, 0, 0, 0.12)";
  button.style.borderRadius = "10px";
  button.style.padding = "8px 10px";
  button.style.background = "#f5f5f5";
  button.style.color = "#111111";
  button.style.fontSize = "12px";
  button.style.fontWeight = "700";
  button.style.cursor = "pointer";
}

function syncPanelCheckboxes() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) {
    return;
  }

  const inputs = panel.querySelectorAll("input[type='checkbox'][data-field-id]");
  for (const input of inputs) {
    const fieldId = input.dataset.fieldId;
    input.checked = Boolean(state.settings[fieldId]);
    if (typeof input.__refreshRowState === "function") {
      input.__refreshRowState();
    }
  }
}

function hidePanelOnOutsideClick(event) {
  const panel = document.getElementById(PANEL_ID);
  const button = document.getElementById(PANEL_BUTTON_ID);

  if (!panel || panel.style.display === "none") {
    return;
  }

  if (panel.contains(event.target) || button?.contains(event.target)) {
    return;
  }

  panel.dataset.open = "false";
  panel.style.display = "none";
}

function setupUi() {
  createSettingsButton();
  ensureSettingsPanel();
  updateSettingsButtonState();

  document.addEventListener("click", hidePanelOnOutsideClick, true);
}

window.addEventListener(ENCOUNTERS_EVENT, (event) => {
  const payload = event.detail?.payload;
  const profiles = extractProfiles(payload);
  mergeProfiles(profiles);
  scheduleRender();
});

async function init() {
  state.settings = await loadSettings();
  injectPageHook();
  setupUi();
  startDomObserver();
  scheduleRender();
}

init();
