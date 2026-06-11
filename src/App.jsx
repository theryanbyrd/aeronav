import { useEffect, useRef, useState } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { createMap, FlightEngine } from './game/engine.js'
import { MISSIONS as LOCAL_MISSIONS } from '../shared/missions.js'
import Menu from './components/Menu.jsx'
import HUD from './components/HUD.jsx'
import Complete from './components/Complete.jsx'

export default function App() {
  const mapRef = useRef(null)
  const engineRef = useRef(null)
  const [snap, setSnap] = useState(null)
  const [missions, setMissions] = useState(LOCAL_MISSIONS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const map = createMap(mapRef.current)
    const engine = new FlightEngine(map)
    engineRef.current = engine
    const unsub = engine.subscribe(setSnap)
    setSnap(engine.snapshot)
    map.on('load', () => setLoaded(true))

    fetch('/api/missions')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => Array.isArray(d.missions) && d.missions.length && setMissions(d.missions))
      .catch(() => {}) // vite dev has no serverless layer; bundled data is identical

    return () => {
      unsub()
      engine.destroy()
      map.remove()
    }
  }, [])

  const phase = snap?.phase ?? 'menu'

  return (
    <div className="app">
      <div ref={mapRef} className="map" />
      <div className="vignette" />
      {phase === 'menu' && (
        <Menu
          missions={missions}
          ready={loaded}
          onSelect={(m) => engineRef.current.startMission(m)}
        />
      )}
      {phase === 'intro' && (
        <div className="intro-banner">
          <div className="intro-title">{snap.mission.name}</div>
          <div className="intro-sub">{snap.mission.city} — descending to start…</div>
        </div>
      )}
      {phase === 'flying' && snap && <HUD snap={snap} />}
      {phase === 'complete' && snap && (
        <Complete
          snap={snap}
          onRetry={() => engineRef.current.startMission(snap.mission)}
          onMenu={() => engineRef.current.abortToMenu()}
        />
      )}
    </div>
  )
}
