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
  try {
    const { rows } = await pool.query("select v from kv where k=$1", [req.params.k]);
    res.json(rows.length ? { value: rows[0].v } : null);
  } catch (e) {
    console.error("[kv get] error:", e.message);
    res.status(503).json({ error: "db unavailable" });
  }
});

app.put("/api/kv/:k", async (req, res) => {
  try {
    const v = (req.body && req.body.value) || "";
    await pool.query(
      `insert into kv(k,v) values($1,$2)
       on conflict(k) do update set v=excluded.v, updated_at=now()`,
      [req.params.k, v]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[kv put] error:", e.message);
    res.status(503).json({ error: "db unavailable" });
  }
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
              { text: 'Read this golf scorecard photo. Return ONLY valid JSON, no markdown, no explanation:\n{"tees":["TeeNameA","TeeNameB"],"holes":[{"no":1,"par":4,"yds":[ydA,ydB]},...]}\n- "tees": all tee names found, in the order they appear\n- "holes": all 18 holes, "yds" aligned to "tees" array order, null if missing\n- Numbers only, no units' },
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

/* ===== AI coach: game plan (整场博弈层) + training plan (训练计划) ===== */
function buildCoachPrompt(kind, p) {
  const course = p.course || {};
  const holes = (course.holes || [])
    .map(h => `${h.no}号 Par${h.par} ${h.yards ?? "?"}码`)
    .join("；");
  const bag = (p.bag || [])
    .map(c => `${c.name} ${c.total}码(carry ${c.carry})`)
    .join("，");
  const meta = [
    course.name ? `球场：${course.name}` : "",
    course.rating ? `球场评级 ${course.rating}` : "",
    course.slope ? `坡度 ${course.slope}` : "",
    p.tee ? `Tee：${p.tee}` : "",
  ].filter(Boolean).join(" · ");

  const d = p.digest || {};
  let stats;
  if (!d.hasData) {
    stats = "（暂无历史记录数据，按球场与球包合理推断，并提示先去记录几轮以便后续精调）";
  } else {
    const weak = (d.weakHoles || []).map(h => `${h.no}号(对标准杆+${h.avg}，${h.n}次)`).join("、");
    const strong = (d.strongHoles || []).map(h => `${h.no}号(${h.avg})`).join("、");
    const clubs = (d.clubs || [])
      .map(c => `${c.club} 均${c.avg ?? "?"}码 离散±${c.spread ?? "?"} 左${c.left}/右${c.right} 短${c.shortN}/长${c.longN}`)
      .join("；");
    stats = [
      `已记录 ${d.rounds} 轮 / ${d.holesPlayed} 洞`,
      d.fir != null ? `球道命中率 ${d.fir}%` : "",
      d.gir != null ? `标准上果岭率 ${d.gir}%` : "",
      d.scrambling != null ? `救球成功率 ${d.scrambling}%` : "",
      d.sandSave != null ? `沙坑救球率 ${d.sandSave}%` : "",
      d.puttsPerHole != null ? `每洞推杆 ${d.puttsPerHole}` : "",
      d.penalties ? `累计罚杆 ${d.penalties}` : "",
      weak ? `最弱洞：${weak}` : "",
      strong ? `最强洞：${strong}` : "",
      clubs ? `各杆表现：${clubs}` : "",
    ].filter(Boolean).join("；");
  }

  if (kind === "gameplan") {
    return `你是经验丰富的高尔夫球场策略教练。基于以下信息，为这位球员制定一份"整场博弈方案"：把 18 洞分类为 score(得分洞,主动争 birdie)/adv(优势洞,稳 par)/hard(困难洞,接受 bogey 不强攻)，并给出达成目标分数的得分路径与逐洞定位。

${meta}
目标分数：${p.target || "未指定（按稳健进步推断）"}
逐洞：${holes}
球包：${bag}
球员数据：${stats}

只输出一个 JSON 对象，不要任何解释或 markdown 代码块，结构严格如下：
{"target":"目标分数字符串","summary":"一句话总览策略","path":[{"icon":"emoji","text":"得分来源说明","delta":"如 -2 / ±0 / +2"}],"holes":[{"no":洞号数字,"par":数字,"yards":数字,"klass":"score|adv|hard","tee_club":"开球建议用杆","plan":"该洞策略目标一句话","note":"可选关键提醒，可空字符串"}],"notes":["整场注意事项"]}
holes 必须覆盖全部 ${(course.holes || []).length} 洞。所有文字用简体中文。`;
  }

  // trainplan
  const prefs = p.prefs || {};
  const facMap = { range: "练习场", green: "果岭区", course: "可下场" };
  const fac = (prefs.facilities || []).map(f => facMap[f] || f).join("、") || "练习场、果岭区";
  const modeTxt = p.mode === "prep"
    ? `备赛冲刺模式，距比赛约 ${p.weeksToEvent || "?"} 周，需周期化（前期建基础→中期整合→末周减量 taper 保持手感）`
    : "日常提升模式，无指定比赛，产出一份针对当前数据短板的滚动周计划（1~2 周）";

  return `你是经验丰富的高尔夫训练教练。基于球场特征与球员真实数据，制定一份高度针对性的训练计划——把练习重心收窄到真正影响这个球场成绩的部分，而不是平均用力。困难洞不强攻、短打与 wedge 优先、按数据补最弱环节。

模式：${modeTxt}
${meta}
目标分数：${p.target || "未指定"}
逐洞：${holes}
球包：${bag}
球员数据：${stats}
训练条件：每周可练 ${prefs.daysPerWeek || 4} 天、每天约 ${prefs.hoursPerDay || 2} 小时、设施：${fac}${prefs.focusNote ? `；球员自评：${prefs.focusNote}` : ""}

只输出一个 JSON 对象，不要任何解释或 markdown 代码块，结构严格如下：
{"mode":"${p.mode || "ongoing"}","title":"计划标题","target":"目标分数字符串","subtitle":"球场与评级副标题","weeksToEvent":${p.weeksToEvent || null},"analysis":{"hardest":[{"label":"如 5号 365/4","detail":"为何难/怎么打"}],"easiest":[{"label":"洞","detail":"为何易/怎么得分"}],"insight":"基于数据的关键判断"},"focus":[{"rank":1,"title":"训练重点","detail":"具体说明","pct":"如 40%"}],"skip":["暂时不练的项"],"path":[{"icon":"emoji","text":"得分路径说明","delta":"如 -2"}],"weeks":[{"n":1,"title":"本周主题","summary":"本周说明","goal":"本周结束标准","days":[{"label":"周一","title":"当日主题","time":"如 2.5h","rest":false,"restNote":"","sessions":[{"icon":"emoji","name":"训练块名","dur":"如 50分钟","drills":[{"text":"drill 说明","note":"可选要点","tag":"可选 如 得分洞"}]}],"focus":"本日重点,可空"}]}]}
休息日用 {"label":"周二","rest":true,"restNote":"休息内容"}。每周 days 数量贴合"每周可练天数"，其余为休息。所有文字用简体中文。`;
}

app.post("/api/coach", async (req, res) => {
  try {
    const { kind, payload } = req.body || {};
    if (kind !== "gameplan" && kind !== "trainplan") throw new Error("invalid kind");
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
    const prompt = buildCoachPrompt(kind, payload || {});
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.7,
            thinkingConfig: { thinkingBudget: 0 }, // 关闭思考，显著提速（结构由 prompt 约束）
          },
        }),
      }
    );
    const data = await r.json();
    if (!r.ok || !data.candidates) {
      const detail = JSON.stringify(data).slice(0, 600);
      console.error("[coach] Gemini API error:", detail);
      throw new Error("Gemini API error: " + detail);
    }
    const candidate = data.candidates[0];
    if (!candidate.content || !candidate.content.parts) {
      const detail = JSON.stringify(candidate).slice(0, 400);
      console.error("[coach] no content:", detail);
      throw new Error("no content (finishReason=" + candidate.finishReason + "): " + detail);
    }
    const raw = candidate.content.parts[0].text;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("no json in response: " + raw.slice(0, 300));
      parsed = JSON.parse(m[0]);
    }
    res.json(parsed);
  } catch (e) {
    console.error("[coach] error:", e.message);
    res.status(500).json({ error: String(e) });
  }
});

app.listen(process.env.PORT || 8080, () => console.log("yardage-caddie up"));
