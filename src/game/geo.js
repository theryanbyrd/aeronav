// Shared geo math used by the flight engine and the ambient world system.

export const EARTH_M_PER_DEG_LAT = 111320

export const toRad = (d) => (d * Math.PI) / 180
export const toDeg = (r) => (r * 180) / Math.PI
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
export const lerp = (a, b, t) => a + (b - a) * t

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

// Offset a [lng, lat] point by meters east (dxM) and north (dyM).
export function offsetM([lng, lat], dxM, dyM) {
  return [
    lng + dxM / (EARTH_M_PER_DEG_LAT * Math.cos(toRad(lat))),
    lat + dyM / EARTH_M_PER_DEG_LAT,
  ]
}

export function circlePolygon(center, radiusM, steps = 28) {
  const ring = []
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    ring.push(offsetM(center, Math.cos(t) * radiusM, Math.sin(t) * radiusM))
  }
  return { type: 'Polygon', coordinates: [ring] }
}

// Place a local-meter silhouette (points as [xEast, yNorth], +y = nose) on the
// map at `center`, rotated to `headingDeg` (clockwise from north).
export function shapeToPolygon(center, ptsM, headingDeg, scale = 1) {
  const h = toRad(headingDeg)
  const cos = Math.cos(h)
  const sin = Math.sin(h)
  const ring = ptsM.map(([x, y]) =>
    offsetM(center, (x * cos + y * sin) * scale, (-x * sin + y * cos) * scale)
  )
  ring.push(ring[0])
  return { type: 'Polygon', coordinates: [ring] }
}

export function pointInRing(pt, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}
