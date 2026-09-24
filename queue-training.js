window.FremiumQueueIntelligence = (() => {
  const prefix = "fremium:qi";
  const names = ["profile", "tracks", "playlists", "history"];
  const defaultProfile = () => ({
    version: 1,
    createdAt: Date.now(),
    updatedAt: null,
    totalPlays: 0,
    totalSkips: 0,
    totalRepeats: 0,
    totalCompletions: 0,
    totalQueueActions: 0,
    settings: {
      skipThreshold: 3,
      completionThreshold: 0.7,
      earlyPosition: 2,
      latePosition: 8,
    },
  });
  const defaultTracks = () => ({ version: 1, tracks: {} });
  const defaultPlaylists = () => ({ version: 1, playlists: {} });
  const defaultHistory = () => ({ version: 1, events: [] });
  const defaultFor = name => name === "profile" ? defaultProfile() : name === "tracks" ? defaultTracks() : name === "playlists" ? defaultPlaylists() : defaultHistory();
  const storageKey = name => `${prefix}:${name}`;
  const readOne = name => {
    try {
      const value = Spicetify.LocalStorage.get(storageKey(name));
      if (!value) return defaultFor(name);
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : defaultFor(name);
    } catch {
      return defaultFor(name);
    }
  };
  const readAll = () => {
    const data = { profile: readOne("profile"), tracks: readOne("tracks"), playlists: readOne("playlists"), history: readOne("history") };
    data.profile = { ...defaultProfile(), ...(data.profile || {}), settings: { ...defaultProfile().settings, ...(data.profile?.settings || {}) } };
    if (!Array.isArray(data.history.events)) data.history.events = [];
    if (!data.tracks.tracks || typeof data.tracks.tracks !== "object") data.tracks.tracks = {};
    if (!data.playlists.playlists || typeof data.playlists.playlists !== "object") data.playlists.playlists = {};
    return data;
  };
  const writeAll = data => {
    const value = { ...data, profile: { ...defaultProfile(), ...(data.profile || {}), updatedAt: Date.now() } };
    names.forEach(name => Spicetify.LocalStorage.set(storageKey(name), JSON.stringify(value[name])));
    return value;
  };
  const writeOne = (name, data) => writeAll({ ...readAll(), [name]: data });
  const currentTrack = () => Spicetify.Player.data?.item || null;
  const currentContext = () => {
    const context = Spicetify.Player.data?.context || Spicetify.Player.data?.context_uri || Spicetify.Player.data?.item?.metadata?.["context_uri"] || "global";
    return typeof context === "string" ? context : context?.uri || "global";
  };
  const queueUri = item => item?.uri || item?.contextTrack?.uri || item?.link || null;
  const queueUid = item => item?.uid || item?.contextTrack?.uid || null;
  const currentPosition = uri => {
    try {
      const next = Spicetify.Queue?.nextTracks || [];
      const index = next.findIndex(item => queueUri(item) === uri);
      if (index >= 0) return index;
      const previous = Spicetify.Queue?.prevTracks || [];
      const previousIndex = previous.findIndex(item => queueUri(item) === uri);
      return previousIndex >= 0 ? previous.length - previousIndex : null;
    } catch {
      return null;
    }
  };
  const trackLabel = (track, uri) => track ? {
    uri,
    name: track.name || "",
    artist: track.artists?.map(artist => artist.name).join(", ") || track.metadata?.artist_name || "",
    album: track.album?.name || track.album?.metadata?.title || "",
  } : { uri, name: "", artist: "", album: "" };
  const ensureTrack = (tracks, uri, label) => {
    if (!tracks.tracks[uri]) {
      tracks.tracks[uri] = {
        ...label,
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
    return tracks.tracks[uri];
  };
  const ensureContext = (track, context) => {
    if (!track.contexts[context]) {
      track.contexts[context] = { plays: 0, skips: 0, repeats: 0, completions: 0, skipStreak: 0, earlyPlays: 0, latePlays: 0, positionTotal: 0, positionSamples: 0 };
    }
    return track.contexts[context];
  };
  const ensurePlaylist = (playlists, context) => {
    if (!playlists.playlists[context]) {
      playlists.playlists[context] = {
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
    return playlists.playlists[context];
  };
  const record = event => {
    if (!event || typeof event !== "object") return readAll();
    const data = readAll();
    const now = Date.now();
    const type = event.type || "unknown";
    const uri = event.uri || event.trackUri || null;
    const context = event.context || currentContext();
    const playerTrack = currentTrack();
    const label = trackLabel(event.name ? { name: event.name, artists: event.artist ? [{ name: event.artist }] : [], album: { name: event.album || "" } } : playerTrack, uri);
    const playlist = ensurePlaylist(data.playlists, context);
    playlist.lastSeenAt = now;
    playlist.queueActions = Number(playlist.queueActions) || 0;
    playlist.queueActions += type === "queue_action" ? 1 : 0;
    if (type === "queue_action") data.profile.totalQueueActions += 1;
    if (uri) {
      const track = ensureTrack(data.tracks, uri, label);
      const contextStats = ensureContext(track, context);
      const position = Number.isFinite(event.position) ? event.position : null;
      const isEarly = position !== null && position <= data.profile.settings.earlyPosition;
      const isLate = position !== null && position >= data.profile.settings.latePosition;
      const updateStats = (stats, key, amount) => { stats[key] += amount; };
      if (type === "play") {
        track.plays += 1; track.playStreak += 1; track.skipStreak = 0; track.lastPlayedAt = now;
        contextStats.plays += 1; contextStats.playStreak = (contextStats.playStreak || 0) + 1; contextStats.skipStreak = 0;
        playlist.plays += 1;
        data.profile.totalPlays += 1;
        if (isEarly) { track.earlyPlays += 1; contextStats.earlyPlays += 1; }
        if (isLate) { track.latePlays += 1; contextStats.latePlays += 1; }
        if (position !== null) { track.positionTotal += position; track.positionSamples += 1; contextStats.positionTotal += position; contextStats.positionSamples += 1; }
      } else if (type === "skip") {
        track.skips += 1; track.skipStreak += 1; track.playStreak = 0; track.lastEvent = "skip";
        contextStats.skips += 1; contextStats.skipStreak += 1; contextStats.playStreak = 0;
        playlist.skips += 1;
        data.profile.totalSkips += 1;
      } else if (type === "repeat") {
        track.repeats += 1; track.playStreak += 1; track.skipStreak = 0; track.lastPlayedAt = now; track.lastEvent = "repeat";
        contextStats.repeats += 1; contextStats.playStreak = (contextStats.playStreak || 0) + 1; contextStats.skipStreak = 0;
        playlist.repeats += 1;
        data.profile.totalRepeats += 1;
      } else if (type === "completion") {
        track.completions += 1; track.playStreak += 1; track.skipStreak = 0; track.lastPlayedAt = now; track.lastEvent = "completion";
        contextStats.completions += 1; contextStats.playStreak = (contextStats.playStreak || 0) + 1; contextStats.skipStreak = 0;
        playlist.completions += 1;
        data.profile.totalCompletions += 1;
      }
      track.lastEvent = track.lastEvent || type;
      playlist.trackStats[uri] = { plays: contextStats.plays, skips: contextStats.skips, repeats: contextStats.repeats, completions: contextStats.completions, skipStreak: contextStats.skipStreak };
    }
    data.history.events.unshift({ ...event, type, uri, context, timestamp: event.timestamp || now });
    if (data.history.events.length > 2000) data.history.events.length = 2000;
    return writeAll(data);
  };
  const score = (uri, context = currentContext()) => {
    const data = readAll();
    const track = data.tracks.tracks[uri];
    if (!track) return 50;
    const local = track.contexts[context] || track;
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
    const earlyBoost = averagePosition !== null && averagePosition <= data.profile.settings.earlyPosition ? 12 : 0;
    const latePenalty = averagePosition !== null && averagePosition >= data.profile.settings.latePosition ? 8 : 0;
    const discoveryBoost = plays === 0 ? 8 : 0;
    return Math.max(0, Math.min(100, Math.round(50 + repeatBoost + familiarBoost + completionBoost + earlyBoost + discoveryBoost - skipPenalty - latePenalty)));
  };
  const rank = (items, context = currentContext()) => items.map((item, index) => ({ item, index, score: score(queueUri(item), context) })).sort((a, b) => b.score - a.score || a.index - b.index).map(entry => entry.item);
  const summary = () => {
    const data = readAll();
    const events = data.history.events;
    return {
      total: events.length,
      plays: data.profile.totalPlays,
      skips: data.profile.totalSkips,
      repeats: data.profile.totalRepeats,
      completions: data.profile.totalCompletions,
      queueActions: data.profile.totalQueueActions,
      tracks: Object.keys(data.tracks.tracks).length,
      playlists: Object.keys(data.playlists.playlists).length,
      updatedAt: data.profile.updatedAt,
    };
  };
  const exportData = name => {
    const data = readAll();
    return JSON.stringify(name ? data[name] : data, null, 2);
  };
  const importData = (name, text) => {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid QI JSON file");
    if (name) return writeOne(name, parsed);
    if (!parsed.profile || !parsed.tracks || !parsed.playlists || !parsed.history) throw new Error("QI bundle must contain profile, tracks, playlists, and history");
    return writeAll(parsed);
  };
  const clear = name => {
    if (name) return writeOne(name, defaultFor(name));
    return writeAll({ profile: defaultProfile(), tracks: defaultTracks(), playlists: defaultPlaylists(), history: defaultHistory() });
  };
  const snapshot = () => {
    const queue = Spicetify.Queue?.nextTracks || [];
    record({ type: "queue_snapshot", context: currentContext(), queue: queue.map(item => ({ uri: queueUri(item), uid: queueUid(item), name: item.name || "" })) });
  };
  const install = () => {
    try {
      if (install.installed) return;
      install.installed = true;
    let previous = null;
    const classify = next => {
      if (!previous) return;
      const uri = previous.uri;
      const duration = Number(previous.duration) || 0;
      const progress = Number(previous.progress) || 0;
      const ratio = duration ? progress / duration : 0;
      if (next?.uri && next.uri === uri) record({ type: "repeat", uri, context: currentContext(), position: previous.position });
      else if (ratio >= readAll().profile.settings.completionThreshold) record({ type: "completion", uri, context: currentContext(), position: previous.position, progress, duration });
      else record({ type: "skip", uri, context: currentContext(), position: previous.position, progress, duration });
    };
    const onSongChange = () => {
      let next = null;
      try { next = currentTrack(); } catch { return; }
      classify(next);
      if (next?.uri) {
        const label = trackLabel(next, next.uri);
        record({ type: "play", uri: next.uri, context: currentContext(), position: currentPosition(next.uri), name: label.name, artist: label.artist, album: label.album });
        previous = { uri: next.uri, duration: Number(Spicetify.Player.getDuration?.()) || Number(next.duration?.milliseconds) || 0, progress: 0, position: currentPosition(next.uri) };
      } else previous = null;
    };
    try {
      Spicetify.Player.addEventListener("songchange", onSongChange);
      const timer = setInterval(() => {
        if (!previous || !Spicetify.Player) return;
        try {
          previous.progress = Number(Spicetify.Player.getProgress?.()) || previous.progress || 0;
          previous.duration = Number(Spicetify.Player.getDuration?.()) || previous.duration || 0;
        } catch {}
      }, 2000);
      window.addEventListener("beforeunload", () => clearInterval(timer));
    } catch {}
    try {
      if (Spicetify.Platform?.PlayerAPI?.getEvents) {
        const events = Spicetify.Platform.PlayerAPI.getEvents();
        if (events?.addListener) events.addListener("queue_action", event => {
          try { record({ type: "queue_action", action: event?.data?.action || "unknown", context: currentContext() }); } catch {}
        });
      }
    } catch {}
    try { onSongChange(); } catch {}
    } catch {}
  };
  install.installed = false;
  return { prefix, names, read, get: readAll, record, score, rank, summary, exportData, importData, clear, snapshot, install, currentContext, queueUri, queueUid };
})();
