(() => {
  const configKey = "fremium-site-config";
  const sessionKey = "fremium-site-session";
  const fallbackConfig = window.FremiumAccountConfig || {};
  const demoData = {
    summary: { lifetimePlays: 1284, lifetimeSkips: 92, tracks: 86, playlists: 14, sessionPlays: 18, sessionSkips: 2, repeats: 34, completions: 221, abandonments: 8, queueActions: 47 },
    leaders: [
      { name: "Let You Down", artist: "NF", plays: 34, skips: 1, completions: 28 },
      { name: "The Search", artist: "NF", plays: 27, skips: 2, completions: 24 },
      { name: "Clouded", artist: "NF", plays: 22, skips: 1, completions: 19 },
      { name: "Turning Page", artist: "Sleeping At Last", plays: 18, skips: 2, completions: 16 },
    ],
    currentTrack: { name: "Let You Down", artist: "NF", album: "Mansion", qiScore: 87, qiConfidence: 91, qiReasons: ["Replayed 8 times", "Usually finished", "Familiar in this playlist"] },
    events: [
      { occurred_at: new Date(Date.now() - 8 * 60000).toISOString(), event_type: "completion", track_name: "Let You Down", artist: "NF" },
      { occurred_at: new Date(Date.now() - 19 * 60000).toISOString(), event_type: "play", track_name: "The Search", artist: "NF" },
      { occurred_at: new Date(Date.now() - 31 * 60000).toISOString(), event_type: "repeat", track_name: "Clouded", artist: "NF" },
      { occurred_at: new Date(Date.now() - 48 * 60000).toISOString(), event_type: "skip", track_name: "A Song", artist: "Unknown artist" },
    ],
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
  const renderDashboard = (data, demo = false) => {
    const source = data || {};
    const summary = source.summary || deriveSummary(source.events);
    const leaders = Array.isArray(source.leaders) ? source.leaders : [];
    const current = source.currentTrack || source.current_track || null;
    const events = Array.isArray(source.events) ? source.events : [];
    document.getElementById("account-demo-banner").hidden = !demo;
    document.getElementById("account-dashboard-title").textContent = demo ? "Demo listening snapshot" : current?.name ? `Last synced: ${current.name}` : "Your listening snapshot";
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
    document.getElementById("account-current").innerHTML = current ? `<div class="account-current-track"><strong>${escapeHtml(current.name || "Unknown track")}</strong><span>${escapeHtml(current.artist || "Unknown artist")} · ${escapeHtml(current.album || "Unknown album")}</span></div><div class="account-current-qi"><strong>${escapeHtml(current.qiScore ?? "—")}</strong><span>${current.qiConfidence != null ? `${escapeHtml(current.qiConfidence)}% confidence` : "QI score from app"}</span></div>` : `<div class="account-empty">No current track has been synced yet.</div>`;
    document.getElementById("account-top").innerHTML = leaders.length ? leaders.slice(0, 5).map(track => `<div class="account-list-row"><div><strong>${escapeHtml(track.name || "Unknown track")}</strong><span>${escapeHtml(track.artist || "Unknown artist")}</span></div><b>${escapeHtml(formatNumber(track.plays))} plays</b></div>`).join("") : `<div class="account-empty">Top tracks appear after Fremium syncs listening data.</div>`;
    document.getElementById("account-recent").innerHTML = events.length ? events.slice(0, 8).map(event => `<div class="account-list-row"><div><strong>${escapeHtml(event.track_name || "Queue activity")}</strong><span>${escapeHtml(event.artist || "Unknown artist")} · ${escapeHtml(eventLabel(event.event_type))}</span></div><b>${escapeHtml(formatDate(event.occurred_at))}</b></div>`).join("") : `<div class="account-empty">Recent listening activity appears here.</div>`;
    const reasons = current?.qiReasons || [];
    document.getElementById("account-qi").innerHTML = `<div class="account-section-label">Queue Intelligence</div><div class="account-qi-grid"><div><strong>${escapeHtml(current?.qiScore ?? "—")}</strong><span>Current QI score</span></div><div><strong>${escapeHtml(summary.lifetimePlays || 0)}</strong><span>Lifetime plays</span></div><div><strong>${escapeHtml(summary.completions || 0)}</strong><span>Completions</span></div><div><strong>${escapeHtml(summary.repeats || 0)}</strong><span>Replays</span></div></div><div class="account-reasons">${reasons.length ? reasons.slice(0, 4).map(reason => `<span>${escapeHtml(reason)}</span>`).join("") : `<span>Open Song QI in Fremium to see the current explanation.</span>`}</div>`;
  };
  const showSignedOut = () => {
    document.getElementById("account-signed-out").hidden = false;
    document.getElementById("account-signed-in").hidden = true;
  };
  const showSignedIn = session => {
    document.getElementById("account-signed-out").hidden = true;
    document.getElementById("account-signed-in").hidden = false;
    const user = session?.user || {};
    const label = user.user_metadata?.username || user.email || "Signed in";
    document.getElementById("account-user").textContent = `${label} · private dashboard`;
  };
  const loadDashboard = async session => {
    const [snapshotResult, eventResult] = await Promise.all([
      request("rest/v1/fremium_qi_snapshots?select=summary,leaders,current_track,snapshot_at,session_id&order=snapshot_at.desc&limit=1"),
      request("rest/v1/fremium_listening_events?select=occurred_at,event_type,track_uri,track_name,artist,album,context_uri&order=occurred_at.desc&limit=200"),
    ]);
    const snapshot = Array.isArray(snapshotResult) ? snapshotResult[0] : null;
    renderDashboard({ summary: snapshot?.summary, leaders: snapshot?.leaders, currentTrack: snapshot?.current_track, events: Array.isArray(eventResult) ? eventResult : [] });
    const user = session?.user || {};
    const label = user.user_metadata?.username || user.email || "Signed in";
    document.getElementById("account-user").textContent = `${label} · synced ${formatDate(snapshot?.snapshot_at)}`;
  };
  const signIn = async (email, password) => {
    const result = await request("auth/v1/token?grant_type=password", { method: "POST", auth: false, body: { email, password } });
    const session = storeSession(result);
    showSignedIn(session);
    await loadDashboard(session);
    return session;
  };
  const signUp = async (email, password, username) => {
    const normalizedUsername = String(username || "").trim();
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(normalizedUsername)) throw new Error("Username must be 3-32 characters using letters, numbers, _ or -");
    const result = await request("auth/v1/signup", { method: "POST", auth: false, body: { email, password, data: { username: normalizedUsername, display_name: normalizedUsername } } });
    if (result?.access_token) {
      const session = storeSession(result);
      showSignedIn(session);
      await loadDashboard(session);
      return { session };
    }
    return { requiresConfirmation: true };
  };
  const signOut = async () => {
    try { if (getSession()?.access_token) await request("auth/v1/logout", { method: "POST" }); } catch {}
    removeStored(sessionStorage, sessionKey);
    showSignedOut();
    renderDashboard(null);
    message("You are signed out.", "ok");
  };
  const init = () => {
    const form = document.getElementById("account-auth-form");
    const displayField = document.getElementById("account-display-field");
    const usernameInput = document.getElementById("account-display-name");
    const submit = document.getElementById("account-submit");
    const toggle = document.getElementById("account-toggle");
    let mode = "signin";
    const updateMode = () => {
      const signup = mode === "signup";
      displayField.hidden = !signup;
      usernameInput.required = signup;
      submit.textContent = signup ? "Create account" : "Sign in";
      toggle.textContent = signup ? "Already have an account? Sign in" : "Need an account? Create one";
    };
    toggle.addEventListener("click", () => { mode = mode === "signin" ? "signup" : "signin"; updateMode(); });
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
    document.getElementById("account-demo").addEventListener("click", () => { renderDashboard(demoData, true); message("Demo data is local to this page. Connect an account to load your own stats.", "ok"); });
    document.getElementById("account-refresh").addEventListener("click", async () => {
      try { const session = await getValidSession(); if (!session) throw new Error("Sign in again to refresh."); await loadDashboard(session); message("Dashboard refreshed.", "ok"); } catch (error) { message(error.message, "error"); }
    });
    document.getElementById("account-signout").addEventListener("click", signOut);
    updateMode();
    renderDashboard(null);
    getValidSession().then(session => { if (session) { showSignedIn(session); loadDashboard(session).catch(error => message(error.message, "error")); } else showSignedOut(); }).catch(() => showSignedOut());
  };
  init();
  window.FremiumSiteAccount = { getConfig, setConfig, signIn, signUp, signOut, loadDashboard, getSession };
})();
