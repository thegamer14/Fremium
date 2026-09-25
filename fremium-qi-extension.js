(() => {
  const DB_NAME = "fremium-qi-files";
  const DB_STORE = "handles";
  const MAX_EVENTS = 1000;
  const REALTIME_FILE = "QI_Profile.json / QI_History.json / QI_Stats.json";
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
    timeProfiles: {},
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
  const createProfile = () => ({
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
  });
  const createLearnedState = () => ({
    version: 1,
    profile: createProfile(),
    tracks: { version: 2, tracks: {} },
    playlists: { version: 1, playlists: {} },
    sessions: { version: 1, sessions: [] },
    artists: { version: 1, artists: {} },
    genres: { version: 1, genres: {} },
    contextProfiles: { version: 1, contexts: {} },
    relationships: { version: 1, transitions: {} },
    updatedAt: null,
  });
  const createLiveState = () => ({
    version: 1,
    startedAt: Date.now(),
    session: createSession(),
    history: { version: 1, events: [] },
    totals: { plays: 0, skips: 0, repeats: 0, completions: 0, abandonments: 0, partialStops: 0, immediateSkips: 0, queueActions: 0 },
  });
  const emptyState = () => {
    const learned = createLearnedState();
    const live = createLiveState();
    return {
      version: 4,
      learned,
      live,
      profile: learned.profile,
      tracks: learned.tracks,
      playlists: learned.playlists,
      sessions: learned.sessions,
      session: live.session,
      history: live.history,
      startedAt: live.startedAt,
      lastSnapshotAt: null,
      lastRealtimeSaveAt: null,
    };
  };
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
    const learnedInput = input.learned || {
      profile: input.profile,
      tracks: input.tracks,
      playlists: input.playlists,
      sessions: input.sessions,
    };
    const liveInput = input.live || {
      startedAt: input.startedAt,
      session: input.session,
      history: input.history,
      totals: input.live?.totals,
    };
    const learned = {
      ...base.learned,
      ...learnedInput,
      profile: { ...base.learned.profile, ...(learnedInput.profile || {}), settings: { ...base.learned.profile.settings, ...(learnedInput.profile?.settings || {}) } },
      tracks: { ...base.learned.tracks, ...(learnedInput.tracks || {}) },
      playlists: { ...base.learned.playlists, ...(learnedInput.playlists || {}) },
      sessions: { ...base.learned.sessions, ...(learnedInput.sessions || {}) },
      artists: { ...base.learned.artists, ...(learnedInput.artists || {}) },
      genres: { ...base.learned.genres, ...(learnedInput.genres || {}) },
      contextProfiles: { ...base.learned.contextProfiles, ...(learnedInput.contextProfiles || {}) },
      relationships: { ...base.learned.relationships, ...(learnedInput.relationships || {}) },
    };
    const live = {
      ...base.live,
      ...liveInput,
      session: { ...base.live.session, ...(liveInput.session || {}), totals: { ...base.live.session.totals, ...(liveInput.session?.totals || {}) } },
      history: { ...base.live.history, ...(liveInput.history || {}) },
      totals: { ...base.live.totals, ...(liveInput.totals || {}) },
    };
    const next = {
      ...base,
      ...input,
      learned,
      live,
      profile: learned.profile,
      tracks: learned.tracks,
      playlists: learned.playlists,
      sessions: learned.sessions,
      session: live.session,
      history: live.history,
      startedAt: live.startedAt,
    };
    next.profile.settings.completionThreshold = Math.max(0.95, Number(next.profile.settings.completionThreshold) || 0.95);
    next.tracks.tracks = next.tracks.tracks && typeof next.tracks.tracks === "object" ? next.tracks.tracks : {};
    Object.values(next.tracks.tracks).forEach(hydrateTrack);
    next.sessions.sessions = Array.isArray(next.sessions.sessions) ? next.sessions.sessions : [];
    next.learned.artists.artists = next.learned.artists.artists && typeof next.learned.artists.artists === "object" ? next.learned.artists.artists : {};
    next.learned.genres.genres = next.learned.genres.genres && typeof next.learned.genres.genres === "object" ? next.learned.genres.genres : {};
    next.learned.contextProfiles.contexts = next.learned.contextProfiles.contexts && typeof next.learned.contextProfiles.contexts === "object" ? next.learned.contextProfiles.contexts : {};
    next.learned.relationships.transitions = next.learned.relationships.transitions && typeof next.learned.relationships.transitions === "object" ? next.learned.relationships.transitions : {};
    next.session.tracks = next.session.tracks && typeof next.session.tracks === "object" ? next.session.tracks : {};
    Object.values(next.session.tracks).forEach(hydrateSessionTrack);
    next.history.events = Array.isArray(next.history.events) ? next.history.events : [];
    next.live.history = next.history;
    next.live.session = next.session;
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
    const genres = event?.genre || event?.genres || track?.genres || track?.metadata?.genres || [];
    return {
      name: event?.name || track?.name || "",
      artist: event?.artist || artistNames.join(", ") || track?.metadata?.artist_name || "",
      album: event?.album || track?.album?.name || track?.metadata?.album_name || "",
      genre: Array.isArray(genres) ? genres.filter(Boolean).join(", ") : genres || "",
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
    plays: state.live.totals.plays,
    skips: state.live.totals.skips,
    repeats: state.live.totals.repeats,
    completions: state.live.totals.completions,
    abandonments: state.live.totals.abandonments,
    partialStops: state.live.totals.partialStops,
    immediateSkips: state.live.totals.immediateSkips || 0,
    queueActions: state.live.totals.queueActions,
    lifetimePlays: state.profile.totalPlays,
    lifetimeSkips: state.profile.totalSkips,
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
  const getTimeProfile = (now = Date.now()) => {
    const date = new Date(now);
    const hour = date.getHours();
    const period = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "lateNight";
    const dayType = date.getDay() === 0 || date.getDay() === 6 ? "weekend" : "weekday";
    return { key: `${period}:${dayType}`, period, dayType };
  };
  const ensureAggregate = (map, key) => {
    if (!map[key]) map[key] = { plays: 0, skips: 0, repeats: 0, completions: 0, abandonments: 0, score: 50, lifetimeScore: 50, recentScore: 50, lastSignalAt: null, contexts: {}, timeProfiles: {} };
    const value = map[key];
    value.contexts = value.contexts && typeof value.contexts === "object" ? value.contexts : {};
    value.timeProfiles = value.timeProfiles && typeof value.timeProfiles === "object" ? value.timeProfiles : {};
    return value;
  };
  const updateAggregate = (map, key, type, delta, context, time) => {
    if (!key || !delta) return;
    const value = ensureAggregate(map, key);
    if (type === "play") value.plays += 1;
    else if (type === "repeat") value.repeats += 1;
    else if (type === "completion") value.completions += 1;
    else if (type === "skip" || type === "abandon") { value.skips += 1; if (type === "abandon") value.abandonments += 1; }
    value.lifetimeScore = clamp((value.lifetimeScore || 50) + delta);
    value.recentScore = clamp((value.recentScore || 50) + delta * 1.25);
    value.lastSignalAt = Date.now();
    const contextValue = value.contexts[context] || (value.contexts[context] = { plays: 0, skips: 0, repeats: 0, completions: 0, score: 50, lastSignalAt: null });
    if (type === "play") contextValue.plays += 1;
    else if (type === "repeat") contextValue.repeats += 1;
    else if (type === "completion") contextValue.completions += 1;
    else if (type === "skip" || type === "abandon") contextValue.skips += 1;
    contextValue.score = clamp((contextValue.score || 50) + delta);
    contextValue.lastSignalAt = Date.now();
    const timeValue = value.timeProfiles[time.key] || (value.timeProfiles[time.key] = { plays: 0, skips: 0, score: 50, lastSignalAt: null });
    if (type === "play") timeValue.plays += 1;
    else if (type === "repeat" || type === "completion") timeValue.plays += 1;
    else if (type === "skip" || type === "abandon") timeValue.skips += 1;
    timeValue.score = clamp((timeValue.score || 50) + delta);
    timeValue.lastSignalAt = Date.now();
  };
  const recordRelationship = (from, to, type, now) => {
    if (!from || !to) return;
    const key = `${from}→${to}`;
    const transitions = state.learned.relationships.transitions;
    const value = transitions[key] || (transitions[key] = { from, to, count: 0, plays: 0, skips: 0, completions: 0, score: 50, lastAt: null });
    value.count += 1;
    if (type === "play" || type === "repeat") value.plays += 1;
    else if (type === "completion") value.completions += 1;
    else if (type === "skip" || type === "abandon") value.skips += 1;
    value.score = clamp((value.score || 50) + signalDelta(type, "middle") * 0.7);
    value.lastAt = now;
  };
  const getAggregateScore = (aggregate, context, time) => {
    if (!aggregate) return 50;
    const lifetime = Number(aggregate.lifetimeScore ?? 50);
    const recent = Number(aggregate.recentScore ?? lifetime);
    const age = Math.max(0, Date.now() - (Number(aggregate.lastSignalAt) || Date.now()));
    const halfLife = state.profile.settings.recentHalfLifeMs || 14 * 24 * 60 * 60 * 1000;
    const decayedRecent = lifetime + (recent - lifetime) * Math.pow(0.5, age / halfLife);
    const contextScore = aggregate.contexts?.[context]?.score ?? 50;
    const timeScore = aggregate.timeProfiles?.[time.key]?.score ?? 50;
    return clamp(lifetime * 0.35 + decayedRecent * 0.35 + contextScore * 0.15 + timeScore * 0.15);
  };
  const getRelationshipScore = (from, to) => state.learned.relationships.transitions?.[`${from}→${to}`]?.score ?? 50;
  const updateTrackTimeProfile = (track, type, delta, time) => {
    if (!track || !delta) return;
    const value = track.timeProfiles[time.key] || (track.timeProfiles[time.key] = { plays: 0, skips: 0, score: 50, lastSignalAt: null });
    if (type === "skip" || type === "abandon") value.skips += 1;
    else value.plays += 1;
    value.score = clamp((value.score || 50) + delta);
    value.lastSignalAt = Date.now();
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
    const time = getTimeProfile(now);
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
    if (track && delta) {
      updateTrackTimeProfile(track, type, delta, time);
      const artistNames = String(label.artist || "").split(/\s*,\s*/).map(value => value.trim()).filter(Boolean);
      artistNames.forEach(name => updateAggregate(state.learned.artists.artists, name, type, delta, context, time));
      const genres = String(label.genre || "").split(/\s*[,;]\s*/).map(value => value.trim()).filter(Boolean);
      genres.forEach(genre => updateAggregate(state.learned.genres.genres, genre, type, delta, context, time));
      const contextProfile = state.learned.contextProfiles.contexts[context] || (state.learned.contextProfiles.contexts[context] = { tracks: {}, score: 50, plays: 0, skips: 0, priority: 50 });
      contextProfile.tracks = contextProfile.tracks && typeof contextProfile.tracks === "object" ? contextProfile.tracks : {};
      const contextTrack = contextProfile.tracks[uri] || (contextProfile.tracks[uri] = { plays: 0, skips: 0, repeats: 0, completions: 0, score: 50, lastSignalAt: null });
      if (type === "play") { contextProfile.plays += 1; contextTrack.plays += 1; }
      else if (type === "repeat") { contextTrack.repeats += 1; }
      else if (type === "completion") { contextTrack.completions += 1; }
      else if (isSkip) { contextProfile.skips += 1; contextTrack.skips += 1; }
      contextTrack.score = clamp((contextTrack.score || 50) + delta);
      contextTrack.lastSignalAt = now;
      contextProfile.score = clamp((contextProfile.score || 50) + delta * 0.2);
      contextProfile.priority = clamp((contextProfile.priority || 50) + delta * 0.1);
    }
    if (type === "play") state.live.totals.plays += 1;
    else if (isSkip) { state.live.totals.skips += 1; if (bucket === "immediate") state.live.totals.immediateSkips += 1; if (type === "abandon") state.live.totals.abandonments += 1; else if (progress !== null && progress >= 0.2 && progress < state.profile.settings.completionThreshold) state.live.totals.partialStops += 1; }
    else if (type === "repeat") state.live.totals.repeats += 1;
    else if (type === "completion") state.live.totals.completions += 1;
    if (type === "queue_action") state.live.totals.queueActions += 1;
    state.learned.updatedAt = now;
    state.history.events.unshift({ ...event, type, uri, context, progress, skipBucket: isSkip ? bucket : null, timestamp: event.timestamp || now });
    if (state.history.events.length > MAX_EVENTS) state.history.events.length = MAX_EVENTS;
    state.profile.updatedAt = now;
    scheduleRealtimeSave();
    notify();
    return publicState();
  };

  const normalizeImported = input => hydrateState(input);
  const mergeAggregateMaps = (target, source) => {
    Object.entries(source || {}).forEach(([key, value]) => {
      const current = target[key] || (target[key] = { plays: 0, skips: 0, repeats: 0, completions: 0, abandonments: 0, score: 50, lifetimeScore: 50, recentScore: 50, lastSignalAt: null, contexts: {}, timeProfiles: {} });
      ["plays", "skips", "repeats", "completions", "abandonments"].forEach(metric => { current[metric] = (current[metric] || 0) + (value[metric] || 0); });
      current.lifetimeScore = clamp(((current.lifetimeScore || 50) + (value.lifetimeScore || 50)) / 2);
      current.recentScore = clamp(((current.recentScore || 50) + (value.recentScore || 50)) / 2);
      current.lastSignalAt = Math.max(current.lastSignalAt || 0, value.lastSignalAt || 0) || null;
      current.contexts = current.contexts || {};
      current.timeProfiles = current.timeProfiles || {};
      Object.entries(value.contexts || {}).forEach(([context, contextValue]) => {
        const contextCurrent = current.contexts[context] || (current.contexts[context] = { plays: 0, skips: 0, repeats: 0, completions: 0, score: 50, lastSignalAt: null });
        ["plays", "skips", "repeats", "completions"].forEach(metric => { contextCurrent[metric] = (contextCurrent[metric] || 0) + (contextValue[metric] || 0); });
        contextCurrent.score = clamp(((contextCurrent.score || 50) + (contextValue.score || 50)) / 2);
      });
      Object.entries(value.timeProfiles || {}).forEach(([time, timeValue]) => {
        const timeCurrent = current.timeProfiles[time] || (current.timeProfiles[time] = { plays: 0, skips: 0, score: 50, lastSignalAt: null });
        timeCurrent.plays = (timeCurrent.plays || 0) + (timeValue.plays || 0);
        timeCurrent.skips = (timeCurrent.skips || 0) + (timeValue.skips || 0);
        timeCurrent.score = clamp(((timeCurrent.score || 50) + (timeValue.score || 50)) / 2);
      });
    });
  };
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
    mergeAggregateMaps(state.learned.artists.artists, incoming.learned?.artists?.artists);
    mergeAggregateMaps(state.learned.genres.genres, incoming.learned?.genres?.genres);
    Object.entries(incoming.learned?.contextProfiles?.contexts || {}).forEach(([context, value]) => {
      const current = state.learned.contextProfiles.contexts[context] || (state.learned.contextProfiles.contexts[context] = { tracks: {}, score: 50, plays: 0, skips: 0, priority: 50 });
      current.score = clamp(((current.score || 50) + (value.score || 50)) / 2);
      current.priority = clamp(((current.priority || 50) + (value.priority || 50)) / 2);
      current.plays = (current.plays || 0) + (value.plays || 0);
      current.skips = (current.skips || 0) + (value.skips || 0);
      current.tracks = current.tracks || {};
      Object.entries(value.tracks || {}).forEach(([uri, track]) => {
        const currentTrack = current.tracks[uri] || (current.tracks[uri] = { plays: 0, skips: 0, repeats: 0, completions: 0, score: 50, lastSignalAt: null });
        ["plays", "skips", "repeats", "completions"].forEach(metric => { currentTrack[metric] = (currentTrack[metric] || 0) + (track[metric] || 0); });
        currentTrack.score = clamp(((currentTrack.score || 50) + (track.score || 50)) / 2);
      });
    });
    Object.entries(incoming.learned?.relationships?.transitions || {}).forEach(([key, value]) => {
      const current = state.learned.relationships.transitions[key] || (state.learned.relationships.transitions[key] = { ...value, count: 0, plays: 0, skips: 0, completions: 0, score: 50, lastAt: null });
      current.count = (current.count || 0) + (value.count || 0);
      current.plays = (current.plays || 0) + (value.plays || 0);
      current.skips = (current.skips || 0) + (value.skips || 0);
      current.completions = (current.completions || 0) + (value.completions || 0);
      current.score = clamp(((current.score || 50) + (value.score || 50)) / 2);
      current.lastAt = Math.max(current.lastAt || 0, value.lastAt || 0) || null;
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
  const getQiDirectories = async () => {
    const root = await getDirectory();
    if (!root) return null;
    const fremium = await root.getDirectoryHandle("Fremium", { create: true });
    const qi = await fremium.getDirectoryHandle("QI", { create: true });
    const backups = await qi.getDirectoryHandle("Backups", { create: true });
    return { root, fremium, qi, backups };
  };
  const writeJsonFile = async (directory, name, value) => {
    const fileHandle = await directory.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(value, null, 2));
    await writable.close();
  };
  const rotateBackups = async backups => {
    const names = [];
    for await (const [name, handle] of backups.entries()) {
      if (name.startsWith("QI_") && handle.kind === "file") names.push(name);
    }
    names.sort();
    while (names.length > 10) {
      const oldest = names.shift();
      try { await backups.removeEntry(oldest); } catch {}
    }
  };
  const writeRealtimeFile = async () => {
    const directories = await getQiDirectories();
    if (!directories) return false;
    if (realtimeWriting) { realtimeQueued = true; return false; }
    realtimeWriting = true;
    try {
      state.lastRealtimeSaveAt = Date.now();
      state.profile.updatedAt = state.lastRealtimeSaveAt;
      await writeJsonFile(directories.qi, "QI_Profile.json", { version: 1, savedAt: state.lastRealtimeSaveAt, learned: state.learned });
      await writeJsonFile(directories.qi, "QI_History.json", { version: 1, savedAt: state.lastRealtimeSaveAt, live: state.live });
      await writeJsonFile(directories.qi, "QI_Stats.json", { version: 1, savedAt: state.lastRealtimeSaveAt, summary: summary(), session: state.session });
      notify();
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
    const directories = await getQiDirectories();
    if (!directories) throw new Error("Choose C:\\Free Saves first");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `QI_${stamp}.json`;
    await writeJsonFile(directories.backups, fileName, exportJson());
    await rotateBackups(directories.backups);
    state.lastSnapshotAt = Date.now();
    state.profile.updatedAt = state.lastSnapshotAt;
    await writeRealtimeFile();
    notify();
    return `Fremium\\QI\\Backups\\${fileName}`;
  };
  const listBackups = async () => {
    const directories = await getQiDirectories();
    if (!directories) return [];
    const names = [];
    for await (const [name, handle] of directories.backups.entries()) {
      if (name.startsWith("QI_") && handle.kind === "file") names.push(name);
    }
    return names.sort().reverse();
  };
  const restoreBackup = async name => {
    const directories = await getQiDirectories();
    if (!directories) throw new Error("Choose C:\\Free Saves first");
    const fileHandle = await directories.backups.getFileHandle(name);
    const file = await fileHandle.getFile();
    const text = await file.text();
    const validation = validateJson(text);
    if (!validation.valid) throw new Error(validation.error);
    return importJson(text, { replace: true });
  };
  const validateJson = text => {
    try {
      const value = JSON.parse(text);
      const valid = value && typeof value === "object" && (value.learned || value.profile || value.version);
      return { valid: Boolean(valid), version: value?.version || null, error: valid ? null : "Not a Fremium QI backup" };
    } catch (error) {
      return { valid: false, version: null, error: String(error?.message || error) };
    }
  };
  const importProfile = (text, options = {}) => {
    const incoming = normalizeImported(typeof text === "string" ? JSON.parse(text) : text);
    if (options.replace) {
      state.learned = incoming.learned;
      state.profile = state.learned.profile;
      state.tracks = state.learned.tracks;
      state.playlists = state.learned.playlists;
      state.sessions = state.learned.sessions;
    } else mergeImported({ ...incoming, history: { events: [] } });
    scheduleRealtimeSave();
    notify();
    return publicState();
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
  const clear = (options = {}) => {
    if (options.learned) state = emptyState();
    else {
      state.live = createLiveState();
      state.session = state.live.session;
      state.history = state.live.history;
      state.startedAt = state.live.startedAt;
    }
    scheduleRealtimeSave();
    notify();
    return publicState();
  };
  const resetLearned = () => {
    const live = state.live;
    state = emptyState();
    state.live = live;
    state.session = live.session;
    state.history = live.history;
    state.startedAt = live.startedAt;
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
  const confidenceFor = samples => clamp(Math.round(5 + 95 * (1 - Math.exp(-samples / 40))), 5, 99);
  const scoreDetails = (uri, context = currentContext(), previousUri = queueUri(currentTrack()), duplicateCount = 1) => {
    const track = state.tracks.tracks[uri];
    if (!track) return { score: 50, confidence: 5, components: {}, reasons: ["New track: not enough listening data yet"] };
    hydrateTrack(track);
    const local = track.contexts?.[context] || track;
    const sessionTrack = state.session?.tracks?.[uri] || null;
    const sessionLocal = sessionTrack?.contexts?.[context] || sessionTrack;
    const time = getTimeProfile();
    const plays = local.plays || 0;
    const skips = local.skips || 0;
    const completions = local.completions || 0;
    const repeats = local.repeats || 0;
    const attempts = Math.max(1, plays + skips);
    const samples = plays + skips + completions + repeats;
    const completionRate = Math.min(1, completions / attempts);
    const weightedSkipRate = Math.min(1.5, (local.weightedSkips || skips) / attempts);
    const abandonRate = Math.min(1, (local.abandonments || 0) / attempts);
    const lastSignal = Number(local.lastSignalAt || track.lastSignalAt || 0);
    const daysSinceSignal = lastSignal ? (Date.now() - lastSignal) / (24 * 60 * 60 * 1000) : 0;
    const lastPlay = Number(local.lastPlayAt || track.lastPlayedAt || 0);
    const hoursSincePlay = lastPlay ? (Date.now() - lastPlay) / (60 * 60 * 1000) : Infinity;
    const lastEvent = local.lastEvent || track.lastEvent;
    const skipDecay = lastEvent === "skip" || lastEvent === "abandon" ? 1 : Math.exp(-daysSinceSignal / 21);
    const skipPenalty = consecutiveSkipPenalty(local.skipStreak || track.skipStreak || 0) + weightedSkipRate * 32 * skipDecay + abandonRate * 12;
    const repeatBoost = Math.min(35, repeats * (repeats > 1 ? 10 : 7));
    const familiarBoost = Math.min(20, plays * 1.25);
    const completionBoost = completionRate * 30 + Math.min(10, completions * 2);
    const positionSamples = local.positionSamples || track.positionSamples || 0;
    const earlyRate = positionSamples ? (local.earlyPlays || track.earlyPlays || 0) / positionSamples : 0;
    const lateRate = positionSamples ? (local.latePlays || track.latePlays || 0) / positionSamples : 0;
    const earlyBoost = earlyRate * 12;
    const latePenalty = lateRate * 8;
    const lifetime = clamp(local.lifetimeScore ?? track.lifetimeScore ?? 50);
    const recent = recentScore(local.lifetimeScore === undefined ? track : local, lifetime);
    const sessionScore = clamp(sessionLocal?.score ?? 50);
    const contextProfile = state.learned.contextProfiles.contexts?.[context];
    const playlistScore = clamp(contextProfile?.tracks?.[uri]?.score ?? local.recentScore ?? 50);
    const contextPriority = clamp(contextProfile?.priority ?? 50);
    const artistScore = getAggregateScore(state.learned.artists.artists?.[track.artist], context, time);
    const genreScore = getAggregateScore(state.learned.genres.genres?.[track.genre], context, time);
    const flowScore = previousUri ? getRelationshipScore(previousUri, uri) : 50;
    const recentPlayPenalty = hoursSincePlay < 24 ? Math.min(12, (24 - hoursSincePlay) / 2) : 0;
    const queueDuplicatePenalty = Math.max(0, duplicateCount - 1) * 10;
    const components = {
      replay: repeatBoost,
      completion: completionBoost,
      position: earlyBoost - latePenalty,
      recent: (recent - lifetime) * 0.35,
      playlist: (playlistScore - 50) * 0.15 + (contextPriority - 50) * 0.05,
      artist: (artistScore - 50) * 0.1,
      genre: (genreScore - 50) * 0.05,
      session: (sessionScore - 50) * 0.2,
      flow: (flowScore - 50) * 0.1,
      skip: -skipPenalty,
      recentlyPlayed: -recentPlayPenalty,
      queueDuplicate: -queueDuplicatePenalty,
    };
    const reasons = [];
    if (repeats) reasons.push(`Replayed ${repeats} time${repeats === 1 ? "" : "s"}`);
    if (completionRate >= 0.7) reasons.push(`${Math.round(completionRate * 100)}% completion rate`);
    if (earlyRate >= 0.5) reasons.push("Usually chosen near the beginning of the queue");
    if (lateRate >= 0.5) reasons.push("Usually reached later in the queue");
    if ((contextProfile?.tracks?.[uri]?.plays || 0) > 0) reasons.push("Frequently played in this playlist");
    if (hoursSincePlay > 72) reasons.push("Not played recently");
    if ((local.skipStreak || track.skipStreak || 0) >= 2) reasons.push(`${local.skipStreak || track.skipStreak} consecutive skips`);
    if (abandonRate >= 0.25) reasons.push("Often abandoned before completion");
    if (!reasons.length) reasons.push("Limited behavior data; ranked near neutral");
    const value = 50 + (lifetime - 50) * 0.25 + (recent - 50) * 0.35 + (sessionScore - 50) * 0.2 + (playlistScore - 50) * 0.15 + (contextPriority - 50) * 0.05 + (artistScore - 50) * 0.1 + (genreScore - 50) * 0.05 + (flowScore - 50) * 0.1 + repeatBoost + familiarBoost + completionBoost + earlyBoost - skipPenalty - latePenalty - recentPlayPenalty - queueDuplicatePenalty;
    return { score: clamp(Math.round(value)), confidence: confidenceFor(samples), components, reasons, samples, completionRate, skipRate: weightedSkipRate, context, time: time.key };
  };
  const score = (uri, context = currentContext(), previousUri = queueUri(currentTrack()), duplicateCount = 1) => scoreDetails(uri, context, previousUri, duplicateCount).score;
  const rank = (items, context = currentContext()) => {
    const counts = new Map();
    (items || []).forEach(item => { const uri = queueUri(item); counts.set(uri, (counts.get(uri) || 0) + 1); });
    const previousUri = queueUri(currentTrack());
    return (items || []).map((item, index) => ({ item, index, details: scoreDetails(queueUri(item), context, previousUri, counts.get(queueUri(item)) || 1) })).sort((a, b) => b.details.score - a.details.score || a.index - b.index).map(entry => entry.item);
  };
  const explain = (uri, context = currentContext()) => ({ uri, track: state.tracks.tracks[uri] ? { name: state.tracks.tracks[uri].name, artist: state.tracks.tracks[uri].artist } : null, ...scoreDetails(uri, context, queueUri(currentTrack()), 1) });
  const debug = explain;
  const classifyPrevious = next => {
    if (!previous?.uri) return;
    const elapsed = Date.now() - previous.startedAt;
    const duration = Number(previous.duration) || 0;
    const progress = duration ? Math.min(1, elapsed / duration) : Math.min(1, elapsed / (30 * 60 * 1000));
    const completed = duration ? progress >= 0.95 : elapsed >= 180000;
    const type = next?.uri === previous.uri ? "repeat" : completed ? "completion" : progress < 0.2 ? "abandon" : "skip";
    record({ type, uri: previous.uri, context: previous.context, position: previous.position, progress, elapsedMs: elapsed, durationMs: duration, name: previous.name, artist: previous.artist, album: previous.album, genre: previous.genre });
    return { from: previous.uri, to: next?.uri || null, type, now: Date.now() };
  };
  const songChanged = () => {
    const next = currentTrack();
    const transition = classifyPrevious(next);
    if (transition?.from && transition?.to) recordRelationship(transition.from, transition.to, transition.type, transition.now);
    if (next?.uri) {
      const label = trackInfo({}, next);
      const duration = Number(next.duration?.milliseconds || next.duration_ms || next.metadata?.duration_ms) || 0;
      const position = queuePosition(next.uri);
      record({ type: "play", uri: next.uri, context: currentContext(), position, queueLength: window.Spicetify?.Queue?.nextTracks?.length || 0, ...label });
      previous = { uri: next.uri, context: currentContext(), startedAt: Date.now(), duration, position, name: label.name, artist: label.artist, album: label.album, genre: label.genre };
    } else previous = null;
  };
  const memory = () => {
    const tracks = Object.values(state.tracks.tracks);
    const totalSamples = tracks.reduce((sum, track) => sum + (track.plays || 0) + (track.skips || 0) + (track.completions || 0) + (track.repeats || 0), 0);
    const totalRepeats = tracks.reduce((sum, track) => sum + (track.repeats || 0), 0);
    const totalSkips = tracks.reduce((sum, track) => sum + (track.skips || 0), 0);
    const totalCompletions = tracks.reduce((sum, track) => sum + (track.completions || 0), 0);
    const totalEarly = tracks.reduce((sum, track) => sum + (track.earlyPlays || 0), 0);
    const totalLate = tracks.reduce((sum, track) => sum + (track.latePlays || 0), 0);
    const totalPositions = totalEarly + totalLate;
    const stale = tracks.filter(track => track.plays > 0 && track.lastPlayedAt && Date.now() - track.lastPlayedAt > 14 * 24 * 60 * 60 * 1000).length;
    const insights = [];
    if (totalRepeats) insights.push(`You replay songs you like ${totalRepeats} time${totalRepeats === 1 ? "" : "s"}.`);
    if (totalSkips) insights.push(`QI has observed ${totalSkips} skip${totalSkips === 1 ? "" : "s"}, weighted by when they happened.`);
    if (totalCompletions) insights.push(`You complete ${totalCompletions} track${totalCompletions === 1 ? "" : "s"} when you let them finish.`);
    if (totalPositions && totalEarly / totalPositions >= 0.5) insights.push("You tend to choose familiar songs near the beginning of queues.");
    if (totalPositions && totalLate / totalPositions >= 0.5) insights.push("You tend to reach some tracks later in queues.");
    if (state.learned.contextProfiles.contexts && Object.keys(state.learned.contextProfiles.contexts).length > 1) insights.push("Your listening preferences differ by playlist or context.");
    if (stale) insights.push(`${stale} frequently played track${stale === 1 ? " has" : "s have"} not been played recently.`);
    if (!insights.length) insights.push("Keep listening and QI will learn your replay, completion, skip, and position patterns.");
    return { totalTracks: tracks.length, totalSamples, insights, topTracks: leaders(), staleTracks: stale, session: state.session ? { id: state.session.id, totals: state.session.totals } : null };
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
  const getDirectoryStatus = () => getDirectory().then(handle => ({ connected: Boolean(handle), realtimeFile: REALTIME_FILE, qiPath: handle ? "C:\\Free Saves\\Fremium\\QI" : null }));

  window.FremiumLiveQI = {
    get: publicState,
    subscribe,
    record,
    score,
    rank,
    explain,
    debug,
    memory,
    summary,
    leaders,
    exportJson,
    importJson,
    importProfile,
    mergeProfiles: importProfile,
    validateJson,
    listBackups,
    restoreBackup,
    resetLearned,
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
