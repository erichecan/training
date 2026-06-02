import express from "express";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(express.static("public"));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.get("/api/kv/:k", async (req, res) => {
  const { rows } = await pool.query("select v from kv where k=$1", [req.params.k]);
  res.json(rows.length ? { value: rows[0].v } : null);
});

app.put("/api/kv/:k", async (req, res) => {
  const v = (req.body && req.body.value) || "";
  await pool.query(
    `insert into kv(k,v) values($1,$2)
     on conflict(k) do update set v=excluded.v, updated_at=now()`,
    [req.params.k, v]
  );
  res.json({ ok: true });
});

app.post("/api/scan", async (req, res) => {
  try {
    const { image, media_type } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: media_type, data: image } },
              { text: 'Read this golf scorecard photo. For holes 1-18 return ONLY compact JSON, no markdown: {"t":["TeeName"],"h":[[holeNo,par,yd], ...18]} aligned to t, null for missing. Numbers only.' },
            ],
          }],
        }),
      }
    );
    const data = await r.json();
    if (!r.ok || !data.candidates) {
      const detail = JSON.stringify(data).slice(0, 600);
      console.error("[scan] Gemini API error:", detail);
      throw new Error("Gemini API error: " + detail);
    }
    const candidate = data.candidates[0];
    if (!candidate.content || !candidate.content.parts) {
      const detail = JSON.stringify(candidate).slice(0, 400);
      console.error("[scan] no content in candidate:", detail);
      throw new Error("no content (finishReason=" + candidate.finishReason + "): " + detail);
    }
    const raw = candidate.content.parts[0].text;
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no json in response: " + raw.slice(0, 300));
    res.json(JSON.parse(m[0]));
  } catch (e) {
    console.error("[scan] error:", e.message);
    res.status(500).json({ error: String(e) });
  }
});

app.listen(process.env.PORT || 8080, () => console.log("yardage-caddie up"));
