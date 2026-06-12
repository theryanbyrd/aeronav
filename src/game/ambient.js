// Ambient world system: weather (sky presets + drifting volumetric cloud
// slabs you can fly through) and NPCs (cars on real OSM roads, AI air
// traffic, bird flocks, trees scattered in real parks/woodland).
//
// Everything renders through native MapLibre layers: clouds, aircraft, birds
// and trees are data-driven fill-extrusions (extrusion-base lets them float
// at altitude); cars are ground-aligned circles. Sources are updated from the
// engine's rAF loop — feature counts are small, so per-frame setData is cheap.

import {
  clamp,
  lerp,
  distanceM,
  offsetM,
  circlePolygon,
  shapeToPolygon,
  pointInRing,
} from './geo.js'

const SKY = {
  clear: {
    'sky-color': '#6fb0e8', 'horizon-color': '#dceaf8', 'fog-color': '#c9d9ea',
    'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.85,
  },
  scattered: {
    'sky-color': '#74aedd', 'horizon-color': '#d6e4f0', 'fog-color': '#c5d4e2',
    'sky-horizon-blend': 0.65, 'horizon-fog-blend': 0.65, 'fog-ground-blend': 0.82,
  },
  overcast: {
    'sky-color': '#8fa3b6', 'horizon-color': '#c3ced9', 'fog-color': '#b9c4cf',
    'sky-horizon-blend': 0.78, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.78,
  },
  fog: {
    'sky-color': '#a6b2bd', 'horizon-color': '#c2cad2', 'fog-color': '#bac2ca',
    'sky-horizon-blend': 0.9, 'horizon-fog-blend': 0.85, 'fog-ground-blend': 0.45,
  },
}
const ATMOSPHERE = ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0.4]

const WEATHER = {
  clear: { n: 3, size: [180, 320], base: [750, 1050], thick: [70, 130], opacity: 0.45, color: '#ffffff', fx: 0 },
  scattered: { n: 12, size: [250, 550], base: [450, 900], thick: [150, 320], opacity: 0.55, color: '#ffffff', fx: 0 },
  overcast: { n: 16, size: [450, 900], base: [800, 1250], thick: [200, 380], opacity: 0.6, color: '#e9edf2', fx: 0.05 },
  fog: { n: 8, size: [300, 620], base: [50, 200], thick: [150, 320], opacity: 0.5, color: '#eef1f4', fx: 0.16 },
}
const WEATHER_POOL = ['clear', 'clear', 'scattered', 'scattered', 'scattered', 'overcast', 'overcast', 'fog']

// Local-meter silhouettes (+y = direction of travel)
const PLANE_PTS = [
  [0, 16], [2, 6], [14, 1.5], [14, -1.5], [2.5, -2.5], [2, -9], [7, -11], [7, -13.5], [0, -12.5],
  [-7, -13.5], [-7, -11], [-2, -9], [-2.5, -2.5], [-14, -1.5], [-14, 1.5], [-2, 6],
]
const BIRD_PTS = [[0, 3], [5, -2], [5, -4], [0, 0], [-5, -4], [-5, -2]]

const CAR_COLORS = ['#d9dde2', '#aeb4bb', '#2e3338', '#b3433c', '#3c6fb3', '#c9a13b', '#3f3f46', '#e8e8e8']
const TREE_COLORS = ['#2f5e3a', '#39704a', '#28522f', '#447a4b']

const rand = (lo, hi) => lo + Math.random() * (hi - lo)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

const NUM_CARS = 36
const NUM_PLANES = 4
const NUM_FLOCKS = 3
const BIRDS_PER_FLOCK = 7
const MAX_TREES = 240

export class Ambient {
  constructor(map) {
    this.map = map
    this.weather = null
    this.cloudFx = 0
    this.t = 0
    this.clouds = []
    this.planes = []
    this.flocks = []
    this.cars = []
    this.roads = []
    this.roadTimer = 0
    this.treeTimer = 0
    this.ensureLayers()
  }

  ensureLayers() {
    const map = this.map
    if (map.getSource('amb-air')) return
    for (const id of ['amb-trees', 'amb-cars', 'amb-air', 'amb-clouds']) {
      map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    }
    map.addLayer({
      id: 'amb-trees',
      type: 'fill-extrusion',
      source: 'amb-trees',
      paint: {
        'fill-extrusion-color': ['get', 'c'],
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.95,
      },
    })
    map.addLayer({
      id: 'amb-cars',
      type: 'circle',
      source: 'amb-cars',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 16, 4, 18, 6],
        'circle-color': ['get', 'c'],
        'circle-pitch-alignment': 'map',
        'circle-stroke-width': 0.5,
        'circle-stroke-color': '#1a1d22',
      },
    })
    map.addLayer({
      id: 'amb-air',
      type: 'fill-extrusion',
      source: 'amb-air',
      paint: {
        'fill-extrusion-color': ['get', 'c'],
        'fill-extrusion-base': ['get', 'b'],
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-opacity': 0.95,
      },
    })
    map.addLayer({
      id: 'amb-clouds',
      type: 'fill-extrusion',
      source: 'amb-clouds',
      paint: {
        'fill-extrusion-color': ['get', 'c'],
        'fill-extrusion-base': ['get', 'b'],
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-opacity': 0.55,
        'fill-extrusion-vertical-gradient': true,
      },
    })
  }

  applySky(name) {
    try {
      this.map.setSky({ ...SKY[name], 'atmosphere-blend': ATMOSPHERE })
    } catch { /* sky unsupported */ }
  }

  start(center) {
    this.ensureLayers()
    this.weather = pick(WEATHER_POOL)
    this.applySky(this.weather)
    const wx = WEATHER[this.weather]
    try {
      this.map.setPaintProperty('amb-clouds', 'fill-extrusion-opacity', wx.opacity)
    } catch { /* layer missing */ }
    this.wind = { dir: rand(0, 360), speed: rand(2.5, 9) }
    this.cloudFx = wx.fx
    this.t = 0
    this.roads = []
    this.cars = []
    this.roadTimer = 0
    this.treeTimer = 0

    this.clouds = Array.from({ length: wx.n }, () => this.makeCloud(center, wx, true))
    this.planes = Array.from({ length: NUM_PLANES }, () => ({
      p: offsetM(center, rand(-4000, 4000), rand(-4000, 4000)),
      h: rand(0, 360),
      spd: rand(60, 120),
      alt: rand(500, 1300),
    }))
    this.flocks = Array.from({ length: NUM_FLOCKS }, () => ({
      c: offsetM(center, rand(-2000, 2000), rand(-2000, 2000)),
      h: rand(0, 360),
      spd: rand(9, 16),
      alt: rand(80, 240),
      off: Array.from({ length: BIRDS_PER_FLOCK }, (_, i) => [
        (i - BIRDS_PER_FLOCK / 2) * rand(10, 18),
        -Math.abs(i - BIRDS_PER_FLOCK / 2) * rand(12, 20),
      ]),
    }))
  }

  clear() {
    this.weather = null
    this.cloudFx = 0
    this.clouds = []
    this.planes = []
    this.flocks = []
    this.cars = []
    this.roads = []
    this.applySky('clear')
    for (const id of ['amb-clouds', 'amb-air', 'amb-cars', 'amb-trees']) {
      this.map.getSource(id)?.setData({ type: 'FeatureCollection', features: [] })
    }
  }

  makeCloud(center, wx, scatterWide) {
    const r = rand(wx.size[0], wx.size[1])
    const verts = 10
    const off = Array.from({ length: verts }, (_, i) => {
      const a = (i / verts) * Math.PI * 2
      const rr = r * rand(0.65, 1.2)
      return [Math.cos(a) * rr, Math.sin(a) * rr]
    })
    const spread = scatterWide ? 5500 : 0
    const base = rand(wx.base[0], wx.base[1])
    return {
      c: offsetM(center, rand(-spread, spread), rand(-spread, spread)),
      off,
      r,
      b: base,
      h: base + rand(wx.thick[0], wx.thick[1]),
    }
  }

  // ---- NPC data acquisition (real roads / parks from the vector tiles) ----

  refreshRoads(pos) {
    let feats = []
    try {
      feats = this.map.queryRenderedFeatures({ layers: ['amb-roads-q'] })
    } catch {
      return
    }
    const lines = []
    for (const f of feats) {
      const geoms =
        f.geometry.type === 'LineString'
          ? [f.geometry.coordinates]
          : f.geometry.type === 'MultiLineString'
            ? f.geometry.coordinates
            : []
      for (const coords of geoms) {
        if (coords.length < 2) continue
        if (distanceM(coords[0], pos) > 4000) continue
        // cumulative length for interpolation
        const cum = [0]
        for (let i = 1; i < coords.length; i++) {
          cum.push(cum[i - 1] + distanceM(coords[i - 1], coords[i]))
        }
        const len = cum[cum.length - 1]
        if (len < 120) continue
        lines.push({ coords, cum, len })
        if (lines.length >= 70) break
      }
      if (lines.length >= 70) break
    }
    if (lines.length) {
      this.roads = lines
      while (this.cars.length < NUM_CARS) {
        const road = pick(this.roads)
        this.cars.push({
          road,
          d: rand(0, road.len),
          dir: Math.random() < 0.5 ? 1 : -1,
          spd: rand(6, 18),
          c: pick(CAR_COLORS),
        })
      }
    }
  }

  refreshTrees(pos, alt) {
    if (alt > 1600) return // invisible specks from up high; skip the work
    let feats = []
    try {
      feats = this.map.queryRenderedFeatures({ layers: ['amb-park-q', 'amb-green-q'] })
    } catch {
      return
    }
    const trees = []
    for (const f of feats.slice(0, 25)) {
      const rings =
        f.geometry.type === 'Polygon'
          ? [f.geometry.coordinates[0]]
          : f.geometry.type === 'MultiPolygon'
            ? f.geometry.coordinates.map((p) => p[0])
            : []
      for (const ring of rings) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const [x, y] of ring) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x)
          minY = Math.min(minY, y); maxY = Math.max(maxY, y)
        }
        const tries = 40
        let placed = 0
        for (let i = 0; i < tries && placed < 18 && trees.length < MAX_TREES; i++) {
          const pt = [rand(minX, maxX), rand(minY, maxY)]
          if (!pointInRing(pt, ring)) continue
          placed++
          trees.push({
            type: 'Feature',
            properties: { c: pick(TREE_COLORS), h: rand(7, 16) },
            geometry: circlePolygon(pt, rand(2.5, 5), 6),
          })
        }
        if (trees.length >= MAX_TREES) break
      }
      if (trees.length >= MAX_TREES) break
    }
    this.map.getSource('amb-trees')?.setData({ type: 'FeatureCollection', features: trees })
  }

  // ---- per-frame ----------------------------------------------------------

  update(dt, pos, alt, heading) {
    if (!this.weather) return
    this.t += dt
    const wx = WEATHER[this.weather]

    // Periodic world queries (real roads / parks around the aircraft)
    this.roadTimer -= dt
    if (this.roadTimer <= 0) {
      this.roadTimer = 5
      this.refreshRoads(pos)
    }
    this.treeTimer -= dt
    if (this.treeTimer <= 0) {
      this.treeTimer = 7
      this.refreshTrees(pos, alt)
    }

    // Clouds drift with the wind; recycle ones left far behind
    const windRad = (this.wind.dir * Math.PI) / 180
    const wdx = Math.sin(windRad) * this.wind.speed * dt
    const wdy = Math.cos(windRad) * this.wind.speed * dt
    let fxTarget = wx.fx
    const cloudFeats = []
    for (let i = 0; i < this.clouds.length; i++) {
      let cl = this.clouds[i]
      cl.c = offsetM(cl.c, wdx, wdy)
      if (distanceM(cl.c, pos) > 8000) {
        const a = ((heading + rand(-80, 80)) * Math.PI) / 180
        const d = rand(2000, 6000)
        cl = this.makeCloud(offsetM(pos, Math.sin(a) * d, Math.cos(a) * d), wx, false)
        this.clouds[i] = cl
      }
      cloudFeats.push({
        type: 'Feature',
        properties: { c: wx.color, b: cl.b, h: cl.h },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [...cl.off, cl.off[0]].map(([dx, dy]) => offsetM(cl.c, dx, dy)),
          ],
        },
      })
      // whiteout when flying inside this cloud
      const horiz = clamp(1 - (distanceM(cl.c, pos) - cl.r * 0.55) / (cl.r * 0.45), 0, 1)
      const vert = clamp((alt - cl.b + 40) / 80, 0, 1) * clamp((cl.h - alt + 40) / 80, 0, 1)
      fxTarget = Math.max(fxTarget, horiz * vert * 0.9)
    }
    this.cloudFx = lerp(this.cloudFx, fxTarget, 1 - Math.exp(-3 * dt))

    // Air traffic
    const airFeats = []
    for (const pl of this.planes) {
      const a = (pl.h * Math.PI) / 180
      pl.p = offsetM(pl.p, Math.sin(a) * pl.spd * dt, Math.cos(a) * pl.spd * dt)
      if (distanceM(pl.p, pos) > 7000) {
        const sa = ((heading + rand(-70, 70)) * Math.PI) / 180
        const d = rand(2500, 5000)
        pl.p = offsetM(pos, Math.sin(sa) * d, Math.cos(sa) * d)
        pl.h = rand(0, 360)
        pl.alt = rand(500, 1300)
      }
      airFeats.push({
        type: 'Feature',
        properties: { c: '#dfe5ec', b: pl.alt, h: pl.alt + 6 },
        geometry: shapeToPolygon(pl.p, PLANE_PTS, pl.h, 1.4),
      })
    }
    for (const fl of this.flocks) {
      fl.h += Math.sin(this.t * 0.4 + fl.alt) * 22 * dt
      const a = (fl.h * Math.PI) / 180
      fl.c = offsetM(fl.c, Math.sin(a) * fl.spd * dt, Math.cos(a) * fl.spd * dt)
      if (distanceM(fl.c, pos) > 4000) {
        const sa = ((heading + rand(-60, 60)) * Math.PI) / 180
        const d = rand(800, 2500)
        fl.c = offsetM(pos, Math.sin(sa) * d, Math.cos(sa) * d)
      }
      fl.off.forEach((off, i) => {
        const bob = Math.sin(this.t * 3 + i * 1.7) * 5
        const center = offsetM(
          fl.c,
          off[0] * Math.cos(a) + off[1] * Math.sin(a),
          -off[0] * Math.sin(a) + off[1] * Math.cos(a)
        )
        airFeats.push({
          type: 'Feature',
          properties: { c: '#23272e', b: fl.alt + bob, h: fl.alt + bob + 1.2 },
          geometry: shapeToPolygon(center, BIRD_PTS, fl.h, 0.7),
        })
      })
    }

    // Cars along real roads
    const carFeats = []
    for (const car of this.cars) {
      car.d += car.spd * car.dir * dt
      if (car.d < 0 || car.d > car.road.len) {
        if (!this.roads.length) continue
        car.road = pick(this.roads)
        car.dir = Math.random() < 0.5 ? 1 : -1
        car.d = car.dir === 1 ? 0 : car.road.len
        car.spd = rand(6, 18)
      }
      const { coords, cum } = car.road
      let i = 1
      while (i < cum.length - 1 && cum[i] < car.d) i++
      const segLen = cum[i] - cum[i - 1] || 1
      const f = clamp((car.d - cum[i - 1]) / segLen, 0, 1)
      carFeats.push({
        type: 'Feature',
        properties: { c: car.c },
        geometry: {
          type: 'Point',
          coordinates: [
            coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f,
            coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f,
          ],
        },
      })
    }

    this.map.getSource('amb-clouds')?.setData({ type: 'FeatureCollection', features: cloudFeats })
    this.map.getSource('amb-air')?.setData({ type: 'FeatureCollection', features: airFeats })
    this.map.getSource('amb-cars')?.setData({ type: 'FeatureCollection', features: carFeats })
  }
}
