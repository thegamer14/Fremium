(() => {
  const KEYS = {
    url: "fremium:account:supabase-url",
    anonKey: "fremium:account:supabase-anon-key",
    session: "fremium:account:session",
    lastSync: "fremium:account:last-sync",
    lastTrainingBackup: "fremium:account:last-training-backup",
    autoSync: "fremium:account:auto-sync",
    autoTrainingBackup: "fremium:account:auto-training-backup",
  };
  const VERSION = "2";
  const defaultConfig = window.FremiumAccountConfig || {};
  const TRAINING_BUCKET = "fremium-qi";
  const TRAINING_FILES = ["QI_Profile.json", "QI_History.json", "QI_Stats.json"];
  const LISTENING_EVENTS = new Set(["play", "repeat", "completion", "skip", "abandon", "queue_action"]);
  const listeners = new Set();
  let syncPromise = null;
  let trainingSyncPromise = null;
  let syncTimer = null;
  let suppressAutoSync = false;
  let qiUnsubscribe = null;
  let playerListenerInstalled = false;

  const storage = () => window.Spicetify?.LocalStorage || null;
  const read = key => {
    try { return storage()?.get(key) || ""; } catch { return ""; }
  };
  const write = (key, value) => {
    try { storage()?.set(key, value); } catch {}
  };
  const remove = key => {
    try { storage()?.remove?.(key); } catch {}
  };
  const readJson = (key, fallback = null) => {
    const value = read(key);
    if (!value) return fallback;
    try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return fallback; }
  };
  const normalizeUrl = value => String(value || "").trim().replace(/\/+$/, "");
  const getConfig = () => ({
    supabaseUrl: normalizeUrl(defaultConfig.supabaseUrl || read(KEYS.url)),
    supabaseAnonKey: String(defaultConfig.supabaseAnonKey || read(KEYS.anonKey) || "").trim(),
  });
  const initialSession = readJson(KEYS.session, null);
  let state = {
    user: initialSession?.user || null,
    syncing: false,
    lastSync: read(KEYS.lastSync) || null,
    lastTrainingBackup: read(KEYS.lastTrainingBackup) || null,
    lastResult: null,
    error: null,
    trainingError: null,
    trainingSyncing: false,
    autoSync: read(KEYS.autoSync) !== "0",
    autoTrainingBackup: read(KEYS.autoTrainingBackup) !== "0",
  };

  const notify = () => {
    const value = getState();
    listeners.forEach(listener => { try { listener(value); } catch {} });
  };
  const setState = patch => {
    state = { ...state, ...patch };
    notify();
  };
  const getState = () => {
    const config = getConfig();
    return {
      ...state,
      configured: Boolean(config.supabaseUrl && config.supabaseAnonKey),
      hasSession: Boolean(state.user),
      config: { supabaseUrl: config.supabaseUrl },
    };
  };
  const getSession = () => readJson(KEYS.session, null);
  const normalizeSession = value => {
    if (!value?.access_token) return null;
    const expiresAt = Number(value.expires_at) || Date.now() + (Number(value.expires_in) || 3600) * 1000;
    return { ...value, expires_at: expiresAt };
  };
  const storeSession = value => {
    const session = normalizeSession(value);
    if (!session) {
      remove(KEYS.session);
      setState({ user: null });
      return null;
    }
    write(KEYS.session, JSON.stringify(session));
    setState({ user: session.user || null });
    return session;
  };
  const clearSession = () => {
    remove(KEYS.session);
    remove(KEYS.lastSync);
    remove(KEYS.lastTrainingBackup);
    setState({ user: null, lastSync: null, lastTrainingBackup: null, lastResult: null, error: null, trainingError: null });
  };
  const request = async (path, options = {}) => {
    const config = getConfig();
    if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error("Fremium account service is not configured");
    const { method = "GET", body, auth = true, headers = {} } = options;
    const requestHeaders = { apikey: config.supabaseAnonKey, ...headers };
    if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
    if (auth) {
      const session = await getValidSession();
      if (!session?.access_token) throw new Error("Sign in required");
      requestHeaders.Authorization = `Bearer ${session.access_token}`;
    }
    let response;
    try {
      response = await fetch(`${config.supabaseUrl}/${path}`, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(`Could not reach Fremium sync: ${error.message || error}`);
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const message = data?.msg || data?.message || data?.error?.message || data?.error_description || `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return data;
  };
  const refreshSession = async () => {
    const session = getSession();
    if (!session?.refresh_token) return null;
    if (Number(session.expires_at) > Date.now() + 60000) return session;
    try {
      const refreshed = await request("auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        auth: false,
        body: { refresh_token: session.refresh_token },
      });
      return storeSession(refreshed);
    } catch {
      clearSession();
      return null;
    }
  };
  const getValidSession = async () => {
    const session = getSession();
    if (!session) return null;
    if (!Number(session.expires_at) || Number(session.expires_at) > Date.now() + 60000) return session;
    return refreshSession();
  };
  const configure = (url, anonKey) => {
    const nextUrl = normalizeUrl(url);
    const nextKey = String(anonKey || "").trim();
    if (!/^https?:\/\//i.test(nextUrl)) throw new Error("Supabase URL must start with http:// or https://");
    if (!nextKey) throw new Error("Supabase anon key is required");
    write(KEYS.url, nextUrl);
    write(KEYS.anonKey, nextKey);
    setState({ error: null });
    return getConfig();
  };
  const clearConfig = () => {
    remove(KEYS.url);
    remove(KEYS.anonKey);
    clearSession();
    setState({ error: null });
  };
  const signUp = async (email, password, username) => {
    const normalizedUsername = String(username || "").trim();
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(normalizedUsername)) throw new Error("Username must be 3-32 characters using letters, numbers, _ or -");
    const result = await request("auth/v1/signup", {
      method: "POST",
      auth: false,
      body: { email: String(email || "").trim(), password, data: { username: normalizedUsername, display_name: normalizedUsername } },
    });
    if (result?.access_token) {
      storeSession(result);
      scheduleSync();
      return { requiresConfirmation: false, user: result.user || null };
    }
    return { requiresConfirmation: true, user: result?.user || null };
  };
  const signIn = async (email, password) => {
    const result = await request("auth/v1/token?grant_type=password", {
      method: "POST",
      auth: false,
      body: { email: String(email || "").trim(), password },
    });
    storeSession(result);
    scheduleSync();
    return result.user || null;
  };
  const resendVerification = async email => {
    const address = String(email || "").trim();
    if (!address) throw new Error("Email is required");
    await request("auth/v1/resend", {
      method: "POST",
      auth: false,
      body: { type: "signup", email: address, options: { emailRedirectTo: defaultConfig.siteUrl || "https://thegamer14.github.io/Fremium/" } },
    });
    return { sent: true, email: address };
  };
  const signOut = async () => {
    try {
      if (getSession()?.access_token) await request("auth/v1/logout", { method: "POST" });
    } finally {
      clearSession();
    }
  };
  const getCurrentTrack = () => {
    const item = window.Spicetify?.Player?.data?.item || null;
    if (!item) return null;
    const artist = Array.isArray(item.artists) ? item.artists.map(value => value?.name).filter(Boolean).join(", ") : item.metadata?.artist_name || "";
    return {
      uri: item.uri || null,
      name: item.name || "Unknown track",
      artist: artist || "Unknown artist",
      album: item.album?.name || item.metadata?.album_name || "Unknown album",
      image: item.album?.images?.[0]?.url || null,
    };
  };
  const hashString = value => {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    return (hash >>> 0).toString(36);
  };
  const eventTimestamp = event => {
    if (typeof event?.timestamp === "number") return event.timestamp;
    const parsed = Date.parse(event?.timestamp || "");
    return Number.isFinite(parsed) ? parsed : Date.now();
  };
  const eventId = event => {
    const timestamp = eventTimestamp(event);
    const raw = [timestamp, event?.type || "event", event?.uri || "queue", event?.context || "global", event?.progress ?? "", event?.skipBucket || ""].join("|");
    return `qi-${timestamp}-${hashString(raw)}`;
  };
  const numberOrNull = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const eventRow = (event, userId) => {
    const label = event?.track || {};
    const type = event?.type || "unknown";
    return {
      user_id: userId,
      event_id: eventId(event),
      occurred_at: new Date(eventTimestamp(event)).toISOString(),
      event_type: type,
      track_uri: event?.uri || label?.uri || null,
      track_name: event?.name || label?.name || null,
      artist: event?.artist || label?.artist || null,
      album: event?.album || label?.album || null,
      context_uri: event?.context || null,
      position: numberOrNull(event?.position),
      progress: numberOrNull(event?.progress),
      metadata: {
        skip_bucket: event?.skipBucket || null,
        queue_length: numberOrNull(event?.queueLength),
        elapsed_ms: numberOrNull(event?.elapsedMs),
        duration_ms: numberOrNull(event?.durationMs),
        genre: event?.genre || label?.genre || null,
      },
    };
  };
  const getQi = () => window.FremiumLiveQI?.get?.() || null;
  const getSyncRows = (qi, userId) => (qi?.history?.events || [])
    .filter(event => LISTENING_EVENTS.has(event?.type))
    .slice(0, 500)
    .map(event => eventRow(event, userId));
  const postEvents = async rows => {
    if (!rows.length) return;
    await request("rest/v1/fremium_listening_events?on_conflict=user_id,event_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: rows,
    });
  };
  const postProfile = async (session, now) => {
    const user = session.user || {};
    await request("rest/v1/fremium_profiles?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: [{
        user_id: user.id,
        username: user.user_metadata?.username || user.user_metadata?.display_name || String(user.email || "").split("@")[0] || "Fremium listener",
        display_name: user.user_metadata?.display_name || user.user_metadata?.username || String(user.email || "").split("@")[0] || "Fremium listener",
        last_seen_at: now,
        updated_at: now,
        client_version: VERSION,
      }],
    });
  };
  const postSnapshot = async (userId, qi, now) => {
    const summary = qi?.summary || {};
    const sessionId = summary.sessionId || "global";
    const context = window.FremiumLiveQI?.currentContext?.() || "global";
    const currentTrack = getCurrentTrack();
    const explanation = currentTrack?.uri ? window.FremiumLiveQI?.explain?.(currentTrack.uri, context) : null;
    const current = currentTrack ? { ...currentTrack, qiScore: explanation?.score ?? null, qiConfidence: explanation?.confidence ?? null, qiReasons: explanation?.reasons || [], qiComponents: explanation?.components || {}, qiContext: explanation?.context || context, qiTime: explanation?.time || null } : null;
    await request("rest/v1/fremium_qi_snapshots?on_conflict=user_id,session_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: [{
        user_id: userId,
        session_id: sessionId,
        snapshot_at: now,
        summary,
        leaders: qi?.leaders || [],
        current_track: current,
        context_uri: context,
        client_version: VERSION,
      }],
    });
  };
  const postSyncState = async (userId, now, eventTime) => {
    await request("rest/v1/fremium_sync_state?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: [{
        user_id: userId,
        last_synced_at: now,
        last_event_at: eventTime,
        client_version: VERSION,
      }],
    });
  };
  const uploadTrainingFile = async (userId, name, value) => {
    const path = `storage/v1/object/${TRAINING_BUCKET}/${encodeURIComponent(userId)}/${encodeURIComponent(name)}`;
    await request(path, { method: "POST", headers: { "x-upsert": "true", "Content-Type": "application/json" }, body: value });
  };
  const syncTrainingFiles = () => {
    if (trainingSyncPromise) return trainingSyncPromise;
    trainingSyncPromise = (async () => {
      setState({ trainingSyncing: true, trainingError: null });
      suppressAutoSync = true;
      try {
        const runtime = window.FremiumLiveQI;
        await runtime?.requestDirectoryPermission?.();
        const session = await getValidSession();
        if (!session?.user?.id) throw new Error("Sign in to back up training files");
        const files = await runtime?.getTrainingFiles?.();
        if (!files || typeof files !== "object") throw new Error("Connect the Free Saves folder first");
        const names = TRAINING_FILES.filter(name => files[name] !== undefined);
        if (!names.length) throw new Error("No QI training files found");
        await Promise.all(names.map(name => uploadTrainingFile(session.user.id, name, files[name])));
        const syncedAt = new Date().toISOString();
        write(KEYS.lastTrainingBackup, syncedAt);
        setState({ lastTrainingBackup: syncedAt, trainingError: null });
        return { files: names, syncedAt };
      } catch (error) {
        setState({ trainingError: String(error?.message || error) });
        throw error;
      } finally {
        suppressAutoSync = false;
        trainingSyncPromise = null;
        setState({ trainingSyncing: false });
      }
    })();
    return trainingSyncPromise;
  };
  const sync = () => {
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      setState({ syncing: true, error: null });
      try {
        const session = await getValidSession();
        if (!session?.user?.id) throw new Error("Sign in to sync Fremium data");
        const qi = getQi();
        const userId = session.user.id;
        const rows = getSyncRows(qi, userId);
        const latestEvent = rows.reduce((latest, row) => Math.max(latest, Date.parse(row.occurred_at) || 0), 0);
        const now = new Date().toISOString();
        await postProfile(session, now);
        await postEvents(rows);
        await postSnapshot(userId, qi, now);
        await postSyncState(userId, now, latestEvent ? new Date(latestEvent).toISOString() : null);
        let training = null;
        if (state.autoTrainingBackup) {
          try {
            const directoryStatus = await window.FremiumLiveQI?.getDirectoryStatus?.();
            if (directoryStatus?.connected) training = await syncTrainingFiles();
          } catch (error) {
            setState({ trainingError: String(error?.message || error) });
          }
        }
        write(KEYS.lastSync, now);
        const result = { events: rows.length, tracks: qi?.summary?.tracks || 0, snapshotAt: now, trainingFiles: training?.files || [] };
        setState({ lastSync: now, lastResult: result, error: null });
        return result;
      } catch (error) {
        setState({ error: String(error?.message || error) });
        throw error;
      } finally {
        syncPromise = null;
        setState({ syncing: false });
      }
    })();
    return syncPromise;
  };
  const scheduleSync = (delay = 15000) => {
    if (suppressAutoSync || !state.autoSync || !state.user) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { syncTimer = null; sync().catch(() => {}); }, delay);
  };
  const setAutoSync = value => {
    const enabled = Boolean(value);
    write(KEYS.autoSync, enabled ? "1" : "0");
    setState({ autoSync: enabled });
    if (enabled) scheduleSync();
    if (!enabled && syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
  };
  const setAutoTrainingBackup = value => {
    const enabled = Boolean(value);
    write(KEYS.autoTrainingBackup, enabled ? "1" : "0");
    setState({ autoTrainingBackup: enabled });
  };
  const subscribe = listener => {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    try { listener(getState()); } catch {}
    return () => listeners.delete(listener);
  };
  const attachRuntime = () => {
    if (!qiUnsubscribe && window.FremiumLiveQI?.subscribe) qiUnsubscribe = window.FremiumLiveQI.subscribe(() => scheduleSync());
    if (!playerListenerInstalled && window.Spicetify?.Player?.addEventListener) {
      playerListenerInstalled = true;
      try { window.Spicetify.Player.addEventListener("songchange", () => scheduleSync(1000)); } catch {}
    }
  };

  window.FremiumAccount = {
    get: getState,
    getConfig,
    configure,
    clearConfig,
    signUp,
    signIn,
    resendVerification,
    signOut,
    sync,
    subscribe,
    setAutoSync,
    syncTrainingFiles,
    setAutoTrainingBackup,
    getCurrentTrack,
    version: VERSION,
  };

  let attempts = 0;
  const readyTimer = setInterval(() => {
    attachRuntime();
    attempts += 1;
    if (attempts >= 60) clearInterval(readyTimer);
  }, 1000);
  attachRuntime();
})();
