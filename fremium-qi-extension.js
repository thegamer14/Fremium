(() => {
  const DB_NAME = "fremium-qi-files";
  const DB_STORE = "handles";
  const MAX_EVENTS = 1000;
  const REALTIME_FILE = "fremium-qi-live.json";
  const listeners = new Set();
  let directoryHandle = null;
  let directoryLoaded = false;
  let installed = false;
  let previous = null;
  let realtimeTimer = null;
  let realtimeWriting = false;
  let realtimeQueued = false;

  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));
  const createSkipTiming = () => ({ immediate: 0, early: 0, middle: 0, late: 0, nearComplete: 0 });
  const createTrackStats = (label = {}) => ({
    ...label,
    plays: 0,
    skips: 0,
    repeats: 0,
    completions: 0,
    abandonments: 0,
    partialStops: 0,
    immediateSkips: 0,
    weightedSkips: 0,
    skipTiming: createSkipTiming(),
    skipStreak: 0,
    playStreak: 0,
    earlyPlays: 0,
    latePlays: 0,
    positionTotal: 0,
    positionSamples: 0,
    firstPlayedAt: null,
    lastPlayedAt: null,
    lastSkipAt: null,
    lastSignalAt: null,
    lastEvent: null,
    lifetimeScore: 50,
    recentScore: 50,
    contexts: {},
  });
  const createContextStats = () => ({
    plays: 0,
    skips: 0,
    repeats: 0,
    completions: 0,
    abandonments: 0,
    partialStops: 0,
    immediateSkips: 0,
    weightedSkips: 0,
    skipTiming: createSkipTiming(),
    skipStreak: 0,
    playStreak: 0,
    earlyPlays: 0,
    latePlays: 0,
    positionTotal: 0,
    positionSamples: 0,
    lastPlayAt: null,
    lastSkipAt: null,
    lastSignalAt: null,
    lastEvent: null,
    lifetimeScore: 50,
    recentScore: 50,
  });
  const createSession = () => ({
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: Date.now(),
    lastEventAt: Date.now(),
    tracks: {},
    totals: { plays: 0, skips: 0, repeats: 0, completions: 0, abandonments: 0, partialStops: 0 },
  });
  const createSessionTrack = label => ({
    ...label,
    plays: 0,
    skips: 0,
    repeats: 0,
    completions: 0,
    abandonments: 0,
    partialStops: 0,
    score: 50,
    lastSignalAt: null,
    contexts: {},
  });
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
    version: 3,
    profile: {
      version: 2,
      createdAt: Date.now(),
      updatedAt: null,
      totalPlays: 0,
      totalSkips: 0,
      totalRepeats: 0,
      totalCompletions: 0,
      totalQueueActions: 0,
      totalAbandonments: 0,
      totalPartialStops: 0,
      totalImmediateSkips: 0,
      totalWeightedSkips: 0,
      settings: {
        skipThreshold: 3,
        completionThreshold: 0.95,
        earlyPosition: 2,
        latePosition: 8,
        sessionGapMs: 30 * 60 * 1000,
        recentHalfLifeMs: 14 * 24 * 60 * 60 * 1000,
      },
    },
    tracks: { version: 2, tracks: {} },
    playlists: { version: 1, playlists: {} },
    sessions: { version: 1, sessions: [] },
    session: createSession(),
    history: { version: 1, events: [] },
    startedAt: Date.now(),
    lastSnapshotAt: null,
    lastRealtimeSaveAt: null,
  });
  let state = emptyState();

  const hydrateContextStats = stats => {
    const defaults = createContextStats();
    Object.keys(defaults).forEach(key => {
      if (key === "skipTiming") stats.skipTiming = { ...defaults.skipTiming, ...(stats.skipTiming || {}) };
      else if (typeof defaults[key] === "number") stats[key] = Number.isFinite(Number(stats[key])) ? Number(stats[key]) : defaults[key];
      else if (stats[key] === undefined) stats[key] = defaults[key];
    });
    return stats;
  };
  const hydrateSessionTrack = track => {
    const defaults = createSessionTrack({ name: track.name || "", artist: track.artist || "", album: track.album || "" });
    Object.keys(defaults).forEach(key => {
      if (key === "contexts") track.contexts = track.contexts && typeof track.contexts === "object" ? track.contexts : {};
      else if (typeof defaults[key] === "number") track[key] = Number.isFinite(Number(track[key])) ? Number(track[key]) : defaults[key];
      else if (track[key] === undefined) track[key] = defaults[key];
    });
    Object.values(track.contexts).forEach(context => {
      const defaultsContext = { plays: 0, skips: 0, repeats: 0, completions: 0, abandonments: 0, partialStops: 0, score: 50, lastSignalAt: null };
      Object.keys(defaultsContext).forEach(key => {
        if (typeof defaultsContext[key] === "number") context[key] = Number.isFinite(Number(context[key])) ? Number(context[key]) : defaultsContext[key];
        else if (context[key] === undefined) context[key] = defaultsContext[key];
      });
    });
    return track;
  };
  const hydrateTrack = track => {
    const defaults = createTrackStats({ name: track.name || "", artist: track.artist || "", album: track.album || "" });
    Object.keys(defaults).forEach(key => {
      if (key === "contexts") track.contexts = track.contexts && typeof track.contexts === "object" ? track.contexts : {};
      else if (key === "skipTiming") track.skipTiming = { ...defaults.skipTiming, ...(track.skipTiming || {}) };
      else if (typeof defaults[key] === "number") track[key] = Number.isFinite(Number(track[key])) ? Number(track[key]) : defaults[key];
      else if (track[key] === undefined) track[key] = defaults[key];
    });
    Object.values(track.contexts).forEach(hydrateContextStats);
    return track;
  };
  const hydrateState = source => {
    const base = emptyState();
    const input = source && typeof source === "object" ? source : {};
    const next = {
      ...base,
      ...input,
      profile: { ...base.profile, ...(input.profile || {}), settings: { ...base.profile.settings, ...(input.profile?.settings || {}) } },
      tracks: { ...base.tracks, ...(input.tracks || {}) },
      playlists: { ...base.playlists, ...(input.playlists || {}) },
      sessions: { ...base.sessions, ...(input.sessions || {}) },
      session: { ...base.session, ...(input.session || {}), totals: { ...base.session.totals, ...(input.session?.totals || {}) } },
      history: { ...base.history, ...(input.history || {}) },
    };
    next.profile.settings.completionThreshold = Math.max(0.95, Number(next.profile.settings.completionThreshold) || 0.95);
    next.tracks.tracks = next.tracks.tracks && typeof next.tracks.tracks === "object" ? next.tracks.tracks : {};
    Object.values(next.tracks.tracks).forEach(hydrateTrack);
    next.sessions.sessions = Array.isArray(next.sessions.sessions) ? next.sessions.sessions : [];
    next.session.tracks = next.session.tracks && typeof next.session.tracks === "object" ? next.session.tracks : {};
    Object.values(next.session.tracks).forEach(hydrateSessionTrack);
    next.history.events = Array.isArray(next.history.events) ? next.history.events : [];
    return next;
  };
  const summarizeSession = session => ({
    id: session.id,
    startedAt: session.startedAt,
    lastEventAt: session.lastEventAt,
    totals: { ...(session.totals || {}) },
  });
  const ensureSession = now => {
    const gap = state.profile.settings.sessionGapMs || 30 * 60 * 1000;
    if (!state.session?.id || now - (state.session.lastEventAt || 0) > gap) {
      if (state.session?.id) {
        state.sessions.sessions.push(summarizeSession(state.session));
        if (state.sessions.sessions.length > 50) state.sessions.sessions.splice(0, state.sessions.sessions.length - 50);
      }
      state.session = createSession();
    }
    state.session.lastEventAt = now;
    return state.session;
  };
  const ensureSessionTrack = (session, uri, label) => {
    if (!session || !uri) return null;
    if (!session.tracks[uri]) session.tracks[uri] = createSessionTrack(label);
    else hydrateSessionTrack(session.tracks[uri]);
    return session.tracks[uri];
  };
  const ensureSessionContext = (track, context) => {
    if (!track.contexts[context]) track.contexts[context] = { plays: 0, skips: 0, repeats: 0, completions: 0, abandonments: 0, partialStops: 0, score: 50, lastSignalAt: null };
    return track.contexts[context];
  };

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
    if (!state.tracks.tracks[uri]) state.tracks.tracks[uri] = createTrackStats({ ...(label || {}), uri });
    else hydrateTrack(state.tracks.tracks[uri]);
    return state.tracks.tracks[uri];
  };
  const ensureContextStats = (track, context) => {
    if (!track.contexts[context]) track.contexts[context] = createContextStats();
    else hydrateContextStats(track.contexts[context]);
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
        abandonments: 0,
        partialStops: 0,
        queueActions: 0,
        firstSeenAt: Date.now(),
        lastSeenAt: null,
        trackStats: {},
      };
    } else {
      const playlist = state.playlists.playlists[context];
      ["plays", "skips", "repeats", "completions", "abandonments", "partialStops", "queueActions"].forEach(key => { playlist[key] = Number(playlist[key]) || 0; });
      playlist.trackStats = playlist.trackStats && typeof playlist.trackStats === "object" ? playlist.trackStats : {};
    }
    return state.playlists.playlists[context];
  };
  const skipBucket = progress => {
    if (!Number.isFinite(progress)) return "middle";
    if (progress < 0.1) return "immediate";
    if (progress < 0.35) return "early";
    if (progress < 0.75) return "middle";
    if (progress < 0.9) return "late";
    return "nearComplete";
  };
  const skipWeight = bucket => ({ immediate: 1.35, early: 1, middle: 0.8, late: 0.9, nearComplete: 1.15 })[bucket] || 1;
  const signalDelta = (type, bucket) => {
    if (type === "play") return 1.5;
    if (type === "repeat") return 7;
    if (type === "completion") return 5;
    if (type === "abandon") return -8 * skipWeight(bucket);
    if (type === "skip") return -4 * skipWeight(bucket);
    return 0;
  };
  const updatePreferenceScore = (stats, delta, now) => {
    if (!delta) return;
    const lifetime = Number(stats.lifetimeScore ?? 50);
    const recent = Number(stats.recentScore ?? lifetime);
    stats.lifetimeScore = clamp(lifetime + delta);
    stats.recentScore = clamp(recent + delta * 1.35);
    stats.lastSignalAt = now;
  };
  const queuePosition = uri => {
    const queue = window.Spicetify?.Queue?.nextTracks || [];
    const index = queue.findIndex(item => queueUri(item) === uri);
    if (index >= 0) return index + 1;
    const history = window.Spicetify?.Queue?.prevTracks || [];
    const historyIndex = history.findIndex(item => queueUri(item) === uri);
    return historyIndex >= 0 ? Math.max(1, history.length - historyIndex) : 0;
  };
  const summary = () => ({
    total: state.history.events.length,
    plays: state.profile.totalPlays,
    skips: state.profile.totalSkips,
    repeats: state.profile.totalRepeats,
    completions: state.profile.totalCompletions,
    abandonments: state.profile.totalAbandonments,
    partialStops: state.profile.totalPartialStops,
    immediateSkips: state.profile.totalImmediateSkips,
    queueActions: state.profile.totalQueueActions,
    tracks: Object.keys(state.tracks.tracks).length,
    playlists: Object.keys(state.playlists.playlists).length,
    sessionId: state.session?.id || null,
    sessionPlays: state.session?.totals?.plays || 0,
    sessionSkips: state.session?.totals?.skips || 0,
    updatedAt: state.profile.updatedAt,
    lastSnapshotAt: state.lastSnapshotAt,
    lastRealtimeSaveAt: state.lastRealtimeSaveAt,
  });
  const leaders = () => Object.values(state.tracks.tracks)
    .sort((a, b) => (b.plays || 0) - (a.plays || 0) || (b.completions || 0) - (a.completions || 0))
    .slice(0, 5)
    .map(track => ({ uri: track.uri, name: track.name, artist: track.artist, plays: track.plays || 0, skips: track.skips || 0, completions: track.completions || 0 }));
  const publicState = () => ({
    ...clone(state),
    summary: summary(),
    leaders: leaders(),
    directoryConnected: Boolean(directoryHandle),
    realtime: { connected: Boolean(directoryHandle), file: REALTIME_FILE },
  });
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
    const label = trackInfo(event, currentTrack());
    const track = ensureTrack(uri, label);
    const contextStats = track ? ensureContextStats(track, context) : null;
    const playlist = ensurePlaylist(context);
    const position = Number.isFinite(event.position) ? event.position : null;
    const progress = Number.isFinite(event.progress) ? event.progress : null;
    const bucket = skipBucket(progress);
    const isSkip = type === "skip" || type === "abandon";
    const early = position !== null && position <= state.profile.settings.earlyPosition;
    const late = position !== null && position >= state.profile.settings.latePosition;
    const session = ensureSession(now);
    const sessionTrack = ensureSessionTrack(session, uri, label);
    const sessionContext = sessionTrack ? ensureSessionContext(sessionTrack, context) : null;
    playlist.lastSeenAt = now;
    if (type === "queue_action") {
      playlist.queueActions += 1;
      state.profile.totalQueueActions += 1;
    }
    let delta = 0;
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
        contextStats.lastPlayAt = now;
        playlist.plays += 1;
        state.profile.totalPlays += 1;
        if (early) { track.earlyPlays += 1; contextStats.earlyPlays += 1; }
        if (late) { track.latePlays += 1; contextStats.latePlays += 1; }
        if (position !== null) { track.positionTotal += position; track.positionSamples += 1; contextStats.positionTotal += position; contextStats.positionSamples += 1; }
        delta = signalDelta(type, bucket);
      } else if (isSkip) {
        const weight = skipWeight(bucket);
        track.skips += 1;
        track.skipStreak += 1;
        track.playStreak = 0;
        track.lastSkipAt = now;
        track.lastEvent = type;
        track.weightedSkips += weight;
        track.skipTiming[bucket] = (track.skipTiming[bucket] || 0) + 1;
        contextStats.skips += 1;
        contextStats.skipStreak += 1;
        contextStats.playStreak = 0;
        contextStats.lastSkipAt = now;
        contextStats.weightedSkips += weight;
        contextStats.skipTiming[bucket] = (contextStats.skipTiming[bucket] || 0) + 1;
        if (bucket === "immediate") { track.immediateSkips += 1; contextStats.immediateSkips += 1; state.profile.totalImmediateSkips += 1; }
        if (type === "abandon") { track.abandonments += 1; contextStats.abandonments += 1; state.profile.totalAbandonments += 1; }
        else if (progress !== null && progress >= 0.2 && progress < state.profile.settings.completionThreshold) { track.partialStops += 1; contextStats.partialStops += 1; state.profile.totalPartialStops += 1; }
        playlist.skips += 1;
        state.profile.totalSkips += 1;
        state.profile.totalWeightedSkips += weight;
        delta = signalDelta(type, bucket);
      } else if (type === "repeat") {
        track.repeats += 1;
        track.playStreak += 1;
        track.skipStreak = 0;
        track.lastPlayedAt = now;
        track.lastEvent = "repeat";
        contextStats.repeats += 1;
        contextStats.playStreak += 1;
        contextStats.skipStreak = 0;
        contextStats.lastPlayAt = now;
        playlist.repeats += 1;
        state.profile.totalRepeats += 1;
        delta = signalDelta(type, bucket);
      } else if (type === "completion") {
        track.completions += 1;
        track.playStreak += 1;
        track.skipStreak = 0;
        track.lastPlayedAt = now;
        track.lastEvent = "completion";
        contextStats.completions += 1;
        contextStats.playStreak += 1;
        contextStats.skipStreak = 0;
        contextStats.lastPlayAt = now;
        playlist.completions += 1;
        state.profile.totalCompletions += 1;
        delta = signalDelta(type, bucket);
      }
      if (type !== "queue_action") contextStats.lastEvent = type;
      updatePreferenceScore(track, delta, now);
      updatePreferenceScore(contextStats, delta, now);
      playlist.trackStats[uri] = {
        plays: contextStats.plays,
        skips: contextStats.skips,
        repeats: contextStats.repeats,
        completions: contextStats.completions,
        abandonments: contextStats.abandonments,
        partialStops: contextStats.partialStops,
        skipStreak: contextStats.skipStreak,
        score: contextStats.recentScore,
      };
    }
    if (sessionTrack && sessionContext) {
      if (type === "play") { sessionTrack.plays += 1; sessionContext.plays += 1; session.totals.plays += 1; }
      else if (isSkip) {
        sessionTrack.skips += 1; sessionContext.skips += 1; session.totals.skips += 1;
        if (type === "abandon") { sessionTrack.abandonments += 1; sessionContext.abandonments += 1; session.totals.abandonments += 1; }
        else if (progress !== null && progress >= 0.2 && progress < state.profile.settings.completionThreshold) { sessionTrack.partialStops += 1; sessionContext.partialStops += 1; session.totals.partialStops += 1; }
      } else if (type === "repeat") { sessionTrack.repeats += 1; sessionContext.repeats += 1; session.totals.repeats += 1; }
      else if (type === "completion") { sessionTrack.completions += 1; sessionContext.completions += 1; session.totals.completions += 1; }
      if (delta) {
        sessionTrack.score = clamp(sessionTrack.score + delta * 1.2);
        sessionContext.score = clamp(sessionContext.score + delta * 1.2);
        sessionTrack.lastSignalAt = now;
        sessionContext.lastSignalAt = now;
      }
    }
    state.history.events.unshift({ ...event, type, uri, context, progress, skipBucket: isSkip ? bucket : null, timestamp: event.timestamp || now });
    if (state.history.events.length > MAX_EVENTS) state.history.events.length = MAX_EVENTS;
    state.profile.updatedAt = now;
    scheduleRealtimeSave();
    notify();
    return publicState();
  };

  const normalizeImported = input => hydrateState(input);
  const mergeImported = incoming => {
    const counters = ["totalPlays", "totalSkips", "totalRepeats", "totalCompletions", "totalQueueActions", "totalAbandonments", "totalPartialStops", "totalImmediateSkips", "totalWeightedSkips"];
    counters.forEach(key => { state.profile[key] = (state.profile[key] || 0) + (incoming.profile[key] || 0); });
    Object.entries(incoming.tracks.tracks || {}).forEach(([uri, value]) => {
      const current = ensureTrack(uri, value);
      ["plays", "skips", "repeats", "completions", "abandonments", "partialStops", "immediateSkips", "weightedSkips", "earlyPlays", "latePlays", "positionTotal", "positionSamples"].forEach(key => { current[key] = (current[key] || 0) + (value[key] || 0); });
      Object.keys(current.skipTiming).forEach(key => { current.skipTiming[key] += value.skipTiming?.[key] || 0; });
      current.lifetimeScore = clamp(((current.lifetimeScore || 50) + (value.lifetimeScore || 50)) / 2);
      current.recentScore = clamp(((current.recentScore || 50) + (value.recentScore || 50)) / 2);
      current.firstPlayedAt ||= value.firstPlayedAt || null;
      current.lastPlayedAt = Math.max(current.lastPlayedAt || 0, value.lastPlayedAt || 0) || null;
      current.lastSkipAt = Math.max(current.lastSkipAt || 0, value.lastSkipAt || 0) || null;
      current.lastSignalAt = Math.max(current.lastSignalAt || 0, value.lastSignalAt || 0) || null;
      Object.entries(value.contexts || {}).forEach(([context, contextValue]) => {
        const currentContextStats = ensureContextStats(current, context);
        ["plays", "skips", "repeats", "completions", "abandonments", "partialStops", "immediateSkips", "weightedSkips", "earlyPlays", "latePlays", "positionTotal", "positionSamples"].forEach(key => { currentContextStats[key] = (currentContextStats[key] || 0) + (contextValue[key] || 0); });
        Object.keys(currentContextStats.skipTiming).forEach(key => { currentContextStats.skipTiming[key] += contextValue.skipTiming?.[key] || 0; });
        currentContextStats.lifetimeScore = clamp(((currentContextStats.lifetimeScore || 50) + (contextValue.lifetimeScore || 50)) / 2);
        currentContextStats.recentScore = clamp(((currentContextStats.recentScore || 50) + (contextValue.recentScore || 50)) / 2);
      });
    });
    Object.entries(incoming.playlists.playlists || {}).forEach(([context, value]) => {
      const current = ensurePlaylist(context);
      ["plays", "skips", "repeats", "completions", "abandonments", "partialStops", "queueActions"].forEach(key => { current[key] = (current[key] || 0) + (value[key] || 0); });
    });
    state.history.events = [...incoming.history.events, ...state.history.events].slice(0, MAX_EVENTS);
    state.profile.updatedAt = Date.now();
  };
  const importJson = (text, options = {}) => {
    const incoming = normalizeImported(typeof text === "string" ? JSON.parse(text) : text);
    if (options.replace) state = incoming;
    else mergeImported(incoming);
    scheduleRealtimeSave();
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
  const writeRealtimeFile = async () => {
    const handle = await getDirectory();
    if (!handle) return false;
    if (realtimeWriting) { realtimeQueued = true; return false; }
    realtimeWriting = true;
    try {
      state.lastRealtimeSaveAt = Date.now();
      state.profile.updatedAt = state.lastRealtimeSaveAt;
      const fileHandle = await handle.getFileHandle(REALTIME_FILE, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(exportJson());
      await writable.close();
      return true;
    } catch {
      return false;
    } finally {
      realtimeWriting = false;
      if (realtimeQueued) { realtimeQueued = false; scheduleRealtimeSave(); }
    }
  };
  const scheduleRealtimeSave = () => {
    getDirectory().then(handle => {
      if (!handle) return;
      if (realtimeTimer) clearTimeout(realtimeTimer);
      realtimeTimer = setTimeout(() => {
        realtimeTimer = null;
        writeRealtimeFile().catch(() => {});
      }, 750);
    }).catch(() => {});
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
    scheduleRealtimeSave();
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
    scheduleRealtimeSave();
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
    scheduleRealtimeSave();
    notify();
    return publicState();
  };
  const snapshot = () => {
    const queue = window.Spicetify?.Queue?.nextTracks || [];
    return record({ type: "queue_snapshot", context: currentContext(), queueLength: queue.length, queue: queue.slice(0, 30).map(item => ({ uri: queueUri(item), uid: queueUid(item), name: item?.name || "" })) });
  };
  const recentScore = (stats, lifetime) => {
    const recent = Number(stats.recentScore ?? lifetime);
    const age = Math.max(0, Date.now() - (Number(stats.lastSignalAt) || Date.now()));
    const halfLife = state.profile.settings.recentHalfLifeMs || 14 * 24 * 60 * 60 * 1000;
    const factor = Math.pow(0.5, age / halfLife);
    return lifetime + (recent - lifetime) * factor;
  };
  const consecutiveSkipPenalty = streak => {
    if (!streak) return 0;
    if (streak === 1) return 6;
    if (streak === 2) return 18;
    return Math.min(60, 30 + (streak - 3) * 8);
  };
  const score = (uri, context = currentContext()) => {
    const track = state.tracks.tracks[uri];
    if (!track) return 50;
    hydrateTrack(track);
    const local = track.contexts?.[context] || track;
    const sessionTrack = state.session?.tracks?.[uri] || null;
    const sessionLocal = sessionTrack?.contexts?.[context] || sessionTrack;
    const plays = local.plays || 0;
    const skips = local.skips || 0;
    const completions = local.completions || 0;
    const repeats = local.repeats || 0;
    const attempts = Math.max(1, plays + skips);
    const completionRate = Math.min(1, completions / attempts);
    const weightedSkipRate = Math.min(1.5, (local.weightedSkips || skips) / attempts);
    const abandonRate = Math.min(1, (local.abandonments || 0) / attempts);
    const lastSignal = Number(local.lastSignalAt || track.lastSignalAt || 0);
    const daysSinceSignal = lastSignal ? (Date.now() - lastSignal) / (24 * 60 * 60 * 1000) : 0;
    const skipDecay = local.lastEvent === "skip" || local.lastEvent === "abandon" || track.lastEvent === "skip" || track.lastEvent === "abandon" ? 1 : Math.exp(-daysSinceSignal / 21);
    const skipPenalty = consecutiveSkipPenalty(local.skipStreak || track.skipStreak || 0) + weightedSkipRate * 32 * skipDecay + abandonRate * 12;
    const repeatBoost = Math.min(35, repeats * (repeats > 1 ? 10 : 7));
    const familiarBoost = Math.min(20, plays * 1.25);
    const completionBoost = completionRate * 30 + Math.min(10, completions * 2);
    const samples = local.positionSamples || track.positionSamples || 0;
    const earlyRate = samples ? (local.earlyPlays || track.earlyPlays || 0) / samples : 0;
    const lateRate = samples ? (local.latePlays || track.latePlays || 0) / samples : 0;
    const earlyBoost = earlyRate * 12;
    const latePenalty = lateRate * 8;
    const lifetime = clamp(local.lifetimeScore ?? track.lifetimeScore ?? 50);
    const recent = recentScore(local.lifetimeScore === undefined ? track : local, lifetime);
    const sessionScore = clamp(sessionLocal?.score ?? 50);
    const preference = lifetime * 0.35 + recent * 0.45 + sessionScore * 0.2;
    return clamp(Math.round(preference + repeatBoost + familiarBoost + completionBoost + earlyBoost - skipPenalty - latePenalty));
  };
  const rank = (items, context = currentContext()) => (items || []).map((item, index) => ({ item, index, score: score(queueUri(item), context) })).sort((a, b) => b.score - a.score || a.index - b.index).map(entry => entry.item);
  const classifyPrevious = next => {
    if (!previous?.uri) return;
    const elapsed = Date.now() - previous.startedAt;
    const duration = Number(previous.duration) || 0;
    const progress = duration ? Math.min(1, elapsed / duration) : Math.min(1, elapsed / (30 * 60 * 1000));
    const completed = duration ? progress >= 0.95 : elapsed >= 180000;
    const type = next?.uri === previous.uri ? "repeat" : completed ? "completion" : progress < 0.2 ? "abandon" : "skip";
    record({ type, uri: previous.uri, context: previous.context, position: previous.position, progress, elapsedMs: elapsed, durationMs: duration, name: previous.name, artist: previous.artist, album: previous.album });
  };
  const songChanged = () => {
    const next = currentTrack();
    classifyPrevious(next);
    if (next?.uri) {
      const label = trackInfo({}, next);
      const duration = Number(next.duration?.milliseconds || next.duration_ms || next.metadata?.duration_ms) || 0;
      const position = queuePosition(next.uri);
      record({ type: "play", uri: next.uri, context: currentContext(), position, queueLength: window.Spicetify?.Queue?.nextTracks?.length || 0, ...label });
      previous = { uri: next.uri, context: currentContext(), startedAt: Date.now(), duration, position, name: label.name, artist: label.artist, album: label.album };
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
  const getDirectoryStatus = () => getDirectory().then(handle => ({ connected: Boolean(handle), realtimeFile: REALTIME_FILE }));

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
    writeRealtimeFile,
    realtimeFile: REALTIME_FILE,
  };
  const readyTimer = setInterval(() => {
    if (window.Spicetify?.Player) {
      clearInterval(readyTimer);
      install();
    }
  }, 250);
})();
