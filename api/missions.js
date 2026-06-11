import { MISSIONS } from '../shared/missions.js'

export default function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
  res.status(200).json({ missions: MISSIONS })
}
