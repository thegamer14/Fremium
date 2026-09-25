(() => {
  const configKey = "fremium-site-config";
  const sessionKey = "fremium-site-session";
  const liveRefreshMs = 5000;
  let liveTimer = null;
  let liveSession = null;
  let dashboardPromise = null;
  let selectedContext = "current";
  let latestData = null;
  const fallbackConfig = window.FremiumAccountConfig || {};
  const artwork = {
    "let you down": "https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/6e/96/04/6e9604a8-3270-f86e-0c47-0127141545c3/17UM1IM17084.rgb.jpg/600x600bb.jpg",
    "the search": "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/3e/fe/fa/3efefa81-fa46-8124-46b1-1b340baff0e9/19UMGIM46307.rgb.jpg/600x600bb.jpg",
    "clouded": "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/c2/38/87/c23887b2-b0db-6962-61ac-203f801c5fa3/21UMGIM08880.rgb.jpg/600x600bb.jpg",
  };
  const getArtwork = value => artwork[String(value || "").trim().toLowerCase()] || "";
  const asNumber = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const formatScore = value => {
    const number = asNumber(value);
    return number == null ? "—" : String(Math.round(number));
  };
  const formatComponent = value => {
    const number = asNumber(value);
    if (number == null) return "—";
    return `${number > 0 ? "+" : ""}${Math.round(number)}`;
  };
  const contextLabel = value => {
    const text = String(value || "").trim();
    if (!text || text === "global") return "Global";
    if (text.includes("playlist")) return "Playlist";
    if (text.includes("album")) return "Album";
    if (text.includes("artist")) return "Artist";
    return text.length > 28 ? `${text.slice(0, 25)}…` : text;
  };
  const formatTime = value => String(value || "").replace(":", " · ");
  const contextValues = (current, events, contextUri) => {
    const values = [current?.qiContext || contextUri || "global"];
    events.forEach(event => { if (event.context_uri && !values.includes(event.context_uri)) values.push(event.context_uri); });
    return values.slice(0, 4);
  };
  const liveImage = (source, alt, className, fallback = "QI") => source ? `<img class="${className}" src="${escapeHtml(source)}" alt="${escapeHtml(alt)}">` : `<div class="${className} ${className}-fallback">${escapeHtml(fallback)}</div>`;
  const setLiveStatus = (label, kind = "connected") => {
    const status = document.getElementById("account-live-status");
    const text = document.getElementById("account-live-status-text");
    if (!status || !text) return;
    status.className = `account-live-status ${kind}`;
    text.textContent = label;
  };
  const nowPlayingMarkup = (current, contextUri) => {
    const name = current?.name || "Waiting for Spotify";
    const artist = current?.artist || "Open Fremium to start a session";
    const album = current?.album || "No current track synced";
    const score = asNumber(current?.qiScore);
    const scoreWidth = score == null ? 0 : Math.max(0, Math.min(100, score));
    const confidence = current?.qiConfidence == null ? "QI score from app" : `${escapeHtml(current.qiConfidence)}% confidence`;
    const components = current?.qiComponents || current?.qi_components || {};
    const reasons = Array.isArray(current?.qiReasons) ? current.qiReasons : [];
    const context = current?.qiContext || contextUri || "global";
    const timeDetail = current?.qiTime ? ` · ${escapeHtml(formatTime(current.qiTime))}` : "";
    const componentMarkup = [["Replay", components.replay], ["Completion", components.completion], ["Skip", components.skip]].map(([label, value]) => `<span>${label}<strong>${formatComponent(value)}</strong></span>`).join("");
    const reasonMarkup = reasons.length ? reasons.slice(0, 4).map(reason => `<span>${escapeHtml(reason)}</span>`).join("") : `<span>Waiting for Queue Intelligence signals</span>`;
    return `<div class="account-now-top"><span>Now playing · Queue Intelligence</span><span>${current ? "● CONNECTED" : "● WAITING"}</span></div>${liveImage(current?.image || getArtwork(current?.name), `${name} album cover`, "account-now-cover", "QI")}<div class="account-now-info"><div class="account-now-title"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(artist)} · ${escapeHtml(album)}</span><span>${escapeHtml(contextLabel(context))}${timeDetail}</span></div><div class="account-now-score"><strong>${formatScore(score)}</strong> <small>/ 100</small><span class="account-now-confidence">${confidence}</span></div></div><div class="account-score-bar"><span style="width:${scoreWidth}%"></span></div><div class="account-components">${componentMarkup}</div><div class="account-now-reasons">${reasonMarkup}</div>`;
  };
  const contextTabsMarkup = (current, events, contextUri) => {
    const currentValue = current?.qiContext || contextUri || "global";
    const values = contextValues(current, events, contextUri);
    const tabs = [{ value: "current", label: "Current session", detail: formatTime(current?.qiTime) || "Live" }, ...values.map(value => ({ value, label: contextLabel(value), detail: value === currentValue ? "Current" : "Synced" }))];
    return tabs.map(tab => `<button class="account-context-tab${tab.value === selectedContext ? " active" : ""}" type="button" data-context="${escapeHtml(tab.value)}"><strong>${escapeHtml(tab.label)}</strong><span>${escapeHtml(tab.detail)}</span></button>`).join("");
  };
  const contextSummaryMarkup = (current, contextUri) => {
    if (!current) return `<div class="account-context-empty">Current Queue Intelligence data will appear after Fremium syncs a track.</div>`;
    const image = current.image || getArtwork(current.name);
    const context = current.qiContext || contextUri || "global";
    const contextText = formatTime(current.qiTime) || contextLabel(context);
    return `<div class="account-context-track">${liveImage(image, `${current.name || "Track"} album cover`, "account-context-art", "QI")}<div class="account-context-copy"><strong>${escapeHtml(current.name || "Unknown track")}</strong><span>${escapeHtml(current.artist || "Unknown artist")} · ${escapeHtml(contextText)}</span></div></div><div class="account-context-score"><strong>${formatScore(current.qiScore)}</strong><span>${current.qiConfidence == null ? "QI score" : `${escapeHtml(current.qiConfidence)}% confidence`}</span></div>`;
  };
  const getStored = (storage, key, fallback = null) => {
    try {
      const value = storage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch { return fallback; }
  };
  const setStored = (storage, key, value) => {
    try { storage.setItem(key, JSON.stringify(value)); } catch {}
  };
  const removeStored = (storage, key) => {
    try { storage.removeItem(key); } catch {}
  };
  const normalizeUrl = value => String(value || "").trim().replace(/\/+$/, "");
  const getConfig = () => {
    const saved = getStored(localStorage, configKey, {}) || {};
    return {
      url: normalizeUrl(fallbackConfig.supabaseUrl || saved.url || ""),
      key: String(fallbackConfig.supabaseAnonKey || saved.key || "").trim(),
    };
  };
  const setConfig = config => {
    const next = { url: normalizeUrl(config.url), key: String(config.key || "").trim() };
    if (!/^https?:\/\//i.test(next.url)) throw new Error("Enter the Supabase project URL.");
    if (!next.key) throw new Error("Enter the Supabase anon key.");
    setStored(localStorage, configKey, next);
    return next;
  };
  const getSession = () => getStored(sessionStorage, sessionKey, null);
  const normalizeSession = value => {
    if (!value?.access_token) return null;
    return { ...value, expires_at: Number(value.expires_at) || Date.now() + (Number(value.expires_in) || 3600) * 1000 };
  };
  const storeSession = value => {
    const session = normalizeSession(value);
    if (!session) { removeStored(sessionStorage, sessionKey); return null; }
    setStored(sessionStorage, sessionKey, session);
    return session;
  };
  const request = async (path, options = {}) => {
    const config = getConfig();
    if (!config.url || !config.key) throw new Error("Fremium account service is not configured.");
    const { method = "GET", body, auth = true, headers = {} } = options;
    const requestHeaders = { apikey: config.key, ...headers };
    if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
    if (auth) {
      const session = await getValidSession();
      if (!session?.access_token) throw new Error("Sign in to view your dashboard.");
      requestHeaders.Authorization = `Bearer ${session.access_token}`;
    }
    const response = await fetch(`${config.url}/${path}`, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const message = data?.msg || data?.message || data?.error?.message || data?.error_description || `Request failed (${response.status})`;
      throw new Error(message);
    }
    return data;
  };
  const getValidSession = async () => {
    const session = getSession();
    if (!session) return null;
    if (!Number(session.expires_at) || Number(session.expires_at) > Date.now() + 60000) return session;
    try {
      const refreshed = await request("auth/v1/token?grant_type=refresh_token", { method: "POST", auth: false, body: { refresh_token: session.refresh_token } });
      return storeSession(refreshed);
    } catch {
      removeStored(sessionStorage, sessionKey);
      return null;
    }
  };
  const clearAuthUrl = () => {
    try { window.history.replaceState({}, document.title, window.location.pathname); } catch {}
  };
  const verifyAuthCallback = async () => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const callbackError = query.get("error_description") || query.get("error") || hash.get("error_description") || hash.get("error");
    if (callbackError) {
      clearAuthUrl();
      throw new Error(callbackError.replace(/\+/g, " "));
    }
    const tokenHash = query.get("token_hash");
    if (tokenHash) {
      const result = await request("auth/v1/verify", { method: "POST", auth: false, body: { token_hash: tokenHash, type: query.get("type") || "email" } });
      clearAuthUrl();
      return storeSession(result);
    }
    if (hash.get("access_token")) {
      const rawExpiry = Number(hash.get("expires_at")) || 0;
      const expiresAt = rawExpiry > 100000000000 ? rawExpiry : rawExpiry ? rawExpiry * 1000 : Date.now() + (Number(hash.get("expires_in")) || 3600) * 1000;
      let session = storeSession({ access_token: hash.get("access_token"), refresh_token: hash.get("refresh_token"), token_type: hash.get("token_type"), expires_at: expiresAt, expires_in: Number(hash.get("expires_in")) || 3600 });
      try {
        const user = await request("auth/v1/user");
        session = storeSession({ ...session, user });
      } catch {}
      clearAuthUrl();
      return session;
    }
    if (query.get("code")) {
      clearAuthUrl();
      throw new Error("This confirmation link uses an unsupported code flow. Request a new verification email after setting the Supabase Site URL.");
    }
    return null;
  };
  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  const formatNumber = value => new Intl.NumberFormat().format(Number(value || 0));
  const formatDate = value => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  };
  const eventLabel = value => ({ play: "Played", repeat: "Repeated", completion: "Completed", skip: "Skipped", abandon: "Abandoned", queue_action: "Queue action" }[value] || value || "Activity");
  const deriveSummary = events => {
    const rows = Array.isArray(events) ? events : [];
    const count = type => rows.filter(event => event.event_type === type).length;
    const unique = new Set(rows.map(event => event.track_uri || `${event.track_name || ""}-${event.artist || ""}`).filter(Boolean));
    return { lifetimePlays: count("play") + count("repeat") + count("completion"), lifetimeSkips: count("skip") + count("abandon"), repeats: count("repeat"), completions: count("completion"), abandonments: count("abandon"), queueActions: count("queue_action"), tracks: unique.size, playlists: 0 };
  };
  const message = (text, kind = "") => {
    const element = document.getElementById("account-message");
    element.textContent = text || "";
    element.className = `account-message ${kind}`.trim();
    element.hidden = !text;
  };
  const statCard = (label, value, sub) => `<div class="account-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(sub || "")}</small></div>`;
  const artworkImage = (source, alt, className) => source ? `<img class="${className}" src="${escapeHtml(source)}" alt="${escapeHtml(alt)}" loading="lazy">` : "";
  const currentTrackMarkup = current => {
    const image = current.image || getArtwork(current.name);
    return `<div class="account-current-track">${artworkImage(image, `${current.name || "Track"} album cover`, "account-art")}<div class="account-track-copy"><strong>${escapeHtml(current.name || "Unknown track")}</strong><span>${escapeHtml(current.artist || "Unknown artist")} · ${escapeHtml(current.album || "Unknown album")}</span></div></div><div class="account-current-qi"><strong>${escapeHtml(current.qiScore ?? "—")}</strong><span>${current.qiConfidence != null ? `${escapeHtml(current.qiConfidence)}% confidence` : "QI score from app"}</span></div>`;
  };
  const leaderMarkup = track => {
    const image = track.image || getArtwork(track.name);
    return `<div class="account-list-row"><div class="account-list-main">${artworkImage(image, `${track.name || "Track"} album cover`, "account-list-art")}<div class="account-track-copy"><strong>${escapeHtml(track.name || "Unknown track")}</strong><span>${escapeHtml(track.artist || "Unknown artist")}</span></div></div><b>${escapeHtml(formatNumber(track.plays))} plays</b></div>`;
  };
  const eventMarkup = event => {
    const image = event.image || getArtwork(event.track_name);
    return `<div class="account-list-row"><div class="account-list-main">${artworkImage(image, `${event.track_name || "Track"} album cover`, "account-list-art")}<div class="account-track-copy"><strong>${escapeHtml(event.track_name || "Queue activity")}</strong><span>${escapeHtml(event.artist || "Unknown artist")} · ${escapeHtml(eventLabel(event.event_type))}</span></div></div><b>${escapeHtml(formatDate(event.occurred_at))}</b></div>`;
  };
  const renderDashboard = data => {
    const source = data || {};
    latestData = source;
    const summary = source.summary || deriveSummary(source.events);
    const leaders = Array.isArray(source.leaders) ? source.leaders : [];
    const current = source.currentTrack || source.current_track || null;
    const events = Array.isArray(source.events) ? source.events : [];
    const contextUri = source.contextUri || source.context_uri || current?.qiContext || "global";
    const currentContext = current?.qiContext || (contextUri === "global" ? "" : contextUri);
    const contextOptions = contextValues(current, events, contextUri);
    if (selectedContext !== "current" && !contextOptions.includes(selectedContext)) selectedContext = "current";
    const visibleEvents = selectedContext === "current" ? (currentContext ? events.filter(event => event.context_uri === currentContext) : events) : events.filter(event => event.context_uri === selectedContext);
    document.getElementById("account-dashboard-title").textContent = current?.name ? `Last synced: ${current.name}` : "Sign in to load your stats";
    document.getElementById("account-now-card").innerHTML = nowPlayingMarkup(current, contextUri);
    document.getElementById("account-context-card").innerHTML = `<div class="account-context-head"><div><div class="eyebrow">Listening context</div><h3>Queue Intelligence, in context.</h3><p>Live signals from the session synced by Fremium.</p></div></div><div class="account-context-tabs" id="account-context-tabs">${contextTabsMarkup(current, events, contextUri)}</div><div class="account-context-summary" id="account-context-summary">${contextSummaryMarkup(current, contextUri)}</div>`;
    document.getElementById("account-context-tabs").querySelectorAll("[data-context]").forEach(button => button.addEventListener("click", () => { selectedContext = button.dataset.context; renderDashboard(latestData); }));
    document.getElementById("account-stats").innerHTML = [
      statCard("Lifetime plays", formatNumber(summary.lifetimePlays), "Observed by Fremium"),
      statCard("Tracks learned", formatNumber(summary.tracks), "Unique listening signals"),
      statCard("Completions", formatNumber(summary.completions), "Tracks allowed to finish"),
      statCard("Skips", formatNumber(summary.lifetimeSkips), "Weighted by timing"),
      statCard("Replays", formatNumber(summary.repeats), "Strong positive signal"),
      statCard("Queue actions", formatNumber(summary.queueActions), "Observed queue changes"),
      statCard("Abandonments", formatNumber(summary.abandonments), "Early exits"),
      statCard("Playlists", formatNumber(summary.playlists), "Contexts learned"),
    ].join("");
    document.getElementById("account-current").innerHTML = current ? currentTrackMarkup(current) : `<div class="account-empty">No current track has been synced yet.</div>`;
    document.getElementById("account-top").innerHTML = leaders.length ? leaders.slice(0, 5).map(leaderMarkup).join("") : `<div class="account-empty">Top tracks appear after Fremium syncs listening data.</div>`;
    document.getElementById("account-recent").innerHTML = visibleEvents.length ? visibleEvents.slice(0, 8).map(eventMarkup).join("") : `<div class="account-empty">Recent listening activity appears here.</div>`;
    const reasons = current?.qiReasons || [];
    document.getElementById("account-qi").innerHTML = `<div class="account-section-label">Queue Intelligence</div><div class="account-qi-grid"><div><strong>${escapeHtml(current?.qiScore ?? "—")}</strong><span>Current QI score</span></div><div><strong>${escapeHtml(summary.lifetimePlays || 0)}</strong><span>Lifetime plays</span></div><div><strong>${escapeHtml(summary.completions || 0)}</strong><span>Completions</span></div><div><strong>${escapeHtml(summary.repeats || 0)}</strong><span>Replays</span></div></div><div class="account-reasons">${reasons.length ? reasons.slice(0, 4).map(reason => `<span>${escapeHtml(reason)}</span>`).join("") : `<span>Open Song QI in Fremium to see the current explanation.</span>`}</div>`;
  };
  const showSignedOut = () => {
    stopLiveRefresh();
    document.getElementById("account-signed-out").hidden = false;
    document.getElementById("account-signed-in").hidden = true;
    setLiveStatus("OFFLINE", "offline");
  };
  const showSignedIn = session => {
    document.getElementById("account-signed-out").hidden = true;
    document.getElementById("account-signed-in").hidden = false;
    const user = session?.user || {};
    const label = user.user_metadata?.username || user.email || "Signed in";
    document.getElementById("account-user").textContent = `${label} · private dashboard`;
    setLiveStatus("CONNECTING", "connecting");
  };
  const refreshLiveDashboard = async session => {
    try {
      await loadDashboard(session);
      return true;
    } catch (error) {
      setLiveStatus("OFFLINE", "offline");
      return false;
    }
  };
  const stopLiveRefresh = () => {
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = null;
    liveSession = null;
  };
  const startLiveRefresh = session => {
    stopLiveRefresh();
    liveSession = session;
    setLiveStatus("CONNECTING", "connecting");
    const firstRefresh = refreshLiveDashboard(session);
    liveTimer = setInterval(() => {
      if (document.visibilityState === "visible" && liveSession) refreshLiveDashboard(liveSession);
    }, liveRefreshMs);
    return firstRefresh;
  };
  const loadDashboard = session => {
    if (dashboardPromise) return dashboardPromise;
    dashboardPromise = (async () => {
      const [snapshotResult, eventResult, syncResult] = await Promise.all([
        request("rest/v1/fremium_qi_snapshots?select=summary,leaders,current_track,context_uri,snapshot_at,session_id&order=snapshot_at.desc&limit=1"),
        request("rest/v1/fremium_listening_events?select=occurred_at,event_type,track_uri,track_name,artist,album,context_uri&order=occurred_at.desc&limit=200"),
        request("rest/v1/fremium_sync_state?select=last_synced_at,last_event_at&limit=1"),
      ]);
      const snapshot = Array.isArray(snapshotResult) ? snapshotResult[0] : null;
      const sync = Array.isArray(syncResult) ? syncResult[0] : null;
      const data = { summary: snapshot?.summary, leaders: snapshot?.leaders, currentTrack: snapshot?.current_track, contextUri: snapshot?.context_uri, events: Array.isArray(eventResult) ? eventResult : [], lastSyncedAt: sync?.last_synced_at || snapshot?.snapshot_at };
      renderDashboard(data);
      const user = session?.user || {};
      const label = user.user_metadata?.username || user.email || "Signed in";
      document.getElementById("account-user").textContent = `${label} · synced ${formatDate(data.lastSyncedAt)}`;
      setLiveStatus(data.currentTrack?.name ? "CONNECTED" : "WAITING", data.currentTrack?.name ? "connected" : "waiting");
      return data;
    })().finally(() => { dashboardPromise = null; });
    return dashboardPromise;
  };
  const signIn = async (email, password) => {
    const result = await request("auth/v1/token?grant_type=password", { method: "POST", auth: false, body: { email, password } });
    const session = storeSession(result);
    showSignedIn(session);
    await startLiveRefresh(session);
    return session;
  };
  const signUp = async (email, password, username) => {
    const normalizedUsername = String(username || "").trim();
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(normalizedUsername)) throw new Error("Username must be 3-32 characters using letters, numbers, _ or -");
    const result = await request("auth/v1/signup", { method: "POST", auth: false, body: { email, password, data: { username: normalizedUsername, display_name: normalizedUsername } } });
    if (result?.access_token) {
      const session = storeSession(result);
      showSignedIn(session);
      await startLiveRefresh(session);
      return { session };
    }
    return { requiresConfirmation: true };
  };
  const resendVerification = async email => {
    const address = String(email || "").trim();
    if (!address) throw new Error("Email is required");
    await request("auth/v1/resend", {
      method: "POST",
      auth: false,
      body: { type: "signup", email: address, options: { emailRedirectTo: fallbackConfig.siteUrl || `${window.location.origin}${window.location.pathname}` } },
    });
    return { sent: true, email: address };
  };
  const signOut = async () => {
    try { if (getSession()?.access_token) await request("auth/v1/logout", { method: "POST" }); } catch {}
    removeStored(sessionStorage, sessionKey);
    showSignedOut();
    renderDashboard(null);
    message("You are signed out.", "ok");
  };
  const initializeAuth = async () => {
    try {
      const callbackSession = await verifyAuthCallback();
      if (callbackSession) {
        showSignedIn(callbackSession);
        await startLiveRefresh(callbackSession);
        message("Email verified. Your Fremium account is ready.", "ok");
        return;
      }
    } catch (error) {
      message(error.message, "error");
    }
    const session = await getValidSession();
    if (session) {
      showSignedIn(session);
      startLiveRefresh(session).catch(error => message(error.message, "error"));
    } else {
      showSignedOut();
    }
  };
  const init = () => {
    const form = document.getElementById("account-auth-form");
    const displayField = document.getElementById("account-display-field");
    const usernameInput = document.getElementById("account-display-name");
    const submit = document.getElementById("account-submit");
    const resendButton = document.getElementById("account-resend");
    const toggle = document.getElementById("account-toggle");
    let mode = "signin";
    const updateMode = () => {
      const signup = mode === "signup";
      displayField.hidden = !signup;
      usernameInput.required = signup;
      resendButton.hidden = !signup;
      submit.textContent = signup ? "Create account" : "Sign in";
      toggle.textContent = signup ? "Already have an account? Sign in" : "Need an account? Create one";
    };
    toggle.addEventListener("click", () => { mode = mode === "signin" ? "signup" : "signin"; updateMode(); });
    document.getElementById("account-resend").addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await resendVerification(document.getElementById("account-email").value);
        message("If that account needs verification, a new email has been sent.", "ok");
      } catch (error) { message(error.message, "error"); }
      finally { button.disabled = false; }
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const button = submit;
      button.disabled = true;
      try {
        const email = document.getElementById("account-email").value.trim();
        const password = document.getElementById("account-password").value;
        if (mode === "signup") {
          const username = document.getElementById("account-display-name").value.trim();
          const result = await signUp(email, password, username);
          message(result.requiresConfirmation ? "Check your email to confirm the account, then sign in." : "Account created and dashboard loaded.", "ok");
        } else {
          await signIn(email, password);
          message("Signed in. Your private dashboard is ready.", "ok");
        }
      } catch (error) { message(error.message, "error"); }
      finally { button.disabled = false; }
    });
    document.getElementById("account-refresh").addEventListener("click", async () => {
      try { const session = await getValidSession(); if (!session) throw new Error("Sign in again to refresh."); await loadDashboard(session); message("Dashboard refreshed.", "ok"); } catch (error) { message(error.message, "error"); }
    });
    document.getElementById("account-signout").addEventListener("click", signOut);
    updateMode();
    renderDashboard(null);
    initializeAuth().catch(() => showSignedOut());
  };
  init();
  window.FremiumSiteAccount = { getConfig, setConfig, signIn, signUp, resendVerification, signOut, loadDashboard, getSession, verifyAuthCallback, startLiveRefresh, stopLiveRefresh };
})();
