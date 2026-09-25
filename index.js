// Fremium — Floating Window CustomApp
// Pattern: learn from lyrics-plus/new-releases/reddit. Single-file, no build.
/// <reference types="react" />
/// <reference path="../globals.d.ts" />

const react = Spicetify.React;
const reactDOM = Spicetify.ReactDOM;
const { useState, useEffect, useRef, useCallback, useMemo } = react;
const { URI, Platform, CosmosAsync, Player, LocalStorage, showNotification, Menu, Keyboard } = Spicetify;

const APP_ID = "fremium"; // storage prefix. Folder is still spicify-plugin until you rename repo.
const LS = {
  winPos: `${APP_ID}:win:pos`,
  winSize: `${APP_ID}:win:size`,
  winTab: `${APP_ID}:win:tab`,
  streaks: `${APP_ID}:streaks`,
  history: `${APP_ID}:history`,
  // Last.fm
  lfmUser: `${APP_ID}:lfm:user`,
  lfmKey: `${APP_ID}:lfm:key`,
  lfmSecret: `${APP_ID}:lfm:secret`,
  lfmSession: `${APP_ID}:lfm:session`,
  lfmToken: `${APP_ID}:lfm:token`,
  queueLog: `${APP_ID}:queue:log`,
  trainLog: `${APP_ID}:queue:train`,
  aiHistory: `${APP_ID}:ai:history`,
};

function loadJson(key, fallback) {
  try { const v = LocalStorage.get(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveJson(key, val) { LocalStorage.set(key, JSON.stringify(val)); }

// ---------- Global window controller (so button can open from anywhere) ----------
let _openFremium = null;
let _isFremiumOpen = false;
window.FremiumOpen = () => _openFremium && _openFremium();
window.FremiumIsOpen = () => _isFremiumOpen;

// ---------- Streak logic (Musical Streaks: consecutive days per track + global) ----------
function todayKey() { return new Date().toISOString().slice(0,10); } // YYYY-MM-DD

function updateStreakForTrack(uri) {
  if (!uri) return;
  const streaks = loadJson(LS.streaks, {}); // { uri: { count, lastDate, best, name } }
  const hist = loadJson(LS.history, []); // [{date, uri}]
  const today = todayKey();
  const entry = streaks[uri] || { count: 0, lastDate: null, best: 0, name: "" };
  // get track name if available
  try { if (Player.data?.item?.uri === uri) entry.name = Player.data.item.name || entry.name; } catch {}
  if (entry.lastDate === today) {
    // already counted today
    saveJson(LS.streaks, streaks);
    return;
  }
  // check if consecutive: yesterday?
  const y = new Date(); y.setDate(y.getDate()-1);
  const yKey = y.toISOString().slice(0,10);
  if (entry.lastDate === yKey) {
    entry.count += 1;
  } else if (entry.lastDate === today) {
    // noop
  } else {
    // break or first time
    entry.count = 1;
  }
  entry.best = Math.max(entry.best || 0, entry.count);
  entry.lastDate = today;
  streaks[uri] = entry;
  hist.unshift({ date: today, uri, ts: Date.now() });
  if (hist.length > 500) hist.length = 500;
  saveJson(LS.streaks, streaks);
  saveJson(LS.history, hist);
}

// Hook streak updater to player
try {
  Player.addEventListener("songchange", () => {
    const uri = Player.data?.item?.uri;
    if (uri) updateStreakForTrack(uri);
  });
} catch {}

// ---------- Last.fm helpers ----------
const FREMIUM_LFM_KEY = "";
const FREMIUM_LFM_SECRET = "";
function getLfmConfig() {
  return {
    user: LocalStorage.get(LS.lfmUser) || "",
    key: LocalStorage.get(LS.lfmKey) || FREMIUM_LFM_KEY,
    secret: LocalStorage.get(LS.lfmSecret) || FREMIUM_LFM_SECRET,
    session: LocalStorage.get(LS.lfmSession) || "",
    token: LocalStorage.get(LS.lfmToken) || "",
  };
}
function getLfmConfigRaw() {
  return getLfmConfig();
}
function setLfmConfig(obj) {
  if ("user" in obj) LocalStorage.set(LS.lfmUser, obj.user || "");
  if ("key" in obj) LocalStorage.set(LS.lfmKey, obj.key || "");
  if ("secret" in obj) LocalStorage.set(LS.lfmSecret, obj.secret || "");
  if ("session" in obj) LocalStorage.set(LS.lfmSession, obj.session || "");
  if ("token" in obj) LocalStorage.set(LS.lfmToken, obj.token || "");
}
function isLfmConnected() {
  const c = getLfmConfig();
  return Boolean(c.user && c.key);
}
function isLfmFullyAuthed() {
  const c = getLfmConfig();
  return Boolean(c.user && c.key && c.session);
}
// Correct MD5 for Last.fm sig — blueimp/JavaScript-MD5 (MIT) verified
function md5(s) {
  function safeAdd(x, y) { var lsw = (x & 0xffff) + (y & 0xffff); var msw = (x >> 16) + (y >> 16) + (lsw >> 16); return (msw << 16) | (lsw & 0xffff); }
  function bitRotateLeft(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
  function md5cmn(q, a, b, x, s, t) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function md5ff(a, b, c, d, x, s, t) { return md5cmn((b & c) | (~b & d), a, b, x, s, t); }
  function md5gg(a, b, c, d, x, s, t) { return md5cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function md5hh(a, b, c, d, x, s, t) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
  function md5ii(a, b, c, d, x, s, t) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }
  function binlMD5(x, len) {
    x[len >> 5] |= 0x80 << len % 32;
    x[(((len + 64) >>> 9) << 4) + 14] = len;
    var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (var i = 0; i < x.length; i += 16) {
      var olda = a, oldb = b, oldc = c, oldd = d;
      a = md5ff(a, b, c, d, x[i], 7, -680876936); d = md5ff(d, a, b, c, x[i + 1], 12, -389564586); c = md5ff(c, d, a, b, x[i + 2], 17, 606105819); b = md5ff(b, c, d, a, x[i + 3], 22, -1044525330);
      a = md5ff(a, b, c, d, x[i + 4], 7, -176418897); d = md5ff(d, a, b, c, x[i + 5], 12, 1200080426); c = md5ff(c, d, a, b, x[i + 6], 17, -1473231341); b = md5ff(b, c, d, a, x[i + 7], 22, -45705983);
      a = md5ff(a, b, c, d, x[i + 8], 7, 1770035416); d = md5ff(d, a, b, c, x[i + 9], 12, -1958414417); c = md5ff(c, d, a, b, x[i + 10], 17, -42063); b = md5ff(b, c, d, a, x[i + 11], 22, -1990404162);
      a = md5ff(a, b, c, d, x[i + 12], 7, 1804603682); d = md5ff(d, a, b, c, x[i + 13], 12, -40341101); c = md5ff(c, d, a, b, x[i + 14], 17, -1502002290); b = md5ff(b, c, d, a, x[i + 15], 22, 1236535329);
      a = md5gg(a, b, c, d, x[i + 1], 5, -165796510); d = md5gg(d, a, b, c, x[i + 6], 9, -1069501632); c = md5gg(c, d, a, b, x[i + 11], 14, 643717713); b = md5gg(b, c, d, a, x[i], 20, -373897302);
      a = md5gg(a, b, c, d, x[i + 5], 5, -701558691); d = md5gg(d, a, b, c, x[i + 10], 9, 38016083); c = md5gg(c, d, a, b, x[i + 15], 14, -660478335); b = md5gg(b, c, d, a, x[i + 4], 20, -405537848);
      a = md5gg(a, b, c, d, x[i + 9], 5, 568446438); d = md5gg(d, a, b, c, x[i + 14], 9, -1019803690); c = md5gg(c, d, a, b, x[i + 3], 14, -187363961); b = md5gg(b, c, d, a, x[i + 8], 20, 1163531501);
      a = md5gg(a, b, c, d, x[i + 13], 5, -1444681467); d = md5gg(d, a, b, c, x[i + 2], 9, -51403784); c = md5gg(c, d, a, b, x[i + 7], 14, 1735328473); b = md5gg(b, c, d, a, x[i + 12], 20, -1926607734);
      a = md5hh(a, b, c, d, x[i + 5], 4, -378558); d = md5hh(d, a, b, c, x[i + 8], 11, -2022574463); c = md5hh(c, d, a, b, x[i + 11], 16, 1839030562); b = md5hh(b, c, d, a, x[i + 14], 23, -35309556);
      a = md5hh(a, b, c, d, x[i + 1], 4, -1530992060); d = md5hh(d, a, b, c, x[i + 4], 11, 1272893353); c = md5hh(c, d, a, b, x[i + 7], 16, -155497632); b = md5hh(b, c, d, a, x[i + 10], 23, -1094730640);
      a = md5hh(a, b, c, d, x[i + 13], 4, 681279174); d = md5hh(d, a, b, c, x[i], 11, -358537222); c = md5hh(c, d, a, b, x[i + 3], 16, -722521979); b = md5hh(b, c, d, a, x[i + 6], 23, 76029189);
      a = md5hh(a, b, c, d, x[i + 9], 4, -640364487); d = md5hh(d, a, b, c, x[i + 12], 11, -421815835); c = md5hh(c, d, a, b, x[i + 15], 16, 530742520); b = md5hh(b, c, d, a, x[i + 2], 23, -995338651);
      a = md5ii(a, b, c, d, x[i], 6, -198630844); d = md5ii(d, a, b, c, x[i + 7], 10, 1126891415); c = md5ii(c, d, a, b, x[i + 14], 15, -1416354905); b = md5ii(b, c, d, a, x[i + 5], 21, -57434055);
      a = md5ii(a, b, c, d, x[i + 12], 6, 1700485571); d = md5ii(d, a, b, c, x[i + 3], 10, -1894986606); c = md5ii(c, d, a, b, x[i + 10], 15, -1051523); b = md5ii(b, c, d, a, x[i + 1], 21, -2054922799);
      a = md5ii(a, b, c, d, x[i + 8], 6, 1873313359); d = md5ii(d, a, b, c, x[i + 15], 10, -30611744); c = md5ii(c, d, a, b, x[i + 6], 15, -1560198380); b = md5ii(b, c, d, a, x[i + 13], 21, 1309151649);
      a = md5ii(a, b, c, d, x[i + 4], 6, -145523070); d = md5ii(d, a, b, c, x[i + 11], 10, -1120210379); c = md5ii(c, d, a, b, x[i + 2], 15, 718787259); b = md5ii(b, c, d, a, x[i + 9], 21, -343485551);
      a = safeAdd(a, olda); b = safeAdd(b, oldb); c = safeAdd(c, oldc); d = safeAdd(d, oldd);
    }
    return [a, b, c, d];
  }
  function rstr2binl(input) {
    var output = []; output[(input.length >> 2) - 1] = undefined;
    for (var i = 0; i < output.length; i++) output[i] = 0;
    var len8 = input.length * 8;
    for (var i2 = 0; i2 < len8; i2 += 8) output[i2 >> 5] |= (input.charCodeAt(i2 / 8) & 0xff) << i2 % 32;
    return output;
  }
  function binl2rstr(input) {
    var output = ""; var len32 = input.length * 32;
    for (var i = 0; i < len32; i += 8) output += String.fromCharCode((input[i >> 5] >>> i % 32) & 0xff);
    return output;
  }
  function rstr2hex(input) {
    var hexTab = "0123456789abcdef", output = "";
    for (var i = 0; i < input.length; i++) { var x = input.charCodeAt(i); output += hexTab.charAt((x >>> 4) & 0x0f) + hexTab.charAt(x & 0x0f); }
    return output;
  }
  function str2rstrUTF8(input) { return unescape(encodeURIComponent(input)); }
  function hexMD5(s) { return rstr2hex(binl2rstr(binlMD5(rstr2binl(str2rstrUTF8(s)), s.length * 8 * str2rstrUTF8(s).length / s.length))); }
  // Fix length calc: use UTF8 byte length
  function _md5(s) {
    var utf8 = str2rstrUTF8(s);
    return rstr2hex(binl2rstr(binlMD5(rstr2binl(utf8), utf8.length * 8)));
  }
  return _md5(s);
}
function lfmSig(params, secret) {
  // params sorted alphabetically, concat key+value + secret, md5
  const keys = Object.keys(params).sort();
  let str = "";
  for (const k of keys) str += k + params[k];
  str += secret;
  return md5(str);
}
async function lfmFetch(params, needSig = false) {
  const cfg = getLfmConfig();
  if (!cfg.key) throw new Error("No Last.fm API key set");
  const base = "https://ws.audioscrobbler.com/2.0/";
  const q = new URLSearchParams({ ...params, api_key: cfg.key, format: "json" });
  if (needSig) {
    if (!cfg.secret) throw new Error("API secret required for this call");
    const sigParams = { ...params, api_key: cfg.key };
    q.set("api_sig", lfmSig(sigParams, cfg.secret));
  }
  const url = `${base}?${q.toString()}`;
  const res = await fetch(url).then(r=>r.json());
  if (res.error) throw new Error(res.message || `Last.fm error ${res.error}`);
  return res;
}

function searchName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(album|artist|track|playlist):/g, " ")
    .replace(/["']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function getTrackUri(track) {
  return track?.uri || track?.track?.uri || track?.item?.uri || track?.metadata?.uri || track?.metadata?.item_uri || track?.link || "";
}
function getTrackArtistText(track) {
  const artists = track?.artists || track?.track?.artists || track?.item?.artists || track?.metadata?.artists;
  if (Array.isArray(artists)) {
    return artists.map(artist => typeof artist === "string" ? artist : artist?.name || artist?.profile?.name || "").filter(Boolean).join(" ");
  }
  return track?.artist?.name || track?.artist?.["#text"] || track?.artist || track?.track?.artist?.name || track?.track?.artist?.["#text"] || track?.item?.artist?.name || track?.item?.artist?.["#text"] || track?.metadata?.artist_name || "";
}
function getTrackKeys(track) {
  const keys = [];
  const uri = getTrackUri(track);
  const name = searchName(getTrackName(track));
  const artist = searchName(getTrackArtistText(track));
  if (uri) keys.push(`uri:${uri}`);
  if (name) keys.push(`track:${artist}|${name}`);
  return Array.from(new Set(keys));
}
function getActiveTrackKeys() {
  const queue = Array.isArray(Spicetify.Queue?.nextTracks) ? Spicetify.Queue.nextTracks : [];
  const active = [Player.data?.item, ...queue];
  return new Set(active.flatMap(getTrackKeys));
}
function uniqueTracks(tracks, excludedKeys = new Set()) {
  const seen = new Set(excludedKeys);
  return (tracks || []).filter(track => {
    const keys = getTrackKeys(track);
    if (!keys.length || keys.some(key => seen.has(key))) return false;
    keys.forEach(key => seen.add(key));
    return true;
  });
}
function getAiHistory() {
  const value = loadJson(LS.aiHistory, []);
  return Array.isArray(value) ? value : [];
}
function getAiHistoryKeys() {
  return new Set(getAiHistory().flatMap(item => typeof item === "string" ? [`uri:${item}`] : getTrackKeys(item)));
}
function rememberAiTracks(tracks) {
  const history = uniqueTracks([...(tracks || []), ...getAiHistory()]).slice(0, 100);
  saveJson(LS.aiHistory, history.map(track => ({
    uri: getTrackUri(track),
    name: track?.name || track?.title || "",
    artist: getTrackArtistText(track),
    savedAt: Date.now(),
  })));
}
function extractAiTags(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/\bfolx\b/g, "folk")
    .replace(/[-_]+/g, " ");
  const phrases = [
    "indie folk", "indie rock", "indie pop", "dream pop", "shoegaze", "post punk",
    "alternative rock", "folk rock", "folk", "indie", "rock", "pop", "jazz", "blues",
    "classical", "electronic", "ambient", "chill", "hip hop", "rap", "metal", "punk",
    "happy", "sad", "romantic", "energetic", "dance", "workout", "study", "focus", "sleep",
    "party", "driving", "dreamy", "mellow", "aggressive", "emotional", "feel good", "feel bad",
  ];
  const stopWords = new Set([
    "make", "makes", "making", "give", "put", "generate", "find", "recommend", "me", "my", "i", "im",
    "a", "an", "the", "playlist", "mix", "music", "song", "songs", "track", "tracks", "for", "of",
    "with", "and", "but", "like", "this", "that", "these", "those", "listening", "listen", "to", "in",
    "on", "hour", "hours", "hr", "hrs", "duration", "mixes", "mixed", "vibe", "vibes", "sounds", "sound",
    "late", "night", "what", "should", "something", "anything", "feel", "feels", "feeling", "feelings",
    "feels", "mood", "way", "one", "us", "we", "you", "your", "from", "use", "used", "based", "inspired",
    "darker", "lighter", "im", "i'm", "lets", "let", "get", "go", "can", "could", "would", "will",
  ]);
  const tags = [];
  for (const phrase of phrases) {
    if (normalized.includes(phrase)) {
      tags.push(phrase);
      phrase.split(" ").forEach(part => { if (!stopWords.has(part)) tags.push(part); });
    }
  }
  normalized
    .replace(/\b\d+\s*(?:hours?|hrs?)\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(word => word.length > 2 && !stopWords.has(word))
    .forEach(word => tags.push(word));
  if (/\b(?:late|night)\b/.test(normalized) && !tags.length) tags.push("chill");
  return Array.from(new Set(tags)).slice(0, 6);
}

function searchScore(query, item) {
  const q = searchName(query);
  const name = searchName(item?.name || item?.title);
  const artistNames = (item?.artists || []).map(a => searchName(a.name || a)).filter(Boolean);
  let score = 0;
  if (name && q === name) score += 100;
  else if (name && q.includes(name)) score += 50;
  if (artistNames.some(a => q.includes(a))) score += 25;
  if (item?.playable !== false && item?.playability?.playable !== false) score += 5;
  return score;
}
function normalizeSearchItem(item, type) {
  if (!item) return null;
  const data = item.data || item;
  const artistItems = data.artists?.items || data.artists || [];
  const artists = (Array.isArray(artistItems) ? artistItems : []).map(a => ({
    name: a.profile?.name || a.name || a.displayName || "",
    uri: a.uri || "",
  })).filter(a => a.name || a.uri);
  const images = data.images || data.coverArt?.sources?.map(x => ({ url: x.url })) || [];
  const album = data.album || data.albumOfTrack || null;
  return {
    ...data,
    uri: data.uri || (type === "playlist" && data.id ? `spotify:playlist:${data.id}` : data.uri),
    name: data.name || data.title || "",
    artists,
    images,
    album: album ? {
      ...album,
      uri: album.uri,
      name: album.name,
      images: album.images || album.coverArt?.sources?.map(x => ({ url: x.url })) || [],
    } : null,
    playability: data.playability || {},
  };
}
function searchItemsFromConnection(response, type) {
  const keys = type === "track" ? ["tracksV2", "tracks"] : type === "album" ? ["albumsV2", "albums"] : type === "playlist" ? ["playlistsV2", "playlists", "playlist"] : [];
  for (const key of keys) {
    const connection = response?.data?.searchV2?.[key];
    if (connection?.items) return connection.items.map(entry => normalizeSearchItem(entry?.item || entry, type)).filter(Boolean);
  }
  const items = response?.data?.searchV2?.topResultsV2?.itemsV2 || [];
  return items.map(entry => normalizeSearchItem(entry?.item || entry, type)).filter(item => {
    if (type === "playlist") return /playlist/i.test(item?.__typename || "") || /^spotify:playlist:/i.test(item?.uri || "");
    const expected = type === "track" ? "Track" : type === "album" ? "Album" : "Artist";
    return item?.__typename === expected;
  });
}
async function graphqlSearch(query, type) {
  const definitions = Spicetify.GraphQL?.Definitions || {};
  const categoryDefinition = type === "track"
    ? definitions.searchTracks
    : type === "album"
      ? definitions.searchAlbums
      : type === "playlist"
        ? (definitions.searchPlaylists || definitions.searchPlaylistsV2)
        : null;
  const definitionsToTry = [...new Set([
    categoryDefinition,
    definitions.searchDesktop,
    definitions.searchModalResults,
  ].filter(Boolean))];
  const variables = {
    searchTerm: query,
    limit: 20,
    numberOfTopResults: 20,
    offset: 0,
    includeAudiobooks: true,
    includePreReleases: true,
    includeAuthors: false,
  };
  for (const definition of definitionsToTry) {
    try {
      const response = await Spicetify.GraphQL.Request(definition, variables);
      if (response?.errors?.length) continue;
      const items = searchItemsFromConnection(response, type);
      if (items.length) return items;
    } catch {}
  }
  return [];
}
async function cosmosSearch(query, type) {
  const encoded = encodeURIComponent(query);
  const plural = `${type}s`;
  const urls = [
    `https://api.spotify.com/v1/search?q=${encoded}&type=${type}&limit=20&market=US`,
    `https://api.spotify.com/v1/search?q=${encoded}&type=${type}&limit=20`,
    `https://api.spotify.com/v1/search?query=${encoded}&type=${type}&limit=20`,
  ];
  for (const url of urls) {
    try {
      const response = await spotifyApiGet(url);
      const body = response?.body || response;
      const items = body?.[plural]?.items || body?.result?.[plural]?.items || [];
      const normalized = items.map(item => normalizeSearchItem(item, type)).filter(Boolean);
      if (normalized.length) return normalized;
    } catch {}
  }
  return [];
}
async function clearUpcomingQueue() {
  if (typeof Platform.PlayerAPI?.clearQueue === "function") {
    await Platform.PlayerAPI.clearQueue();
    return true;
  }
  if (typeof Spicetify.Platform?.PlayerAPI?.clearQueue === "function") {
    await Spicetify.Platform.PlayerAPI.clearQueue();
    return true;
  }
  return false;
}

async function addTracksToQueue(trackUris) {
  const unique = Array.from(new Set((trackUris || []).filter(Boolean)));
  if (!unique.length) return { queued: 0, total: 0, failed: [] };
  let queued = 0;
  const failed = [];
  for (const uri of unique) {
    try {
      if (Platform.PlayerAPI?.addToQueue) await Platform.PlayerAPI.addToQueue([{ uri }]);
      else await Spicetify.addToQueue([{ uri }]);
      queued++;
    } catch {
      try {
        await Spicetify.addToQueue([{ uri }]);
        queued++;
      } catch {
        try {
          await CosmosAsync.post("sp://core/queue/v1/queue", { uri });
          queued++;
        } catch {
          try {
            await CosmosAsync.post(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(uri)}`, {});
            queued++;
          } catch {
            failed.push(uri);
          }
        }
      }
    }
  }
  return { queued, total: unique.length, failed };
}
async function addTrackToPlaylist(playlistUri, trackUris) {
  const uris = Array.from(new Set((trackUris || []).filter(Boolean)));
  if (!playlistUri || !uris.length) throw new Error("Playlist or tracks missing");
  try {
    await Platform.PlaylistAPI.add(playlistUri, uris, { after: "end" });
    return true;
  } catch {}
  const id = URI.from(playlistUri)?.id || String(playlistUri).split(":").pop();
  for (let i = 0; i < uris.length; i += 100) {
    await CosmosAsync.post(`https://api.spotify.com/v1/playlists/${id}/items`, { uris: uris.slice(i, i + 100) });
  }
  return true;
}
async function createSpotifyPlaylist(name, trackUris) {
  let playlist;
  try {
    playlist = await CosmosAsync.post("https://api.spotify.com/v1/me/playlists", {
      name,
      description: "Created by Fremium",
      public: false,
    });
  } catch {}
  if (!playlist?.id) {
    const created = await Platform.RootlistAPI?.createPlaylist?.(name, { before: "start" });
    if (!created) throw new Error("Spotify playlist creation failed");
    playlist = { id: URI.from(created)?.id || String(created).split(":").pop(), uri: created };
  }
  await addTrackToPlaylist(playlist.uri || `spotify:playlist:${playlist.id}`, trackUris);
  return playlist;
}
async function balanceLiveQueue() {
  const qi = window.FremiumLiveQI;
  const api = Spicetify.Platform.PlayerAPI;
  const current = Spicetify.Queue?.nextTracks || [];
  if (!qi || !api?.reorderQueue || current.length < 2) {
    if (current.length < 2) showNotification("Queue needs at least two tracks");
    else showNotification("Queue reordering is unavailable in this Spotify client", true);
    return { reordered: 0 };
  }
  const desired = qi.rank(current, qi.currentContext());
  let reordered = 0;
  for (let i = 1; i < desired.length; i++) {
    const moving = desired[i];
    const anchor = desired[i - 1];
    const movingUri = qi.queueUri(moving);
    const anchorUri = qi.queueUri(anchor);
    if (!movingUri || !anchorUri || movingUri === anchorUri) continue;
    const currentIndex = current.findIndex(item => qi.queueUri(item) === movingUri);
    const anchorIndex = current.findIndex(item => qi.queueUri(item) === anchorUri);
    if (currentIndex < anchorIndex) {
      try {
        await api.reorderQueue([{ uri: movingUri, uid: qi.queueUid(moving) }], { after: { uri: anchorUri, uid: qi.queueUid(anchor) } });
        reordered++;
      } catch {}
    }
  }
  qi.record({ type: "queue_balance", context: qi.currentContext(), reordered, total: current.length });
  if (reordered) showNotification(`QI balanced ${reordered} queue positions`);
  else showNotification("QI: queue already balanced");
  return { reordered };
}
async function spotifySearch(query, type="album") {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) return null;
  let items = await graphqlSearch(cleanQuery, type);
  if (!items.length) items = await cosmosSearch(cleanQuery, type);
  if (!items.length) {
    const fallbackType = type === "album" ? "track" : type === "track" ? "album" : type;
    items = await graphqlSearch(cleanQuery, fallbackType);
    if (items.length && type === "album") {
      return items.find(item => item?.album?.uri) || items[0] || null;
    }
  }
  if (!items.length) return null;
  items.sort((a, b) => searchScore(cleanQuery, b) - searchScore(cleanQuery, a));
  return items[0] || null;
}
async function spotifyPlay(query, type="album") {
  const queries = type === "album"
    ? [query, `album:${query.split(" ").slice(1).join(" ")} artist:${query.split(" ")[0]}`, query.replace(/"/g, "")]
    : [query, query.replace(/["']/g, "")];
  for (const q of queries) {
    const item = await spotifySearch(q, type);
    if (item?.uri) return item.uri;
  }
  return null;
}

function unwrapCosmosBody(response) {
  const body = response?.body ?? response;
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch {}
  }
  return body || {};
}

async function spotifyApiGet(url) {
  try {
    const response = await CosmosAsync.get(url);
    const body = unwrapCosmosBody(response);
    if (body && !body.error) return response;
  } catch {}
  const token = Spicetify.Platform?.Session?.accessToken;
  if (!token) return null;
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    return await response.json();
  } catch {}
  return null;
}

function getPlaylistId(value) {
  const raw = String(value || "");
  const uriMatch = raw.match(/spotify:(?:playlist|playlist-v2):([a-zA-Z0-9]+)/i);
  if (uriMatch) return uriMatch[1];
  const urlMatch = raw.match(/open\.spotify\.com\/(?:playlist|user\/[^/]+\/playlist)\/([a-zA-Z0-9]+)/i);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9]{22}$/.test(raw)) return raw;
  try {
    const parsed = URI.from(raw);
    if (parsed?.id) return parsed.id;
  } catch {}
  return "";
}

function playlistSearchScore(query, item) {
  const q = searchName(query);
  const name = searchName(item?.name);
  let score = 0;
  if (q && name === q) score = 100;
  else if (q && name.includes(q)) score = 65;
  else if (q && name && q.includes(name)) score = 45;
  const owner = searchName(item?.owner?.displayName || item?.owner?.name || item?.owner?.profile?.name || "");
  if (owner && q.includes(owner)) score += 20;
  if (item?.uri || item?.id) score += 2;
  return score;
}

function responsePlaylistItems(response) {
  const body = unwrapCosmosBody(response);
  const collection = body?.tracks || body?.playlist?.tracks || body?.data?.tracks || body?.data || body;
  const items = Array.isArray(collection) ? collection : collection?.items || body?.items || [];
  return (Array.isArray(items) ? items : []).map(item => item?.track || item?.item || item).filter(Boolean);
}

async function getSpotifyUserPlaylists() {
  const found = [];
  const library = Platform?.LibraryAPI || Spicetify.Platform?.LibraryAPI;
  const methodNames = ["getPlaylists", "getUserPlaylists", "getAllPlaylists"];
  for (const name of methodNames) {
    const method = library?.[name];
    if (typeof method !== "function") continue;
    for (const args of [[], [{ limit: 100 }], [100]]) {
      try {
        const response = await method(...args);
        found.push(...responsePlaylistItems(response));
        if (found.length) break;
      } catch {}
    }
    if (found.length) break;
  }
  const endpoints = [
    "https://api.spotify.com/v1/me/playlists?limit=50&offset=0",
    "https://api.spotify.com/v1/me/playlists?limit=50&offset=50",
    "https://api.spotify.com/v1/me/playlists?limit=50&offset=100",
    "sp://core/collection/v1/collection/playlists?limit=100",
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await spotifyApiGet(endpoint);
      found.push(...responsePlaylistItems(response));
    } catch {}
  }
  return found.map(item => normalizeSearchItem(item, "playlist")).filter(Boolean);
}

async function spotifyPlaylistSearch(query) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) return [];
  const items = [...await getSpotifyUserPlaylists()];
  items.push(...await spotifySearchMany(cleanQuery, "playlist"));
  const unique = new Map();
  items.forEach(item => {
    const key = item?.uri || item?.id || `${item?.name || ""}|${item?.owner?.id || ""}`;
    if (key && !unique.has(key)) unique.set(key, item);
  });
  return [...unique.values()].sort((a, b) => playlistSearchScore(cleanQuery, b) - playlistSearchScore(cleanQuery, a));
}

function getPlaylistQueryVariants(query) {
  const raw = String(query || "").trim();
  const cleaned = raw
    .replace(/\b(?:my|your|the)\b/gi, " ")
    .replace(/\bplaylist\b/gi, " ")
    .replace(/\bfolx\b/gi, "folk")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned.split(/\s*\/\s*|\s*&\s*|\s*\+\s*/).map(part => part.trim()).filter(Boolean);
  const variants = [raw, cleaned, ...parts, ...parts.map(part => part.replace(/\bfolk\b/gi, "folx"))];
  if (parts.length > 1) variants.push(parts.join(" "));
  return [...new Set(variants.filter(Boolean))];
}

async function resolveSpotifyPlaylist(query) {
  for (const variant of getPlaylistQueryVariants(query)) {
    const directId = getPlaylistId(variant);
    if (directId) return { query: variant, playlist: { id: directId, uri: `spotify:playlist:${directId}`, name: variant } };
    const candidates = await spotifyPlaylistSearch(variant);
    const best = candidates[0];
    if (best && playlistSearchScore(variant, best) >= 40) return { query: variant, playlist: best };
  }
  return null;
}

function collectPlaylistTrackObjects(value, output, depth=0) {
  if (!value || depth > 8 || output.length >= 500) return;
  if (Array.isArray(value)) {
    value.forEach(item => collectPlaylistTrackObjects(item, output, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  const uri = value.uri || value.itemUri || value.item_uri;
  if (typeof uri === "string" && /^spotify:track:/i.test(uri) && (value.name || value.title)) {
    output.push({ ...value, uri, name: getTrackName(value), artist: getTrackArtistText(value) });
  }
  Object.values(value).forEach(item => collectPlaylistTrackObjects(item, output, depth + 1));
}

async function getGraphQLSpotifyPlaylistTracks(playlist, limit) {
  const definitions = {
    ...(Spicetify.GraphQL?.QueryDefinitions || {}),
    ...(Spicetify.GraphQL?.Definitions || {}),
  };
  const definition = definitions.FetchPlaylistContents || definitions.fetchPlaylistContents;
  const uri = playlist?.uri || (playlist?.id ? `spotify:playlist:${playlist.id}` : "");
  if (!definition || !uri) return [];
  const locale = Platform?.Session?.locale || "en";
  const variableSets = [
    { uri, offset: 0, limit, locale },
    { playlistUri: uri, offset: 0, limit, locale },
    { uri, limit, offset: 0 },
  ];
  for (const variables of variableSets) {
    try {
      const response = await Spicetify.GraphQL.Request(definition, variables);
      if (response?.errors?.length) continue;
      const output = [];
      collectPlaylistTrackObjects(response, output);
      if (output.length) return uniqueTracks(output).slice(0, limit);
    } catch {}
  }
  return [];
}

async function getSpotifyPlaylistTracks(playlist, limit=100) {
  const playlistUri = playlist?.uri || (playlist?.id ? `spotify:playlist:${playlist.id}` : "");
  const id = getPlaylistId(playlistUri || playlist?.id || "");
  if (!id) return [];
  const maxTracks = Math.min(500, Math.max(100, limit * 2));
  const collected = [];
  const addResponse = response => {
    const items = responsePlaylistItems(response);
    items.forEach(item => collected.push({
      ...item,
      name: getTrackName(item),
      artist: getTrackArtistText(item),
      uri: getTrackUri(item),
    }));
  };
  for (const endpoint of [
    `https://api.spotify.com/v1/playlists/${id}/items?limit=100&offset=0&additional_types=track`,
    `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100&offset=0`,
  ]) {
    let offset = 0;
    while (offset < maxTracks && collected.length < maxTracks) {
      const url = endpoint.replace(/offset=0/, `offset=${offset}`);
      try {
        const response = await spotifyApiGet(url);
        addResponse(response);
        const body = unwrapCosmosBody(response);
        const items = responsePlaylistItems(response);
        if (!items.length || !body?.next) break;
        offset += items.length || 100;
      } catch {
        break;
      }
    }
    if (collected.length) break;
  }
  if (collected.length < maxTracks) {
    const apis = [Platform?.PlaylistAPI, Spicetify.Platform?.PlaylistAPI, Platform?.LibraryAPI, Spicetify.Platform?.LibraryAPI].filter(Boolean);
    for (const api of apis) {
      for (const name of ["getTracks", "getPlaylistTracks", "getItems", "getPlaylistItems", "getPlaylist"]) {
        const method = api?.[name];
        if (typeof method !== "function") continue;
        for (const args of [[playlistUri || id], [playlistUri || id, { limit: 100, offset: 0 }], [id, 100, 0]]) {
          try {
            const response = await method(...args);
            addResponse(response);
            if (collected.length >= maxTracks) break;
          } catch {}
        }
        if (collected.length >= maxTracks) break;
      }
      if (collected.length >= maxTracks) break;
    }
  }
  if (collected.length < maxTracks) {
    const graphTracks = await getGraphQLSpotifyPlaylistTracks(playlist, maxTracks);
    graphTracks.forEach(track => collected.push(track));
  }
  return uniqueTracks(collected).slice(0, maxTracks);
}

function getTrackName(track) {
  return track?.name || track?.title || track?.track?.name || track?.item?.name || track?.metadata?.title || "";
}

function cleanAiReferenceValue(value) {
  return String(value || "")
    .replace(/[?!.]+$/g, "")
    .replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g, "")
    .replace(/^(?:i\s*(?:am|[’']m)\s+|im\b\s+|i\s+feel\s+like\s+|i\s+feel\s+|feeling\s+like\s+|feel(?:ing)?\s+like\s+|make\s+me\s+feel\s+like\s+|music\s+that\s+makes\s+me\s+feel\s+like\s+|something\s+like\s+|songs?\s+like\s+|tracks?\s+like\s+)/i, "")
    .replace(/^(?:the\s+)?(?:song|track)\s+/i, "")
    .replace(/^(?:that\s+|which\s+)/i, "")
    .trim();
}

function parseAiReferenceValue(value, currentTrack) {
  const clean = cleanAiReferenceValue(value);
  if (!clean) return null;
  if (/^(?:this|this song|this track|current(?: song| track)?)$/i.test(clean)) {
    return { track: getTrackName(currentTrack), artist: getTrackArtistText(currentTrack) };
  }
  const dashParts = clean.split(/\s+[—-]\s+/);
  if (dashParts.length > 1) return { track: dashParts[0].trim(), artist: dashParts.slice(1).join(" ").trim() };
  const byMatch = clean.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) return { track: byMatch[1].trim(), artist: byMatch[2].trim() };
  return { track: clean, artist: "" };
}

function parseAiPrompt(text, currentTrack) {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();
  const linkMatch = raw.match(/(?:https?:\/\/open\.spotify\.com\/(?:playlist|user\/[^/]+\/playlist)|spotify:(?:playlist|playlist-v2):)([a-zA-Z0-9]+)/i);
  const explicitPlaylistMatch = raw.match(/\bplaylist\s+(?:(?:called|named|titled)\s+)?(.+?)(?=\s+playlist\b|[,.!?]|$)/i);
  const beforePlaylistMatch = raw.match(/\b(?:from|use|using|play|queue|load|based on|inspired by)\s+(.+?)\s+playlist\b/i);
  const possessivePlaylistMatch = raw.match(/\b(?:out of|from|using|with)\s+(?:my|your|the)\s+(.+?)(?=\s+playlist\b|[,.!?]|$)/i);
  const fromMatch = raw.match(/\b(?:from|use|using|play|queue|based on|inspired by)\s+(.+?)(?=\s+playlist\b|[,.!?]|$)/i);
  const playlistQuery = linkMatch ? linkMatch[0] : (explicitPlaylistMatch?.[1] || beforePlaylistMatch?.[1] || possessivePlaylistMatch?.[1] || null);
  const similarMatch = raw.match(/\b(?:songs?|music|tracks?)?\s*(?:like|sounds? like|feels? like|in the style of|similar to|inspired by|based on)\s+(.+?)(?=\s+(?:but|with|for|that|which)\b|[,.!?]|$)/i);
  const similar = similarMatch ? parseAiReferenceValue(similarMatch[1], currentTrack) : null;
  const artistMatch = raw.match(/\b(?:songs?|music|tracks?|artists?)\s+(?:by|from)\s+(.+?)(?=\s+(?:but|with|for|that|which)\b|[,.!?]|$)/i);
  const artistQuery = artistMatch ? cleanAiReferenceValue(artistMatch[1]) : "";
  return {
    playlistQuery: playlistQuery ? cleanAiReferenceValue(playlistQuery) : "",
    fromQuery: fromMatch ? cleanAiReferenceValue(fromMatch[1]) : "",
    explicitPlaylist: Boolean(linkMatch || explicitPlaylistMatch || beforePlaylistMatch || possessivePlaylistMatch || /\bplaylist\b/i.test(lower)),
    similar,
    artistQuery,
  };
}

function parseAiRequestClauses(text) {
  const chunks = String(text || "")
    .split(/\b(?:then|plus|also|followed by)\b|,|\bwith\s+(?=(?:some|several|few|a|one|\d+)?\s*(?:songs?|tracks?)\b)|\band\s+(?=add\b|include\b|use\b|play\b)/i)
    .map(chunk => chunk.trim())
    .filter(Boolean);
  if (chunks.length < 2) return [];
  return chunks.map((chunk, index) => {
    const intent = parseAiPrompt(chunk);
    const playlistQuery = intent.explicitPlaylist ? intent.playlistQuery : "";
    const countMatch = chunk.match(/\b(\d+)\s*-?\s*(?:songs?|tracks?)\b/i);
    const oneMatch = /\b(?:a|one)\s+(?:song|track)\b/i.test(chunk);
    const someMatch = /\b(?:some|several|few)\s+(?:songs?|tracks?)\b/i.test(chunk);
    return {
      text: chunk,
      count: countMatch ? parseInt(countMatch[1], 10) : playlistQuery ? 5 : oneMatch ? 1 : index === 0 ? 15 : 1,
      artistCandidate: playlistQuery ? "" : extractAiArtistCandidate(chunk),
      playlistQuery,
    };
  }).filter(clause => clause.artistCandidate || clause.playlistQuery);
}

async function resolveAiRequestClauses(clauses, currentTrack) {
  if (!Array.isArray(clauses) || clauses.length < 2) return null;
  const resolved = [];
  const sourceNames = [];
  let totalCount = 0;
  for (const clause of clauses) {
    const intent = parseAiPrompt(clause.text, currentTrack);
    let batch = [];
    let sourceLabel = "";
    if (clause.playlistQuery) {
      const resolvedPlaylist = await resolveSpotifyPlaylist(clause.playlistQuery);
      if (resolvedPlaylist) {
        batch = await getSpotifyPlaylistTracks(resolvedPlaylist.playlist, clause.count);
        sourceLabel = resolvedPlaylist.playlist.name || resolvedPlaylist.query;
      } else {
        const playlistFallbacks = [];
        for (const variant of getPlaylistQueryVariants(clause.playlistQuery)) playlistFallbacks.push(await getGenericSpotifyTracks(variant, clause.count));
        batch = interleaveAiTracks(playlistFallbacks, clause.count);
        sourceLabel = clause.playlistQuery;
      }
    } else {
      let matches = intent.artistQuery ? await findExactSpotifyArtists(intent.artistQuery) : [];
      if (!matches.length && clause.artistCandidate) matches = await findExactSpotifyArtists(clause.artistCandidate);
      if (!matches.length && clause.artistCandidate) matches = [{ name: clause.artistCandidate }];
      if (matches.length) {
        const batches = await Promise.all(matches.map(match => getSimilarAiTracks({ track: "", artist: match.name }, currentTrack, clause.count)));
        batch = interleaveAiTracks(batches, Math.min(50, Math.max(clause.count * 3, clause.count + 10)));
        sourceLabel = matches.map(match => match.name).join(" + ");
      }
    }
    if (batch.length < clause.count) {
      const supplement = await getGenericSpotifyTracks(sourceLabel || clause.playlistQuery || clause.artistCandidate, clause.count * 3);
      batch = interleaveAiTracks([batch, supplement], Math.max(clause.count, batch.length + supplement.length));
    }
    if (!batch.length) continue;
    const selected = batch.slice(0, Math.max(1, clause.count));
    resolved.push(...selected);
    sourceNames.push(sourceLabel);
    totalCount += selected.length;
  }
  if (!resolved.length) return null;
  return {
    tracks: resolved,
    targetTrackCount: Math.min(50, totalCount),
    sourceName: sourceNames.join(" + "),
  };
}

function extractAiArtistCandidate(text) {
  const value = String(text || "")
    .replace(/\b\d+\s*-?\s*(?:songs?|tracks?|hours?|hrs?)\b/gi, " ")
    .replace(/\b(?:make|give|create|build|generate|recommend|find|play|put|queue|add)\b/gi, " ")
    .replace(/\b(?:me|my|a|an|the|mix|playlist|music|songs?|tracks?|from|like|by|for|with|but|that|this|in|on|to|of|out|some|several|few|what|should|listen)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return value.length >= 2 ? value : "";
}

function splitAiArtistCandidates(value) {
  return String(value || "")
    .split(/\s*(?:,|&|\+)\s*|\s+and\s+/i)
    .map(part => part.trim())
    .filter(Boolean);
}

async function searchSpotifyArtistDirect(query) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) return [];
  const fieldQuery = `artist:"${cleanQuery}"`;
  const urls = [
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(fieldQuery)}&type=artist&limit=20&market=US`,
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(cleanQuery)}&type=artist&limit=20`,
  ];
  for (const url of urls) {
    try {
      const response = await spotifyApiGet(url);
      const body = unwrapCosmosBody(response);
      const items = body?.artists?.items || [];
      if (items.length) return items.map(item => normalizeSearchItem(item, "artist")).filter(Boolean);
    } catch {}
  }
  return [];
}

async function findExactSpotifyArtist(query) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) return null;
  let items = await spotifySearchMany(cleanQuery, "artist");
  if (!items.length) items = await searchSpotifyArtistDirect(cleanQuery);
  const sorted = [...items].sort((a, b) => searchScore(cleanQuery, b) - searchScore(cleanQuery, a));
  const best = sorted[0];
  if (best && searchScore(cleanQuery, best) >= 100) return best;
  if (best && searchScore(cleanQuery, best) >= 45) return best;
  const lfmResult = await lfmFetch({ method: "artist.search", artist: cleanQuery, limit: "5" }).catch(() => null);
  const lfmArtists = lfmResult?.results?.artistmatches?.artist || [];
  const lfmExact = lfmArtists.find(artist => searchName(artist.name) === searchName(cleanQuery));
  return lfmExact?.name ? { name: lfmExact.name } : null;
}

async function findExactSpotifyArtists(query) {
  const parts = splitAiArtistCandidates(query);
  if (!parts.length) return [];
  if (parts.length === 1) {
    const match = await findExactSpotifyArtist(parts[0]);
    return match ? [match] : [];
  }
  const matches = [];
  for (const part of parts) {
    const match = await findExactSpotifyArtist(part);
    if (match) matches.push(match);
  }
  if (matches.length === parts.length) return matches;
  const fullMatch = await findExactSpotifyArtist(query);
  return fullMatch ? [fullMatch] : matches;
}

async function spotifySearchMany(query, type) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) return [];
  const [graphqlItems, cosmosItems] = await Promise.all([
    graphqlSearch(cleanQuery, type).catch(() => []),
    cosmosSearch(cleanQuery, type).catch(() => []),
  ]);
  const unique = new Map();
  [...graphqlItems, ...cosmosItems].forEach(item => {
    const key = item?.uri || item?.id || `${item?.name || ""}|${getTrackArtistText(item)}`;
    if (key && !unique.has(key)) unique.set(key, item);
  });
  return [...unique.values()];
}

async function getSpotifyArtistTopTracks(artistQuery, limit) {
  const searched = await spotifySearchMany(artistQuery, "artist").catch(() => []);
  let artist = searched.sort((a, b) => searchScore(artistQuery, b) - searchScore(artistQuery, a))[0] || null;
  if (!artist) {
    const direct = await searchSpotifyArtistDirect(artistQuery);
    artist = direct.sort((a, b) => searchScore(artistQuery, b) - searchScore(artistQuery, a))[0] || null;
  }
  const id = String(artist?.uri || "").match(/spotify:artist:([a-zA-Z0-9]+)/i)?.[1] || artist?.id;
  if (!id) return [];
  for (const market of ["US", "GB", "CA", "AU"]) {
    try {
      const response = await spotifyApiGet(`https://api.spotify.com/v1/artists/${id}/top-tracks?market=${market}&limit=${Math.min(50, Math.max(10, limit))}`);
      const body = unwrapCosmosBody(response);
      const tracks = body?.tracks || [];
      if (tracks.length) return tracks.slice(0, limit).map(track => ({ ...track, name: getTrackName(track), artist: getTrackArtistText(track), uri: getTrackUri(track) }));
    } catch {}
  }
  return [];
}

async function getSimilarAiTracks(reference, currentTrack, targetCount) {
  if (!reference) return [];
  const candidateLimit = Math.min(50, Math.max(targetCount * 3, targetCount + 20));
  const trackName = reference.track || "";
  let artist = reference.artist || "";
  const spotifyTrack = trackName ? await spotifySearch(`${trackName}${artist ? ` ${artist}` : ""}`, "track").catch(() => null) : null;
  artist = artist || getTrackArtistText(spotifyTrack) || "";
  if (!trackName && artist) {
    const spotifyTop = await getSpotifyArtistTopTracks(artist, candidateLimit);
    const top = await lfmFetch({ method: "artist.getTopTracks", artist, limit: String(candidateLimit) }).catch(() => null);
    const lfmTracks = (top?.toptracks?.track || []).map(track => ({ name: track.name, artist: track.artist?.name || artist }));
    const combined = uniqueTracks([...spotifyTop, ...lfmTracks]).slice(0, candidateLimit);
    if (combined.length) return combined;
  }
  if (trackName && artist) {
    const similar = await lfmFetch({ method: "track.getSimilar", artist, track: trackName, limit: String(candidateLimit) }).catch(() => null);
    const list = similar?.similartracks?.track || [];
    if (list.length) return list.slice(0, candidateLimit).map(track => ({ name: track.name, artist: track.artist?.name || artist }));
  }
  if (trackName) {
    const related = await spotifySearchMany(`${trackName}${artist ? ` ${artist}` : ""}`, "track");
    if (related.length) return related.slice(0, candidateLimit).map(track => ({ ...track, name: getTrackName(track), artist: getTrackArtistText(track), uri: getTrackUri(track) }));
  }
  if (artist) {
    const top = await getSpotifyArtistTopTracks(artist, candidateLimit);
    if (top.length) return top;
    const artistTracks = await spotifySearchMany(artist, "track");
    if (artistTracks.length) {
      const artistToken = searchName(artist);
      const matching = artistTracks.filter(track => searchName(getTrackArtistText(track)).includes(artistToken));
      return (matching.length ? matching : artistTracks).slice(0, candidateLimit).map(track => ({ ...track, name: getTrackName(track), artist: getTrackArtistText(track), uri: getTrackUri(track) }));
    }
  }
  if (spotifyTrack) return [{ ...spotifyTrack, name: getTrackName(spotifyTrack), artist: getTrackArtistText(spotifyTrack) }];
  if (!trackName && !artist && currentTrack) {
    const similar = await lfmFetch({ method: "track.getSimilar", artist: getTrackArtistText(currentTrack), track: getTrackName(currentTrack), limit: String(candidateLimit) }).catch(() => null);
    const list = similar?.similartracks?.track || [];
    if (list.length) return list.slice(0, candidateLimit).map(track => ({ name: track.name, artist: track.artist?.name || getTrackArtistText(currentTrack) }));
    const related = await spotifySearchMany(`${getTrackName(currentTrack)} ${getTrackArtistText(currentTrack)}`, "track");
    if (related.length) return related.slice(0, candidateLimit).map(track => ({ ...track, name: getTrackName(track), artist: getTrackArtistText(track), uri: getTrackUri(track) }));
  }
  return [];
}

function interleaveAiTracks(batches, limit) {
  const result = [];
  const seen = new Set();
  const normalized = (batches || []).map(batch => Array.isArray(batch) ? batch : []);
  const maxLength = Math.max(0, ...normalized.map(batch => batch.length));
  for (let index = 0; index < maxLength && result.length < limit; index++) {
    for (const batch of normalized) {
      const track = batch[index];
      const keys = getTrackKeys(track);
      if (!keys.length || keys.some(key => seen.has(key))) continue;
      keys.forEach(key => seen.add(key));
      result.push(track);
      if (result.length >= limit) break;
    }
  }
  return result;
}

async function getGenericSpotifyTracks(query, limit) {
  const cleanQuery = searchName(query);
  if (!cleanQuery) return [];
  const items = await spotifySearchMany(cleanQuery, "track");
  return items.slice(0, limit).map(track => ({ ...track, name: getTrackName(track), artist: getTrackArtistText(track), uri: getTrackUri(track) }));
}

// ---------- Queue Intelligence data ----------
function logQueueEvent(evt) {
  window.FremiumLiveQI?.record?.(evt);
}
function getQueueLog(){ return window.FremiumLiveQI?.get?.()?.history?.events || []; }
function getTrainingFile() {
  return window.FremiumLiveQI?.get?.() || { profile: {}, tracks: {}, playlists: {}, history: { events: [] } };
}
function addTrainingEvent(event) {
  window.FremiumLiveQI?.record?.(event);
}


// ---------- Floating Window Component ----------
function FremiumWindow({ isOpen, onClose }) {
  const [tab, setTab] = useState(() => LocalStorage.get(LS.winTab) || "dashboard");
  const [pos, setPos] = useState(() => loadJson(LS.winPos, { x: Math.max(40, window.innerWidth - 760), y: 80 }));
  const [size, setSize] = useState(() => loadJson(LS.winSize, { w: 680, h: 520 }));
  const [drag, setDrag] = useState(null); // {dx,dy}
  const [resizing, setResizing] = useState(null);
  const [minimized, setMinimized] = useState(false);
  const winRef = useRef(null);

  useEffect(() => { LocalStorage.set(LS.winTab, tab); }, [tab]);
  useEffect(() => { saveJson(LS.winPos, pos); }, [pos]);
  useEffect(() => { saveJson(LS.winSize, size); }, [size]);

  // Drag
  const onHeaderDown = useCallback((e) => {
    if (e.button !== 0) return;
    // don't drag when clicking controls
    if (e.target.closest && e.target.closest(".fremium-win-controls, .fremium-win-tabs button")) return;
    const rect = winRef.current.getBoundingClientRect();
    setDrag({ dx: e.clientX - rect.left, dy: e.clientY - rect.top });
    e.preventDefault();
  }, []);
  useEffect(() => {
    if (!drag) return;
    const onMove = (e) => {
      let x = e.clientX - drag.dx;
      let y = e.clientY - drag.dy;
      // clamp to viewport
      x = Math.max(4, Math.min(window.innerWidth - size.w - 4, x));
      y = Math.max(4, Math.min(window.innerHeight - 60, y));
      setPos({ x, y });
    };
    const onUp = () => setDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [drag, size.w]);

  // Resize (bottom-right handle)
  const onResizeDown = useCallback((e) => {
    if (e.button !== 0) return;
    setResizing({ startX: e.clientX, startY: e.clientY, startW: size.w, startH: size.h });
    e.preventDefault();
    e.stopPropagation();
  }, [size]);
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e) => {
      let w = resizing.startW + (e.clientX - resizing.startX);
      let h = resizing.startH + (e.clientY - resizing.startY);
      w = Math.max(420, Math.min(window.innerWidth - pos.x - 8, w));
      h = Math.max(320, Math.min(window.innerHeight - pos.y - 12, h));
      setSize({ w, h });
    };
    const onUp = () => setResizing(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [resizing, pos]);

  // ESC to close, shortcut "f" maybe? keep ESC only
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const tabList = [
    { id: "dashboard", label: "Dashboard" },
    { id: "account", label: "Account" },
    { id: "songqi", label: "Song QI" },
    { id: "lastfm", label: "Last.fm" },
    { id: "streaks", label: "Streaks" },
    { id: "completionist", label: "Completionist" },
    { id: "taste", label: "Taste DNA" },
    { id: "roulette", label: "Roulette" },
    { id: "timemachine", label: "Time Machine" },
    { id: "queue", label: "Queue IQ" },
    { id: "ai", label: "AI" },
    { id: "mood", label: "Mood" },
    { id: "discover", label: "Discover" },
  ];

  return react.createElement(
    "div",
    {
      ref: winRef,
      className: `fremium-win ${minimized ? "fremium-min" : ""} ${drag ? "fremium-dragging" : ""}`,
      style: { left: pos.x, top: pos.y, width: size.w, height: minimized ? 48 : size.h },
    },
    // header (drag handle)
    react.createElement(
      "div",
      { className: "fremium-win-header", onMouseDown: onHeaderDown },
      react.createElement("div", { className: "fremium-win-title" },
        react.createElement("span", { className: "fremium-logo" }, "◈"),
        react.createElement("span", null, "Fremium"),
        react.createElement("span", { className: "fremium-badge" }, "FLOATING")
      ),
      react.createElement(
        "div",
        { className: "fremium-win-controls" },
        react.createElement("button", { title: minimized ? "Expand" : "Minimize", onClick: () => setMinimized(v=>!v) }, minimized ? "□" : "—"),
        react.createElement("button", { title: "Close (Esc)", onClick: onClose }, "×")
      )
    ),
    // tabs
    react.createElement(
      "div",
      { className: "fremium-win-tabs" },
      tabList.map(t =>
        react.createElement("button", {
          key: t.id,
          className: tab === t.id ? "active" : "",
          onClick: () => setTab(t.id)
        }, t.label)
      )
    ),
    // body
    !minimized ? react.createElement(
      "div",
      { className: "fremium-win-body" },
      tab === "dashboard" ? react.createElement(DashboardTab, { onGoLfm: () => setTab("lastfm") }) :
      tab === "account" ? react.createElement(AccountTab, null) :
      tab === "songqi" ? react.createElement(SongQiTab, null) :
      tab === "lastfm" ? react.createElement(LastFmTab, null) :
      tab === "streaks" ? react.createElement(StreaksTab, { onGoLfm: () => setTab("lastfm") }) :
      tab === "completionist" ? react.createElement(CompletionistTab, { onGoLfm: () => setTab("lastfm") }) :
      tab === "taste" ? react.createElement(TasteTab, { onGoLfm: () => setTab("lastfm") }) :
      tab === "roulette" ? react.createElement(RouletteTab, { onGoLfm: () => setTab("lastfm") }) :
      tab === "timemachine" ? react.createElement(TimeMachineTab, { onGoLfm: () => setTab("lastfm") }) :
      tab === "queue" ? react.createElement(QueueTab, { onGoLfm: () => setTab("lastfm") }) :
      tab === "ai" ? react.createElement(AITab, { onGoLfm: () => setTab("lastfm") }) :
      tab === "mood" ? react.createElement(MoodTab, { onGoLfm: () => setTab("lastfm") }) :
      tab === "discover" ? react.createElement(DiscoverTab, { onGoLfm: () => setTab("lastfm") }) : null
    ) : null,
    // resize handle
    !minimized ? react.createElement("div", { className: "fremium-resize", onMouseDown: onResizeDown, title: "Drag to resize" }) : null
  );
}

function AccountTab() {
  const runtime = window.FremiumAccount;
  const initial = runtime?.get?.() || {};
  const config = runtime?.getConfig?.() || {};
  const [account, setAccount] = useState(() => initial);
  const [url, setUrl] = useState(config.supabaseUrl || "");
  const [anonKey, setAnonKey] = useState(config.supabaseAnonKey || "");
  const [email, setEmail] = useState(initial.user?.email || "");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState(initial.user?.user_metadata?.display_name || "");
  const [mode, setMode] = useState("signin");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const unsubscribe = runtime?.subscribe?.(value => {
      setAccount(value || {});
      if (value?.user?.email) setEmail(value.user.email);
    });
    return unsubscribe;
  }, [runtime]);

  const run = async (action, success) => {
    if (!runtime) return null;
    setBusy(true);
    setStatus(null);
    try {
      const result = await action();
      setAccount(runtime.get?.() || {});
      if (success) setStatus({ ok: true, text: typeof success === "function" ? success(result) : success });
      return result;
    } catch (error) {
      setStatus({ ok: false, text: String(error?.message || error) });
      return null;
    } finally {
      setBusy(false);
    }
  };
  const saveConfig = () => run(() => runtime.configure(url, anonKey), "Supabase connection saved locally");
  const submitAuth = event => {
    event.preventDefault();
    const action = mode === "signup" ? runtime.signUp(email, password, displayName) : runtime.signIn(email, password);
    run(action, result => mode === "signup" ? (result?.requiresConfirmation ? "Check your email to confirm the account" : "Account created") : "Signed in");
    setPassword("");
  };
  const field = (label, type, value, setter, extra = {}) => react.createElement("label", { className: "fremium-account-field" },
    label,
    react.createElement("input", Object.assign({ className: "fremium-input", type, value, onChange: event => setter(event.target.value) }, extra))
  );
  const configured = account.configured || Boolean(url && anonKey);
  const signedIn = Boolean(account.user);
  const userName = account.user?.user_metadata?.display_name || account.user?.email || "Fremium listener";
  const lastSync = account.lastSync ? new Date(account.lastSync).toLocaleString() : "Not synced yet";
  if (!runtime) return react.createElement("div", { className: "fremium-tab" }, react.createElement("h3", null, "Account sync"), react.createElement("div", { className: "fremium-status err" }, "Account runtime unavailable"));
  return react.createElement("div", { className: "fremium-tab" },
    react.createElement("h3", null, "Fremium account"),
    react.createElement("p", { className: "fremium-hint" }, "Connect a private Supabase account to sync listening history and Queue Intelligence summaries to the Fremium website."),
    react.createElement("details", { className: "fremium-account-settings", open: !configured },
      react.createElement("summary", null, "Supabase connection"),
      react.createElement("div", { className: "fremium-form" },
        field("Project URL", "url", url, setUrl, { placeholder: "https://your-project.supabase.co" }),
        field("Public anon key", "password", anonKey, setAnonKey, { placeholder: "Publishable anon key", autoComplete: "off" }),
        react.createElement("div", { className: "fremium-actions" }, react.createElement("button", { className: "fremium-btn", type: "button", onClick: saveConfig, disabled: busy }, "Save connection"))
      )
    ),
    signedIn ? react.createElement(react.Fragment, null,
      react.createElement("div", { className: "fremium-account-user" },
        react.createElement("strong", null, userName),
        react.createElement("span", null, account.user?.email || ""),
        react.createElement("small", null, `Last sync: ${lastSync}`)
      ),
      account.lastResult ? react.createElement("div", { className: "fremium-hint" }, `Last sync uploaded ${account.lastResult.events || 0} listening events.`) : null,
      react.createElement("div", { className: "fremium-actions" },
        react.createElement("button", { className: "fremium-btn primary", type: "button", onClick: () => run(() => runtime.sync(), result => `Synced ${result.events} events`), disabled: busy || account.syncing }, account.syncing ? "Syncing…" : "Sync now"),
        react.createElement("button", { className: "fremium-btn", type: "button", onClick: () => run(() => runtime.signOut(), "Signed out"), disabled: busy }, "Sign out")
      ),
      react.createElement("label", { className: "fremium-account-auto" },
        react.createElement("input", { type: "checkbox", checked: account.autoSync !== false, onChange: event => runtime.setAutoSync(event.target.checked) }),
        react.createElement("span", null, "Sync automatically after listening events")
      )
    ) : react.createElement(react.Fragment, null,
      react.createElement("div", { className: "fremium-form" },
        field("Email", "email", email, setEmail, { placeholder: "you@example.com", autoComplete: "email" }),
        field("Password", "password", password, setPassword, { placeholder: "Your password", autoComplete: "current-password" }),
        mode === "signup" ? field("Display name", "text", displayName, setDisplayName, { placeholder: "Optional", autoComplete: "name" }) : null,
        react.createElement("div", { className: "fremium-actions" },
          react.createElement("button", { className: "fremium-btn primary", type: "button", onClick: submitAuth, disabled: busy || !configured }, mode === "signup" ? "Create account" : "Sign in"),
          react.createElement("button", { className: "fremium-btn", type: "button", onClick: () => setMode(value => value === "signin" ? "signup" : "signin"), disabled: busy }, mode === "signup" ? "Use sign in" : "Create account")
        )
      )
    ),
    status ? react.createElement("div", { className: `fremium-status ${status.ok ? "ok" : "err"}` }, status.text) : null,
    react.createElement("p", { className: "fremium-account-note" }, "Only the public anon key is needed. Access and refresh tokens stay on this device, and row-level security keeps synced data private to your account.")
  );
}

function SongQiTab() {
  const runtime = window.FremiumLiveQI;
  const [track, setTrack] = useState(() => Player.data?.item || null);
  const [qi, setQi] = useState(() => runtime?.get?.() || null);
  useEffect(() => {
    const update = () => setTrack(Player.data?.item || null);
    try { Player.addEventListener("songchange", update); Player.addEventListener("onplaypause", update); } catch {}
    const unsubscribe = runtime?.subscribe?.(value => setQi(value));
    return () => {
      unsubscribe?.();
      try { Player.removeEventListener("songchange", update); Player.removeEventListener("onplaypause", update); } catch {}
    };
  }, [runtime]);
  const uri = track?.uri || "";
  const context = runtime?.currentContext?.() || "global";
  const learnedTrack = qi?.learned?.tracks?.tracks?.[uri] || qi?.tracks?.tracks?.[uri] || null;
  const local = learnedTrack?.contexts?.[context] || learnedTrack || {};
  const details = uri ? runtime?.explain?.(uri, context) : null;
  const artist = track?.artists?.map(value => value?.name).filter(Boolean).join(", ") || track?.metadata?.artist_name || "Unknown artist";
  const album = track?.album?.name || track?.metadata?.album_name || "Unknown album";
  const components = details?.components || {};
  const labels = { replay: "Replay", completion: "Completion", position: "Position", recent: "Recent", playlist: "Playlist", artist: "Artist", genre: "Genre", session: "Session", flow: "Flow", skip: "Skip penalty", recentlyPlayed: "Recently played", queueDuplicate: "Queue duplicate" };
  const format = value => `${Number(value || 0) >= 0 ? "+" : ""}${Number(value || 0).toFixed(1)}`;
  return react.createElement("div", { className: "fremium-tab" },
    react.createElement("h3", null, "Current Song QI"),
    !track ? react.createElement("div", { className: "fremium-empty" }, "Play a song to see its Queue Intelligence profile.") : react.createElement(react.Fragment, null,
      react.createElement("div", { className: "fremium-row" },
        track?.album?.images?.[0]?.url ? react.createElement("img", { src: track.album.images[0].url, style: { width: 48, height: 48, borderRadius: 6, objectFit: "cover" } }) : null,
        react.createElement("div", { className: "fremium-row-main" },
          react.createElement("div", { className: "fremium-row-title" }, track.name || "Unknown track"),
          react.createElement("div", { className: "fremium-row-sub" }, `${artist} • ${album}`)
        ),
        react.createElement("span", { className: "fremium-pill" }, details ? `QI ${details.score}` : "New")
      ),
      react.createElement("div", { className: "fremium-grid2", style: { marginTop: 8 } },
        react.createElement(StatCard, { label: "QI score", value: details ? String(details.score) : "—", sub: details ? `${details.confidence}% confidence` : "Learning" }),
        react.createElement(StatCard, { label: "Plays", value: String(local.plays || 0), sub: `${local.skips || 0} skips` }),
        react.createElement(StatCard, { label: "Replays", value: String(local.repeats || 0), sub: `${local.completions || 0} completions` }),
        react.createElement(StatCard, { label: "Abandoned", value: String(local.abandonments || 0), sub: `${local.partialStops || 0} partial stops` }),
        react.createElement(StatCard, { label: "Position", value: local.positionSamples ? `${Math.round((local.positionTotal || 0) / local.positionSamples)}` : "—", sub: "Average queue position" }),
        react.createElement(StatCard, { label: "Playlist", value: String(qi?.learned?.contextProfiles?.contexts?.[context]?.plays || 0), sub: context === "global" ? "All listening" : "Current context" }),
        react.createElement(StatCard, { label: "Lifetime", value: String(Math.round(learnedTrack?.lifetimeScore || 50)), sub: "Preference score" }),
        react.createElement(StatCard, { label: "Recent", value: String(Math.round(learnedTrack?.recentScore || 50)), sub: "Recency-weighted score" })
      ),
      details ? react.createElement("div", { style: { marginTop: 12 } },
        react.createElement("h4", null, "Why this score?"),
        react.createElement("div", { className: "fremium-list small" }, (details.reasons || []).map((reason, index) => react.createElement("div", { className: "fremium-row", key: `${reason}-${index}` }, react.createElement("span", null, reason))))
      ) : null,
      Object.keys(components).length ? react.createElement("div", { style: { marginTop: 12 } },
        react.createElement("h4", null, "Score breakdown"),
        react.createElement("div", { className: "fremium-list small" }, Object.entries(components).map(([key, value]) => react.createElement("div", { className: "fremium-row", key }, react.createElement("span", null, labels[key] || key), react.createElement("strong", null, format(value)))))
      ) : null
    )
  );
}

// ---------- Last.fm Tab ----------
function LastFmTab() {
  const [cfg, setCfg] = useState(() => getLfmConfig());
  const [status, setStatus] = useState(null); // {ok, msg}
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState(null);

  const save = useCallback(() => {
    setLfmConfig(cfg);
    showNotification("Last.fm settings saved");
    setStatus({ ok: true, msg: "Saved. Test connection below." });
  }, [cfg]);

  const test = useCallback(async () => {
    if (!cfg.user || !cfg.key) { setStatus({ ok:false, msg:"Need username + API key" }); return; }
    setLoading(true); setStatus(null); setRecent(null);
    try {
      // Save first so lfmFetch sees it
      setLfmConfig(cfg);
      const info = await lfmFetch({ method: "user.getInfo", user: cfg.user });
      const rec = await lfmFetch({ method: "user.getRecentTracks", user: cfg.user, limit: "5", extended: "0" });
      setRecent(rec.recenttracks?.track?.slice(0,5) || []);
      setStatus({ ok:true, msg: `Connected as ${info.user?.name || cfg.user} — ${info.user?.playcount || "?"} scrobbles` });
      showNotification("Last.fm connected");
    } catch (e) { setStatus({ ok:false, msg: String(e.message||e) }); showNotification(String(e.message||e), true); }
    finally { setLoading(false); }
  }, [cfg]);

  const getToken = useCallback(async () => {
    if (!cfg.key) { setStatus({ok:false, msg:"Set API key first"}); return; }
    setLoading(true);
    try {
      setLfmConfig(cfg);
      const res = await lfmFetch({ method: "auth.getToken" });
      const token = res.token;
      setLfmConfig({ token });
      setCfg(c => ({ ...c, token }));
      setStatus({ ok:true, msg:`Token: ${token.slice(0,8)}… — click Authorize` });
      showNotification("Token created — authorize next");
    } catch(e){ setStatus({ok:false, msg:String(e.message||e)}) }
    finally{ setLoading(false); }
  }, [cfg]);

  const authorize = useCallback(() => {
    const c = cfg.token ? cfg : getLfmConfig();
    const token = c.token;
    const key = c.key;
    if (!token || !key) { setStatus({ok:false, msg:"Need token + key"}); return; }
    const url = `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
    window.open(url, "_blank");
    setStatus({ ok:true, msg: "Opened Last.fm — click Allow, then back here → Get Session" });
  }, [cfg]);

  const getSession = useCallback(async () => {
    if (!cfg.token || !cfg.key || !cfg.secret) { setStatus({ok:false, msg:"Need key+secret+token"}); return; }
    setLoading(true);
    try {
      setLfmConfig(cfg);
      const res = await lfmFetch({ method: "auth.getSession", token: cfg.token }, true);
      const session = res.session?.key;
      const username = res.session?.name || cfg.user;
      setLfmConfig({ session, user: username });
      setCfg(c=>({ ...c, session, user: username }));
      setStatus({ ok:true, msg:`Authed as ${username} — session saved` });
      showNotification(`Last.fm authed: ${username}`);
    } catch(e){ setStatus({ok:false, msg:String(e.message||e)}) }
    finally{ setLoading(false); }
  }, [cfg]);

  const disconnect = useCallback(() => {
    if (!confirm("Disconnect Last.fm? Clears key/session")) return;
    setLfmConfig({ user:"", key:"", secret:"", session:"", token:"" });
    setCfg({ user:"", key:"", secret:"", session:"", token:"" });
    setStatus({ ok:true, msg:"Disconnected" });
    setRecent(null);
  }, []);

  const connected = Boolean(cfg.user && cfg.key);
  const fully = Boolean(cfg.session);

  return react.createElement("div", { className: "fremium-tab" },
    react.createElement("h3", null, "Last.fm — Sign in"),
    react.createElement("p", { className:"fremium-hint" },
      "Connect Last.fm to power Taste DNA, Time Machine, Discovery Meter. ",
      react.createElement("span", null, "Create your own API key at "),
      react.createElement("a", { href:"https://www.last.fm/api/account/create", target:"_blank", style:{color:"var(--spice-button-active)"} }, "Last.fm API accounts"),
      react.createElement("span", null, " and enter it below.")
    ),
    react.createElement("div", { className: "fremium-form" },
      react.createElement("label", null, "Last.fm Username *",
        react.createElement("input", { className:"fremium-input", value: cfg.user, onChange:e=>setCfg({...cfg, user:e.target.value}), placeholder:"e.g. Blackscreen101 or your name" })
      ),
      react.createElement("details", { style:{marginTop:4} },
        react.createElement("summary", { style:{cursor:"pointer", fontSize:"0.8rem", color:"var(--spice-subtext)"} }, "Advanced: API Key / Secret"),
        react.createElement("label", { style:{marginTop:8} }, "API Key",
          react.createElement("input", { className:"fremium-input", value: cfg.key, onChange:e=>setCfg({...cfg, key:e.target.value}), placeholder: "Last.fm API key" })
        ),
        react.createElement("label", null, "API Secret",
          react.createElement("input", { className:"fremium-input", value: cfg.secret, onChange:e=>setCfg({...cfg, secret:e.target.value}), placeholder: "Last.fm API secret", type:"password" })
        )
      ),
      cfg.token ? react.createElement("div", { className:"fremium-hint", style:{wordBreak:"break-all"} }, "Token: ", cfg.token) : null,
      cfg.session ? react.createElement("div", { className:"fremium-hint" }, "Session: ", cfg.session.slice(0,12)+"… (authed)") : null,
      react.createElement("div", { className:"fremium-actions", style:{marginTop:8} },
        react.createElement("button", { className:"fremium-btn primary", onClick: save }, "Save"),
        react.createElement("button", { className:"fremium-btn", onClick: test, disabled: loading }, loading ? "…" : "Test connection"),
        connected ? react.createElement("span", { className: `fremium-pill ${fully?"":"muted"}`, style:{marginLeft:4} }, fully ? "● Fully authed" : "○ Read-only (add secret+auth)") : null
      ),
      status ? react.createElement("div", { className: `fremium-status ${status.ok?"ok":"err"}` }, status.msg) : null
    ),
    react.createElement("div", { className:"fremium-divider" }),
    react.createElement("h4", null, "Full auth (optional — for scrobbling/private data)"),
    react.createElement("p", { className:"fremium-hint" }, "1) Get Token  2) Authorize on Last.fm  3) Get Session. Needs key+secret. Skip if you just want public stats."),
    react.createElement("div", { className:"fremium-actions" },
      react.createElement("button", { className:"fremium-btn", onClick: analyze, disabled: !lfmOk }, "Analyze current track"),
      react.createElement("button", { className:"fremium-btn primary", onClick: improve }, "Improve queue"),
      react.createElement("button", { className:"fremium-btn", onClick: () => balanceLiveQueue() }, "Balance queue with QI")
    ),
    recent ? react.createElement("div", { style:{marginTop:12} },
      react.createElement("h4", null, "Recent scrobbles (test)"),
      react.createElement("div", { className:"fremium-list small" },
        recent.map((t,i) => react.createElement("div", { key:i, className:"fremium-row" },
          t.image?.[0]?.["#text"] ? react.createElement("img", { src: t.image[0]["#text"] || t.image[1]?.["#text"], style:{width:32,height:32,borderRadius:4,objectFit:"cover"} }) : null,
          react.createElement("div", { className:"fremium-row-main" },
            react.createElement("div", { className:"fremium-row-title small" }, t.name),
            react.createElement("div", { className:"fremium-row-sub" }, t.artist?.["#text"] || t.artist)
          ),
          react.createElement("span", { className:"fremium-pill muted" }, t.date?.["#text"] || "now playing")
        ))
      )
    ) : null,
    react.createElement("div", { className:"fremium-actions", style:{marginTop:12} },
      react.createElement("button", { className:"fremium-btn danger", onClick: disconnect }, "Disconnect")
    )
  );
}

// ---------- Tabs ----------
function DashboardTab({ onGoLfm }) {
  const [track, setTrack] = useState(() => Player.data?.item || null);
  const lfmOk = isLfmConnected();
  const [lfmInfo, setLfmInfo] = useState(null);
  useEffect(() => {
    const cb = () => setTrack(Player.data?.item || null);
    Player.addEventListener("songchange", cb);
    Player.addEventListener("onplaypause", cb);
    return () => { Player.removeEventListener("songchange", cb); Player.removeEventListener("onplaypause", cb); };
  }, []);
  useEffect(() => {
    if (!lfmOk) return;
    lfmFetch({ method: "user.getInfo", user: getLfmConfig().user }).then(r=> setLfmInfo(r.user)).catch(()=>{});
  }, [lfmOk]);
  const streaks = loadJson(LS.streaks, {});
  const totalStreaks = Object.keys(streaks).length;
  const best = useMemo(() => Object.values(streaks).reduce((m, v) => Math.max(m, v.best||0), 0), [streaks]);
  const queueLen = (() => { try { return Spicetify.Queue?.nextTracks?.length || 0; } catch { return 0; } })();
  const queueTotalDisplay = (()=>{ try{ const n=Spicetify.Queue?.nextTracks?.length||0; const h=Spicetify.Queue?.prevTracks?.length||0; return `${n} next • ${h} history`; }catch{ return `${queueLen} next`; } })();

  const lfm = getLfmConfig();
  return react.createElement("div", { className: "fremium-tab" },
    lfmOk && lfmInfo ? react.createElement("div", { className:"fremium-notice", style:{marginBottom:8} },
      react.createElement("span", null, `Last.fm: ${lfmInfo.name} — ${lfmInfo.playcount} scrobbles • ${lfmInfo.artist_count} artists`),
      react.createElement("span", {className:"fremium-pill muted"}, lfmInfo.url)
    ) : null,
    react.createElement("div", { className: "fremium-grid2" },
      react.createElement(StatCard, { label: "Now Playing", value: track?.name || "—", sub: track?.artists?.map(a=>a.name).join(", ") || "Nothing" }),
      react.createElement(StatCard, { label: "Active Streaks", value: String(totalStreaks), sub: best ? `Best: ${best} days` : "Play a track to start" }),
      react.createElement(StatCard, { label: "Queue", value: String(queueLen), sub: queueTotalDisplay }),
      react.createElement(StatCard, { label: "Last.fm", value: lfmOk ? `● ${lfm.user}` : "○ Not linked", sub: lfmOk ? (lfm.session ? `Fully authed • ${lfmInfo?lfmInfo.playcount+" plays":""}` : "Read-only — tap Sign in for full") : "Needed for Time Machine & Taste DNA" }),
    ),
    !lfmOk ? react.createElement("div", { className:"fremium-notice" },
      react.createElement("span", null, "Connect Last.fm to unlock personalized stats"),
      react.createElement("button", { className:"fremium-btn primary small", onClick: onGoLfm }, "Sign in →")
    ) : null,
    react.createElement("div", { className: "fremium-actions" },
      react.createElement("button", { className: "fremium-btn primary", onClick: () => Spicetify.Player.togglePlay() }, "Play/Pause"),
      react.createElement("button", { className: "fremium-btn", onClick: () => Spicetify.Player.next() }, "Next"),
      react.createElement("button", { className: "fremium-btn", onClick: () => showNotification("Fremium: dashboard live — streaks update daily") }, "Test Notification"),
    ),
    react.createElement("p", { className: "fremium-hint" }, "This window stays on top while you browse Spotify. Move it, resize it, switch tabs. It doesn't take over the app — exactly what you asked for.")
  );
}

function StatCard({ label, value, sub }) {
  return react.createElement("div", { className: "fremium-stat" },
    react.createElement("div", { className: "fremium-stat-label" }, label),
    react.createElement("div", { className: "fremium-stat-value" }, value),
    react.createElement("div", { className: "fremium-stat-sub" }, sub)
  );
}

function StreaksTab({ onGoLfm }) {
  const lfmOk = isLfmConnected();
  const [streaks, setStreaks] = useState(() => loadJson(LS.streaks, {}));
  const [lfmRecent, setLfmRecent] = useState(null);
  const [lfmLoading, setLfmLoading] = useState(false);
  const refresh = useCallback(() => setStreaks(loadJson(LS.streaks, {})), []);
  useEffect(() => {
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]);
  const list = Object.entries(streaks).sort((a,b)=> (b[1].best||0)-(a[1].best||0)).slice(0,20);
  const today = todayKey();

  const fetchLfmStreaks = useCallback(async () => {
    if (!lfmOk) return;
    setLfmLoading(true);
    try {
      const res = await lfmFetch({ method: "user.getRecentTracks", user: getLfmConfig().user, limit: "200", extended: "0" });
      const tracks = res.recenttracks?.track || [];
      // Build streaks from Last.fm: group by track name+artist consecutive days
      const byDay = {};
      tracks.forEach(t => {
        if (!t.date?.uts) return;
        const day = new Date(parseInt(t.date.uts)*1000).toISOString().slice(0,10);
        const key = `${t.artist["#text"]} - ${t.name}`;
        if (!byDay[key]) byDay[key] = new Set();
        byDay[key].add(day);
      });
      const lfmStreaks = Object.entries(byDay).map(([k, days]) => {
        const sorted = Array.from(days).sort();
        let cur=1, best=1;
        for(let i=1;i<sorted.length;i++){
          const a=new Date(sorted[i-1]), b=new Date(sorted[i]);
          const diff=(b-a)/86400000;
          if(diff===1) cur++; else cur=1;
          best=Math.max(best,cur);
        }
        return { key:k, days: sorted.length, best, last: sorted[sorted.length-1] };
      }).sort((a,b)=>b.best-a.best).slice(0,10);
      setLfmRecent(lfmStreaks);
    } catch(e){ showNotification(String(e.message||e), true); }
    finally{ setLfmLoading(false); }
  }, [lfmOk]);

  useEffect(()=>{ if(lfmOk) fetchLfmStreaks(); }, [lfmOk, fetchLfmStreaks]);

  return react.createElement("div", { className: "fremium-tab" },
    react.createElement("h3", null, "Musical Streaks"),
    react.createElement("p", { className: "fremium-hint" }, "Local streaks (Spotify) + Last.fm historical streaks. Consecutive days you listened to same track."),
    list.length === 0 ? react.createElement("div", { className: "fremium-empty" }, "No local streaks yet — play a track, streak starts tomorrow.") :
    react.createElement("div", { className: "fremium-list" },
      list.map(([uri, s]) => react.createElement("div", { key: uri, className: "fremium-row" },
        react.createElement("div", { className: "fremium-row-main" },
          react.createElement("div", { className: "fremium-row-title" }, s.name || uri.slice(0,32)+"…"),
          react.createElement("div", { className: "fremium-row-sub" }, `${uri} • last: ${s.lastDate || "—"} ${s.lastDate===today?"• today ✓":""}`)
        ),
        react.createElement("div", { className: "fremium-row-stats" },
          react.createElement("span", { className: "fremium-pill" }, `🔥 ${s.count} day`),
          react.createElement("span", { className: "fremium-pill muted" }, `best ${s.best}`)
        )
      ))
    ),
    lfmOk ? react.createElement("div", { style:{marginTop:14} },
      react.createElement("h4", null, "Last.fm Historical Streaks"),
      lfmLoading ? react.createElement("div", {className:"fremium-empty"}, "Loading Last.fm…") :
      !lfmRecent ? react.createElement("div", {className:"fremium-empty"}, "No Last.fm streaks") :
      react.createElement("div", { className:"fremium-list small" },
        lfmRecent.map(r=> react.createElement("div", { key:r.key, className:"fremium-row" },
          react.createElement("div", {className:"fremium-row-main"},
            react.createElement("div", {className:"fremium-row-title small"}, r.key),
            react.createElement("div", {className:"fremium-row-sub"}, `unique days: ${r.days} • last: ${r.last}`)
          ),
          react.createElement("span", {className:"fremium-pill"}, `best ${r.best}`)
        ))
      ),
      react.createElement("button", { className:"fremium-btn small", onClick: fetchLfmStreaks, disabled: lfmLoading, style:{marginTop:8} }, "Refresh Last.fm")
    ) : react.createElement("div", { className:"fremium-notice", style:{marginTop:10} },
      react.createElement("span", null, "Sign in to see historical Last.fm streaks"),
      react.createElement("button", { className:"fremium-btn small primary", onClick: onGoLfm }, "Sign in")
    ),
    react.createElement("div", { className: "fremium-actions" },
      react.createElement("button", { className: "fremium-btn", onClick: () => { const cur = Player.data?.item?.uri; if(cur){ updateStreakForTrack(cur); refresh(); showNotification("Streak updated for current track") } else showNotification("No track", true) } }, "Bump current track"),
      react.createElement("button", { className: "fremium-btn danger", onClick: () => { if(confirm("Reset all streaks?")){ saveJson(LS.streaks, {}); saveJson(LS.history, []); refresh(); } } }, "Reset")
    )
  );
}

function CompletionistTab({ onGoLfm }) {
  const lfmOk = isLfmConnected();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("albums");

  const fetchLfm = useCallback(async () => {
    if (!lfmOk) return;
    setLoading(true);
    try {
      if (mode === "albums") {
        const res = await lfmFetch({ method: "user.getTopAlbums", user: getLfmConfig().user, period: "overall", limit: "12" });
        const albums = res.topalbums?.album?.slice(0,12) || [];
        const enriched = await Promise.all(albums.map(async (a) => {
          let total = 10, userCount = parseInt(a.playcount)||0;
          try {
            const info = await lfmFetch({ method: "album.getInfo", artist: a.artist.name, album: a.name, username: getLfmConfig().user }).catch(()=>null);
            if (info?.album?.tracks?.track) total = Array.isArray(info.album.tracks.track) ? info.album.tracks.track.length : 1;
            else if (info?.album?.tracks) total = parseInt(info.album.tracks) || total;
            if (info?.album?.userplaycount) userCount = parseInt(info.album.userplaycount)||userCount;
          } catch {}
          const pct = Math.min(100, Math.round((Math.min(userCount, total*3) / Math.max(total,1))*33.3));
          return { name: a.name, artist: a.artist.name, image: a.image?.[2]?.["#text"] || a.image?.[1]?.["#text"] || "", playcount: userCount, total, pct, url: a.url };
        }));
        setData(enriched);
      } else {
        const res = await lfmFetch({ method: "user.getTopArtists", user: getLfmConfig().user, period: "overall", limit: "12" });
        const artists = res.topartists?.artist?.slice(0,12) || [];
        let enriched = artists.map(a => {
          const pc = parseInt(a.playcount)||0;
          const img = a.image?.[2]?.["#text"] || a.image?.[3]?.["#text"] || "";
          return { name: a.name, artist: "", image: img, playcount: pc, total: 50, pct: Math.min(100, Math.round((pc/100)*20)), url: a.url };
        });
        setData(enriched);
        // Fix Last.fm default star images by fetching Spotify artist images
        const defaultHash = "2a96cbd8b46e442fc41c2b86b821562f";
        Promise.all(enriched.map(async (e, idx) => {
          if (!e.image || e.image.includes(defaultHash)) {
            try {
              const item0 = await spotifySearch(`artist:"${e.name}"`, "artist");
              const s = item0 ? { artists: { items: [item0] } } : null;
              const sImg = s?.artists?.items?.[0]?.images?.[1]?.url || s?.artists?.items?.[0]?.images?.[0]?.url || "";
              if (sImg) enriched[idx].image = sImg;
            } catch {}
          }
        })).then(()=> setData([...enriched]));
      }
    } catch(e){ showNotification(String(e.message||e), true); setData([]); }
    finally { setLoading(false); }
  }, [lfmOk, mode]);

  const fetchSpotify = useCallback(async () => {
    setLoading(true);
    try {
      let albums = [];
      try {
        const res = await CosmosAsync.get("sp://core/collection/v1/collection/tracks?offset=0&limit=50").catch(()=>null);
        if (res?.items) albums = res.items.slice(0,5).map(i => ({ name: i.track?.album?.name || "Album", artist: i.track?.artists?.[0]?.name || "", total: 10, played: Math.floor(Math.random()*10), playcount: 0 }));
      } catch {}
      if (!albums.length) {
        albums = [
          { name: "Random Access Memories", artist: "Daft Punk", total: 13, played: 7, playcount: 7 },
          { name: "Currents", artist: "Tame Impala", total: 13, played: 13, playcount: 50 },
          { name: "AM", artist: "Arctic Monkeys", total: 12, played: 4, playcount: 12 },
          { name: "Blonde", artist: "Frank Ocean", total: 17, played: 9, playcount: 22 },
        ];
      }
      const enriched = albums.map(a => ({ ...a, pct: Math.round((a.played/a.total)*100), image:"" }));
      setData(enriched);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (lfmOk) fetchLfm(); else fetchSpotify(); }, [lfmOk, fetchLfm, fetchSpotify]);
  useEffect(() => { if (lfmOk) fetchLfm(); }, [mode]);

  return react.createElement("div", { className: "fremium-tab" },
    react.createElement("h3", null, "Album / Artist Completionist"),
    !lfmOk ? react.createElement("div", { className:"fremium-notice" },
      react.createElement("span", null, "Connect Last.fm to see real top albums/artists completion"),
      react.createElement("button", { className:"fremium-btn small primary", onClick: onGoLfm }, "Sign in")
    ) : react.createElement("p", { className: "fremium-hint" }, mode==="albums" ? "Top albums from Last.fm — bar = estimated completion (playcount vs tracks). Playcounts from your scrobbles." : "Top artists — playcount as completion proxy."),
    lfmOk ? react.createElement("div", { className:"fremium-actions", style:{marginBottom:6} },
      react.createElement("button", { className: `fremium-btn small ${mode==="albums"?"primary":""}`, onClick:()=>setMode("albums") }, "Albums"),
      react.createElement("button", { className: `fremium-btn small ${mode==="artists"?"primary":""}`, onClick:()=>setMode("artists") }, "Artists"),
      react.createElement("button", { className:"fremium-btn small", onClick: fetchLfm, disabled: loading }, loading?"…":"Refresh")
    ) : null,
    loading ? react.createElement("div", { className: "fremium-empty" }, "Loading from Last.fm…") :
    !data ? react.createElement("div", { className: "fremium-empty" }, "No data") :
    react.createElement("div", { className: "fremium-list" },
      data.map(a => react.createElement("div", { key: a.name + a.artist, className: "fremium-row" },
        a.image ? react.createElement("img", { src: a.image, style:{width:36,height:36,borderRadius:4,objectFit:"cover"} }) : null,
        react.createElement("div", { className: "fremium-row-main" },
          react.createElement("div", { className: "fremium-row-title" }, `${a.name} ${a.artist?`— ${a.artist}`:""}`),
          react.createElement("div", { className: "fremium-bar" }, react.createElement("div", { className: "fremium-bar-fill", style: { width: a.pct+"%" } })),
          react.createElement("div", { className: "fremium-row-sub" }, `${a.playcount} plays • ~${a.pct}% • ${a.total} tracks`)
        ),
        react.createElement("button", { className: "fremium-btn small", onClick: async () => {
          let uri=null;
          try {
            if (a.artist) {
              // Album mode - try album, then track fallback (Heiress etc. may be single)
              let item = await spotifySearch(`${a.artist} ${a.name}`, "album");
              if (!item) item = await spotifySearch(`album:"${a.name}" artist:"${a.artist}"`, "album");
              if (!item) item = await spotifySearch(a.name, "album");
              if (!item) {
                const t = await spotifySearch(`${a.artist} ${a.name}`, "track");
                if (t?.album?.uri) item = { uri: t.album.uri };
                else if (t?.uri) item = t;
              }
              if (!item) {
                const t2 = await spotifySearch(a.name, "track");
                if (t2?.album?.uri) item = { uri: t2.album.uri };
              }
              if (item?.album?.uri) item = { uri: item.album.uri };
              uri = item?.uri;
              if (uri) { await Player.playUri(uri); showNotification(`Playing: ${a.name} — ${a.artist}`); }
              else { showNotification(`Couldn't find "${a.name}" — opening Spotify search`, true); try{ Platform.History.push(`/search/${encodeURIComponent(`${a.artist} ${a.name}`)}`); }catch{} }
            } else {
              let item = await spotifySearch(a.name, "artist");
              uri = item?.uri;
              if (uri) { await Player.playUri(uri); showNotification(`Playing: ${a.name}`); }
              else showNotification(`Couldn't find "${a.name}" on Spotify`, true);
            }
          } catch(e){ showNotification(String(e.message||e), true); }
        } }, "Play")
      ))
    ),
    !lfmOk ? react.createElement("div", { className: "fremium-actions" },
      react.createElement("button", { className: "fremium-btn", onClick: fetchSpotify }, "Load Spotify mock"),
      react.createElement("span", { className: "fremium-hint" }, "Sign in for real data.")
    ) : null
  );
}

function TasteTab({ onGoLfm }) {
  const lfmOk = isLfmConnected();
  const [tags, setTags] = useState(null);
  const [tagSource, setTagSource] = useState("");
  const [tasteError, setTasteError] = useState("");
  const [loading, setLoading] = useState(false);
  const [discovery, setDiscovery] = useState(null);
  const [personality, setPersonality] = useState(null);
  const [deepCut, setDeepCut] = useState(null);

  const fetchAll = useCallback(async () => {
    if (!lfmOk) return;
    setLoading(true);
    setTasteError("");
    try {
      const [topTags, topArtists, recent, loved] = await Promise.all([
        lfmFetch({ method: "user.getTopTags", user: getLfmConfig().user, limit: "20" }).catch(()=>null),
        lfmFetch({ method: "user.getTopArtists", user: getLfmConfig().user, period: "overall", limit: "10" }).catch(()=>null),
        lfmFetch({ method: "user.getRecentTracks", user: getLfmConfig().user, limit: "50" }).catch(()=>null),
        lfmFetch({ method: "user.getLovedTracks", user: getLfmConfig().user, limit: "10" }).catch(()=>null),
      ]);
      const artistList = topArtists?.topartists?.artist || [];
      const artistTagResponses = topTags?.toptags?.tag?.length
        ? []
        : await Promise.all(artistList.slice(0, 10).map(artist => lfmFetch({
            method: "artist.getTopTags",
            artist: artist.name,
            autocorrect: "1",
            limit: "10",
          }).catch(() => null)));
      const tagMap = new Map();
      topTags?.toptags?.tag?.forEach(tag => {
        tagMap.set(tag.name.toLowerCase(), { name: tag.name, score: Number(tag.count) || 0 });
      });
      artistTagResponses.forEach((response, index) => {
        const weight = Math.max(1, 10 - index);
        response?.toptags?.tag?.forEach(tag => {
          const key = tag.name.toLowerCase();
          const current = tagMap.get(key) || { name: tag.name, score: 0 };
          current.score += (Number(tag.count) || 0) * weight;
          tagMap.set(key, current);
        });
      });
      const effectiveTags = Array.from(tagMap.values())
        .filter(tag => tag.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
      if (effectiveTags.length) {
        const max = effectiveTags[0].score || 1;
        setTags(effectiveTags.map(tag => ({ name: tag.name, v: Math.max(5, Math.round((tag.score / max) * 30)), count: Math.round(tag.score) })));
        setTagSource(topTags?.toptags?.tag?.length ? "Last.fm user.getTopTags" : "Derived from your top artists' Last.fm tags");
        setTasteError("");
      } else {
        setTags([]);
        setTagSource("");
        setTasteError("No tags found from Last.fm yet. Scrobble more music, then refresh.");
      }
      // Discovery meter: % of recent tracks that are not in top artists
      if (recent?.recenttracks?.track && topArtists?.topartists?.artist) {
        const topSet = new Set(topArtists.topartists.artist.map(a=>a.name.toLowerCase()));
        const rec = recent.recenttracks.track.filter(x=>!x["@attr"]?.nowplaying).slice(0,30);
        const newCount = rec.filter(t=> !topSet.has((t.artist["#text"]||"").toLowerCase())).length;
        const pct = Math.round((newCount/Math.max(rec.length,1))*100);
        setDiscovery({ pct, newCount, total: rec.length });
      }
      // Listening personality: simple heuristic from top tags + playcount
      if (effectiveTags.length && artistList.length) {
        const tagNames = effectiveTags.slice(0,3).map(t=>t.name).join(", ");
        const topArtist = artistList[0]?.name || "Unknown";
        const lovedCount = loved?.lovedtracks?.track?.length || 0;
        let pers = "Explorer";
        if (lovedCount > 5) pers = "Collector";
        else if (tagNames.toLowerCase().includes("rock")) pers = "Rock Devotee";
        else if (tagNames.toLowerCase().includes("electronic")||tagNames.toLowerCase().includes("hyperpop")) pers = "Night Owl";
        setPersonality({ label: pers, detail: `Top: ${topArtist} • ${tagNames}` });
      }
    } catch(e){ showNotification(String(e.message||e), true); }
    finally{ setLoading(false); }
  }, [lfmOk]);
  useEffect(()=>{ if(lfmOk) fetchAll(); }, [lfmOk, fetchAll]);

  const genres = tags || [];

  const doDeepCut = useCallback(async () => {
    if (!lfmOk) { showNotification("Connect Last.fm", true); return; }
    try {
      const topArtists = await lfmFetch({ method: "user.getTopArtists", user: getLfmConfig().user, limit: "5" });
      const artistList = topArtists.topartists?.artist?.slice(0,3).map(a=>a.name) || [];
      const artist = artistList[Math.floor(Math.random()*artistList.length)] || topArtists.topartists?.artist?.[0]?.name;
      if (!artist) throw new Error("No top artist");
      const tracks = await lfmFetch({ method: "artist.getTopTracks", artist, limit: "50", autocorrect: "1" });
      const list = tracks.toptracks?.track || [];
      const sorted = [...list].sort((a,b)=> parseInt(a.playcount||0) - parseInt(b.playcount||0));
      // Pick random among 10 rarest to avoid same song
      const pool = sorted.slice(0,12);
      const pick = pool[Math.floor(Math.random()*Math.min(pool.length, 8))] || sorted[0];
      if (pick) {
        setDeepCut(pick);
        showNotification(`Deep cut: ${pick.name} — ${artist} (${pick.playcount} plays)`);
      }
    } catch(e){ showNotification(String(e.message||e), true); }
  }, [lfmOk]);

  const doGenreFusion = useCallback(async (n) => {
    if (!lfmOk) { showNotification("Connect Last.fm", true); return; }
    if (!genres.length) { showNotification("No Last.fm tags available yet", true); return; }
    const source = genres;
    const pickNames = source.slice(0,n).map(g=>g.name);
    const pick = pickNames.join(" + ");
    showNotification(`Genre Fusion: ${pick} → building queue…`);
    try {
      // Fetch top tracks for each genre tag
      const perGenre = 4;
      let combined = [];
      for (const tag of pickNames) {
        try {
          const res = await lfmFetch({ method: "tag.getTopTracks", tag, limit: String(perGenre) });
          const tr = res.tracks?.track || res.toptracks?.track || [];
          tr.slice(0,perGenre).forEach(t=> combined.push({ name: t.name, artist: t.artist.name }));
        } catch {}
      }
      if (!combined.length) { showNotification(`No tracks for ${pick}`, true); return; }
      // Shuffle and queue 12
      combined = combined.sort(()=>Math.random()-0.5).slice(0,12);
      const uris = [];
      for (const t of combined) {
        const item = await spotifySearch(`${t.name} ${t.artist}`, "track");
        if (item?.uri) uris.push(item.uri);
      }
      const first = uris[0];
      if (first) await clearUpcomingQueue();
      const queueResult = first ? await addTracksToQueue(uris.slice(1)) : { queued: 0, total: 0, failed: [] };
      if (first) await Player.playUri(first);
      showNotification(`Genre Fusion: queued ${queueResult.queued}/${combined.length} tracks (${pick})`, queueResult.queued === 0);
      try { addTrainingEvent({ type:"genre_fusion", tags: pickNames, queued: queueResult.queued, ts: Date.now() }); } catch {}
    } catch(e){ showNotification(String(e.message||e), true); }
  }, [lfmOk, tags, genres]);

  const shareDNA = useCallback(async () => {
    if (!genres.length) { showNotification("No Last.fm tags available to share", true); return; }
    const effective = genres;
    const txt = `My Taste DNA: ${effective.map(g=> `${g.name} ${g.v||g.count||""}%`.trim()).join(", ")} — via Fremium + Last.fm (${getLfmConfig().user}; ${tagSource})`;
    try { await Platform.ClipboardAPI.copy(txt); showNotification("Copied Taste DNA: " + txt.slice(0,80)); } catch { showNotification(txt); }
  }, [tags, genres]);

  return react.createElement("div", { className: "fremium-tab" },
    react.createElement("h3", null, "Taste DNA + Discovery Meter"),
    !lfmOk ? react.createElement("div", { className:"fremium-notice" },
      react.createElement("span", null, "Sign in to Last.fm for real genre data"),
      react.createElement("button", { className:"fremium-btn small primary", onClick: onGoLfm }, "Sign in")
    ) : react.createElement("p", { className: "fremium-hint" }, loading ? "Loading your Last.fm profile…" : tasteError || (tags?.length ? `Source: ${tagSource}` : "No Last.fm profile tags yet — scrobble more music, then refresh.")),
    lfmOk ? react.createElement("button", { className:"fremium-btn small", onClick: fetchAll, disabled: loading, style:{marginBottom:6} }, loading?"…":"Refresh from Last.fm") : null,
    tasteError ? react.createElement("div", { className: "fremium-empty" }, tasteError) : null,
    genres.length ? react.createElement("div", { className: "fremium-bars" },
      genres.map(g => react.createElement("div", { key: g.name, className: "fremium-bar-row" },
        react.createElement("span", { className: "fremium-bar-label" }, g.name),
        react.createElement("div", { className: "fremium-bar" }, react.createElement("div", { className: "fremium-bar-fill alt", style: { width: g.v*3+"%" } })),
        react.createElement("span", { className: "fremium-bar-val" }, g.v+"%")
      ))
    ) : null,
    react.createElement("div", { className: "fremium-grid2", style: { marginTop: 12 } },
      react.createElement(StatCard, { label: "Discovery Meter", value: discovery ? `${discovery.pct}% new` : "—", sub: discovery ? `${discovery.newCount}/${discovery.total} recent outside top artists` : "No recent-track data" }),
      react.createElement(StatCard, { label: "Personality", value: personality?.label || "—", sub: personality?.detail || "No profile data" }),
    ),
    deepCut ? react.createElement("div", { className:"fremium-row", style:{marginTop:8} },
      react.createElement("div", {className:"fremium-row-main"},
        react.createElement("div", {className:"fremium-row-title small"}, `Deep Cut: ${deepCut.name}`),
        react.createElement("div", {className:"fremium-row-sub"}, `${deepCut.artist?.name || ""} • ${deepCut.playcount} global plays`)
      ),
      react.createElement("button", { className:"fremium-btn small", onClick: async ()=>{
        const q=encodeURIComponent(`${deepCut.name} ${deepCut.artist?.name||""}`);
        const _item2 = await spotifySearch(decodeURIComponent(q), "track");
        const uri=_item2?.uri; if(uri) Player.playUri(uri);
      }}, "Play")
    ) : null,
    react.createElement("div", { className: "fremium-actions" },
      react.createElement("button", { className: "fremium-btn", onClick: doDeepCut, disabled: !lfmOk }, "Deep Cut Finder"),
      react.createElement("button", { className: "fremium-btn primary", onClick: () => doGenreFusion(3) }, "Genre Fusion 3-way"),
      react.createElement("button", { className: "fremium-btn", onClick: () => doGenreFusion(5) }, "Fusion 5-way"),
      react.createElement("button", { className: "fremium-btn", onClick: shareDNA }, "Share DNA")
    )
  );
}

function RouletteTab({ onGoLfm }) {
  const lfmOk = isLfmConnected();
  const doRoulette = useCallback(async () => {
    showNotification("🎲 Music Roulette…");
    try {
      if (lfmOk) {
        let picks = [];
        try {
          const top = await lfmFetch({ method: "user.getTopTracks", user: getLfmConfig().user, period: "1month", limit: "80" });
          picks = top.toptracks?.track || [];
        } catch {}
        if (!picks.length) {
          const rec = await lfmFetch({ method: "user.getRecentTracks", user: getLfmConfig().user, limit: "100" }).catch(()=>null);
          picks = (rec?.recenttracks?.track || []).filter(t=>!t["@attr"]?.nowplaying).map(t=>({ name: t.name, artist: { name: t.artist["#text"] } }));
        }
        if (picks.length) {
          const shuffled = [...picks].sort(()=>Math.random()-0.5).slice(0,8);
          const uris = [];
          for (const p of shuffled) {
            const item = await spotifySearch(`${p.name} ${p.artist.name}`, "track");
            if (item?.uri) uris.push(item.uri);
          }
          const firstUri = uris[0];
          if (firstUri) await clearUpcomingQueue();
          const queueResult = firstUri ? await addTracksToQueue(uris.slice(1)) : { queued: 0, total: 0, failed: [] };
          if (firstUri) { await Player.playUri(firstUri); showNotification(`Roulette: playing first track + queued ${queueResult.queued} more`); try{ addTrainingEvent({ type:"roulette", count: queueResult.queued+1, ts: Date.now() }); }catch{} return; }
        }
      }
      const hist = loadJson(LS.history, []);
      if (hist.length) {
        const pick = hist[Math.floor(Math.random()*Math.min(hist.length,20))];
        if (pick?.uri) { await Player.playUri(pick.uri); showNotification("Roulette: from local history"); return; }
      }
      await Platform.History.push("/search");
      showNotification("Roulette: opened Search");
    } catch (e) { showNotification(String(e.message||e), true); }
  }, [lfmOk]);

  return react.createElement("div", { className: "fremium-tab" },
    react.createElement("h3", null, "Music Roulette"),
    !lfmOk ? react.createElement("div", {className:"fremium-notice"},
      react.createElement("span", null, "Roulette shuffles your Last.fm last month"),
      react.createElement("button", {className:"fremium-btn small primary", onClick: onGoLfm}, "Sign in")
    ) : react.createElement("p", { className: "fremium-hint" }, "One button → random session from Last.fm last 30 days (Top Tracks 1month + Recent) → queued in Spotify."),
    react.createElement("button", { className: "fremium-btn primary large", onClick: doRoulette }, "🎲 SPIN ROULETTE")
  );
}

function TimeMachineTab({ onGoLfm }) {
  const [year, setYear] = useState("2018-06-14");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const lfmOk = isLfmConnected();
  const parseRange = (input) => {
    input=input.trim();
    if (/^\d{4}$/.test(input)) {
      const y=parseInt(input);
      return { from: Math.floor(Date.UTC(y,0,1)/1000), to: Math.floor(Date.UTC(y+1,0,1)/1000)-1, label: input };
    }
    if (/^\d{4}[-/]\d{1,2}$/.test(input)) {
      const parts=input.split(/[-/]/);
      const y=parseInt(parts[0]);
      const mo=parseInt(parts[1])-1;
      return { from: Math.floor(Date.UTC(y,mo,1)/1000), to: Math.floor(Date.UTC(y,mo+1,1)/1000)-1, label: input };
    }
    const match = input.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (match) {
      const y=parseInt(match[1]);
      const mo=parseInt(match[2])-1;
      const day=parseInt(match[3]);
      const center=Math.floor(Date.UTC(y,mo,day)/1000);
      return { from: center - 3*86400, to: center + 4*86400, label: input };
    }
    return null;
  };
  const build = useCallback(async () => {
    if (!lfmOk) { showNotification("Connect Last.fm first", true); return; }
    const range = parseRange(year);
    if (!range) { showNotification("Use YYYY, YYYY-MM or YYYY-MM-DD", true); return; }
    setLoading(true); setResults(null);
    try {
      const params = { method: "user.getRecentTracks", user: getLfmConfig().user, limit: "50", extended: "1", from: String(range.from), to: String(range.to) };
      const res = await lfmFetch(params);
      const all = Array.isArray(res.recenttracks?.track) ? res.recenttracks.track : [res.recenttracks?.track].filter(Boolean);
      const tracks = all.filter(track => {
        const uts = Number(track?.date?.uts);
        return !track?.["@attr"]?.nowplaying && Number.isFinite(uts) && uts >= range.from && uts <= range.to;
      });
      setResults(tracks.slice(0,20));
      if (!tracks.length) showNotification(`No songs scrobbled at ${range.label}`, true);
      else showNotification(`Found ${tracks.length} scrobbles in ${range.label}`);
    } catch(e){ showNotification(String(e.message||e), true); }
    finally{ setLoading(false); }
  }, [year, lfmOk]);

  const playRandomFromDate = useCallback(async () => {
    if (!lfmOk) { showNotification("Connect Last.fm first", true); return; }
    const range = parseRange(year);
    if (!range) { showNotification("Use YYYY, YYYY-MM or YYYY-MM-DD", true); return; }
    setLoading(true);
    try {
      const res = await lfmFetch({ method: "user.getRecentTracks", user: getLfmConfig().user, limit: "50", extended: "1", from: String(range.from), to: String(range.to) });
      const all = Array.isArray(res.recenttracks?.track) ? res.recenttracks.track : [res.recenttracks?.track].filter(Boolean);
      const tracks = all.filter(track => {
        const uts = Number(track?.date?.uts);
        return !track?.["@attr"]?.nowplaying && Number.isFinite(uts) && uts >= range.from && uts <= range.to;
      });
      if (!tracks.length) {
        showNotification(`No songs scrobbled at ${range.label}`, true);
        return;
      }
      const pick = tracks[Math.floor(Math.random() * tracks.length)];
      const item = await spotifySearch(`${pick.name} ${pick.artist?.["#text"] || pick.artist?.name || ""}`, "track");
      if (item?.uri) {
        await Player.playUri(item.uri);
        showNotification(`Random from ${range.label}: ${pick.name}`);
      } else {
        showNotification(`Found ${pick.name} on Last.fm, but not Spotify`, true);
      }
    } catch (e) { showNotification(String(e.message || e), true); }
    finally { setLoading(false); }
  }, [lfmOk, year]);

  const playRandomForgotten = useCallback(async () => {
    if (!lfmOk) { showNotification("Connect Last.fm", true); return; }
    setLoading(true);
    try {
      // Forgotten = loved or top tracks that haven't been in recent 30 days
      const [recent, top] = await Promise.all([
        lfmFetch({ method: "user.getRecentTracks", user: getLfmConfig().user, limit: "80" }).catch(()=>null),
        lfmFetch({ method: "user.getLovedTracks", user: getLfmConfig().user, limit: "50" }).catch(()=>null),
      ]);
      const recentSet = new Set((recent?.recenttracks?.track||[]).filter(t=>!t["@attr"]?.nowplaying).map(t=> `${t.artist["#text"]?.toLowerCase()}|${t.name.toLowerCase()}`));
      let pool = (top?.lovedtracks?.track||[]).filter(t=> !recentSet.has(`${t.artist.name.toLowerCase()}|${t.name.toLowerCase()}`));
      if (!pool.length) {
        const topTracks = await lfmFetch({ method: "user.getTopTracks", user: getLfmConfig().user, period: "12month", limit: "100" }).catch(()=>null);
        const all = topTracks?.toptracks?.track || [];
        pool = all.filter(t=> !recentSet.has(`${t.artist.name.toLowerCase()}|${t.name.toLowerCase()}`));
      }
      if (!pool.length) pool = (recent?.recenttracks?.track||[]).slice(20,40).map(t=>({ name: t.name, artist: { name: t.artist["#text"] }}));
      const pick = pool[Math.floor(Math.random()*pool.length)];
      if (pick) {
        const item = await spotifySearch(`${pick.name} ${pick.artist.name}`, "track");
        if (item?.uri) { await Player.playUri(item.uri); showNotification(`Forgotten: ${pick.name} — ${pick.artist.name}`); }
        else showNotification(`Couldn't find "${pick.name}" on Spotify`, true);
      } else showNotification("No forgotten tracks", true);
    } catch(e){ showNotification(String(e.message||e), true); }
    finally{ setLoading(false); }
  }, [lfmOk]);

  return react.createElement("div", { className: "fremium-tab" },
    react.createElement("h3", null, "Music Time Machine"),
    !lfmOk ? react.createElement("div", { className:"fremium-notice" },
      react.createElement("span", null, "Last.fm required — searches scrobbles around your date"),
      react.createElement("button", { className:"fremium-btn small primary", onClick: onGoLfm }, "Sign in")
    ) :     react.createElement("p", { className: "fremium-hint" }, "Enter YYYY, YYYY-MM or YYYY-MM-DD — shows what you actually scrobbled around that date (7-day window for days, full month/year for others). Use Random from date to play one track from the selected period."),
    react.createElement("div", { className: "fremium-row" },
      react.createElement("input", { className: "fremium-input", value: year, onChange: e=>setYear(e.target.value), placeholder:"2022, 2022-06 or 2022-06-14" }),
      react.createElement("button", { className: "fremium-btn primary", onClick: build, disabled: loading || !lfmOk }, loading?"…":"Build"),
      react.createElement("button", { className: "fremium-btn", onClick: playRandomFromDate, disabled: loading || !lfmOk }, "Random from date"),
      react.createElement("button", { className: "fremium-btn", onClick: playRandomForgotten, disabled: loading || !lfmOk }, "Random forgotten")
    ),
    results ? react.createElement("div", { className:"fremium-list small", style:{marginTop:10} },
      results.map((t,i) => react.createElement("div", { key:i, className:"fremium-row" },
        t.image?.[0]?.["#text"] ? react.createElement("img", { src: t.image[0]["#text"] || t.image[1]?.["#text"], style:{width:28,height:28,borderRadius:4, objectFit:"cover"} }) : null,
        react.createElement("div", { className:"fremium-row-main" },
          react.createElement("div", { className:"fremium-row-title small" }, t.name),
          react.createElement("div", { className:"fremium-row-sub" }, `${t.artist?.["#text"] || t.artist?.name || ""} • ${t.date?.["#text"] || "scrobbled"} • ${t.album?.["#text"]||""}`)
        ),
        react.createElement("button", { className:"fremium-btn small", onClick: async ()=>{
          const item = await spotifySearch(`${t.name} ${t.artist?.["#text"]||t.artist?.name||""}`, "track");
          if(item?.uri) { await Player.playUri(item.uri); showNotification(`Playing: ${t.name}`); } else showNotification(`Couldn't find "${t.name}"`, true);
        } }, "Play")
      ))
    ) : null,
    react.createElement("p", { className: "fremium-hint" }, "Only Last.fm scrobbles whose timestamps fall inside the selected year/month/date window are shown. A 2022 search cannot play a track from last month.")
  );
}

function QueueTab({ onGoLfm }) {
  const lfmOk = isLfmConnected();
  const [q, setQ] = useState(() => { try { return Spicetify.Queue?.nextTracks || [] } catch { return [] } });
  const [similar, setSimilar] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const refreshQueue = useCallback(() => {
    try { setQ([...(Spicetify.Queue?.nextTracks || [])]); } catch {}
  }, []);
  useEffect(() => {
    const id = setInterval(refreshQueue, 1200);
    return () => clearInterval(id);
  }, [refreshQueue]);

  const analyze = useCallback(async () => {
    const cur = Player.data?.item;
    if (!cur) { showNotification("No track", true); return; }
    if (!lfmOk) { showNotification("Connect Last.fm to analyze", true); return; }
    const artist = cur.artists?.[0]?.name || cur.metadata?.artist_name;
    const title = cur.name;
    setAnalysis(null);
    try {
      const res = await lfmFetch({ method: "track.getSimilar", artist, track: title, limit: "6" });
      const list = res.similartracks?.track || [];
      const notQueued = list.filter(t => !q.some(item => item.name === t.name)).length;
      setSimilar(list);
      setAnalysis({ track: `${title} — ${artist}`, candidates: list.length, notQueued });
      addTrainingEvent({ type: "analyze", track: `${title} — ${artist}`, candidates: list.length, notQueued });
      showNotification(list.length ? `Queue IQ: found ${list.length} similar tracks` : "No similar tracks", !list.length);
    } catch (e) { showNotification(String(e.message || e), true); }
  }, [lfmOk, q]);

  const improve = useCallback(async () => {
    if (!similar) { await analyze(); return; }
    const existing = new Set(q.map(item => item.uri));
      const uris = [];
      for (const t of similar) {
        const item = await spotifySearch(`${t.name} ${t.artist.name}`, "track");
        if (item?.uri && !existing.has(item.uri)) uris.push(item.uri);
      }
      const rankedUris = (window.FremiumLiveQI?.rank?.(uris.map(uri => ({ uri })), window.FremiumLiveQI?.currentContext?.()) || []).map(item => item.uri);
      const result = await addTracksToQueue(rankedUris);
    if (result.queued) {
      addTrainingEvent({ type: "improve", added: uris, queued: result.queued });
      refreshQueue();
      showNotification(`Queue IQ: added ${result.queued} tracks`);
    } else showNotification(`Queue IQ: nothing new to add (${result.failed.length} unavailable)`, true);
  }, [similar, q, analyze, refreshQueue]);

  return react.createElement("div", { className: "fremium-tab" },
    react.createElement("h3", null, "Queue Intelligence"),
    !lfmOk ? react.createElement("div", { className: "fremium-notice" },
      react.createElement("span", null, "Connect Last.fm to analyze the current track"),
      react.createElement("button", { className: "fremium-btn small primary", onClick: onGoLfm }, "Sign in")
    ) : react.createElement("p", { className: "fremium-hint" }, "Analyze the current track, then improve the live queue with similar tracks that are not already queued."),
    react.createElement("div", { className: "fremium-grid2" },
      react.createElement(StatCard, { label: "Queued", value: String(q.length), sub: "Next tracks" }),
      react.createElement(StatCard, { label: "Candidates", value: String(analysis?.notQueued ?? 0), sub: analysis ? "Not currently queued" : "Run Analyze first" })
    ),
    react.createElement("div", { className: "fremium-actions" },
      react.createElement("button", { className: "fremium-btn", onClick: analyze, disabled: !lfmOk }, "Analyze current track"),
      react.createElement("button", { className: "fremium-btn primary", onClick: improve }, "Improve queue")
    ),
    analysis ? react.createElement("div", { className: "fremium-notice", style: { marginTop: 8 } },
      react.createElement("span", null, `${analysis.track}: ${analysis.candidates} similar tracks, ${analysis.notQueued} not queued`),
      react.createElement("span", { className: "fremium-pill" }, "saved")
    ) : null,
    similar ? react.createElement("div", { style: { marginTop: 10 } },
      react.createElement("h4", null, "Similar tracks"),
      react.createElement("div", { className: "fremium-list small" }, similar.map((track, i) => react.createElement("div", { key: i, className: "fremium-row" },
        react.createElement("div", { className: "fremium-row-main" },
          react.createElement("div", { className: "fremium-row-title small" }, track.name),
          react.createElement("div", { className: "fremium-row-sub" }, track.artist?.name || "")
        ),
         react.createElement(react.Fragment, null,
           react.createElement("button", { className: "fremium-btn small", onClick: async () => {
             const item = await spotifySearch(`${track.name} ${track.artist.name}`, "track");
             if (item?.uri) { await addTracksToQueue([item.uri]); refreshQueue(); }
           } }, "Queue"),
           react.createElement("button", { className: "fremium-btn small", onClick:()=>{ const item = window.FremiumLiveQI?.explain?.(track.uri); showNotification(item?.reasons?.join(" • ") || "No QI explanation yet"); } }, "Why?")
         )
      )))
    ) : null,
    react.createElement("p", { className:"fremium-hint" }, "QI learns from weighted skips, skip timing, abandonment, replay/completion, early/late positions, playlist context, sessions, and recent-versus-lifetime behavior. Use the base QI panel for Why?, Memory, backups, and conditional live saves.")
  );
}

// ---------- AI Tab ----------
function AITab({ onGoLfm }) {
  const lfmOk = isLfmConnected();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [playlistName, setPlaylistName] = useState("Fremium AI Playlist");
  const [savingPlaylist, setSavingPlaylist] = useState(false);
  const saveAsPlaylist = useCallback(async () => {
    const uris = (results || []).filter(t => t.found).map(t => t.uri);
    if (!uris.length) { showNotification("Generate songs first", true); return; }
    setSavingPlaylist(true);
    try {
      const playlist = await createSpotifyPlaylist(playlistName.trim() || "Fremium AI Playlist", uris);
      showNotification(`Playlist saved: ${playlist.name || playlistName}`);
    } catch (e) { showNotification(String(e.message || e), true); }
    finally { setSavingPlaylist(false); }
  }, [results, playlistName]);
  const cur = Player.data?.item;
  const curDesc = cur ? `${cur.name} — ${cur.artists?.[0]?.name||""}` : "nothing playing";

  const generate = useCallback(async () => {
    if (!prompt.trim()) { showNotification("Enter a prompt first", true); return; }
    const initialIntent = parseAiPrompt(prompt, cur);
    const hasPlaylistSource = Boolean(initialIntent.playlistQuery || (!initialIntent.similar && initialIntent.fromQuery));
    const hasArtistCandidate = !initialIntent.similar && !initialIntent.playlistQuery && Boolean(extractAiArtistCandidate(prompt));
    if (!lfmOk && !hasPlaylistSource && !initialIntent.similar && !initialIntent.artistQuery && !hasArtistCandidate) { showNotification("Connect Last.fm for tag-based recommendations", true); return; }
    setLoading(true); setResults(null);
    try {
      const p = prompt.toLowerCase();
      const intent = parseAiPrompt(prompt, cur);
      const requestClauses = parseAiRequestClauses(prompt);
      const compositeRequest = requestClauses.length > 1 ? await resolveAiRequestClauses(requestClauses, cur) : null;
      let tracks = compositeRequest?.tracks || [];
      let sourceName = compositeRequest?.sourceName || "";
      const durationMatch = p.match(/(\d+)\s*-?\s*(?:hours?|hrs?)/);
      const songCountMatch = p.match(/\b(\d+)\s*-?\s*(?:songs?|tracks?)\b/);
      const requestedHours = durationMatch ? parseInt(durationMatch[1], 10) : null;
      const requestedSongCount = songCountMatch ? parseInt(songCountMatch[1], 10) : null;
      const requestedTags = extractAiTags(p);
      const targetTrackCount = compositeRequest?.targetTrackCount || (requestedSongCount !== null
        ? Math.min(50, Math.max(1, requestedSongCount))
        : requestedHours ? Math.min(50, Math.max(8, Math.ceil(requestedHours * 20))) : 15);
      const playlistQuery = compositeRequest ? "" : (intent.playlistQuery || (!intent.similar && intent.fromQuery ? intent.fromQuery : ""));
      if (playlistQuery) {
        const resolvedPlaylist = await resolveSpotifyPlaylist(playlistQuery);
        if (resolvedPlaylist) {
          sourceName = resolvedPlaylist.playlist.name || resolvedPlaylist.query;
          tracks = await getSpotifyPlaylistTracks(resolvedPlaylist.playlist, targetTrackCount);
        }
      }
      if (!tracks.length && intent.similar) {
        tracks = await getSimilarAiTracks(intent.similar, cur, targetTrackCount);
        if (p.includes("darker")) {
          const dark = await lfmFetch({ method: "tag.getTopTracks", tag: "dark", limit: "20" }).catch(() => null);
          const darkSet = new Set((dark?.tracks?.track || []).map(track => track.name.toLowerCase()));
          const filtered = tracks.filter(track => darkSet.has(track.name.toLowerCase()));
          if (filtered.length >= 3) tracks = filtered;
          else if (!tracks.length) tracks = (dark?.tracks?.track || []).slice(0, 8).map(track => ({ name: track.name, artist: track.artist.name }));
        }
      }
      let artistCandidate = "";
      let artistMatches = [];
      if (!compositeRequest) {
        artistMatches = intent.artistQuery ? await findExactSpotifyArtists(intent.artistQuery) : [];
        const explicitArtistParts = splitAiArtistCandidates(intent.artistQuery);
        if (intent.artistQuery && artistMatches.length < explicitArtistParts.length) {
          explicitArtistParts.forEach(part => {
            if (!artistMatches.some(match => searchName(match.name) === searchName(part))) artistMatches.push({ name: part });
          });
        }
        if (!artistMatches.length && !intent.similar && !intent.playlistQuery) {
          artistCandidate = extractAiArtistCandidate(prompt);
          if (artistCandidate) artistMatches = await findExactSpotifyArtists(artistCandidate);
        }
        if (!artistMatches.length && !intent.explicitPlaylist && !intent.similar && intent.fromQuery) artistMatches = [{ name: intent.fromQuery }];
      }
      const artistSource = artistMatches.map(match => match.name).filter(Boolean).join(" + ");
      if (artistMatches.length) sourceName = artistSource;
      if (!tracks.length && artistMatches.length) {
        const batches = await Promise.all(artistMatches.map(match => getSimilarAiTracks({ track: "", artist: match.name }, cur, targetTrackCount)));
        tracks = interleaveAiTracks(batches, Math.min(50, Math.max(targetTrackCount * 3, targetTrackCount + 20)));
      }
      if (!tracks.length && (p.includes("what should") || p.includes("listen to"))) {
        if (!lfmOk) throw new Error("Connect Last.fm for personalized listening suggestions");
        const top = await lfmFetch({ method: "user.getTopTracks", user: getLfmConfig().user, period: "7day", limit: "40" }).catch(() => null);
        tracks = (top?.toptracks?.track || []).sort(() => Math.random() - 0.5).slice(0, targetTrackCount).map(track => ({ name: track.name, artist: track.artist.name }));
      }
      if (!tracks.length && lfmOk && (requestedTags.length || p.includes("late") || p.includes("night") || p.includes("hour"))) {
        const tags = requestedTags.length ? requestedTags : [p.includes("late") || p.includes("night") ? "chill" : "indie"];
        const perTagLimit = Math.min(50, Math.max(10, Math.ceil(targetTrackCount / tags.length) + 8));
        for (const tag of tags) {
          try {
            const res = await lfmFetch({ method: "tag.getTopTracks", tag, limit: String(perTagLimit) });
            (res.tracks?.track || []).slice(0, perTagLimit).forEach(track => tracks.push({ name: track.name, artist: track.artist.name }));
          } catch {}
          if (tracks.length >= targetTrackCount) break;
        }
      }
      if (!tracks.length && lfmOk) {
        const words = requestedTags.length ? requestedTags : prompt.split(/[,+]/).map(value => value.trim()).filter(Boolean).slice(0, 3);
        for (const word of words) {
          try {
            const result = await lfmFetch({ method: "tag.getTopTracks", tag: word, limit: String(Math.min(20, Math.max(5, targetTrackCount))) });
            (result.tracks?.track || []).slice(0, Math.min(20, Math.max(5, targetTrackCount))).forEach(track => tracks.push({ name: track.name, artist: track.artist.name }));
          } catch {}
        }
        if (!tracks.length) {
          const artistSearch = await lfmFetch({ method: "artist.search", artist: prompt.replace(/[^a-z0-9 ]/gi, " ").trim(), limit: "1" }).catch(() => null);
          const artist = artistSearch?.results?.artistmatches?.artist?.[0]?.name;
          if (artist) {
            const top = await lfmFetch({ method: "artist.getTopTracks", artist, limit: String(targetTrackCount) }).catch(() => null);
            tracks = (top?.toptracks?.track || []).slice(0, targetTrackCount).map(track => ({ name: track.name, artist: track.artist.name || artist }));
          }
        }
      }
      if (!tracks.length) {
        const fallbackQueries = [
          ...splitAiArtistCandidates(artistCandidate),
          ...splitAiArtistCandidates(intent.artistQuery),
          intent.similar?.track,
          intent.fromQuery,
          searchName(prompt),
        ].filter(Boolean);
        const fallbackBatches = [];
        for (const query of [...new Set(fallbackQueries)].slice(0, 5)) {
          fallbackBatches.push(await getGenericSpotifyTracks(query, targetTrackCount * 2));
        }
        tracks = interleaveAiTracks(fallbackBatches, Math.min(50, targetTrackCount * 3));
      }
      if (tracks.length < targetTrackCount) {
        const supplement = await getGenericSpotifyTracks(artistCandidate || searchName(prompt), targetTrackCount * 2);
        tracks = interleaveAiTracks([tracks, supplement], Math.min(50, targetTrackCount * 3));
      }
      tracks = tracks.map(track => ({ ...track, name: getTrackName(track), artist: getTrackArtistText(track), uri: getTrackUri(track) })).filter(track => track.name && track.artist);
      if (!tracks.length) throw new Error(playlistQuery ? `Could not find or load playlist "${playlistQuery}"` : "No AI tracks found — try clearer prompt");
      const candidateTracks = tracks;
      const activeKeys = getActiveTrackKeys();
      const excludedKeys = new Set([...activeKeys, ...getAiHistoryKeys()]);
      tracks = uniqueTracks(candidateTracks, excludedKeys).slice(0, targetTrackCount);
      if (!tracks.length) tracks = uniqueTracks(candidateTracks, activeKeys).slice(0, targetTrackCount);
      if (!tracks.length) throw new Error("No new AI tracks found — try a different prompt");
      const out = [];
      const seenSpotifyUris = new Set();
      const seenSpotifyKeys = new Set();
      for (const track of tracks) {
        const item = track.uri ? track : await spotifySearch(`${track.name} ${track.artist}`, "track");
        if (!item?.uri || seenSpotifyUris.has(item.uri)) continue;
        const itemKeys = getTrackKeys(item);
        if (itemKeys.some(key => seenSpotifyKeys.has(key))) continue;
        seenSpotifyUris.add(item.uri);
        itemKeys.forEach(key => seenSpotifyKeys.add(key));
        out.push({ ...track, name: getTrackName(item) || track.name, artist: getTrackArtistText(item) || track.artist, uri: item.uri, found: true });
      }
      setResults(out);
      const uris = out.filter(track => track.found).map(track => track.uri);
      const firstUri = uris[0];
      if (firstUri) await clearUpcomingQueue();
      const queueResult = firstUri ? await addTracksToQueue(uris.slice(1)) : { queued: 0, total: 0, failed: [] };
      if (firstUri) {
        rememberAiTracks(out);
        await Player.playUri(firstUri);
        const sourceText = sourceName ? ` from ${sourceName}` : "";
        showNotification(`AI${sourceText}: playing ${out[0].name} + queued ${queueResult.queued} more (${uris.length} total)`);
      } else showNotification(`AI found ${out.length} tracks but none were available on Spotify`, true);
      addTrainingEvent({ type: "ai_playlist", prompt, source: sourceName || null, count: out.length, queued: queueResult.queued });
    } catch (e) { showNotification(String(e.message || e), true); }
    finally { setLoading(false); }
  }, [lfmOk, prompt, cur]);

  return react.createElement("div", { className:"fremium-tab" },
    react.createElement("h3", null, "AI Playlist Generator"),
    !lfmOk ? react.createElement("div", {className:"fremium-notice"}, react.createElement("span", null, "Connect Last.fm for tag-based recommendations; playlist and reference prompts still work"), react.createElement("button", {className:"fremium-btn small primary", onClick:onGoLfm}, "Sign in")) :
    react.createElement("p", {className:"fremium-hint"}, `Try: “Make me a 2-hour late-night playlist”, “Give me songs like ${curDesc} but darker”, or “Play the Roadtrip playlist” — playlist names and Spotify links are supported.`),
    react.createElement("div", {className:"fremium-row"},
      react.createElement("input", {className:"fremium-input", style:{flex:1}, value:prompt, onChange:e=>setPrompt(e.target.value), placeholder:`e.g. like I’m butterbean, play the Roadtrip playlist, or shoegaze + hyperpop`}),
      react.createElement("button", {className:"fremium-btn primary", onClick:generate, disabled:loading||!prompt.trim()}, loading?"…":"Generate")
    ),
    react.createElement("div", {className:"fremium-actions"},
      react.createElement("button", {className:"fremium-btn small", onClick:()=>setPrompt("Make me a 2-hour late-night playlist")}, "2h late-night"),
      react.createElement("button", {className:"fremium-btn small", onClick:()=>setPrompt(`Give me songs like ${cur?cur.name:"this"} but darker`)}, "Like this darker"),
      react.createElement("button", {className:"fremium-btn small", onClick:()=>setPrompt("What should I listen to?")}, "What to listen?")
    ),
    results ? react.createElement("div", {className:"fremium-list small", style:{marginTop:10}},
      results.slice(0,12).map((t,i) => react.createElement("div", {key:i, className:"fremium-row"},
        react.createElement("div", {className:"fremium-row-main"},
          react.createElement("div", {className:"fremium-row-title small"}, t.name),
          react.createElement("div", {className:"fremium-row-sub"}, `${t.artist} • ${t.found?"found":"not on Spotify"}`)
        ),
         t.uri ? react.createElement(react.Fragment, null,
           react.createElement("button", {className:"fremium-btn small", onClick:()=>Player.playUri(t.uri)}, "Play"),
           react.createElement("button", {className:"fremium-btn small", onClick:()=>{ const info = window.FremiumLiveQI?.explain?.(t.uri); showNotification(info?.reasons?.join(" • ") || "No QI explanation yet"); }}, "Why?")
         ) : react.createElement("span", {className:"fremium-pill muted"}, "—")
      )),
      react.createElement("div", {className:"fremium-row", style:{marginTop:10}},
        react.createElement("input", {className:"fremium-input", style:{flex:1}, value:playlistName, onChange:e=>setPlaylistName(e.target.value), placeholder:"Playlist name"}),
        react.createElement("button", {className:"fremium-btn primary", onClick:saveAsPlaylist, disabled:savingPlaylist}, savingPlaylist?"Saving…":"Save to Spotify playlist")
      )
    ) : null
  );
}

// ---------- Mood Tab ----------
function MoodTab({ onGoLfm }) {
  const lfmOk = isLfmConnected();
  const [loading, setLoading] = useState(null);
  const moods = [
    { id:"late", label:"Late Night", tag:"chill", emoji:"🌙" },
    { id:"dark", label:"Darker", tag:"dark", emoji:"🖤" },
    { id:"happy", label:"Happy", tag:"happy", emoji:"☀️" },
    { id:"chill", label:"Chill", tag:"chill", emoji:"❄️" },
    { id:"energetic", label:"Energetic", tag:"energetic", emoji:"⚡" },
    { id:"sad", label:"Sad", tag:"sad", emoji:"💧" },
    { id:"romantic", label:"Romantic", tag:"romantic", emoji:"💌" },
    { id:"focus", label:"Focus", tag:"instrumental", emoji:"🎧" },
  ];
  const playMood = useCallback(async (m) => {
    if (!lfmOk) { showNotification("Connect Last.fm", true); return; }
    setLoading(m.id);
    try {
      const res = await lfmFetch({ method: "tag.getTopTracks", tag: m.tag, limit: "20" });
      const tracks = (res.tracks?.track || []).slice(0,15).map(t=>({name:t.name, artist:t.artist.name}));
      const uris = [];
      for (const t of tracks) {
        const it = await spotifySearch(`${t.name} ${t.artist}`, "track");
        if (it?.uri) uris.push(it.uri);
      }
      const first = uris[0];
      if (first) await clearUpcomingQueue();
      const queueResult = first ? await addTracksToQueue(uris.slice(1)) : { queued: 0, total: 0, failed: [] };
      if (first) { await Player.playUri(first); showNotification(`${m.emoji} Mood: ${m.label} — queued ${queueResult.queued} more`); addTrainingEvent({ type:"mood", mood:m.id, queued: queueResult.queued }); }
      else showNotification(`No ${m.label} tracks`, true);
    } catch(e){ showNotification(String(e.message||e), true); }
    finally{ setLoading(null); }
  }, [lfmOk]);
  return react.createElement("div", {className:"fremium-tab"},
    react.createElement("h3", null, "Mood Playlists"),
    !lfmOk ? react.createElement("div", {className:"fremium-notice"}, react.createElement("span", null, "Mood via Last.fm tags"), react.createElement("button", {className:"fremium-btn small primary", onClick:onGoLfm}, "Sign in")) :
    react.createElement("p", {className:"fremium-hint"}, "One tap → mood playlist from Last.fm tag top tracks → queued in Spotify."),
    react.createElement("div", {style:{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:8}},
      moods.map(m=> react.createElement("button", {key:m.id, className:"fremium-btn", style:{justifyContent:"flex-start"}, onClick:()=>playMood(m), disabled:loading===m.id}, `${m.emoji} ${m.label}${loading===m.id?" …":""}`))
    )
  );
}

// ---------- Discover Tab ----------
function DiscoverTab({ onGoLfm }) {
  const lfmOk = isLfmConnected();
  const [songSim, setSongSim] = useState(null);
  const [artistSim, setArtistSim] = useState(null);
  const [discover, setDiscover] = useState(null);
  const [loading, setLoading] = useState(null);
  const cur = Player.data?.item;
  const curArtist = cur?.artists?.[0]?.name || cur?.metadata?.artist_name || "";
  const curTitle = cur?.name || "";
  const doSongSim = useCallback(async ()=>{
    if(!lfmOk||!curArtist||!curTitle) { showNotification("Play a track first", true); return; }
    setLoading("song"); try{
      const res = await lfmFetch({ method:"track.getSimilar", artist: curArtist, track: curTitle, limit:"8" });
      setSongSim(res.similartracks?.track||[]);
    }catch(e){ showNotification(String(e.message||e), true);} finally{ setLoading(null); }
  }, [lfmOk, curArtist, curTitle]);
  const doArtistSim = useCallback(async ()=>{
    if(!lfmOk||!curArtist) { showNotification("Play a track first", true); return; }
    setLoading("artist"); try{
      const res = await lfmFetch({ method:"artist.getSimilar", artist: curArtist, limit:"8" });
      setArtistSim(res.similarartists?.artist||[]);
    }catch(e){ showNotification(String(e.message||e), true);} finally{ setLoading(null); }
  }, [lfmOk, curArtist]);
  const doDiscover = useCallback(async ()=>{
    if(!lfmOk) return;
    setLoading("discover"); try{
      const [topArtists, recent] = await Promise.all([
        lfmFetch({ method:"user.getTopArtists", user:getLfmConfig().user, period:"overall", limit:"10" }).catch(()=>null),
        lfmFetch({ method:"user.getRecentTracks", user:getLfmConfig().user, limit:"80" }).catch(()=>null),
      ]);
      const topSet = new Set((topArtists?.topartists?.artist||[]).map(a=>a.name.toLowerCase()));
      const top = topArtists?.topartists?.artist?.[0]?.name;
      if(!top) throw new Error("No top artist");
      const sim = await lfmFetch({ method:"artist.getSimilar", artist: top, limit:"15" }).catch(()=>null);
      const cand = (sim?.similarartists?.artist||[]).filter(a=> !topSet.has(a.name.toLowerCase())).slice(0,8);
      // For each new artist, get a track
      const out=[];
      for(const a of cand){
        try{
          const tr = await lfmFetch({ method:"artist.getTopTracks", artist: a.name, limit:"1" });
          const t = tr.toptracks?.track?.[0];
          if(t) out.push({ artist: a.name, track: t.name, image: a.image?.[2]?.["#text"]||"" });
        }catch{}
      }
      setDiscover(out);
      if(!out.length) showNotification("Discover: try listening more for data", true);
    }catch(e){ showNotification(String(e.message||e), true);} finally{ setLoading(null); }
  }, [lfmOk]);
  useEffect(()=>{ if(lfmOk) doDiscover(); }, [lfmOk]);
  return react.createElement("div", {className:"fremium-tab"},
    react.createElement("h3", null, "Discover + Similarity APIs"),
    !lfmOk ? react.createElement("div", {className:"fremium-notice"}, react.createElement("span", null, "Needs Last.fm"), react.createElement("button", {className:"fremium-btn small primary", onClick:onGoLfm}, "Sign in")) :
    react.createElement("p", {className:"fremium-hint"}, `Song similarity for "${curTitle||"—"}" • Artist similarity for "${curArtist||"—"}" • Discover finds artists similar to your top but you haven't scrobbled.`),
    react.createElement("div", {className:"fremium-actions"},
      react.createElement("button", {className:"fremium-btn", onClick:doSongSim, disabled:loading==="song"}, loading==="song"?"…":"Song Similarity"),
      react.createElement("button", {className:"fremium-btn", onClick:doArtistSim, disabled:loading==="artist"}, loading==="artist"?"…":"Artist Similarity"),
      react.createElement("button", {className:"fremium-btn primary", onClick:doDiscover, disabled:loading==="discover"}, loading==="discover"?"…":"Discover Mode")
    ),
    songSim ? react.createElement("div", {style:{marginTop:10}},
      react.createElement("h4", null, `Songs like "${curTitle}"`),
      react.createElement("div", {className:"fremium-list small"},
        songSim.slice(0,6).map((t,i)=> react.createElement("div", {key:i, className:"fremium-row"},
          react.createElement("div", {className:"fremium-row-main"},
            react.createElement("div", {className:"fremium-row-title small"}, t.name),
            react.createElement("div", {className:"fremium-row-sub"}, t.artist?.name||"")
          ),
          react.createElement("button", {className:"fremium-btn small", onClick: async()=>{
            const it=await spotifySearch(`${t.name} ${t.artist.name}`, "track");
            if(it?.uri) { await Player.playUri(it.uri); showNotification(`Similar: ${t.name}`); } else showNotification("Not on Spotify", true);
          }}, "Play")
        ))
      )
    ) : null,
    artistSim ? react.createElement("div", {style:{marginTop:10}},
      react.createElement("h4", null, `Artists like "${curArtist}"`),
      react.createElement("div", {className:"fremium-list small"},
        artistSim.slice(0,6).map((a,i)=> react.createElement("div", {key:i, className:"fremium-row"},
          a.image?.[2]?.["#text"] ? react.createElement("img", {src:a.image[2]["#text"], style:{width:32,height:32,borderRadius:16}}) : null,
          react.createElement("div", {className:"fremium-row-main"},
            react.createElement("div", {className:"fremium-row-title small"}, a.name),
            react.createElement("div", {className:"fremium-row-sub"}, `${Math.round(parseFloat(a.match||0)*100)}% match`)
          ),
          react.createElement("button", {className:"fremium-btn small", onClick: async()=>{
            const it=await spotifySearch(a.name, "artist");
            if(it?.uri) Player.playUri(it.uri); else showNotification("Not found", true);
          }}, "Play")
        ))
      )
    ) : null,
    discover ? react.createElement("div", {style:{marginTop:12}},
      react.createElement("h4", null, "Discover — New for you"),
      discover.length ? react.createElement("div", {className:"fremium-list small"},
        discover.map((d,i)=> react.createElement("div", {key:i, className:"fremium-row"},
          d.image ? react.createElement("img", {src:d.image, style:{width:28,height:28,borderRadius:4}}) : null,
          react.createElement("div", {className:"fremium-row-main"},
            react.createElement("div", {className:"fremium-row-title small"}, d.track),
            react.createElement("div", {className:"fremium-row-sub"}, d.artist)
          ),
          react.createElement("button", {className:"fremium-btn small", onClick: async()=>{
            const it=await spotifySearch(`${d.track} ${d.artist}`, "track");
            if(it?.uri) Player.playUri(it.uri);
          }}, "Play")
        ))
      ) : react.createElement("div", {className:"fremium-empty"}, "No new artists — keep listening")
    ) : null
  );
}

function FremiumQiPanel() {
  const runtime = window.FremiumLiveQI;
  const [data, setData] = useState(() => runtime?.get?.() || null);
  const [status, setStatus] = useState("");
  const [folderConnected, setFolderConnected] = useState(false);
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const fileInput = useRef(null);
  const profileInput = useRef(null);

  useEffect(() => {
    if (!runtime) {
      setStatus("QI runtime unavailable");
      return;
    }
    const unsubscribe = runtime.subscribe?.(setData);
    runtime.getDirectoryStatus?.().then(result => setFolderConnected(Boolean(result?.connected))).catch(() => {});
    return unsubscribe;
  }, [runtime]);

  const run = async (action, successMessage) => {
    if (!runtime) return;
    setStatus("");
    try {
      const result = await action();
      setData(runtime.get?.() || null);
      setStatus(typeof successMessage === "function" ? successMessage(result) : successMessage || "Done");
    } catch (error) {
      setStatus(String(error?.message || error));
    }
  };

  const importFiles = async event => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || !runtime) return;
    try {
      for (let index = 0; index < files.length; index++) {
        const text = await files[index].text();
        runtime.importJson?.(text, { replace: replaceOnImport && index === 0 && files.length === 1 });
      }
      setData(runtime.get?.() || null);
      setStatus(`Imported ${files.length} JSON file${files.length === 1 ? "" : "s"}`);
    } catch (error) {
      setStatus(String(error?.message || error));
    }
  };
  const importProfileFiles = async event => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || !runtime) return;
    try {
      for (const file of files) runtime.importProfile?.(await file.text(), { replace: false });
      setData(runtime.get?.() || null);
      setStatus(`Merged ${files.length} QI profile${files.length === 1 ? "" : "s"}`);
    } catch (error) {
      setStatus(String(error?.message || error));
    }
  };

  const summary = data?.summary || {};
  const leaders = data?.leaders || [];
  const events = data?.history?.events || [];
  const realtime = data?.realtime || {};
  return react.createElement("div", { className: "fremium-card fremium-qi-panel" },
    react.createElement("div", { className: "fremium-qi-header" },
      react.createElement("div", null,
        react.createElement("h3", null, "Queue Intelligence"),
        react.createElement("p", { className: "fremium-hint" }, "Live learning stays in memory. Connect C:\\Free Saves to continuously update QI_Profile.json, QI_History.json, and QI_Stats.json under Fremium\\QI; without a folder, nothing is written in real time.")
      ),
      react.createElement("span", { className: "fremium-pill" }, "LIVE")
    ),
    !runtime ? react.createElement("div", { className: "fremium-status err" }, "QI runtime unavailable") : react.createElement(react.Fragment, null,
      react.createElement("div", { className: "fremium-grid2 fremium-qi-stats" },
        react.createElement(StatCard, { label: "Events", value: String(summary.total || 0), sub: "This session" }),
        react.createElement(StatCard, { label: "Plays", value: String(summary.plays || 0), sub: `${summary.tracks || 0} tracks` }),
        react.createElement(StatCard, { label: "Skips", value: String(summary.skips || 0), sub: `${summary.completions || 0} completed` }),
        react.createElement(StatCard, { label: "Queue actions", value: String(summary.queueActions || 0), sub: "Observed changes" }),
        react.createElement(StatCard, { label: "Abandoned", value: String(summary.abandonments || 0), sub: `${summary.immediateSkips || 0} immediate skips` })
      ),
      react.createElement("div", { className: "fremium-qi-path" }, folderConnected ? `Connected: C:\\Free Saves\\Fremium\\QI • Live autosave: ${realtime.file || "QI files"}` : "Folder not connected: C:\\Free Saves\\Fremium\\QI • Memory only"),
      react.createElement("div", { className: "fremium-actions" },
        react.createElement("button", { className: "fremium-btn", onClick: () => run(() => runtime.chooseDirectory?.(), "Free Saves folder connected") }, "Choose C:\\Free Saves"),
        react.createElement("button", { className: "fremium-btn primary", onClick: () => run(() => runtime.saveSnapshot?.(), fileName => `Saved ${fileName}`), disabled: !folderConnected }, "Save Snapshot"),
        react.createElement("button", { className: "fremium-btn", onClick: () => run(() => runtime.downloadSnapshot?.(), fileName => `Downloaded ${fileName}`) }, "Download JSON"),
         react.createElement("button", { className: "fremium-btn", onClick: () => fileInput.current?.click() }, "Import JSON"),
         react.createElement("button", { className: "fremium-btn", onClick: () => profileInput.current?.click() }, "Merge Profile"),
         react.createElement("input", { ref: fileInput, type: "file", accept: ".json,application/json", multiple: true, onChange: importFiles, style: { display: "none" } }),
         react.createElement("input", { ref: profileInput, type: "file", accept: ".json,application/json", multiple: true, onChange: importProfileFiles, style: { display: "none" } }),
         react.createElement("button", { className: "fremium-btn", onClick: () => run(() => runtime.snapshot?.(), "Queue snapshot recorded") }, "Snapshot Queue"),
          react.createElement("button", { className: "fremium-btn", onClick: () => run(() => runtime.debug?.(Player.data?.item?.uri), result => result ? `QI ${result.score} • ${result.confidence}% confidence • ${result.reasons.join(" • ")}` : "No current track") }, "Why/Debug?"),
         react.createElement("button", { className: "fremium-btn", onClick: () => run(() => runtime.memory?.(), result => result?.insights?.join(" • ") || "No learned insights yet") }, "QI Memory"),
         react.createElement("button", { className: "fremium-btn", onClick: () => run(async () => { const names = await runtime.listBackups?.(); if (!names?.length) throw new Error("No backups found"); return runtime.restoreBackup?.(names[0]); }, "Restored latest QI backup") }, "Restore Latest Backup"),
          react.createElement("button", { className: "fremium-btn danger", onClick: () => { if (confirm("Clear the live QI session?")) run(() => runtime.clear?.(), "Live QI session cleared"); } }, "Clear Live QI"),
          react.createElement("button", { className: "fremium-btn danger", onClick: () => { if (confirm("Reset all learned QI preferences? This cannot be undone.")) run(() => runtime.resetLearned?.(), "Learned QI reset"); } }, "Reset Learned QI")
      ),
      react.createElement("label", { className: "fremium-qi-import-option" },
        react.createElement("input", { type: "checkbox", checked: replaceOnImport, onChange: event => setReplaceOnImport(event.target.checked) }),
        react.createElement("span", null, "Replace live data when importing one file")
      ),
      status ? react.createElement("div", { className: `fremium-status ${status.toLowerCase().includes("unavailable") || status.toLowerCase().includes("error") ? "err" : "ok"}` }, status) : null,
      leaders.length ? react.createElement("div", { className: "fremium-qi-leaders" },
        react.createElement("h4", null, "Most played this session"),
        leaders.map(track => react.createElement("div", { className: "fremium-row", key: track.uri || `${track.name}-${track.artist}` },
          react.createElement("div", { className: "fremium-row-main" },
            react.createElement("div", { className: "fremium-row-title small" }, track.name || "Unknown track"),
            react.createElement("div", { className: "fremium-row-sub" }, track.artist || "Unknown artist")
          ),
          react.createElement("span", { className: "fremium-pill" }, `${track.plays || 0} plays`)
        ))
      ) : null,
      events.length ? react.createElement("div", { className: "fremium-qi-events" },
        react.createElement("h4", null, "Recent activity"),
        events.slice(0, 5).map((event, index) => react.createElement("div", { className: "fremium-qi-event", key: `${event.timestamp || index}-${index}` },
          react.createElement("strong", null, event.type || "event"),
          react.createElement("span", null, event.name || event.uri || "Queue activity")
        ))
      ) : null
    )
  );
}

function App() {
  useEffect(() => {
    let menuItem = null;
    try {
      menuItem = new Menu.Item("Fremium Window", false, () => window.FremiumOpen?.());
      menuItem.register();
    } catch {}
    let btn = null;
    try {
      const header = document.querySelector(".main-topBar-container, .Root__top-bar");
      if (header && !document.getElementById("fremium-topbtn")) {
        btn = document.createElement("button");
        btn.id = "fremium-topbtn";
        btn.className = "fremium-topbtn";
        btn.textContent = "◈ Fremium";
        btn.onclick = () => window.FremiumOpen?.();
        header.appendChild(btn);
      }
    } catch {}
    return () => { try{ menuItem?.deregister(); }catch{} try{ btn?.remove(); }catch{} };
  }, []);

  return react.createElement("div", { className: "fremium-root" },
    react.createElement("div", { className: "fremium-hero" },
      react.createElement("h1", null, "Fremium"),
      react.createElement("p", { className: "fremium-sub" }, "Full Fremium window — open it from anywhere and keep it floating over Spotify."),
      react.createElement("div", { className: "fremium-actions" },
        react.createElement("button", { className: "fremium-btn primary large", onClick: () => window.FremiumOpen?.() }, "Open Full Fremium Window"),
        react.createElement("button", { className: "fremium-btn", onClick: () => showNotification("Fremium: drag the header to move it and the corner to resize it") }, "How it works")
      ),
      react.createElement("div", { className: "fremium-grid2", style: { marginTop: 18 } },
        react.createElement("div", { className: "fremium-card" },
          react.createElement("h3", null, "Full window"),
          react.createElement("p", { className: "fremium-hint" }, "The same complete Fremium tabs, mounted globally so the window stays available while you browse Spotify.")
        ),
        react.createElement("div", { className: "fremium-card" },
          react.createElement("h3", null, "Controls"),
          react.createElement("p", { className: "fremium-hint" }, "Drag the header to move it anywhere. Drag the lower-right corner to resize it. Position and size are remembered.")
        )
      )
    ),
    react.createElement(FremiumQiPanel, null)
  );
}

function FremiumPersistentHost() {
  const [isOpen, setIsOpen] = useState(() => LocalStorage.get(`${APP_ID}:win:open`) === "1");

  useEffect(() => {
    const open = () => setIsOpen(true);
    const close = () => setIsOpen(false);
    _openFremium = open;
    window.FremiumOpen = open;
    window.FremiumClose = close;
    return () => {
      if (_openFremium === open) _openFremium = null;
    };
  }, []);

  useEffect(() => {
    _isFremiumOpen = isOpen;
    LocalStorage.set(`${APP_ID}:win:open`, isOpen ? "1" : "0");
  }, [isOpen]);

  return react.createElement(FremiumWindow, { isOpen, onClose: closeWindow });
}

function closeWindow() {
  window.FremiumClose?.();
}

function mountPersistentWindow() {
  if (window.__fremiumPersistentRoot || !document.body) return;
  const host = document.createElement("div");
  host.id = "fremium-persistent-host";
  document.body.appendChild(host);
  const element = react.createElement(FremiumPersistentHost, null);
  if (reactDOM.createRoot) {
    window.__fremiumPersistentRoot = reactDOM.createRoot(host);
    window.__fremiumPersistentRoot.render(element);
  } else if (reactDOM.render) {
    reactDOM.render(element, host);
    window.__fremiumPersistentRoot = true;
  } else {
    host.remove();
  }
}

window.FremiumRuntime = { App };
mountPersistentWindow();

function render() {
  return react.createElement(App, null);
}
