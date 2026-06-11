export default function Menu({ missions, ready, onSelect }) {
  return (
    <div className="menu">
      <div className="menu-head">
        <h1 className="logo">
          AERO<span>NAV</span>
        </h1>
        <p className="tagline">Real-world flight navigator — live OpenStreetMap 3D cities &amp; terrain</p>
      </div>

      <div className="mission-grid">
        {missions.map((m) => {
          const best = Number(localStorage.getItem(`aeronav-best-${m.id}`) || 0)
          return (
            <button key={m.id} className="mission-card" disabled={!ready} onClick={() => onSelect(m)}>
              <div className="mc-city">{m.city}</div>
              <div className="mc-name">{m.name}</div>
              <div className="mc-meta">
                <span className={`diff diff-${m.difficulty.toLowerCase()}`}>{m.difficulty}</span>
                <span>{m.checkpoints.length} waypoints</span>
                <span>par {Math.floor(m.par / 60)}:{String(m.par % 60).padStart(2, '0')}</span>
              </div>
              {best > 0 && <div className="mc-best">BEST {best.toLocaleString()}</div>}
            </button>
          )
        })}
      </div>

      <div className="controls-card">
        <span><kbd>W</kbd>/<kbd>S</kbd> throttle</span>
        <span><kbd>A</kbd>/<kbd>D</kbd> turn</span>
        <span><kbd>↑</kbd>/<kbd>↓</kbd> climb / dive</span>
        <span><kbd>Shift</kbd> boost</span>
        <span><kbd>Space</kbd> airbrake</span>
        <span><kbd>Esc</kbd> abort</span>
      </div>
      {!ready && <div className="loading">loading world…</div>}
    </div>
  )
}
