import maplibregl from 'maplibre-gl'

// AeroNav flight engine: owns the MapLibre map, the requestAnimationFrame
// loop, arcade flight physics, checkpoint logic, and scoring. React reads a
// snapshot via subscribe(); it never touches the map directly.

const EARTH_M_PER_DEG_LAT = 111320

const toRad = (d) => (d * Math.PI) / 180
const toDeg = (r) => (r * 180) / Math.PI
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const lerp = (a, b, t) => a + (b - a) * t

export function distanceM(a, b) {
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const la1 = toRad(a[1])
  const la2 = toRad(b[1])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function bearingDeg(a, b) {
  const la1 = toRad(a[1])
  const la2 = toRad(b[1])
  const dLng = toRad(b[0] - a[0])
  const y = Math.sin(dLng) * Math.cos(la2)
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

function circlePolygon([lng, lat], radiusM, steps = 28) {
  const ring = []
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    ring.push([
      lng + (Math.cos(t) * radiusM) / (EARTH_M_PER_DEG_LAT * Math.cos(toRad(lat))),
      lat + (Math.sin(t) * radiusM) / EARTH_M_PER_DEG_LAT,
    ])
  }
  return { type: 'Polygon', coordinates: [ring] }
}

const CAPTURE_RADIUS_M = 170
const BEAM_HEIGHT_M = 1300

export class FlightEngine {
  constructor(map) {
    this.map = map
    this.keys = new Set()
    this.listeners = new Set()
    this.phase = 'menu' // menu | intro | flying | complete
    this.mission = null
    this.cpIndex = 0
    this.pos = [-30, 25]
    this.alt = 400
    this.heading = 0
    this.speed = 110
    this.roll = 0
    this.elapsed = 0
    this.score = 0
    this.captures = []
    this.message = null
    this.messageUntil = 0
    this.lastT = null
    this.audio = null
    this.snapshot = this.buildSnapshot()

    this.onKeyDown = (e) => {
      if (e.repeat) return
      this.keys.add(e.code)
      if (e.code === 'Escape' && this.phase === 'flying') this.abortToMenu()
    }
    this.onKeyUp = (e) => this.keys.delete(e.code)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)

    this.rafId = requestAnimationFrame((t) => this.loop(t))
  }

  destroy() {
    cancelAnimationFrame(this.rafId)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
  }

  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  notify() {
    this.snapshot = this.buildSnapshot()
    this.listeners.forEach((fn) => fn(this.snapshot))
  }

  buildSnapshot() {
    const target = this.currentTarget()
    return {
      phase: this.phase,
      mission: this.mission,
      cpIndex: this.cpIndex,
      total: this.mission?.checkpoints.length ?? 0,
      speed: this.speed,
      alt: this.alt,
      heading: this.heading,
      elapsed: this.elapsed,
      score: this.score,
      message: performance.now() < this.messageUntil ? this.message : null,
      targetName: target?.name ?? null,
      targetDist: target ? distanceM(this.pos, target.pos) : 0,
      targetBearing: target ? bearingDeg(this.pos, target.pos) : 0,
    }
  }

  currentTarget() {
    if (!this.mission || this.phase === 'complete') return null
    return this.mission.checkpoints[this.cpIndex] ?? null
  }

  flash(msg, ms = 2600) {
    this.message = msg
    this.messageUntil = performance.now() + ms
  }

  beep(freq = 880, dur = 0.18, type = 'sine', gain = 0.12) {
    try {
      this.audio = this.audio || new (window.AudioContext || window.webkitAudioContext)()
      const ctx = this.audio
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = type
      osc.frequency.value = freq
      g.gain.setValueAtTime(gain, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
      osc.connect(g).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + dur)
    } catch {
      /* audio is optional */
    }
  }

  // ---- map layers -------------------------------------------------------

  ensureLayers() {
    const map = this.map
    if (map.getSource('aeronav-cps')) return
    map.addSource('aeronav-cps', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addSource('aeronav-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({
      id: 'aeronav-beam',
      type: 'fill-extrusion',
      source: 'aeronav-cps',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-extrusion-height': BEAM_HEIGHT_M,
        'fill-extrusion-base': 0,
        'fill-extrusion-color': [
          'match', ['get', 'status'],
          'target', '#00e5ff',
          'done', '#2bd97c',
          '#5b6b8c',
        ],
        'fill-extrusion-opacity': 0.42,
      },
    })
    map.addLayer({
      id: 'aeronav-ring',
      type: 'circle',
      source: 'aeronav-cps',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 14,
        'circle-color': 'rgba(0,229,255,0.25)',
        'circle-stroke-width': 3,
        'circle-stroke-color': [
          'match', ['get', 'status'],
          'target', '#00e5ff',
          'done', '#2bd97c',
          '#5b6b8c',
        ],
      },
    })
    map.addLayer({
      id: 'aeronav-route-line',
      type: 'line',
      source: 'aeronav-route',
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': '#00e5ff',
        'line-width': 3,
        'line-opacity': 0.55,
        'line-dasharray': [0.6, 2.2],
      },
    })
  }

  refreshCheckpointFeatures() {
    if (!this.mission) return
    const features = []
    this.mission.checkpoints.forEach((cp, i) => {
      const status = i < this.cpIndex ? 'done' : i === this.cpIndex ? 'target' : 'future'
      features.push({
        type: 'Feature',
        properties: { status },
        geometry: { type: 'Point', coordinates: cp.pos },
      })
      if (status !== 'future') {
        features.push({
          type: 'Feature',
          properties: { status },
          geometry: circlePolygon(cp.pos, status === 'target' ? 65 : 45),
        })
      }
    })
    this.map.getSource('aeronav-cps')?.setData({ type: 'FeatureCollection', features })
  }

  refreshRoute() {
    const target = this.currentTarget()
    const src = this.map.getSource('aeronav-route')
    if (!src) return
    src.setData(
      target
        ? {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: [this.pos, target.pos] },
          }
        : { type: 'FeatureCollection', features: [] }
    )
  }

  // ---- lifecycle --------------------------------------------------------

  startMission(mission) {
    this.mission = mission
    this.cpIndex = 0
    this.elapsed = 0
    this.score = 0
    this.captures = []
    this.pos = [...mission.start.pos]
    this.alt = mission.start.alt
    this.speed = 110
    this.heading = bearingDeg(mission.start.pos, mission.checkpoints[0].pos)
    this.roll = 0
    this.phase = 'intro'
    this.ensureLayers()
    this.refreshCheckpointFeatures()
    this.notify()

    this.map.flyTo({
      center: mission.start.pos,
      zoom: 15.8,
      pitch: 76,
      bearing: this.heading,
      duration: 4200,
      essential: true,
    })
    this.map.once('moveend', () => {
      if (this.phase !== 'intro') return
      this.phase = 'flying'
      this.lastT = null
      this.flash(`Mission start — fly to ${mission.checkpoints[0].name}`, 3500)
      this.beep(660, 0.12)
      this.notify()
    })
  }

  abortToMenu() {
    this.phase = 'menu'
    this.mission = null
    this.map.getSource('aeronav-cps')?.setData({ type: 'FeatureCollection', features: [] })
    this.map.getSource('aeronav-route')?.setData({ type: 'FeatureCollection', features: [] })
    this.map.flyTo({ center: [-30, 25], zoom: 1.9, pitch: 0, bearing: 0, roll: 0, duration: 3000 })
    this.notify()
  }

  completeMission() {
    const par = this.mission.par
    const timeBonus = Math.max(0, Math.round((par - this.elapsed) * 12))
    this.score = this.mission.checkpoints.length * 1000 + timeBonus
    this.phase = 'complete'
    this.beep(523, 0.15)
    setTimeout(() => this.beep(659, 0.15), 140)
    setTimeout(() => this.beep(784, 0.3), 280)
    const key = `aeronav-best-${this.mission.id}`
    const best = Number(localStorage.getItem(key) || 0)
    if (this.score > best) localStorage.setItem(key, String(this.score))
    fetch('/api/leaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'PILOT',
        missionId: this.mission.id,
        score: this.score,
        timeMs: Math.round(this.elapsed * 1000),
      }),
    }).catch(() => {})
    this.notify()
  }

  // ---- per-frame --------------------------------------------------------

  loop(t) {
    this.rafId = requestAnimationFrame((tt) => this.loop(tt))
    if (this.lastT == null) {
      this.lastT = t
      return
    }
    const dt = clamp((t - this.lastT) / 1000, 0, 0.05)
    this.lastT = t

    if (this.phase === 'menu') {
      // Slow idle spin of the globe behind the menu.
      const c = this.map.getCenter()
      this.map.jumpTo({ center: [c.lng + dt * 2.4, c.lat] })
      return
    }
    if (this.phase !== 'flying') return

    const k = this.keys
    const turn = (k.has('KeyA') || k.has('ArrowLeft') ? -1 : 0) + (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0)
    const throttle = (k.has('KeyW') ? 1 : 0) + (k.has('KeyS') ? -1 : 0)
    const climb = (k.has('ArrowUp') ? 1 : 0) + (k.has('ArrowDown') ? -1 : 0)
    const boost = k.has('ShiftLeft') || k.has('ShiftRight')
    const brake = k.has('Space')

    // Speed (m/s)
    const maxSpeed = boost ? 720 : 300
    this.speed += throttle * 140 * dt + (boost ? 260 * dt : 0)
    if (brake) this.speed -= 380 * dt
    this.speed = clamp(this.speed, 30, maxSpeed)

    // Heading + banked roll
    const turnRate = 58 - this.speed * 0.025
    this.heading = (this.heading + turn * turnRate * dt + 360) % 360
    this.roll = lerp(this.roll, turn * 24, 1 - Math.exp(-6 * dt))

    // Altitude, clamped above terrain
    this.alt += climb * (70 + this.speed * 0.35) * dt
    let ground = 0
    try {
      ground = this.map.queryTerrainElevation(this.pos) || 0
    } catch {
      ground = 0
    }
    this.alt = clamp(this.alt, ground + 25, 4500)

    // Advance position along heading
    const meters = this.speed * dt
    const rad = toRad(this.heading)
    this.pos = [
      this.pos[0] + (Math.sin(rad) * meters) / (EARTH_M_PER_DEG_LAT * Math.cos(toRad(this.pos[1]))),
      clamp(this.pos[1] + (Math.cos(rad) * meters) / EARTH_M_PER_DEG_LAT, -85, 85),
    ]

    // Camera: true camera-position control when available (MapLibre v5+),
    // otherwise approximate altitude with zoom. Base pitch sits near the
    // horizon for a cockpit view; climbing/diving tilts the nose.
    const pitch = clamp(85 + climb * 5, 64, 93)
    if (typeof this.map.calculateCameraOptionsFromCameraLngLatAltRotation === 'function') {
      try {
        const cam = this.map.calculateCameraOptionsFromCameraLngLatAltRotation(
          { lng: this.pos[0], lat: this.pos[1] },
          this.alt,
          this.heading,
          Math.min(pitch, this.map.getMaxPitch()),
          this.roll
        )
        this.map.jumpTo(cam)
      } catch {
        this.fallbackCamera()
      }
    } else {
      this.fallbackCamera()
    }

    // Checkpoint capture
    const target = this.currentTarget()
    if (target) {
      const d = distanceM(this.pos, target.pos)
      if (d < CAPTURE_RADIUS_M && this.alt < ground + BEAM_HEIGHT_M + 400) {
        this.captures.push(this.elapsed)
        this.cpIndex++
        this.beep(980, 0.2, 'triangle')
        if (this.cpIndex >= this.mission.checkpoints.length) {
          this.refreshCheckpointFeatures()
          this.refreshRoute()
          this.completeMission()
          return
        }
        this.flash(`✓ ${target.name} — next: ${this.mission.checkpoints[this.cpIndex].name}`)
        this.refreshCheckpointFeatures()
      }
    }
    this.refreshRoute()

    this.elapsed += dt
    this.notify()
  }

  fallbackCamera() {
    this.map.jumpTo({
      center: this.pos,
      bearing: this.heading,
      pitch: Math.min(85, this.map.getMaxPitch()),
      zoom: 24.1 - Math.log2(Math.max(this.alt, 40)),
    })
  }
}

// ---- map bootstrap ------------------------------------------------------

export function createMap(container) {
  // Satellite imagery base (Esri World Imagery, keyless) + OpenFreeMap vector
  // tiles for 3D building extrusions + AWS Open Data terrain tiles.
  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: {
        satellite: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution:
            'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        },
        openmaptiles: {
          type: 'vector',
          url: 'https://tiles.openfreemap.org/planet',
        },
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#0a1320' } },
        { id: 'satellite', type: 'raster', source: 'satellite' },
      ],
    },
    center: [-30, 25],
    zoom: 1.9,
    maxPitch: 95,
    // Required so the flight camera's explicit elevation is honored instead of
    // being recomputed from the terrain under the screen center.
    centerClampedToGround: false,
    attributionControl: { compact: true },
    canvasContextAttributes: { antialias: true },
  })

  map.on('style.load', () => {
    try {
      map.setProjection({ type: 'globe' })
    } catch { /* older maplibre: stay mercator */ }

    map.addSource('aeronav-dem', {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 13,
      attribution: 'Terrain: USGS/NASA via AWS Open Data',
    })
    try {
      map.setTerrain({ source: 'aeronav-dem', exaggeration: 1.15 })
    } catch { /* terrain unsupported */ }

    try {
      map.setSky({
        'sky-color': '#6fb0e8',
        'horizon-color': '#dceaf8',
        'fog-color': '#c9d9ea',
        'sky-horizon-blend': 0.6,
        'horizon-fog-blend': 0.6,
        'fog-ground-blend': 0.85,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0.4],
      })
    } catch { /* sky unsupported */ }

    // 3D buildings extruded over the satellite imagery, tinted to blend in.
    try {
      map.addLayer({
        id: 'aeronav-3d-buildings',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'],
            ['coalesce', ['get', 'render_height'], 12],
            0, '#c9cdd4',
            80, '#aeb6c2',
            300, '#8e9aac',
          ],
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.96,
        },
      })
    } catch { /* building layer unavailable */ }
  })

  return map
}
