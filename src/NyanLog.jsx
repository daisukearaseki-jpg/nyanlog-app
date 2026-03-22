import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "./lib/supabase";

/* DB形式 → アプリ形式 */
function dbToApp(row) {
  return {
    id: row.id,
    careId: row.care_id,
    timestamp: row.timestamp,
    memo: row.memo || "",
    largeSyringe: row.large_syringe || 0,
    smallSyringe: row.small_syringe || 0,
  };
}

const CARE_TYPES = [
  { id: "food", label: "ごはん", icon: "🍚", defaultInterval: 8 * 60 * 60 * 1000, btnLabel: "あげた！", color: "#E8A87C", hasSyringe: true },
  { id: "water", label: "お水", icon: "💧", defaultInterval: 6 * 60 * 60 * 1000, btnLabel: "あげた！", color: "#7EC8E3", hasSyringe: true },
  { id: "diaper", label: "おむつ", icon: "🧷", defaultInterval: 4 * 60 * 60 * 1000, btnLabel: "替えた！", color: "#C3B1E1", hasSyringe: false },
  { id: "iron", label: "鉄剤", icon: "💊", defaultInterval: 24 * 60 * 60 * 1000, btnLabel: "あげた！", color: "#F2A3A3", hasSyringe: false },
];

const PRED_N = 7;

function fmt(d) { return new Date(d).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }); }
function fmtD(d) { return new Date(d).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }); }

function elapsedStr(ms) {
  if (ms < 0) return "—";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm > 0 ? `${h}時間${rm}分前` : `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}

function remainStr(ms) {
  if (ms <= 0) return "過ぎています";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `あと${m}分`;
  const h = Math.floor(m / 60), rm = m % 60;
  return rm > 0 ? `あと${h}時間${rm}分` : `あと${h}時間`;
}

function predictInterval(records, careId, def) {
  const f = records.filter(r => r.careId === careId).sort((a, b) => b.timestamp - a.timestamp);
  if (f.length < 2) return def;
  const n = Math.min(f.length - 1, PRED_N);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += f[i].timestamp - f[i + 1].timestamp;
  return Math.round(sum / n);
}

function getLast(records, careId) {
  return records.filter(r => r.careId === careId).sort((a, b) => b.timestamp - a.timestamp)[0] || null;
}

function urgency(nextTime, now) {
  const d = nextTime - now;
  if (d <= 0) return "overdue";
  if (d <= 30 * 60 * 1000) return "soon";
  return "ok";
}

function syringeLabel(rec) {
  if (!rec) return "";
  const p = [];
  if (rec.largeSyringe > 0) p.push(`大×${rec.largeSyringe}`);
  if (rec.smallSyringe > 0) p.push(`小×${rec.smallSyringe}`);
  return p.join("  ");
}

/* ── Counter Component ── */
function Counter({ value, onChange, label }) {
  return (
    <div style={S.counter}>
      <span style={S.counterLabel}>{label}</span>
      <div style={S.counterControls}>
        <button style={S.counterBtn} onClick={() => onChange(Math.max(0, value - 1))}>−</button>
        <span style={S.counterValue}>{value}</span>
        <button style={S.counterBtn} onClick={() => onChange(value + 1)}>＋</button>
      </div>
    </div>
  );
}

/* ── Main App ── */
export default function NyanLog() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [memos, setMemos] = useState({});
  const [syringes, setSyringes] = useState({ food: { large: 0, small: 0 }, water: { large: 0, small: 0 } });
  const [showHistory, setShowHistory] = useState(false);
  const [notifPerm, setNotifPerm] = useState("default");
  const [now, setNow] = useState(Date.now());
  const notifiedRef = useRef(new Set());

  /* Clock */
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);

  const fetchRecords = useCallback(async () => {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("records")
      .select("*")
      .order("timestamp", { ascending: false });
    if (error) {
      console.error("Supabase fetch error:", error);
      return [];
    }
    return (data || []).map(dbToApp);
  }, []);

  /* Load */
  useEffect(() => {
    (async () => {
      try {
        const rows = await fetchRecords();
        setRecords(rows);
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    })();
  }, [fetchRecords]);

  /* Sync poll */
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const rows = await fetchRecords();
        setRecords(rows);
      } catch {}
    }, 20000);
    return () => clearInterval(t);
  }, [fetchRecords]);

  /* Notification permission */
  useEffect(() => { if ("Notification" in window) setNotifPerm(Notification.permission); }, []);
  const requestNotif = async () => { if ("Notification" in window) { const p = await Notification.requestPermission(); setNotifPerm(p); } };

  /* Send notifications */
  useEffect(() => {
    if (notifPerm !== "granted") return;
    CARE_TYPES.forEach(c => {
      const last = getLast(records, c.id);
      if (!last) return;
      const iv = predictInterval(records, c.id, c.defaultInterval);
      const nt = last.timestamp + iv;
      const key = `${c.id}-${last.timestamp}`;
      if (now >= nt && !notifiedRef.current.has(key)) {
        notifiedRef.current.add(key);
        try { new Notification("🐱 にゃんログ", { body: `${c.icon} ${c.label}の時間です！`, tag: key }); } catch {}
      }
    });
  }, [now, records, notifPerm]);

  /* Add record */
  const addRecord = async (careId) => {
    if (!supabase) return;
    const care = CARE_TYPES.find(c => c.id === careId);
    const row = {
      care_id: careId,
      timestamp: Date.now(),
      memo: memos[careId] || "",
      large_syringe: care.hasSyringe ? (syringes[careId]?.large || 0) : 0,
      small_syringe: care.hasSyringe ? (syringes[careId]?.small || 0) : 0,
    };
    const { data, error } = await supabase.from("records").insert(row).select().single();
    if (error) {
      console.error("Supabase insert error:", error);
      return;
    }
    setRecords([dbToApp(data), ...records]);
    setMemos(m => ({ ...m, [careId]: "" }));
    if (care.hasSyringe) setSyringes(p => ({ ...p, [careId]: { large: 0, small: 0 } }));
  };

  const deleteRecord = async (recordId) => {
    if (!supabase) return;
    const { error } = await supabase.from("records").delete().eq("id", recordId);
    if (error) {
      console.error("Supabase delete error:", error);
      return;
    }
    setRecords(records.filter(r => r.id !== recordId));
  };

  if (!isSupabaseConfigured()) return (
    <div style={S.loadWrap}>
      <div style={{ fontSize: 52 }}>🐱</div>
      <p style={{ fontSize: 14, color: "#8B7355", fontFamily: "'Zen Maru Gothic', sans-serif", marginTop: 8, textAlign: "center", padding: "0 24px" }}>
        Supabaseの設定が必要です。<br />
        .env に VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を設定してください。
      </p>
    </div>
  );

  if (loading) return (
    <div style={S.loadWrap}>
      <div style={{ fontSize: 52 }}>🐱</div>
      <p style={{ fontSize: 14, color: "#8B7355", fontFamily: "'Zen Maru Gothic', sans-serif", marginTop: 8 }}>読み込み中...</p>
    </div>
  );

  return (
    <div style={S.container}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@400;500;700;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#FDF6EC}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes glow{0%,100%{box-shadow:0 0 8px rgba(220,53,69,.2)}50%{box-shadow:0 0 22px rgba(220,53,69,.45)}}
        .card{animation:fadeUp .4s ease both}
        .card:nth-child(2){animation-delay:.06s}
        .card:nth-child(3){animation-delay:.12s}
        .card:nth-child(4){animation-delay:.18s}
        .overdue{animation:glow 2s ease-in-out infinite}
        .rbtn:active{transform:scale(.93)}
        .hi{animation:fadeUp .25s ease both}
      `}</style>

      {/* ── Header ── */}
      <header style={S.header}>
        <div style={S.headerRow}><span style={{ fontSize: 30 }}>🐱</span><h1 style={S.title}>にゃんログ</h1></div>
        <p style={S.subtitle}>老猫ケア記録</p>
        {notifPerm !== "granted" && "Notification" in (typeof window !== "undefined" ? window : {}) && (
          <button onClick={requestNotif} style={S.notifBtn}>🔔 通知を許可する</button>
        )}
      </header>

      {/* ── Cards ── */}
      <main style={S.main}>
        {CARE_TYPES.map(care => {
          const last = getLast(records, care.id);
          const iv = predictInterval(records, care.id, care.defaultInterval);
          const nt = last ? last.timestamp + iv : null;
          const urg = nt ? urgency(nt, now) : "ok";
          const el = last ? now - last.timestamp : null;
          const samples = records.filter(r => r.careId === care.id).length;

          return (
            <div key={care.id} className={`card ${urg === "overdue" ? "overdue" : ""}`}
              style={{ ...S.card, borderLeft: `5px solid ${care.color}`, background: urg === "overdue" ? "#FFF0F0" : urg === "soon" ? "#FFFBE6" : "#fff" }}>

              {/* Title row */}
              <div style={S.cardTitle}>
                <span style={{ fontSize: 22 }}>{care.icon}</span>
                <span style={S.cardName}>{care.label}</span>
                {urg === "overdue" && <span style={S.badgeRed}>⚠️ 過ぎてます</span>}
                {urg === "soon" && <span style={S.badgeYellow}>もうすぐ</span>}
              </div>

              {/* Big time display */}
              <div style={S.bigTimeRow}>
                <div style={S.bigTimeBlock}>
                  <span style={S.bigTimeLabel}>最終</span>
                  <div style={S.bigTimeFlex}>
                    <span style={S.bigTime}>{last ? fmt(last.timestamp) : "--:--"}</span>
                    {last && <span style={S.elapsedBadge}>{elapsedStr(el)}</span>}
                  </div>
                </div>
                <div style={S.divider} />
                <div style={S.bigTimeBlock}>
                  <span style={S.bigTimeLabel}>次の予測</span>
                  <div style={S.bigTimeFlex}>
                    <span style={{ ...S.nextTime, color: urg === "overdue" ? "#dc3545" : urg === "soon" ? "#b8860b" : "#5a5a5a" }}>
                      {nt ? fmt(nt) : "--:--"}
                    </span>
                    {nt && (
                      <span style={{ ...S.remainBadge,
                        background: urg === "overdue" ? "#FFD6D6" : urg === "soon" ? "#FFF3CD" : "#E8F5E9",
                        color: urg === "overdue" ? "#c0392b" : urg === "soon" ? "#856404" : "#2e7d32" }}>
                        {remainStr(nt - now)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Accuracy */}
              <div style={S.accRow}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: samples < 2 ? "#ccc" : samples < PRED_N ? "#f0ad4e" : "#5cb85c" }} />
                <span style={S.accText}>
                  {samples < 2 ? "初期値で予測中" : samples < PRED_N ? `学習中（${samples}件）` : `安定予測（直近${PRED_N}件）`}
                </span>
              </div>

              {/* Previous syringe / memo */}
              {last && care.hasSyringe && syringeLabel(last) && <div style={S.prevDetail}>🩺 前回: {syringeLabel(last)}</div>}
              {last?.memo && <div style={S.prevDetail}>💬 {last.memo}</div>}

              {/* Syringe inputs */}
              {care.hasSyringe && (
                <div style={S.syringeRow}>
                  <Counter label="大シリンジ" value={syringes[care.id]?.large || 0}
                    onChange={v => setSyringes(p => ({ ...p, [care.id]: { ...p[care.id], large: v } }))} />
                  <Counter label="小シリンジ" value={syringes[care.id]?.small || 0}
                    onChange={v => setSyringes(p => ({ ...p, [care.id]: { ...p[care.id], small: v } }))} />
                </div>
              )}

              {/* Memo + record button */}
              <div style={S.actionCol}>
                <input type="text" placeholder="メモ（任意）" value={memos[care.id] || ""}
                  onChange={e => setMemos(m => ({ ...m, [care.id]: e.target.value }))} style={S.memoInput} />
                <button className="rbtn" onClick={() => addRecord(care.id)}
                  style={{ ...S.recordBtn, background: care.color }}>{care.btnLabel}</button>
              </div>
            </div>
          );
        })}
      </main>

      {/* ── History ── */}
      <button onClick={() => setShowHistory(!showHistory)} style={S.histToggle}>📋 履歴 {showHistory ? "▲" : "▼"}</button>

      {showHistory && (
        <section style={S.histSection}>
          {records.length === 0 && <p style={S.histEmpty}>まだ記録がありません</p>}
          {records.slice(0, 80).map((rec, i) => {
            const care = CARE_TYPES.find(c => c.id === rec.careId);
            if (!care) return null;
            const isToday = fmtD(Date.now()) === fmtD(rec.timestamp);
            return (
              <div key={`${rec.timestamp}-${i}`} className="hi" style={{ ...S.histItem, animationDelay: `${i * 0.02}s` }}>
                <div style={S.histLeft}>
                  <span style={{ ...S.histDot, background: care.color }} />
                  <div>
                    <div style={S.histTop}>
                      <span style={S.histTime}>{!isToday && <span style={S.histDate}>{fmtD(rec.timestamp)} </span>}{fmt(rec.timestamp)}</span>
                      <span style={S.histCare}>{care.icon} {care.label}</span>
                    </div>
                    {care.hasSyringe && syringeLabel(rec) && <span style={S.histSub}>🩺 {syringeLabel(rec)}</span>}
                    {rec.memo && <span style={S.histSub}>💬 {rec.memo}</span>}
                  </div>
                </div>
                <button onClick={() => deleteRecord(rec.id)} style={S.delBtn}>✕</button>
              </div>
            );
          })}
        </section>
      )}

      <footer style={S.footer}>記録が増えるほど予測が正確になります 🐾</footer>
    </div>
  );
}

/* ── Styles ── */
const S = {
  container: { fontFamily: "'Zen Maru Gothic',sans-serif", maxWidth: 500, margin: "0 auto", padding: "0 0 40px", minHeight: "100vh", background: "#FDF6EC", color: "#3D3226" },
  loadWrap: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#FDF6EC" },

  header: { background: "linear-gradient(135deg,#E8A87C 0%,#D4956B 100%)", padding: "28px 20px 18px", color: "#fff", textAlign: "center", borderRadius: "0 0 24px 24px", boxShadow: "0 4px 20px rgba(232,168,124,.3)", marginBottom: 20 },
  headerRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8 },
  title: { fontSize: 26, fontWeight: 900, letterSpacing: 2 },
  subtitle: { fontSize: 13, opacity: .85, marginTop: 3 },
  notifBtn: { marginTop: 12, background: "rgba(255,255,255,.25)", border: "1px solid rgba(255,255,255,.5)", borderRadius: 20, padding: "6px 16px", color: "#fff", fontSize: 13, cursor: "pointer", fontFamily: "inherit" },

  main: { padding: "0 14px", display: "flex", flexDirection: "column", gap: 14 },
  card: { borderRadius: 16, padding: 16, boxShadow: "0 2px 12px rgba(0,0,0,.06)", transition: "all .3s" },
  cardTitle: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  cardName: { fontSize: 18, fontWeight: 700, flex: 1 },
  badgeRed: { fontSize: 11, fontWeight: 700, background: "#FFD6D6", color: "#c0392b", padding: "3px 10px", borderRadius: 12 },
  badgeYellow: { fontSize: 11, fontWeight: 700, background: "#FFF3CD", color: "#856404", padding: "3px 10px", borderRadius: 12 },

  bigTimeRow: { display: "flex", alignItems: "stretch", background: "#FAF5EE", borderRadius: 12, padding: "12px 8px", marginBottom: 8 },
  bigTimeBlock: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 },
  divider: { width: 1, background: "#E0D5C5", margin: "4px 0" },
  bigTimeLabel: { fontSize: 11, color: "#8B7355", fontWeight: 500, letterSpacing: 1 },
  bigTimeFlex: { display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", justifyContent: "center" },
  bigTime: { fontSize: 32, fontWeight: 900, color: "#3D3226", lineHeight: 1.1 },
  elapsedBadge: { fontSize: 12, fontWeight: 600, color: "#8B7355", background: "#EDE6DA", padding: "2px 8px", borderRadius: 8, whiteSpace: "nowrap" },
  nextTime: { fontSize: 24, fontWeight: 700, lineHeight: 1.1 },
  remainBadge: { fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 8, whiteSpace: "nowrap" },

  accRow: { display: "flex", alignItems: "center", gap: 6, marginBottom: 8, paddingLeft: 4 },
  accText: { fontSize: 11, color: "#8B7355" },

  prevDetail: { fontSize: 12, color: "#6B5B47", background: "#FDF3E7", padding: "5px 10px", borderRadius: 8, marginBottom: 6 },

  syringeRow: { display: "flex", gap: 12, marginBottom: 10, justifyContent: "center" },
  counter: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4 },
  counterLabel: { fontSize: 12, fontWeight: 600, color: "#6B5B47" },
  counterControls: { display: "flex", alignItems: "center", background: "#FAF5EE", borderRadius: 10, overflow: "hidden", border: "1.5px solid #E0D5C5" },
  counterBtn: { width: 40, height: 40, border: "none", background: "transparent", fontSize: 20, fontWeight: 700, cursor: "pointer", color: "#6B5B47", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center" },
  counterValue: { width: 38, textAlign: "center", fontSize: 22, fontWeight: 900, color: "#3D3226" },

  actionCol: { display: "flex", flexDirection: "column", gap: 8 },
  memoInput: { width: "100%", border: "1.5px solid #E0D5C5", borderRadius: 10, padding: "10px 12px", fontSize: 14, fontFamily: "inherit", background: "#FEFCF8", outline: "none", color: "#3D3226" },
  recordBtn: { width: "100%", border: "none", borderRadius: 12, padding: "12px 20px", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "transform .15s", boxShadow: "0 2px 8px rgba(0,0,0,.1)" },

  histToggle: { display: "block", margin: "20px auto 0", background: "none", border: "2px solid #E0D5C5", borderRadius: 20, padding: "8px 24px", fontSize: 15, fontWeight: 500, cursor: "pointer", fontFamily: "'Zen Maru Gothic',sans-serif", color: "#6B5B47" },
  histSection: { margin: "12px 14px 0", background: "#fff", borderRadius: 16, padding: 12, boxShadow: "0 2px 12px rgba(0,0,0,.04)", maxHeight: 420, overflowY: "auto" },
  histEmpty: { textAlign: "center", color: "#aaa", padding: 20, fontSize: 14 },
  histItem: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 8px", borderBottom: "1px solid #F0EBE3" },
  histLeft: { display: "flex", alignItems: "flex-start", gap: 10, flex: 1 },
  histDot: { width: 10, height: 10, borderRadius: "50%", marginTop: 5, flexShrink: 0 },
  histTop: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  histTime: { fontSize: 14, fontWeight: 700 },
  histDate: { fontSize: 11, color: "#8B7355", fontWeight: 400 },
  histCare: { fontSize: 13, color: "#6B5B47" },
  histSub: { fontSize: 11, color: "#8B7355", display: "block", marginTop: 2 },
  delBtn: { background: "none", border: "none", fontSize: 14, color: "#ccc", cursor: "pointer", padding: "4px 8px", borderRadius: 8, flexShrink: 0 },

  footer: { textAlign: "center", padding: "24px 16px 8px", fontSize: 12, color: "#B5A48B" },
};
