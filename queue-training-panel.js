window.FremiumTrainingPanel = function FremiumTrainingPanel() {
  const trainingReact = Spicetify.React;
  const { useState, useCallback } = trainingReact;
  const [data, setData] = useState(() => window.FremiumQueueIntelligence?.get?.() || { profile: {}, tracks: { tracks: {} }, playlists: { playlists: {} }, history: { events: [] } });
  const [status, setStatus] = useState("");
  const refresh = useCallback(() => setData(window.FremiumQueueIntelligence?.get?.() || data), [data]);
  const log = useCallback(event => { window.FremiumQueueIntelligence?.record?.(event); refresh(); }, [refresh]);
  const clear = useCallback(() => { if (confirm("Clear all Queue Intelligence data?")) { window.FremiumQueueIntelligence?.clear?.(); refresh(); setStatus("QI data cleared"); } }, [refresh]);
  const exportFile = useCallback(() => { const text = window.FremiumQueueIntelligence?.exportData?.() || JSON.stringify(data, null, 2); const blob = new Blob([text], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "fremium-qi.json"; link.click(); URL.revokeObjectURL(url); setStatus("Downloaded fremium-qi.json"); }, [data]);
  const importFile = useCallback(event => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { window.FremiumQueueIntelligence?.importData?.(null, String(reader.result)); refresh(); setStatus(`Imported ${file.name}`); } catch (error) { setStatus(String(error.message || error)); } }; reader.readAsText(file); event.target.value = ""; }, [refresh]);
  const current = Spicetify.Player.data?.item;
  const summary = window.FremiumQueueIntelligence?.summary?.() || { total: 0, plays: 0, skips: 0, repeats: 0, completions: 0, tracks: 0, playlists: 0, updatedAt: null };
  const h = trainingReact.createElement;
  return h("div", { className: "fremium-training-panel" },
    h("div", { className: "fremium-training-header" }, h("h3", null, "Queue Intelligence data"), h("span", { className: "fremium-pill" }, `${summary.total} events`)),
    h("p", { className: "fremium-hint" }, "Stored separately from Spotify's actual queue in four datasets: profile, tracks, playlists, and history. Export/import the complete QI database as JSON."),
    h("div", { className: "fremium-grid2" },
      h("div", { className: "fremium-stat" }, h("div", { className: "fremium-stat-label" }, "Plays"), h("div", { className: "fremium-stat-value" }, String(summary.plays))),
      h("div", { className: "fremium-stat" }, h("div", { className: "fremium-stat-label" }, "Skips"), h("div", { className: "fremium-stat-value" }, String(summary.skips))),
      h("div", { className: "fremium-stat" }, h("div", { className: "fremium-stat-label" }, "Repeats"), h("div", { className: "fremium-stat-value" }, String(summary.repeats))),
      h("div", { className: "fremium-stat" }, h("div", { className: "fremium-stat-label" }, "Completed"), h("div", { className: "fremium-stat-value" }, String(summary.completions))),
      h("div", { className: "fremium-stat" }, h("div", { className: "fremium-stat-label" }, "Tracks"), h("div", { className: "fremium-stat-value" }, String(summary.tracks))),
      h("div", { className: "fremium-stat" }, h("div", { className: "fremium-stat-label" }, "Playlists"), h("div", { className: "fremium-stat-value" }, String(summary.playlists)))
    ),
    h("div", { className: "fremium-actions" },
      h("button", { className: "fremium-btn", onClick: () => current && log({ type: "play", uri: current.uri, name: current.name, artist: current.artists?.[0]?.name || "" }) }, "Log current play"),
      h("button", { className: "fremium-btn", onClick: () => current && log({ type: "skip", uri: current.uri, name: current.name, artist: current.artists?.[0]?.name || "" }) }, "Log current skip"),
      h("button", { className: "fremium-btn", onClick: () => window.FremiumQueueIntelligence?.snapshot?.() }, "Snapshot queue"),
      h("button", { className: "fremium-btn primary", onClick: exportFile }, "Export QI database"),
      h("label", { className: "fremium-btn" }, "Import QI database", h("input", { type: "file", accept: ".json,application/json", onChange: importFile, style: { display: "none" } })),
      h("button", { className: "fremium-btn danger", onClick: clear }, "Clear QI data")
    ),
    status ? h("div", { className: "fremium-status ok" }, status) : null,
    h("p", { className: "fremium-hint" }, `Last updated: ${summary.updatedAt || "never"}`)
  );
};
