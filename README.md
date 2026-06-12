# 🌍 AeroNav — Real-World Flight Navigator

A full-screen arcade flight game over the **real world**. Fly checkpoint missions
through actual landmarks in New York, Paris, Tokyo, London, San Francisco, and
Dubai — rendered live from OpenStreetMap vector tiles with 3D extruded
buildings, real elevation terrain, globe projection, and atmospheric sky.
No API keys required.

**Play it live:** deployed on Vercel (see repo About link)

## How to play

| Key | Action |
| --- | --- |
| `W` / `S` | Throttle up / down |
| `A` / `D` (or `←` / `→`) | Turn (banked) |
| `↑` / `↓` | Climb / dive |
| `Shift` | Afterburner boost |
| `Space` | Airbrake |
| `Esc` | Abort to world map |

Fly through the cyan beacon beams in order. Beat the par time for a score bonus.

## Living world

- **Weather** — each mission rolls clear / scattered / overcast / fog conditions:
  matching sky + atmospheric haze, and drifting volumetric clouds you can fly
  straight through (full cockpit whiteout inside).
- **NPCs** — cars drive along real OSM roads pulled from the vector tiles,
  AI air traffic crosses at altitude, bird flocks wander below you, and trees
  are scattered inside real parks and woodland polygons.

## Stack

- **React 18 + Vite** — UI, HUD, menus
- **MapLibre GL JS v5** — globe projection, 3D terrain, fill-extrusion buildings,
  true camera-position flight via `calculateCameraOptionsFromCameraLngLatAltRotation`
- **OpenFreeMap** — keyless OpenStreetMap vector tiles (Liberty style)
- **AWS Open Data terrain tiles** — real elevation (Terrarium encoding)
- **Node serverless functions** (`/api`) on Vercel — mission data + ephemeral leaderboard

## Develop

```bash
npm install
npm run dev        # frontend only (missions fall back to bundled data)
vercel dev         # frontend + Node API routes
```

## Deploy

```bash
vercel --prod
```

Map data © OpenStreetMap contributors. Terrain: USGS/NASA via AWS Open Data.
