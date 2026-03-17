const ENCOUNTERS_EVENT = "bumble-encounters-response";
const USER_SELECTOR = "h1.encounters-story-profile__user";
const NAME_SELECTOR = "span.encounters-story-profile__name";
const AGE_SELECTOR = "span.encounters-story-profile__age";
const BADGE_ID = "bumble-encounters-vote-indicator";
const MAX_RESULTS = 80;

const state = {
  profiles: [],
  observer: null,
  renderTimer: null
};

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
        hasUserVoted: Boolean(item?.has_user_voted),
        matchMessage: typeof user?.match_message === "string" ? user.match_message : "",
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

function ensureBadge(anchorNode) {
  let badge = document.getElementById(BADGE_ID);
  if (!badge) {
    badge = document.createElement("div");
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

function setBadgeState(badge, matchedProfile) {
  const voted = matchedProfile.hasUserVoted;
  const matchMessage = matchedProfile.matchMessage.trim();

  badge.style.background = voted ? "rgba(33, 150, 83, 0.14)" : "rgba(255, 179, 0, 0.14)";
  badge.style.borderColor = voted ? "rgba(33, 150, 83, 0.35)" : "rgba(255, 179, 0, 0.35)";
  badge.style.color = "#1f1f1f";

  const parts = [`has_user_voted: ${String(voted)}`];
  if (voted && matchMessage) {
    parts.push(`match_message: ${matchMessage}`);
  }

  badge.textContent = parts.join(" | ");
}

function render() {
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

window.addEventListener(ENCOUNTERS_EVENT, (event) => {
  const payload = event.detail?.payload;
  const profiles = extractProfiles(payload);
  mergeProfiles(profiles);
  scheduleRender();
});

injectPageHook();
startDomObserver();
scheduleRender();
