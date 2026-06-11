// In-memory leaderboard. Ephemeral by design (resets on cold start) — it
// exists to demo the Node API layer; swap for KV/Postgres for persistence.
globalThis.__aeronavScores = globalThis.__aeronavScores || []

export default function handler(req, res) {
  const scores = globalThis.__aeronavScores

  if (req.method === 'POST') {
    const { name, missionId, score, timeMs } = req.body || {}
    if (
      typeof missionId !== 'string' ||
      !Number.isFinite(score) ||
      !Number.isFinite(timeMs)
    ) {
      return res.status(400).json({ error: 'invalid payload' })
    }
    scores.push({
      name: String(name || 'PILOT').slice(0, 16),
      missionId: missionId.slice(0, 32),
      score: Math.round(score),
      timeMs: Math.round(timeMs),
      at: Date.now(),
    })
    scores.sort((a, b) => b.score - a.score)
    scores.length = Math.min(scores.length, 100)
    return res.status(201).json({ ok: true })
  }

  const missionId = req.query?.missionId
  const top = (missionId ? scores.filter((s) => s.missionId === missionId) : scores).slice(0, 10)
  res.status(200).json({ scores: top })
}
