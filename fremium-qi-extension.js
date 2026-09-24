(() => {
  const DB_NAME = "fremium-qi-files";
  const DB_STORE = "handles";
  const MAX_EVENTS = 1000;
  const listeners = new Set();
  let directoryHandle = null;
  let directoryLoaded = false;
  let installed = false;
  let previous = null;

  const clone = value => JSON.parse(JSON.stringify(value));
  const player = () => window.Spicetify?.Player || null;
  const playerApi = () => window.Spicetify?.Platform?.PlayerAPI || null;
  const currentTrack = () => {
    try { return player()?.data?.item || null; } catch { return null; }
  };
  const currentContext = () => {
    try {
      const context = player()?.data?.context || player()?.data?.context_uri || currentTrack()?.metadata?.context_uri || "global";
      return typeof context === "string" ? context : context?.uri || "global";
    } catch { return "global"; }
  };
  const queueUri = item => item?.uri || item?.contextTrack?.uri || item?.link || null;
  const queueUid = item => item?.uid || item?.contextTrack?.uid || null;
  const emptyState = () => ({
    version: 2,
    profile: {
      version: 1,
      createdAt: Date.now(),
      updatedAt: null,
      totalPlays: 0,
      totalSkips: 0,
      totalRepeats: 0,
      totalCompletions: 0,
      totalQueueActions: 0,
      settings: { skipThreshold: 3, completionThreshold: 0.7, earlyPosition: 2, latePosition: 8 },
    },
    tracks: { version: 1, tracks: {} },
    playlists: { version: 1, playlists: {} },
    history: { version: 1, events: [] },
    startedAt: Date.now(),
    lastSnapshotAt: null,
  });
  let state = emptyState();

  const trackInfo = (event, track) => {
    const artists = track?.artists || track?.metadata?.artists || [];
    const artistNames = Array.isArray(artists) ? artists.map(artist => artist?.name || artist || "").filter(Boolean) : [];
    return {
      name: event?.name || track?.name || "",
      artist: event?.artist || artistNames.join(", ") || track?.metadata?.artist_name || "",
      album: event?.album || track?.album?.name || track?.metadata?.album_name || "",
    };
  };
  const ensureTrack = (uri, label) => {
    if (!uri) return null;
    if (!state.tracks.tracks[uri]) {
      state.tracks.tracks[uri] = {
        ...label,
        uri,
        plays: 0,
        skips: 0,
        repeats: 0,
        completions: 0,
        skipStreak: 0,
        playStreak: 0,
        earlyPlays: 0,
        latePlays: 0,
        positionTotal: 0,
        positionSamples: 0,
        firstPlayedAt: null,
        lastPlayedAt: null,
        lastEvent: null,
        contexts: {},
      };
    }
    return state.tracks.tracks[uri];
  };
  const ensureContextStats = (track, context) => {
    if (!track.contexts[context]) {
      track.contexts[context] = { plays: 0, skips: 0, repeats: 0, completions: 0, skipStreak: 0, earlyPlays: 0, latePlays: 0, positionTotal: 0, positionSamples: 0 };
    }
    return track.contexts[context];
  };
  const ensurePlaylist = context => {
    if (!state.playlists.playlists[context]) {
      state.playlists.playlists[context] = {
        context,
        name: context === "global" ? "All listening" : context,
        plays: 0,
        skips: 0,
        repeats: 0,
        completions: 0,
        queueActions: 0,
        firstSeenAt: Date.now(),
        lastSeenAt: null,
        trackStats: {},
      };
    }
    return state.playlists.playlists[context];
  };
  const summary = () => ({
    total: state.history.events.length,
    plays: state.profile.totalPlays,
    skips: state.profile.totalSkips,
    repeats: state.profile.totalRepeats,
    completions: state.profile.totalCompletions,
    queueActions: state.profile.totalQueueActions,
    tracks: Object.keys(state.tracks.tracks).length,
    playlists: Object.keys(state.playlists.playlists).length,
    updatedAt: state.profile.updatedAt,
    lastSnapshotAt: state.lastSnapshotAt,
  });
  const leaders = () => Object.values(state.tracks.tracks)
    .sort((a, b) => (b.plays || 0) - (a.plays || 0) || (b.completions || 0) - (a.completions || 0))
    .slice(0, 5)
    .map(track => ({ uri: track.uri, name: track.name, artist: track.artist, plays: track.plays || 0, skips: track.skips || 0, completions: track.completions || 0 }));
  const publicState = () => ({ ...clone(state), summary: summary(), leaders: leaders(), directoryConnected: Boolean(directoryHandle) });
  const notify = () => {
    const value = publicState();
    listeners.forEach(listener => { try { listener(value); } catch {} });
  };
  const record = event => {
    if (!event || typeof event !== "object") return publicState();
    const now = Date.now();
    const type = event.type || "unknown";
    const uri = event.uri || event.trackUri || null;
    const context = event.context || currentContext();
    const track = ensureTrack(uri, trackInfo(event, currentTrack()));
    const contextStats = track ? ensureContextStats(track, context) : null;
    const playlist = ensurePlaylist(context);
    const position = Number.isFinite(event.position) ? event.position : null;
    const early = position !== null && position <= state.profile.settings.earlyPosition;
    const late = position !== null && position >= state.profile.settings.latePosition;
    playlist.lastSeenAt = now;
    if (type === "queue_action") {
      playlist.queueActions += 1;
      state.profile.totalQueueActions += 1;
    }
    if (track && contextStats) {
      if (type === "play") {
        track.plays += 1;
        track.playStreak += 1;
        track.skipStreak = 0;
        track.firstPlayedAt ||= now;
        track.lastPlayedAt = now;
        track.lastEvent = "play";
        contextStats.plays += 1;
        contextStats.playStreak += 1;
        contextStats.skipStreak = 0;
        playlist.plays += 1;
        state.profile.totalPlays += 1;
        if (early) { track.earlyPlays += 1; contextStats.earlyPlays += 1; }
        if (late) { track.latePlays += 1; contextStats.latePlays += 1; }
        if (position !== null) { track.positionTotal += position; track.positionSamples += 1; contextStats.positionTotal += position; contextStats.positionSamples += 1; }
      } else if (type === "skip") {
        track.skips += 1;
        track.skipStreak += 1;
        track.playStreak = 0;
        track.lastEvent = "skip";
        contextStats.skips += 1;
        contextStats.skipStreak += 1;
        contextStats.playStreak = 0;
        playlist.skips += 1;
        state.profile.totalSkips += 1;
      } else if (type === "repeat") {
        track.repeats += 1;
        track.playStreak += 1;
        track.skipStreak = 0;
        track.lastPlayedAt = now;
        track.lastEvent = "repeat";
        contextStats.repeats += 1;
        contextStats.playStreak += 1;
        contextStats.skipStreak = 0;
        playlist.repeats += 1;
        state.profile.totalRepeats += 1;
      } else if (type === "completion") {
        track.completions += 1;
        track.playStreak += 1;
        track.skipStreak = 0;
        track.lastPlayedAt = now;
        track.lastEvent = "completion";
        contextStats.completions += 1;
        contextStats.playStreak += 1;
        contextStats.skipStreak = 0;
        playlist.completions += 1;
        state.profile.totalCompletions += 1;
      }
      playlist.trackStats[uri] = { plays: contextStats.plays, skips: contextStats.skips, repeats: contextStats.repeats, completions: contextStats.completions, skipStreak: contextStats.skipStreak };
    }
    state.history.events.unshift({ ...event, type, uri, context, timestamp: event.timestamp || now });
    if (state.history.events.length > MAX_EVENTS) state.history.events.length = MAX_EVENTS;
    state.profile.updatedAt = now;
    notify();
    return publicState();
  };

  const normalizeImported = input => {
    const source = input && typeof input === "object" ? input : {};
    const base = emptyState();
    const profile = { ...base.profile, ...(source.profile || {}), settings: { ...base.profile.settings, ...(source.profile?.settings || {}) } };
    const tracks = source.tracks?.tracks || source.tracks || {};
    const playlists = source.playlists?.playlists || source.playlists || {};
    const events = source.history?.events || source.events || [];
    return { ...base, profile, tracks: { version: 1, tracks: typeof tracks === "object" ? tracks : {} }, playlists: { version: 1, playlists: typeof playlists === "object" ? playlists : {} }, history: { version: 1, events: Array.isArray(events) ? events : [] } };
  };
  const mergeImported = incoming => {
    const counters = ["totalPlays", "totalSkips", "totalRepeats", "totalCompletions", "totalQueueActions"];
    counters.forEach(key => { state.profile[key] = (state.profile[key] || 0) + (incoming.profile[key] || 0); });
    Object.entries(incoming.tracks.tracks || {}).forEach(([uri, value]) => {
      const current = ensureTrack(uri, value);
      ["plays", "skips", "repeats", "completions", "earlyPlays", "latePlays", "positionTotal", "positionSamples"].forEach(key => { current[key] = (current[key] || 0) + (value[key] || 0); });
      current.name ||= value.name || "";
      current.artist ||= value.artist || "";
      current.album ||= value.album || "";
      current.firstPlayedAt ||= value.firstPlayedAt || null;
      current.lastPlayedAt ||= value.lastPlayedAt || null;
    });
    Object.entries(incoming.playlists.playlists || {}).forEach(([context, value]) => {
      const current = ensurePlaylist(context);
      ["plays", "skips", "repeats", "completions", "queueActions"].forEach(key => { current[key] = (current[key] || 0) + (value[key] || 0); });
    });
    state.history.events = [...incoming.history.events, ...state.history.events].slice(0, MAX_EVENTS);
    state.profile.updatedAt = Date.now();
  };
  const importJson = (text, options = {}) => {
    const incoming = normalizeImported(typeof text === "string" ? JSON.parse(text) : text);
    if (options.replace) state = incoming;
    else mergeImported(incoming);
    notify();
    return publicState();
  };
  const exportJson = () => JSON.stringify(state, null, 2);

  const openDb = () => new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error("IndexedDB is unavailable")); return; }
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open file storage"));
  });
  const getDirectory = async () => {
    if (directoryLoaded) return directoryHandle;
    directoryLoaded = true;
    try {
      const db = await openDb();
      directoryHandle = await new Promise((resolve, reject) => {
        const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get("directory");
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      db.close();
    } catch {}
    return directoryHandle;
  };
  const setDirectory = async handle => {
    directoryHandle = handle;
    directoryLoaded = true;
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const request = db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).put(handle, "directory");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      db.close();
    } catch {}
    notify();
  };
  const chooseDirectory = async () => {
    if (typeof window.showDirectoryPicker !== "function") throw new Error("Folder access is unavailable in this Spotify client");
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await setDirectory(handle);
    return { connected: true };
  };
  const saveSnapshot = async () => {
    const handle = await getDirectory();
    if (!handle) throw new Error("Choose C:\\Free Saves first");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `fremium-qi-${stamp}.json`;
    const fileHandle = await handle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(exportJson());
    await writable.close();
    state.lastSnapshotAt = Date.now();
    state.profile.updatedAt = state.lastSnapshotAt;
    notify();
    return fileName;
  };
  const downloadSnapshot = () => {
    const blob = new Blob([exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fremium-qi-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return link.download;
  };
  const clear = () => {
    state = emptyState();
    notify();
    return publicState();
  };
  const snapshot = () => {
    const queue = window.Spicetify?.Queue?.nextTracks || [];
    return record({ type: "queue_snapshot", context: currentContext(), queueLength: queue.length, queue: queue.slice(0, 30).map(item => ({ uri: queueUri(item), uid: queueUid(item), name: item?.name || "" })) });
  };
  const score = (uri, context = currentContext()) => {
    const track = state.tracks.tracks[uri];
    if (!track) return 50;
    const local = track.contexts?.[context] || track;
    const plays = local.plays || 0;
    const skips = local.skips || 0;
    const completions = local.completions || 0;
    const repeats = local.repeats || 0;
    const attempts = plays + skips + completions;
    const completionRate = attempts ? completions / attempts : 0;
    const skipRate = attempts ? skips / attempts : 0;
    const skipPenalty = Math.min(55, (local.skipStreak || track.skipStreak || 0) * 15 + skipRate * 35);
    const repeatBoost = Math.min(25, repeats * 4);
    const familiarBoost = Math.min(20, plays * 1.5);
    const completionBoost = completionRate * 30;
    const samples = local.positionSamples || track.positionSamples || 0;
    const averagePosition = samples ? (local.positionTotal || track.positionTotal) / samples : null;
    const earlyBoost = averagePosition !== null && averagePosition <= state.profile.settings.earlyPosition ? 12 : 0;
    const latePenalty = averagePosition !== null && averagePosition >= state.profile.settings.latePosition ? 8 : 0;
    return Math.max(0, Math.min(100, Math.round(50 + repeatBoost + familiarBoost + completionBoost + earlyBoost - skipPenalty - latePenalty)));
  };
  const rank = (items, context = currentContext()) => (items || []).map((item, index) => ({ item, index, score: score(queueUri(item), context) })).sort((a, b) => b.score - a.score || a.index - b.index).map(entry => entry.item);
  const classifyPrevious = next => {
    if (!previous?.uri) return;
    const elapsed = Date.now() - previous.startedAt;
    const duration = Number(previous.duration) || 0;
    const completed = duration ? elapsed >= duration * state.profile.settings.completionThreshold : elapsed >= 180000;
    const type = next?.uri === previous.uri ? "repeat" : completed ? "completion" : "skip";
    record({ type, uri: previous.uri, context: previous.context, position: previous.position, name: previous.name, artist: previous.artist, album: previous.album });
  };
  const songChanged = () => {
    const next = currentTrack();
    classifyPrevious(next);
    if (next?.uri) {
      const label = trackInfo({}, next);
      const duration = Number(next.duration?.milliseconds || next.duration_ms || next.metadata?.duration_ms) || 0;
      record({ type: "play", uri: next.uri, context: currentContext(), position: null, queueLength: window.Spicetify?.Queue?.nextTracks?.length || 0, ...label });
      previous = { uri: next.uri, context: currentContext(), startedAt: Date.now(), duration, position: null, name: label.name, artist: label.artist, album: label.album };
    } else previous = null;
  };
  const install = () => {
    if (installed) return;
    const p = player();
    if (!p?.addEventListener) return;
    installed = true;
    try { p.addEventListener("songchange", songChanged); } catch {}
    try { songChanged(); } catch {}
  };
  const subscribe = listener => {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    try { listener(publicState()); } catch {}
    return () => listeners.delete(listener);
  };
  const getDirectoryStatus = () => getDirectory().then(handle => ({ connected: Boolean(handle) }));

  window.FremiumLiveQI = {
    get: publicState,
    subscribe,
    record,
    score,
    rank,
    summary,
    leaders,
    exportJson,
    importJson,
    clear,
    snapshot,
    currentContext,
    queueUri,
    queueUid,
    chooseDirectory,
    saveSnapshot,
    downloadSnapshot,
    getDirectoryStatus,
  };
  const readyTimer = setInterval(() => {
    if (window.Spicetify?.Player) {
      clearInterval(readyTimer);
      install();
    }
  }, 250);
})();
