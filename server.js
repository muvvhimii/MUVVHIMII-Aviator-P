import express from 'express';
import { neon } from '@neondatabase/serverless';

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static('.'));

function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(process.env.DATABASE_URL);
}

function cleanUserCode(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return /^[A-Za-z0-9_-]{3,80}$/.test(v) ? v : null;
}

app.post('/api/session', async (req, res) => {
  try {
    const userCode = cleanUserCode(req.body?.user_code);
    if (!userCode) return res.status(400).json({ error: 'Invalid user_code' });
    const sql = db();
    const rows = await sql`
      INSERT INTO public.app_users (user_code)
      VALUES (${userCode})
      ON CONFLICT (user_code) DO UPDATE SET user_code = EXCLUDED.user_code
      RETURNING id, user_code, created_at
    `;
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Unable to create session' });
  }
});

app.post('/api/rounds', async (req, res) => {
  try {
    const multiplier = Number(req.body?.multiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0) return res.status(400).json({ error: 'Invalid multiplier' });
    const sql = db();
    const rows = await sql`
      INSERT INTO public.aviator_rounds (round_code, multiplier, observed_at, source)
      VALUES (${req.body?.round_code ?? null}, ${multiplier}, COALESCE(${req.body?.observed_at ?? null}::timestamptz, now()), ${req.body?.source ?? 'manual'})
      RETURNING *
    `;
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Unable to record round' });
  }
});

app.get('/api/rounds', async (_req, res) => {
  try {
    const sql = db();
    const rows = await sql`
      SELECT id, round_code, multiplier, observed_at, source
      FROM public.aviator_rounds
      ORDER BY observed_at DESC
      LIMIT 50
    `;
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Unable to load rounds' });
  }
});

app.post('/api/predictions', async (req, res) => {
  try {
    const sql = db();
    const confidence = Number(req.body?.confidence ?? 0);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) return res.status(400).json({ error: 'Invalid confidence' });
    const rows = await sql`
      INSERT INTO public.aviator_predictions
        (round_id, prediction_type, predicted_value, predicted_min, predicted_max, confidence, model_version, features)
      VALUES
        (${req.body?.round_id ?? null}, ${req.body?.prediction_type ?? 'range'}, ${req.body?.predicted_value ?? '2.00x-3.00x'}, ${req.body?.predicted_min ?? null}, ${req.body?.predicted_max ?? null}, ${confidence}, ${req.body?.model_version ?? 'v0.1'}, ${JSON.stringify(req.body?.features ?? {})}::jsonb)
      RETURNING *
    `;
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Unable to save prediction' });
  }
});

app.post('/api/feedback', async (req, res) => {
  try {
    const outcome = req.body?.outcome;
    if (!['success', 'fail'].includes(outcome)) return res.status(400).json({ error: 'Outcome must be success or fail' });
    const userCode = cleanUserCode(req.body?.user_code);
    const sql = db();
    const users = userCode ? await sql`SELECT id FROM public.app_users WHERE user_code = ${userCode} LIMIT 1` : [];
    const rows = await sql`
      INSERT INTO public.aviator_prediction_feedback
        (prediction_id, user_id, outcome, actual_multiplier)
      VALUES
        (${req.body.prediction_id}, ${users[0]?.id ?? null}, ${outcome}, ${req.body?.actual_multiplier ?? null})
      RETURNING *
    `;
    await sql`
      UPDATE public.aviator_predictions
      SET status = ${outcome}, resolved_at = now()
      WHERE id = ${req.body.prediction_id}
    `;
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Unable to record feedback' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'MUVVHIMII Aviator API' }));

app.get('/api/performance', async (_req, res) => {
  try {
    const sql = db();
    const rows = await sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE outcome = 'success')::int AS successes,
        COUNT(*) FILTER (WHERE outcome = 'fail')::int AS fails,
        ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'success') / NULLIF(COUNT(*),0), 2) AS success_rate
      FROM public.aviator_prediction_feedback
    `;
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Unable to load performance' });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => console.log(`MUVVHIMII server listening on :${port}`));
