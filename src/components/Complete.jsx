import { useEffect, useState } from 'react'

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function Complete({ snap, onRetry, onMenu }) {
  const [board, setBoard] = useState(null)
  const underPar = snap.elapsed <= snap.mission.par
  const best = Number(localStorage.getItem(`aeronav-best-${snap.mission.id}`) || 0)

  useEffect(() => {
    fetch(`/api/leaderboard?missionId=${snap.mission.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setBoard(d.scores))
      .catch(() => setBoard(null))
  }, [snap.mission.id])

  return (
    <div className="complete">
      <div className="complete-card panel">
        <div className="complete-title">MISSION COMPLETE</div>
        <div className="complete-city">
          {snap.mission.name} — {snap.mission.city}
        </div>
        <div className="complete-score">{snap.score.toLocaleString()}</div>
        <div className="complete-rows">
          <div>
            <span>Time</span>
            <span className={underPar ? 'good' : 'overpar'}>
              {fmtTime(snap.elapsed)} {underPar ? '(under par!)' : '(over par)'}
            </span>
          </div>
          <div>
            <span>Waypoints</span>
            <span>{snap.total} × 1,000</span>
          </div>
          <div>
            <span>Session best</span>
            <span>{best.toLocaleString()}</span>
          </div>
        </div>
        {board && board.length > 0 && (
          <div className="board">
            <div className="board-title">GLOBAL TOP — {snap.mission.city.toUpperCase()}</div>
            {board.slice(0, 5).map((s, i) => (
              <div key={i} className="board-row">
                <span>
                  {i + 1}. {s.name}
                </span>
                <span>{s.score.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
        <div className="complete-actions">
          <button className="btn primary" onClick={onRetry}>
            FLY AGAIN
          </button>
          <button className="btn" onClick={onMenu}>
            WORLD MAP
          </button>
        </div>
      </div>
    </div>
  )
}
