const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`)

function CompassStrip({ heading }) {
  const marks = []
  for (let d = -90; d <= 90; d += 15) {
    const h = (Math.round(heading / 15) * 15 + d + 360) % 360
    const offset = ((h - heading + 540) % 360) - 180
    if (Math.abs(offset) > 60) continue
    const label =
      h % 90 === 0 ? ['N', 'E', 'S', 'W'][h / 90] : h % 45 === 0 ? ['NE', 'SE', 'SW', 'NW'][(h - 45) / 90] : h
    marks.push(
      <span
        key={d}
        className={`compass-mark ${typeof label === 'string' ? 'cardinal' : ''}`}
        style={{ left: `${50 + offset * 0.8}%` }}
      >
        {label}
      </span>
    )
  }
  return (
    <div className="compass">
      {marks}
      <div className="compass-needle">▼</div>
      <div className="compass-reading">{String(Math.round(heading)).padStart(3, '0')}°</div>
    </div>
  )
}

export default function HUD({ snap }) {
  // Direction to target relative to the nose, for the guidance arrow.
  const rel = ((snap.targetBearing - snap.heading + 540) % 360) - 180

  return (
    <div className="hud">
      <CompassStrip heading={snap.heading} />

      <div className="hud-topleft panel">
        <div className="hud-mission">{snap.mission.name}</div>
        <div className="hud-row">
          <span className="hud-label">TIME</span>
          <span className={snap.elapsed > snap.mission.par ? 'overpar' : ''}>{fmtTime(snap.elapsed)}</span>
          <span className="hud-label">PAR</span>
          <span>{fmtTime(snap.mission.par)}</span>
        </div>
        <div className="hud-row">
          <span className="hud-label">WAYPOINT</span>
          <span>
            {snap.cpIndex + 1} / {snap.total}
          </span>
        </div>
      </div>

      <div className="hud-target panel">
        <div className="target-arrow" style={{ transform: `rotate(${rel}deg)` }}>
          ➤
        </div>
        <div>
          <div className="target-name">{snap.targetName}</div>
          <div className="target-dist">{fmtDist(snap.targetDist)}</div>
        </div>
      </div>

      <div className="hud-bottom">
        <div className="gauge panel">
          <div className="gauge-value">{Math.round(snap.speed * 3.6)}</div>
          <div className="gauge-unit">km/h</div>
        </div>
        <div className="reticle">+</div>
        <div className="gauge panel">
          <div className="gauge-value">{Math.round(snap.alt)}</div>
          <div className="gauge-unit">m ALT</div>
        </div>
      </div>

      {snap.message && <div className="hud-flash">{snap.message}</div>}

      <div className="hud-keys">W/S throttle · A/D turn · ↑/↓ climb · Shift boost · Esc abort</div>
    </div>
  )
}
