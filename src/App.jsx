import { useState, useCallback, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

// ─── BRAND ────────────────────────────────────────────────────────────────────
const R = "#E8192C";
const BK = "#1A1A1A";
const GRAY = "#6B6B6B";
const LGRAY = "#F2F2F2";
const WHITE = "#FFFFFF";

const ASSET_COLORS = {
  Multifamily: "#E8192C", "Mixed-Use": "#FF6B35", Development: "#F5A623",
  Retail: "#2C3E50", Industrial: "#7F8C8D", Office: "#3D5A80", Other: "#BDC3C7",
};

// ─── DATA LOGIC ───────────────────────────────────────────────────────────────
const ZIP_NBD = {
  "11201":"Brooklyn Heights","11202":"Brooklyn Heights","11203":"East Flatbush",
  "11204":"Borough Park","11205":"Fort Greene","11206":"Bushwick","11207":"East New York",
  "11208":"East New York","11209":"Bay Ridge","11210":"Flatbush","11211":"Williamsburg",
  "11212":"Brownsville","11213":"Crown Heights","11214":"Bensonhurst","11215":"Park Slope",
  "11216":"Bed-Stuy","11217":"Boerum Hill","11218":"Kensington","11219":"Borough Park",
  "11220":"Sunset Park","11221":"Bed-Stuy","11222":"Greenpoint","11223":"Gravesend",
  "11224":"Coney Island","11225":"Crown Heights","11226":"Flatbush","11228":"Dyker Heights",
  "11229":"Sheepshead Bay","11230":"Midwood","11231":"Carroll Gardens","11232":"Sunset Park",
  "11233":"Brownsville","11234":"Canarsie","11235":"Brighton Beach","11236":"Canarsie",
  "11237":"Bushwick","11238":"Prospect Heights","11239":"East New York",
  "11101":"Long Island City","11102":"Astoria","11103":"Astoria","11104":"Sunnyside",
  "11105":"Astoria","11106":"Astoria","11354":"Flushing","11355":"Flushing",
  "11356":"College Point","11357":"Whitestone","11358":"Fresh Meadows","11361":"Bayside",
  "11362":"Little Neck","11363":"Little Neck","11364":"Oakland Gardens",
  "11365":"Fresh Meadows","11366":"Fresh Meadows","11367":"Kew Gardens Hills",
  "11368":"Corona","11369":"East Elmhurst","11370":"East Elmhurst",
  "11371":"East Elmhurst","11372":"Jackson Heights","11373":"Elmhurst",
  "11374":"Rego Park","11375":"Forest Hills","11377":"Woodside","11378":"Maspeth",
  "11379":"Middle Village","11385":"Ridgewood","11411":"Cambria Heights",
  "11412":"St. Albans","11413":"Springfield Gardens","11414":"Howard Beach",
  "11415":"Kew Gardens","11416":"Ozone Park","11417":"Ozone Park",
  "11418":"Richmond Hill","11419":"South Ozone Park","11420":"South Ozone Park",
  "11421":"Woodhaven","11422":"Rosedale","11423":"Hollis","11426":"Bellerose",
  "11427":"Queens Village","11428":"Queens Village","11429":"Queens Village",
  "11432":"Jamaica","11433":"Jamaica","11434":"Jamaica","11435":"Jamaica",
  "11436":"Jamaica","11691":"Far Rockaway","11692":"Arverne","11694":"Rockaway Park",
};

function extractCode(bc) {
  if (!bc) return "";
  // Grab the LAST parenthetical — that contains the actual building code
  // e.g. "Multi-Story Retail Building (2 or More) (K2)" -> "K2"
  const matches = [...String(bc).matchAll(/\(([^)]+)\)/g)];
  if (!matches.length) return "";
  return matches[matches.length - 1][1].trim();
}

function classifyAsset(bc) {
  const code = extractCode(bc);
  if (!code) return "Other";
  const L = code[0];

  // FILTER: 1-family (A*), 2-family (B*), 1/2-family with store (S1, S2)
  if (L === "A") return null;
  if (L === "B") return null;
  if (code === "S1" || code === "S2") return null;

  // DEVELOPMENT SITES
  if (code === "V0" || code === "V1") return "Development";

  // MULTIFAMILY — pure residential 3+ units
  if (["C0","C1","C2","C3","C4","C5","C6"].includes(code)) return "Multifamily";
  // S3-S5 = 3 to 6-family with one store (res-dominant)
  if (["S3","S4","S5"].includes(code)) return "Mixed-Use";

  // MIXED-USE — residential with meaningful commercial component
  if (code === "C7" || code === "S9") return "Mixed-Use";
  if (code === "R8") return "Mixed-Use";

  // RETAIL — all K* store types, G* auto/garage
  if (L === "K") return "Retail";
  if (L === "G") return "Retail";

  // INDUSTRIAL — E* warehouses, F* factories
  if (L === "E" || L === "F") return "Industrial";

  // OFFICE — all O* types
  if (L === "O") return "Office";

  // OTHER — hotels (H*), institutional (I*), religious (M*), utility (U*), misc (W*, Z*)
  return "Other";
}

function parseAddr(addr) {
  if (!addr) return { borough: "Unknown", neighborhood: "", zip: "" };
  const bors = ["Brooklyn","Queens","Manhattan","Bronx","Staten Island"];
  let borough = "Unknown";
  for (const b of bors) { if (addr.includes(b)) { borough = b; break; } }
  const zm = addr.match(/\b(\d{5})\b/);
  const zip = zm ? zm[1] : "";
  return { borough, neighborhood: ZIP_NBD[zip] || "", zip };
}

const fmt = (n) => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n?.toLocaleString()}`;
};

// ─── AI HELPER ──────────────────────────────────────────────────────────────
const MODEL_MAP = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-20250514",
};

async function callClaude({ model = "sonnet", messages, system, tools, maxTokens = 2048, betas }) {
  const body = { model: MODEL_MAP[model] || model, max_tokens: maxTokens, messages };
  if (system) body.system = system;
  if (tools) body.tools = tools;
  if (betas) body.betas = betas;

  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (resp.status === 429) {
        const wait = Math.min(2000 * Math.pow(2, attempt), 15000);
        await new Promise(r => setTimeout(r, wait));
        lastErr = `Rate limited (429)`;
        continue;
      }
      const json = await resp.json();
      if (!resp.ok) {
        return { ok: false, error: json.error?.message || json.message || `HTTP ${resp.status}`, status: resp.status };
      }
      let text = "";
      for (const block of (json.content || [])) {
        if (block.type === "text") text = block.text;
      }
      return { ok: true, text, raw: json };
    } catch (err) {
      lastErr = err.message;
    }
  }
  return { ok: false, error: lastErr || "Request failed after retries" };
}

// ─── LOCALSTORAGE HELPERS ───────────────────────────────────────────────────
function saveHistory(period, summary) {
  try {
    const key = `schuckman_history_${period.replace(/\s+/g, "_")}`;
    localStorage.setItem(key, JSON.stringify({ ...summary, savedAt: Date.now() }));
  } catch (_) {}
}

function loadAllHistory() {
  const results = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("schuckman_history_")) {
        const val = JSON.parse(localStorage.getItem(key));
        if (val) results.push(val);
      }
    }
  } catch (_) {}
  return results.sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
}

function getCachedEntity(name) {
  try {
    const key = `schuckman_entity_${name.toLowerCase().trim().replace(/[^a-z0-9]/g, "_")}`;
    const val = JSON.parse(localStorage.getItem(key));
    if (val && Date.now() - val.cachedAt < 7 * 24 * 60 * 60 * 1000) return val;
  } catch (_) {}
  return null;
}

function cacheEntity(name, data) {
  try {
    const key = `schuckman_entity_${name.toLowerCase().trim().replace(/[^a-z0-9]/g, "_")}`;
    localStorage.setItem(key, JSON.stringify({ ...data, cachedAt: Date.now() }));
  } catch (_) {}
}

function processSheets(workbook) {
  const XLSX = window._XLSX;
  let allRows = [];
  let sheetDates = [];

  for (const name of workbook.SheetNames) {
    sheetDates.push(name);
    const ws = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    for (let i = 1; i < rows.length; i++) allRows.push(rows[i]);
  }

  let txns = [];
  for (const row of allRows) {
    const [addr,,dateClosed,,price,buyer,seller,bc,zoning,,lotSqft,sqft,resUnits,,totalUnits,floors] = row;
    if (!addr || addr.length < 5) continue;
    if (!price || typeof price !== "number" || price < 1000000) continue;
    const assetClass = classifyAsset(bc);
    if (assetClass === null) continue;
    const { borough, neighborhood, zip } = parseAddr(String(addr));
    txns.push({ addr: String(addr), dateClosed, price, buyer, seller, bc, assetClass, zoning,
      lotSqft, sqft, resUnits, totalUnits, floors, borough, neighborhood, zip,
      isPortfolio: false, portfolioId: null });
  }

  // Portfolio detection: same buyer + same close date
  const groups = {};
  for (const t of txns) {
    const key = `${(t.buyer || "").toLowerCase().trim()}|||${t.dateClosed}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }

  const portfolios = [];
  let pid = 1;
  for (const grp of Object.values(groups)) {
    if (grp.length < 2) continue;
    const id = `P${pid++}`;
    const uniquePrices = [...new Set(grp.map(t => t.price))];
    const totalPrice = uniquePrices.reduce((s, p) => s + p, 0);
    grp.forEach(t => { t.isPortfolio = true; t.portfolioId = id; });
    portfolios.push({ id, buyer: grp[0].buyer, count: grp.length, totalPrice,
      assetClass: grp[0].assetClass, borough: grp[0].borough,
      date: grp[0].dateClosed, properties: grp.map(t => t.addr) });
  }

  // Deduplicate: portfolio = 1 representative row
  const seen = new Set();
  const deduped = txns.filter(t => {
    if (!t.isPortfolio) return true;
    if (seen.has(t.portfolioId)) return false;
    seen.add(t.portfolioId);
    return true;
  });

  // Get correct price for portfolio entries
  const getPrice = (t) => {
    if (t.isPortfolio) {
      const p = portfolios.find(p => p.id === t.portfolioId);
      return p ? p.totalPrice : t.price;
    }
    return t.price;
  };

  const totalVolume = deduped.reduce((s, t) => s + getPrice(t), 0);
  const prices = deduped.map(t => getPrice(t)).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)] || 0;

  const assetOrder = ["Multifamily","Mixed-Use","Development","Retail","Industrial","Office","Other"];
  const byAsset = assetOrder.map(cls => ({
    name: cls,
    count: deduped.filter(t => t.assetClass === cls).length,
    volume: deduped.filter(t => t.assetClass === cls).reduce((s, t) => s + getPrice(t), 0),
  })).filter(c => c.count > 0);

  const boroughOrder = ["Brooklyn","Queens","Manhattan","Bronx","Staten Island"];
  const byBorough = boroughOrder.map(b => ({
    name: b, short: b === "Staten Island" ? "SI" : b.slice(0, 3).toUpperCase(),
    count: deduped.filter(t => t.borough === b).length,
    volume: deduped.filter(t => t.borough === b).reduce((s, t) => s + getPrice(t), 0),
  })).filter(b => b.count > 0).sort((a, b) => b.volume - a.volume);

  const topDeals = [...deduped].sort((a, b) => getPrice(b) - getPrice(a)).slice(0, 5)
    .map(t => ({ ...t, displayPrice: getPrice(t) }));

  const getTopNbds = (borough) => {
    const map = {};
    deduped.filter(t => t.borough === borough && t.neighborhood).forEach(t => {
      if (!map[t.neighborhood]) map[t.neighborhood] = { count: 0, volume: 0 };
      map[t.neighborhood].count++;
      map[t.neighborhood].volume += getPrice(t);
    });
    return Object.entries(map).sort((a, b) => b[1].volume - a[1].volume)
      .slice(0, 6).map(([name, d]) => ({ name, ...d }));
  };

  // Derive period label from sheet names
const monthCounts = {};
  for (const name of sheetDates) {
    const m = name.trim().match(/^(\d+)\./);
    if (m) monthCounts[m[1]] = (monthCounts[m[1]] || 0) + 1;
  }
  const dominantMonth = Object.entries(monthCounts).sort((a,b) => b[1]-a[1])[0]?.[0] || "1";
  const monthMap = { "1":"January","2":"February","3":"March","4":"April","5":"May","6":"June",
    "7":"July","8":"August","9":"September","10":"October","11":"November","12":"December" };
  const last = sheetDates[sheetDates.length - 1] || "";
  const ymatch = last.match(/(\d{2})$/);
  const period = `${monthMap[dominantMonth]} ${ymatch ? "20"+ymatch[1] : ""} Report`.trim();

  return { txns, portfolios, deduped, totalVolume, median,
    count: deduped.length, byAsset, byBorough, topDeals,
    bkNbds: getTopNbds("Brooklyn"), qnsNbds: getTopNbds("Queens"),
    devCount: deduped.filter(t => t.assetClass === "Development").length,
    portfolioCount: portfolios.length, period, filteredCount: txns.length };
}

// ─── LOGO ──────────────────────────────────────────────────────────────────────
function SchuckmanLogo({ size = "md", mono = false }) {
  const sizes = {
    sm: { fs: 20, sub: 7, gap: 2 },
    md: { fs: 30, sub: 9, gap: 3 },
    lg: { fs: 42, sub: 12, gap: 4 }
  };
  const s = sizes[size];
  const subColor = mono ? WHITE : BK;
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: s.gap, lineHeight: 1, alignItems: "center" }}>
      <div style={{ fontFamily: "'Arial Black', 'Franklin Gothic Heavy', 'Impact', sans-serif",
        fontWeight: 900, fontSize: s.fs, color: R, letterSpacing: "-0.5px", lineHeight: 1 }}>
        SCHUCKMAN
      </div>
      <div style={{ fontFamily: "'Arial', sans-serif", fontWeight: 400, fontSize: s.sub,
        color: subColor, letterSpacing: "5px", lineHeight: 1, textAlign: "center" }}>
        REALTY INC.
      </div>
    </div>
  );
}

// ─── STAT CARD ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background: WHITE, border: `1px solid #E8E8E8`, borderRadius: 8,
      padding: "16px 20px", borderTop: `3px solid ${accent || R}` }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: GRAY, letterSpacing: "1px",
        textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: BK, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: GRAY, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ─── INSTAGRAM SLIDE ───────────────────────────────────────────────────────────
function IGSlide({ children, bg = WHITE, style = {} }) {
  return (
    <div style={{ width: 540, height: 540, background: bg, overflow: "hidden",
      flexShrink: 0, display: "flex", flexDirection: "column", position: "relative",
      fontFamily: "'Arial', sans-serif", boxShadow: "0 4px 24px rgba(0,0,0,0.12)", ...style }}>
      {children}
    </div>
  );
}

function IGHeader({ period, mono = true }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      padding: "20px 24px 0" }}>
      <SchuckmanLogo size="sm" mono={mono} />
      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "1.5px",
        color: mono ? "rgba(255,255,255,0.7)" : GRAY, textTransform: "uppercase",
        textAlign: "right", lineHeight: 1.4 }}>
        NYC INVESTMENT SALES<br />{period?.toUpperCase()}
      </div>
    </div>
  );
}

function IGFooter({ mono = true }) {
  return (
    <div style={{ padding: "0 24px 16px", display: "flex", justifyContent: "space-between",
      alignItems: "center", marginTop: "auto" }}>
      <div style={{ fontSize: 8, color: mono ? "rgba(255,255,255,0.4)" : "#BBB",
        letterSpacing: "1px" }}>SOURCE: PROPERTYSHARK · $1M+ ONLY</div>
      <div style={{ fontSize: 8, color: mono ? "rgba(255,255,255,0.4)" : "#BBB",
        letterSpacing: "1px" }}>SCHUCKMANREALTY.COM</div>
    </div>
  );
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function SchuckmanAnalyzer() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("instagram");
  const [slideIdx, setSlideIdx] = useState(0);
  const [xlsxReady, setXlsxReady] = useState(false);
  const fileRef = useRef();

  // Lazy-load SheetJS
  const ensureXLSX = useCallback(() => new Promise((res, rej) => {
    if (window._XLSX) return res();
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => { window._XLSX = window.XLSX; setXlsxReady(true); res(); };
    s.onerror = rej;
    document.head.appendChild(s);
  }), []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setLoading(true);
    try {
      await ensureXLSX();
      const buf = await file.arrayBuffer();
      const wb = window._XLSX.read(buf, { type: "array" });
      const result = processSheets(wb);
      setData(result);
      setTab("instagram");
      setSlideIdx(0);
      // Save summary to localStorage for trend analysis
      saveHistory(result.period, {
        period: result.period,
        totalVolume: result.totalVolume,
        count: result.count,
        median: result.median,
        byAsset: result.byAsset,
        byBorough: result.byBorough,
        devCount: result.devCount,
        portfolioCount: result.portfolioCount,
        bkNbds: result.bkNbds?.slice(0, 4),
        qnsNbds: result.qnsNbds?.slice(0, 4),
      });
    } catch (e) {
      alert("Error reading file: " + e.message);
    }
    setLoading(false);
  }, [ensureXLSX]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  const TABS = [
    { id: "instagram", label: "📱 Instagram Slides" },
    { id: "article", label: "📰 Website Article" },
    { id: "team", label: "📊 Team Report" },
    { id: "devintel", label: "🔍 Dev Intelligence" },
    { id: "entities", label: "🏢 Entity Intel" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#F0F0F0", fontFamily: "'Arial', sans-serif" }}>
      {/* TOP BAR */}
      <div style={{ background: BK, padding: "0 32px", display: "flex",
        alignItems: "center", justifyContent: "space-between", height: 60 }}>
        <SchuckmanLogo size="sm" mono={true} />
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: "2px",
          textTransform: "uppercase" }}>Schuckman · NYC Investment Sales Analyzer</div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
        {/* UPLOAD */}
        {!data && (
          <div onDrop={onDrop} onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            style={{ background: WHITE, border: `2px dashed #CCC`, borderRadius: 12,
              padding: "80px 40px", textAlign: "center", cursor: "pointer",
              transition: "border-color 0.2s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = R}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#CCC"}>
            <input ref={fileRef} type="file" accept=".xlsx,.xls"
              style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
            <div style={{ fontSize: 48, marginBottom: 16 }}>📂</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: BK, marginBottom: 8 }}>
              Drop Your PropertyShark Export Here
            </div>
            <div style={{ fontSize: 14, color: GRAY, marginBottom: 24 }}>
              Upload your weekly or monthly XLSX file — all sheets will be combined and analyzed
            </div>
            <div style={{ display: "inline-block", background: R, color: WHITE,
              padding: "12px 32px", borderRadius: 6, fontSize: 14, fontWeight: 700,
              letterSpacing: "0.5px" }}>
              {loading ? "Processing..." : "Choose File"}
            </div>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: "center", padding: 60 }}>
            <div style={{ fontSize: 14, color: GRAY }}>Analyzing transactions...</div>
          </div>
        )}

        {data && !loading && (
          <>
            {/* SUMMARY BAR */}
            <div style={{ background: BK, borderRadius: 10, padding: "20px 28px",
              marginBottom: 24, display: "flex", alignItems: "center",
              justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
              <div>
                <div style={{ color: WHITE, fontWeight: 800, fontSize: 18 }}>{data.period}</div>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 2 }}>
                  {data.filteredCount} qualifying transactions over $1M analyzed
                  {data.portfolioCount > 0 && ` · ${data.portfolioCount} portfolio${data.portfolioCount > 1 ? "s" : ""} identified`}
                  {" · Report based on deals $1M+ only"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 24 }}>
                {[
                  { label: "TOTAL VOLUME", val: fmt(data.totalVolume) },
                  { label: "TRANSACTIONS", val: data.count },
                  { label: "MEDIAN PRICE", val: fmt(data.median) },
                  { label: "DEV SITES", val: data.devCount },
                ].map(({ label, val }) => (
                  <div key={label} style={{ textAlign: "center" }}>
                    <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 9,
                      letterSpacing: "1px", textTransform: "uppercase" }}>{label}</div>
                    <div style={{ color: WHITE, fontWeight: 800, fontSize: 20 }}>{val}</div>
                  </div>
                ))}
              </div>
              <button onClick={() => { setData(null); setSlideIdx(0); }}
                style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)",
                  color: "rgba(255,255,255,0.6)", padding: "8px 16px", borderRadius: 4,
                  cursor: "pointer", fontSize: 12 }}>↑ Upload New</button>
            </div>

            {/* TABS */}
            <div style={{ display: "flex", gap: 4, marginBottom: 24 }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  style={{ padding: "10px 22px", borderRadius: 6, border: "none",
                    cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "all 0.15s",
                    background: tab === t.id ? R : WHITE,
                    color: tab === t.id ? WHITE : GRAY,
                    boxShadow: tab === t.id ? "0 2px 8px rgba(232,25,44,0.3)" : "none" }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── INSTAGRAM ── */}
            {tab === "instagram" && <InstagramView data={data} slideIdx={slideIdx} setSlideIdx={setSlideIdx} />}
            {tab === "article" && <ArticleView data={data} />}
            {tab === "team" && <TeamView data={data} />}
            {tab === "devintel" && <DevIntelView data={data} />}
            {tab === "entities" && <EntityIntelView data={data} />}
          </>
        )}
      </div>
    </div>
  );
}

// ─── INSTAGRAM VIEW ────────────────────────────────────────────────────────────
function InstagramView({ data, slideIdx, setSlideIdx }) {
  const { period, totalVolume, count, median, byAsset, byBorough, topDeals,
    devCount, portfolioCount, bkNbds, qnsNbds } = data;

  const [captions, setCaptions] = useState([]);
  const [captionsLoading, setCaptionsLoading] = useState(false);
  const [captionCopied, setCaptionCopied] = useState(null);

  const slideSummaries = [
    `Slide 1 (Cover): ${period} NYC Investment Sales Market Report`,
    `Slide 2 (Market Overview): Total volume ${fmt(totalVolume)}, ${count} transactions, median ${fmt(median)}, ${devCount} dev sites, ${portfolioCount} portfolios`,
    `Slide 3 (Asset Class): ${byAsset.map(a => `${a.name}: ${a.count} deals/${fmt(a.volume)}`).join(", ")}`,
    `Slide 4 (Boroughs): ${byBorough.map(b => `${b.name}: ${b.count} deals/${fmt(b.volume)}`).join(", ")}`,
    `Slide 5 (Top Deals): ${topDeals.slice(0, 5).map((t, i) => `#${i+1} ${t.addr.split(",")[0]} ${fmt(t.displayPrice)}`).join(", ")}`,
  ];

  const generateCaptions = async () => {
    setCaptionsLoading(true);
    const result = await callClaude({
      model: "haiku",
      maxTokens: 1024,
      system: "You write Instagram captions for a NYC commercial real estate brokerage (Schuckman Realty Inc). Professional but engaging. Always include relevant hashtags.",
      messages: [{ role: "user", content: `Generate one Instagram caption for each slide of our ${period} market report carousel. Keep each caption to 1-2 sentences plus 5-8 hashtags. Format: one caption per line, numbered 1-${slideSummaries.length}.

Slide data:
${slideSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}` }],
    });
    if (result.ok && result.text) {
      const lines = result.text.split("\n").filter(l => l.trim());
      const parsed = lines.map(l => l.replace(/^\d+[\.\)]\s*/, "").trim()).filter(Boolean);
      setCaptions(parsed);
    }
    setCaptionsLoading(false);
  };

  const copyCaption = (idx) => {
    if (captions[idx]) {
      navigator.clipboard.writeText(captions[idx]);
      setCaptionCopied(idx);
      setTimeout(() => setCaptionCopied(null), 2000);
    }
  };

  const slides = [
    // 1 — Cover
    <IGSlide key="cover" bg={BK}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column",
        justifyContent: "center", padding: "32px 40px" }}>
        <div style={{ width: 48, height: 4, background: R, marginBottom: 24 }} />
        <div style={{ color: WHITE, fontSize: 13, letterSpacing: "3px", fontWeight: 700,
          textTransform: "uppercase", marginBottom: 12, opacity: 0.6 }}>NYC Investment Sales</div>
        <div style={{ color: WHITE, fontSize: 44, fontWeight: 900, lineHeight: 1.05,
          marginBottom: 20 }}>{period?.replace(" Report","")}<br />Market<br />Report</div>
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, letterSpacing: "1px" }}>
          SOURCE: PROPERTYSHARK · TRANSACTIONS $1M+ ONLY
        </div>
      </div>
      <div style={{ padding: "0 40px 32px", display: "flex", justifyContent: "space-between",
        alignItems: "flex-end" }}>
        <SchuckmanLogo size="md" mono={true} />
        <div style={{ textAlign: "right", color: "rgba(255,255,255,0.4)", fontSize: 9,
          letterSpacing: "1.5px", textTransform: "uppercase", lineHeight: 1.8 }}>
          Brooklyn · Queens<br />Manhattan · Bronx
        </div>
      </div>
    </IGSlide>,

    // 2 — Market Overview
    <IGSlide key="overview" bg={WHITE}>
      <IGHeader period={period} mono={false} />
      <div style={{ flex: 1, padding: "16px 28px 0" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "2px",
          color: R, textTransform: "uppercase", marginBottom: 16 }}>Market Overview</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[
            { label: "Total Volume", val: fmt(totalVolume), bg: R, color: WHITE },
            { label: "Transactions", val: count, bg: BK, color: WHITE },
            { label: "Median Price", val: fmt(median), bg: LGRAY, color: BK },
            { label: "Dev Sites", val: devCount, bg: LGRAY, color: BK },
          ].map(({ label, val, bg, color }) => (
            <div key={label} style={{ background: bg, borderRadius: 8, padding: "20px 20px",
              display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1.5px",
                textTransform: "uppercase", color: bg === LGRAY ? GRAY : "rgba(255,255,255,0.6)",
                marginBottom: 8 }}>{label}</div>
              <div style={{ fontSize: 36, fontWeight: 900, color, lineHeight: 1 }}>{val}</div>
            </div>
          ))}
        </div>
        {portfolioCount > 0 && (
          <div style={{ marginTop: 12, background: "#FFF8F8", borderLeft: `3px solid ${R}`,
            padding: "8px 12px", borderRadius: "0 6px 6px 0" }}>
            <div style={{ fontSize: 11, color: BK, fontWeight: 600 }}>
              ⚠ {portfolioCount} portfolio transaction{portfolioCount > 1 ? "s" : ""} identified & deduplicated
            </div>
          </div>
        )}
      </div>
      <IGFooter mono={false} />
    </IGSlide>,

    // 3 — Asset Class Breakdown
    <IGSlide key="assets" bg={WHITE}>
      <IGHeader period={period} mono={false} />
      <div style={{ flex: 1, padding: "12px 24px 0" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "2px",
          color: R, textTransform: "uppercase", marginBottom: 14 }}>By Asset Class</div>
        {byAsset.map((a, i) => {
          const maxVol = Math.max(...byAsset.map(x => x.volume));
          const pct = (a.volume / maxVol) * 100;
          return (
            <div key={a.name} style={{ marginBottom: 11 }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                alignItems: "baseline", marginBottom: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: BK }}>{a.name}</div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ fontSize: 11, color: GRAY }}>{a.count} deals</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: BK }}>{fmt(a.volume)}</div>
                </div>
              </div>
              <div style={{ background: LGRAY, borderRadius: 3, height: 8 }}>
                <div style={{ width: `${pct}%`, height: 8, borderRadius: 3,
                  background: ASSET_COLORS[a.name] || R, transition: "width 0.5s" }} />
              </div>
            </div>
          );
        })}
      </div>
      <IGFooter mono={false} />
    </IGSlide>,

    // 4 — Borough Breakdown
    <IGSlide key="boroughs" bg={BK}>
      <IGHeader period={period} mono={true} />
      <div style={{ flex: 1, padding: "12px 28px 0" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "2px",
          color: R, textTransform: "uppercase", marginBottom: 14 }}>Borough Activity</div>
        {byBorough.map((b, i) => {
          const maxVol = Math.max(...byBorough.map(x => x.volume));
          const pct = (b.volume / maxVol) * 100;
          return (
            <div key={b.name} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                marginBottom: 5 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: WHITE }}>{b.name}</div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: WHITE }}>{fmt(b.volume)}</span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)",
                    marginLeft: 8 }}>{b.count} deals</span>
                </div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 3, height: 6 }}>
                <div style={{ width: `${pct}%`, height: 6, borderRadius: 3,
                  background: i === 0 ? R : "rgba(255,255,255,0.5)" }} />
              </div>
            </div>
          );
        })}
      </div>
      <IGFooter mono={true} />
    </IGSlide>,

    // 5 — Top Deals
    <IGSlide key="deals" bg={WHITE}>
      <IGHeader period={period} mono={false} />
      <div style={{ flex: 1, padding: "12px 24px 0", overflowY: "hidden" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "2px",
          color: R, textTransform: "uppercase", marginBottom: 12 }}>Top Transactions</div>
        {topDeals.slice(0, 5).map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start",
            paddingBottom: 11, marginBottom: 11,
            borderBottom: i < 4 ? "1px solid #F0F0F0" : "none" }}>
            <div style={{ background: i === 0 ? R : LGRAY, color: i === 0 ? WHITE : GRAY,
              width: 24, height: 24, borderRadius: 4, display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
              {i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: BK,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {t.addr}
              </div>
              <div style={{ fontSize: 10, color: GRAY, marginTop: 1 }}>
                {t.assetClass} · {t.borough}
                {t.isPortfolio && <span style={{ color: R, fontWeight: 700 }}> · Portfolio</span>}
              </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: BK, flexShrink: 0 }}>
              {fmt(t.displayPrice)}
            </div>
          </div>
        ))}
      </div>
      <IGFooter mono={false} />
    </IGSlide>,
  ];

  return (
    <div>
      <div style={{ background: WHITE, borderRadius: 10, padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: BK }}>Instagram Slides</div>
            <div style={{ fontSize: 12, color: GRAY, marginTop: 2 }}>
              {slides.length} slides · 1:1 format (540×540) · Screenshot each slide to save
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {slides.map((_, i) => (
              <button key={i} onClick={() => setSlideIdx(i)}
                style={{ width: 32, height: 32, borderRadius: 4, border: "none",
                  cursor: "pointer", fontSize: 12, fontWeight: 700,
                  background: slideIdx === i ? R : LGRAY,
                  color: slideIdx === i ? WHITE : GRAY }}>
                {i + 1}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 32, alignItems: "flex-start" }}>
          <button onClick={() => setSlideIdx(Math.max(0, slideIdx - 1))}
            disabled={slideIdx === 0}
            style={{ marginTop: 240, background: "none", border: `2px solid ${slideIdx === 0 ? "#EEE" : R}`,
              color: slideIdx === 0 ? "#CCC" : R, width: 40, height: 40, borderRadius: 20,
              fontSize: 18, cursor: slideIdx === 0 ? "default" : "pointer", fontWeight: 700 }}>
            ‹
          </button>
          {slides[slideIdx]}
          <button onClick={() => setSlideIdx(Math.min(slides.length - 1, slideIdx + 1))}
            disabled={slideIdx === slides.length - 1}
            style={{ marginTop: 240, background: "none",
              border: `2px solid ${slideIdx === slides.length - 1 ? "#EEE" : R}`,
              color: slideIdx === slides.length - 1 ? "#CCC" : R,
              width: 40, height: 40, borderRadius: 20, fontSize: 18,
              cursor: slideIdx === slides.length - 1 ? "default" : "pointer", fontWeight: 700 }}>
            ›
          </button>
        </div>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: GRAY }}>
          Slide {slideIdx + 1} of {slides.length} — Screenshot or right-click to save each slide
        </div>

        {/* AI Captions */}
        <div style={{ marginTop: 24, borderTop: "1px solid #E8E8E8", paddingTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: BK }}>AI Instagram Captions</div>
              <div style={{ fontSize: 11, color: GRAY, marginTop: 2 }}>
                Powered by Claude Haiku — one caption per slide
              </div>
            </div>
            <button onClick={generateCaptions} disabled={captionsLoading}
              style={{ background: captionsLoading ? GRAY : BK, color: WHITE, border: "none",
                padding: "8px 20px", borderRadius: 6, fontSize: 12, fontWeight: 700,
                cursor: captionsLoading ? "not-allowed" : "pointer" }}>
              {captionsLoading ? "Generating…" : captions.length > 0 ? "Regenerate Captions" : "Generate Captions"}
            </button>
          </div>

          {captions.length > 0 && captions[slideIdx] && (
            <div style={{ background: "#FAFAFA", border: "1px solid #E8E8E8", borderRadius: 8,
              padding: "14px 18px", display: "flex", justifyContent: "space-between",
              alignItems: "flex-start", gap: 12 }}>
              <div style={{ fontSize: 13, color: BK, lineHeight: 1.6, flex: 1 }}>
                {captions[slideIdx]}
              </div>
              <button onClick={() => copyCaption(slideIdx)}
                style={{ background: captionCopied === slideIdx ? "#22C55E" : R, color: WHITE,
                  border: "none", padding: "6px 14px", borderRadius: 5, fontSize: 11,
                  fontWeight: 700, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" }}>
                {captionCopied === slideIdx ? "Copied!" : "Copy"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ARTICLE VIEW ──────────────────────────────────────────────────────────────
function ArticleView({ data }) {
  const { period, totalVolume, count, median, byAsset, byBorough, topDeals,
    devCount, portfolioCount, bkNbds, qnsNbds } = data;
  const [copied, setCopied] = useState(false);
  const [generatedArticle, setGeneratedArticle] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);
  const [tone, setTone] = useState("Professional");
  const [length, setLength] = useState("Standard");
  const articleCache = useRef({});

  const topBorough = byBorough[0] || {};
  const topAsset = [...byAsset].sort((a, b) => b.volume - a.volume)[0] || {};
  const mfData = byAsset.find(a => a.name === "Multifamily") || {};

  const defaultArticleText = `NYC Investment Sales Market Report — ${period}

The New York City investment sales market recorded ${count} qualifying transactions totaling ${fmt(totalVolume)} in ${period}, with a median transaction price of ${fmt(median)}. This report is based only on transactions over $1 million. The data, sourced from PropertyShark, excludes single-family and two-family residential sales and has been adjusted to account for ${portfolioCount} portfolio transaction${portfolioCount !== 1 ? "s" : ""} identified during the period.

MARKET OVERVIEW

Total transaction volume reached ${fmt(totalVolume)} across ${count} deals. ${topBorough.name} led all boroughs with ${topBorough.count} transactions totaling ${fmt(topBorough.volume)}, representing ${Math.round((topBorough.volume / totalVolume) * 100)}% of overall market volume. ${byBorough[1]?.name || "Queens"} was the second most active market with ${byBorough[1]?.count || 0} transactions and ${fmt(byBorough[1]?.volume || 0)} in total volume.

ASSET CLASS BREAKDOWN

${topAsset.name} was the dominant asset class by volume, accounting for ${fmt(topAsset.volume)} across ${topAsset.count} transactions. ${mfData.name === topAsset.name ? "" : `Multifamily assets recorded ${mfData.count || 0} transactions totaling ${fmt(mfData.volume || 0)}.`}Development site activity was notable with ${devCount} vacant land transactions, reflecting continued demand for assemblage and ground-up development opportunities across the boroughs.

${byAsset.map(a => `${a.name}: ${a.count} transactions · ${fmt(a.volume)}`).join("\n")}

BOROUGH BREAKDOWN

${byBorough.map(b => `${b.name}: ${b.count} transactions · ${fmt(b.volume)}`).join("\n")}

${bkNbds.length > 0 ? `TOP BROOKLYN NEIGHBORHOODS BY VOLUME\n${bkNbds.map((n, i) => `${i + 1}. ${n.name} — ${n.count} deals · ${fmt(n.volume)}`).join("\n")}` : ""}

${qnsNbds.length > 0 ? `TOP QUEENS NEIGHBORHOODS BY VOLUME\n${qnsNbds.map((n, i) => `${i + 1}. ${n.name} — ${n.count} deals · ${fmt(n.volume)}`).join("\n")}` : ""}

TOP TRANSACTIONS

${topDeals.map((t, i) => `${i + 1}. ${t.addr} — ${t.assetClass}${t.isPortfolio ? " (Portfolio)" : ""} — ${fmt(t.displayPrice)}`).join("\n")}

---
Source: PropertyShark (transactions $1M+ only) | Analysis: Schuckman Realty Inc. Investment Sales Division
`;

  const articleText = generatedArticle ?? defaultArticleText;

  const generateWithClaude = async () => {
    const cacheKey = `${period}_${tone}_${length}`;
    if (articleCache.current[cacheKey]) {
      setGeneratedArticle(articleCache.current[cacheKey]);
      return;
    }
    setGenerating(true);
    setGenerateError(null);
    const dataBlob = [
      `Period: ${period}`,
      `Transactions: ${count} (over $1M only). Portfolio deals identified: ${portfolioCount}.`,
      `Total volume: ${fmt(totalVolume)}. Median price: ${fmt(median)}. Dev sites: ${devCount}.`,
      "",
      "Boroughs:",
      ...byBorough.map(b => `  ${b.name}: ${b.count} deals, ${fmt(b.volume)}`),
      "",
      "Asset classes:",
      ...byAsset.map(a => `  ${a.name}: ${a.count} transactions, ${fmt(a.volume)}`),
      "",
      "Top Brooklyn neighborhoods:",
      ...(bkNbds.slice(0, 6).map((n, i) => `  ${i + 1}. ${n.name} — ${n.count} deals, ${fmt(n.volume)}`) || ["  (none)"]),
      "",
      "Top Queens neighborhoods:",
      ...(qnsNbds.slice(0, 6).map((n, i) => `  ${i + 1}. ${n.name} — ${n.count} deals, ${fmt(n.volume)}`) || ["  (none)"]),
      "",
      "Top transactions:",
      ...topDeals.slice(0, 5).map((t, i) => `  ${i + 1}. ${t.addr} — ${t.assetClass}${t.isPortfolio ? " (Portfolio)" : ""} — ${fmt(t.displayPrice)}`),
    ].join("\n");

    const toneGuide = {
      Professional: "Write in a polished, authoritative tone suitable for a commercial real estate brokerage's website. Use precise language and industry terminology.",
      Conversational: "Write in a conversational, accessible tone that a general audience can understand. Avoid excessive jargon. Be engaging and informative.",
      "Data-Heavy": "Write in a highly analytical, numbers-forward style. Lead every paragraph with specific data points. Minimize narrative; maximize statistics and comparisons.",
    };
    const wordTarget = { Short: 200, Standard: 350, Detailed: 500 };
    const target = wordTarget[length] || 350;

    const prompt = `You are a senior NYC commercial real estate market analyst writing for Schuckman Realty Inc.

TONE: ${toneGuide[tone] || toneGuide.Professional}

Write an NYC Investment Sales Market Report article using ONLY the data below. Do not invent any numbers or facts.

Structure:
1. Opening hook — lead with the most compelling headline number (total volume or a standout trend)
2. Market Overview — volume, transaction count, median price, portfolio activity
3. Asset Class Breakdown — what dominated and why it matters
4. Borough Activity — which boroughs led and by how much
5. Top Neighborhoods — Brooklyn and Queens highlights
6. Notable Transactions — the biggest deals
7. Forward-looking statement — one sentence on what this data suggests

Rules:
- Target ~${target} words
- Use ONLY the data provided — never fabricate numbers
- Report covers transactions $1M+ only; single/two-family excluded; portfolios deduplicated
- Output plain text only, no markdown, no headers with # symbols
- End with exactly: "Source: PropertyShark (transactions $1M+ only) | Analysis: Schuckman Realty Inc. Investment Sales Division"

DATA:
${dataBlob}`;

    try {
      const result = await callClaude({
        model: "sonnet",
        maxTokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });
      if (!result.ok) {
        setGenerateError(result.error);
      } else if (result.text?.trim()) {
        setGeneratedArticle(result.text.trim());
        articleCache.current[cacheKey] = result.text.trim();
      } else {
        setGenerateError("No text in response.");
      }
    } catch (err) {
      setGenerateError(err.message || "Request failed.");
    }
    setGenerating(false);
  };

  const copy = () => {
    navigator.clipboard.writeText(articleText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ background: WHITE, borderRadius: 10, padding: 32 }}>
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 24 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: BK }}>Website Article</div>
          <div style={{ fontSize: 12, color: GRAY, marginTop: 2 }}>
            Data-forward narrative · Generate with Claude or copy template
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4, background: LGRAY, borderRadius: 6, padding: 3 }}>
            {["Professional","Conversational","Data-Heavy"].map(t => (
              <button key={t} onClick={() => setTone(t)}
                style={{ padding: "5px 12px", borderRadius: 4, border: "none", cursor: "pointer",
                  fontSize: 11, fontWeight: 600,
                  background: tone === t ? BK : "transparent", color: tone === t ? WHITE : GRAY }}>
                {t}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 4, background: LGRAY, borderRadius: 6, padding: 3 }}>
            {["Short","Standard","Detailed"].map(l => (
              <button key={l} onClick={() => setLength(l)}
                style={{ padding: "5px 12px", borderRadius: 4, border: "none", cursor: "pointer",
                  fontSize: 11, fontWeight: 600,
                  background: length === l ? BK : "transparent", color: length === l ? WHITE : GRAY }}>
                {l}
              </button>
            ))}
          </div>
          <button onClick={generateWithClaude} disabled={generating}
            style={{ background: generating ? GRAY : BK, color: WHITE, border: "none",
              padding: "10px 24px", borderRadius: 6, fontSize: 13, fontWeight: 700,
              cursor: generating ? "not-allowed" : "pointer" }}>
            {generating ? "Generating…" : "Generate with Claude"}
          </button>
          <button onClick={copy}
            style={{ background: copied ? "#22C55E" : R, color: WHITE, border: "none",
              padding: "10px 24px", borderRadius: 6, fontSize: 13, fontWeight: 700,
              cursor: "pointer" }}>
            {copied ? "✓ Copied!" : "Copy Article Text"}
          </button>
        </div>
      </div>

      {generateError && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8,
          padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#B91C1C" }}>
          {generateError}
        </div>
      )}

      {/* Preview */}
      <div style={{ background: "#FAFAFA", border: "1px solid #E8E8E8", borderRadius: 8,
        padding: "40px 48px", maxWidth: 720, margin: "0 auto" }}>
        <div style={{ marginBottom: 32 }}>
          <SchuckmanLogo size="md" />
        </div>

        <div style={{ borderLeft: `4px solid ${R}`, paddingLeft: 20, marginBottom: 32 }}>
          <div style={{ fontSize: 26, fontWeight: 900, color: BK, lineHeight: 1.2,
            marginBottom: 8 }}>NYC Investment Sales Market Report</div>
          <div style={{ fontSize: 16, color: R, fontWeight: 700 }}>{period}</div>
        </div>

        {generatedArticle ? (
          <div style={{ fontSize: 15, lineHeight: 1.7, color: "#333", whiteSpace: "pre-wrap", marginBottom: 32 }}>
            {generatedArticle}
          </div>
        ) : (
          <>
        <p style={{ fontSize: 15, lineHeight: 1.75, color: "#333", marginBottom: 24 }}>
          The New York City investment sales market recorded <strong>{count}</strong> qualifying transactions
          totaling <strong>{fmt(totalVolume)}</strong> in {period}, with a median transaction price of{" "}
          <strong>{fmt(median)}</strong>. This report is based only on transactions over $1 million. The data, sourced from PropertyShark, excludes single-family and
          two-family residential sales and has been adjusted to account for{" "}
          <strong>{portfolioCount} portfolio transaction{portfolioCount !== 1 ? "s" : ""}</strong> identified
          during the period.
        </p>

        <div style={{ background: BK, borderRadius: 8, padding: "24px 28px",
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginBottom: 32 }}>
          {[
            { label: "Total Volume", val: fmt(totalVolume) },
            { label: "Transactions", val: count },
            { label: "Median Price", val: fmt(median) },
          ].map(({ label, val }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, letterSpacing: "1px",
                textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
              <div style={{ color: WHITE, fontWeight: 900, fontSize: 24 }}>{val}</div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 14, fontWeight: 800, color: R, letterSpacing: "2px",
          textTransform: "uppercase", marginBottom: 16 }}>Asset Class Breakdown</div>
        <div style={{ marginBottom: 32 }}>
          {byAsset.map(a => (
            <div key={a.name} style={{ display: "flex", justifyContent: "space-between",
              padding: "10px 0", borderBottom: "1px solid #EEE", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2,
                  background: ASSET_COLORS[a.name] }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: BK }}>{a.name}</span>
              </div>
              <div style={{ display: "flex", gap: 24, fontSize: 13 }}>
                <span style={{ color: GRAY }}>{a.count} transactions</span>
                <span style={{ fontWeight: 700, color: BK }}>{fmt(a.volume)}</span>
              </div>
            </div>
          ))}
        </div>

        {bkNbds.length > 0 && (
          <>
            <div style={{ fontSize: 14, fontWeight: 800, color: R, letterSpacing: "2px",
              textTransform: "uppercase", marginBottom: 16 }}>Top Brooklyn Neighborhoods</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 32 }}>
              {bkNbds.slice(0, 6).map((n, i) => (
                <div key={n.name} style={{ background: LGRAY, borderRadius: 6, padding: "12px 14px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: BK }}>{n.name}</div>
                  <div style={{ fontSize: 11, color: GRAY, marginTop: 2 }}>
                    {n.count} deals · {fmt(n.volume)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {qnsNbds.length > 0 && (
          <>
            <div style={{ fontSize: 14, fontWeight: 800, color: R, letterSpacing: "2px",
              textTransform: "uppercase", marginBottom: 16 }}>Top Queens Neighborhoods</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 32 }}>
              {qnsNbds.slice(0, 6).map((n, i) => (
                <div key={n.name} style={{ background: LGRAY, borderRadius: 6, padding: "12px 14px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: BK }}>{n.name}</div>
                  <div style={{ fontSize: 11, color: GRAY, marginTop: 2 }}>
                    {n.count} deals · {fmt(n.volume)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ fontSize: 14, fontWeight: 800, color: R, letterSpacing: "2px",
          textTransform: "uppercase", marginBottom: 16 }}>Top Transactions</div>
        {topDeals.slice(0, 5).map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 16, paddingBottom: 14, marginBottom: 14,
            borderBottom: "1px solid #EEE" }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: i === 0 ? R : "#CCC",
              width: 28, flexShrink: 0 }}>#{i + 1}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: BK }}>{t.addr}</div>
              <div style={{ fontSize: 12, color: GRAY, marginTop: 2 }}>
                {t.assetClass} · {t.borough}
                {t.isPortfolio && <span style={{ color: R }}> · Portfolio Sale</span>}
              </div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 900, color: BK, flexShrink: 0 }}>
              {fmt(t.displayPrice)}
            </div>
          </div>
        ))}
          </>
        )}

        <div style={{ marginTop: 40, paddingTop: 20, borderTop: "1px solid #EEE",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <SchuckmanLogo size="sm" />
          <div style={{ fontSize: 10, color: "#CCC", letterSpacing: "1px" }}>
            SOURCE: PROPERTYSHARK · TRANSACTIONS $1M+ ONLY
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TEAM REPORT VIEW ─────────────────────────────────────────────────────────
function TeamView({ data }) {
  const { period, totalVolume, count, median, byAsset, byBorough,
    topDeals, devCount, portfolioCount, bkNbds, qnsNbds, deduped } = data;

  const [activeBorough, setActiveBorough] = useState("All");
  const boroughs = ["All", ...byBorough.map(b => b.name)];

  const filtered = activeBorough === "All" ? deduped
    : deduped.filter(t => t.borough === activeBorough);

  const assetBreakdown = ["Multifamily","Mixed-Use","Development","Retail","Industrial","Office","Other"]
    .map(cls => ({
      name: cls,
      count: filtered.filter(t => t.assetClass === cls).length,
      volume: filtered.filter(t => t.assetClass === cls).reduce((s, t) => s + t.price, 0),
    })).filter(a => a.count > 0);

  return (
    <div>
      {/* Header */}
      <div style={{ background: BK, borderRadius: 10, padding: "24px 32px",
        marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <SchuckmanLogo size="sm" mono={true} />
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 8,
            letterSpacing: "1px" }}>INVESTMENT SALES · TEAM REPORT · {period?.toUpperCase()} · TRANSACTIONS $1M+ ONLY</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {boroughs.map(b => (
            <button key={b} onClick={() => setActiveBorough(b)}
              style={{ padding: "6px 14px", borderRadius: 4, border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 600,
                background: activeBorough === b ? R : "rgba(255,255,255,0.1)",
                color: WHITE }}>
              {b}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard label="Total Volume" value={fmt(activeBorough === "All" ? totalVolume : filtered.reduce((s,t) => s+t.price, 0))} accent={R} />
        <StatCard label="Transactions" value={filtered.length} sub={`${portfolioCount} portfolios identified`} accent={BK} />
        <StatCard label="Median Price" value={fmt([...filtered.map(t => t.price)].sort((a,b)=>a-b)[Math.floor(filtered.length/2)] || 0)} accent={GRAY} />
        <StatCard label="Dev Sites" value={filtered.filter(t => t.assetClass === "Development").length} sub="Vacant land transactions" accent="#F5A623" />
      </div>

      {/* Charts Row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div style={{ background: WHITE, borderRadius: 10, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: BK, marginBottom: 16,
            letterSpacing: "1px", textTransform: "uppercase" }}>Volume by Asset Class</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={assetBreakdown} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: GRAY }} />
              <YAxis tick={{ fontSize: 10, fill: GRAY }}
                tickFormatter={v => v >= 1e6 ? `$${(v/1e6).toFixed(0)}M` : `$${v}`} />
              <Tooltip formatter={(v) => [fmt(v), "Volume"]}
                contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="volume" radius={[3, 3, 0, 0]}>
                {assetBreakdown.map((a, i) => (
                  <Cell key={a.name} fill={ASSET_COLORS[a.name] || R} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: WHITE, borderRadius: 10, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: BK, marginBottom: 16,
            letterSpacing: "1px", textTransform: "uppercase" }}>Transaction Count by Asset Class</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={assetBreakdown} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: GRAY }} />
              <YAxis tick={{ fontSize: 10, fill: GRAY }} />
              <Tooltip formatter={(v) => [v, "Deals"]} contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {assetBreakdown.map((a) => (
                  <Cell key={a.name} fill={ASSET_COLORS[a.name] || R} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Neighborhood Tables */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        {[{ label: "Brooklyn", nbds: bkNbds }, { label: "Queens", nbds: qnsNbds }].map(({ label, nbds }) => (
          <div key={label} style={{ background: WHITE, borderRadius: 10, padding: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: BK, marginBottom: 14,
              letterSpacing: "1px", textTransform: "uppercase" }}>
              {label} — Top Neighborhoods
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${R}` }}>
                  <th style={{ textAlign: "left", padding: "4px 0", color: GRAY,
                    fontWeight: 700, fontSize: 10, letterSpacing: "1px" }}>NEIGHBORHOOD</th>
                  <th style={{ textAlign: "right", padding: "4px 0", color: GRAY,
                    fontWeight: 700, fontSize: 10, letterSpacing: "1px" }}>DEALS</th>
                  <th style={{ textAlign: "right", padding: "4px 0", color: GRAY,
                    fontWeight: 700, fontSize: 10, letterSpacing: "1px" }}>VOLUME</th>
                </tr>
              </thead>
              <tbody>
                {nbds.slice(0, 6).map((n, i) => (
                  <tr key={n.name} style={{ borderBottom: "1px solid #F5F5F5" }}>
                    <td style={{ padding: "9px 0", fontWeight: 600, color: BK }}>{n.name}</td>
                    <td style={{ padding: "9px 0", textAlign: "right", color: GRAY }}>{n.count}</td>
                    <td style={{ padding: "9px 0", textAlign: "right", fontWeight: 700,
                      color: i === 0 ? R : BK }}>{fmt(n.volume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Top Deals Table */}
      <div style={{ background: WHITE, borderRadius: 10, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: BK, marginBottom: 14,
          letterSpacing: "1px", textTransform: "uppercase" }}>Notable Transactions</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${R}` }}>
              {["#","Address","Asset Class","Borough","Price","Type"].map(h => (
                <th key={h} style={{ textAlign: h === "Price" ? "right" : "left",
                  padding: "6px 8px", color: GRAY, fontWeight: 700, fontSize: 10,
                  letterSpacing: "1px", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topDeals.slice(0, 10).map((t, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #F5F5F5",
                background: i % 2 === 0 ? WHITE : "#FAFAFA" }}>
                <td style={{ padding: "10px 8px", fontWeight: 800,
                  color: i < 3 ? R : GRAY }}>{i + 1}</td>
                <td style={{ padding: "10px 8px", fontWeight: 600, color: BK, maxWidth: 260,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.addr}
                </td>
                <td style={{ padding: "10px 8px" }}>
                  <span style={{ background: `${ASSET_COLORS[t.assetClass]}20`,
                    color: ASSET_COLORS[t.assetClass], padding: "2px 8px", borderRadius: 3,
                    fontSize: 11, fontWeight: 700 }}>{t.assetClass}</span>
                </td>
                <td style={{ padding: "10px 8px", color: GRAY }}>{t.borough}</td>
                <td style={{ padding: "10px 8px", textAlign: "right", fontWeight: 800,
                  color: BK }}>{fmt(t.displayPrice)}</td>
                <td style={{ padding: "10px 8px" }}>
                  {t.isPortfolio
                    ? <span style={{ color: R, fontSize: 11, fontWeight: 700 }}>Portfolio</span>
                    : <span style={{ color: "#22C55E", fontSize: 11, fontWeight: 700 }}>Single</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Asset + Portfolio footnote */}
      <div style={{ background: "#FFF8F8", border: `1px solid ${R}30`,
        borderRadius: 8, padding: "14px 20px", fontSize: 12, color: GRAY }}>
        <strong style={{ color: BK }}>Methodology: </strong>
        Report based only on transactions over $1 million. 1-family (A*) and 2-family (B*, S1, S2) transactions excluded.{" "}
        {portfolioCount} portfolio sale{portfolioCount !== 1 ? "s" : ""} identified by matching
        buyer name + closing date — deduplicated and reported as single transactions with
        combined pricing. Development sites classified via V0/V1 building codes.
      </div>

      {/* AI Trend Analysis */}
      <TrendAnalysis data={data} />
    </div>
  );
}

// ─── TREND ANALYSIS ──────────────────────────────────────────────────────────
function TrendAnalysis({ data }) {
  const [trendText, setTrendText] = useState(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState(null);
  const [trendOpen, setTrendOpen] = useState(false);
  const trendCache = useRef({});

  const history = loadAllHistory();
  const previous = history.filter(h => h.period !== data.period);

  const generateTrend = async () => {
    const cacheKey = data.period;
    if (trendCache.current[cacheKey]) {
      setTrendText(trendCache.current[cacheKey]);
      return;
    }
    setTrendLoading(true);
    setTrendError(null);

    const currentSummary = `CURRENT PERIOD: ${data.period}
Volume: ${fmt(data.totalVolume)}, Transactions: ${data.count}, Median: ${fmt(data.median)}, Dev sites: ${data.devCount}
Boroughs: ${data.byBorough.map(b => `${b.name}: ${b.count} deals/${fmt(b.volume)}`).join(", ")}
Asset classes: ${data.byAsset.map(a => `${a.name}: ${a.count}/${fmt(a.volume)}`).join(", ")}`;

    const historySummaries = previous.map(h =>
      `${h.period}: Vol ${fmt(h.totalVolume)}, ${h.count} txns, Median ${fmt(h.median)}, DevSites ${h.devCount}` +
      (h.byBorough ? ` | Boroughs: ${h.byBorough.map(b => `${b.name}:${fmt(b.volume)}`).join(",")}` : "") +
      (h.byAsset ? ` | Assets: ${h.byAsset.map(a => `${a.name}:${a.count}`).join(",")}` : "")
    ).join("\n");

    const prompt = `You are a senior NYC commercial real estate analyst at Schuckman Realty Inc. Analyze the current period's investment sales data${previous.length > 0 ? " and compare it to historical periods" : ""}.

${currentSummary}

${previous.length > 0 ? `HISTORICAL PERIODS:\n${historySummaries}` : "No historical data available — analyze the current period on its own."}

Write a concise trend analysis (200-300 words) covering:
${previous.length > 0 ? `1. Volume trend — is the market growing, declining, or stable vs previous periods?
2. Asset class shifts — what's gaining/losing share?
3. Borough momentum — which areas are heating up or cooling?
4. Notable patterns — any standout changes worth highlighting?
5. One forward-looking takeaway` : `1. Market size assessment — how does this volume and deal count compare to typical NYC investment sales activity?
2. Asset class composition — what does the mix tell us about market dynamics?
3. Borough concentration — where is activity concentrated and what does it suggest?
4. One forward-looking takeaway`}

Use specific numbers and percentages. Plain text, no markdown. Be analytical, not promotional.`;

    try {
      const result = await callClaude({
        model: "sonnet",
        maxTokens: 1500,
        messages: [{ role: "user", content: prompt }],
      });
      if (!result.ok) {
        setTrendError(result.error);
      } else if (result.text?.trim()) {
        setTrendText(result.text.trim());
        trendCache.current[cacheKey] = result.text.trim();
      } else {
        setTrendError("No response text.");
      }
    } catch (err) {
      setTrendError(err.message);
    }
    setTrendLoading(false);
  };

  return (
    <div style={{ background: WHITE, borderRadius: 10, padding: 20, marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        cursor: "pointer" }} onClick={() => setTrendOpen(!trendOpen)}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: BK }}>
            AI Market Trend Analysis
          </div>
          <div style={{ fontSize: 11, color: GRAY, marginTop: 2 }}>
            {previous.length > 0
              ? `${previous.length} previous period${previous.length > 1 ? "s" : ""} available for comparison`
              : "Upload reports from multiple months to unlock trend comparisons"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!trendText && (
            <button onClick={(e) => { e.stopPropagation(); setTrendOpen(true); generateTrend(); }}
              disabled={trendLoading}
              style={{ background: trendLoading ? GRAY : BK, color: WHITE, border: "none",
                padding: "8px 20px", borderRadius: 6, fontSize: 12, fontWeight: 700,
                cursor: trendLoading ? "not-allowed" : "pointer" }}>
              {trendLoading ? "Analyzing…" : "Generate Analysis"}
            </button>
          )}
          <div style={{ color: GRAY, fontSize: 16, transform: trendOpen ? "rotate(90deg)" : "none",
            transition: "transform 0.2s" }}>›</div>
        </div>
      </div>

      {trendOpen && (
        <div style={{ marginTop: 16 }}>
          {trendError && (
            <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8,
              padding: "10px 14px", fontSize: 12, color: "#B91C1C", marginBottom: 12 }}>
              {trendError}
            </div>
          )}
          {trendText && (
            <div style={{ background: "#FAFAFA", border: "1px solid #E8E8E8", borderRadius: 8,
              padding: "20px 24px" }}>
              <div style={{ fontSize: 13, color: BK, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                {trendText}
              </div>
              <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                <button onClick={() => { navigator.clipboard.writeText(trendText); }}
                  style={{ background: LGRAY, color: BK, border: "none", padding: "6px 14px",
                    borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  Copy Analysis
                </button>
                <button onClick={generateTrend} disabled={trendLoading}
                  style={{ background: "none", border: "1px solid #DDD", color: GRAY,
                    padding: "6px 14px", borderRadius: 5, fontSize: 11, cursor: "pointer" }}>
                  Regenerate
                </button>
              </div>
            </div>
          )}
          {trendLoading && !trendText && (
            <div style={{ textAlign: "center", padding: 32, color: GRAY, fontSize: 13 }}>
              Analyzing market trends…
            </div>
          )}

          {/* Historical snapshots */}
          {previous.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: GRAY, letterSpacing: "1.5px",
                textTransform: "uppercase", marginBottom: 8 }}>Historical Data Points</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                {previous.map(h => (
                  <div key={h.period} style={{ background: LGRAY, borderRadius: 6, padding: "10px 14px" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: BK }}>{h.period}</div>
                    <div style={{ fontSize: 11, color: GRAY, marginTop: 2 }}>
                      {fmt(h.totalVolume)} · {h.count} deals
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── DEV INTELLIGENCE VIEW ────────────────────────────────────────────────────
const CONF_COLORS = {
  "Confirmed Dev": "#16A34A",
  "Likely Dev":    "#F5A623",
  "Possible Dev":  "#3D5A80",
  "Not Dev":       "#9CA3AF",
  "Researching…":  "#6B6B6B",
  "Pending":       "#D1D5DB",
  "Error":         "#DC2626",
};

function ConfBadge({ label }) {
  const bg = CONF_COLORS[label] || "#D1D5DB";
  return (
    <span style={{ background: bg + "22", color: bg, border: `1px solid ${bg}55`,
      padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
      whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function DevIntelView({ data }) {
  const { deduped } = data;
  const fmt = (n) => {
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
    return `$${n?.toLocaleString()}`;
  };

  // Candidate pool: V0/V1 confirmed + any non-MF/Office that might be dev
  const candidates = deduped.filter(t =>
    t.assetClass === "Development" ||
    (["Multifamily","Mixed-Use","Retail","Industrial","Other"].includes(t.assetClass) &&
      t.price >= 1500000)
  ).sort((a, b) => b.price - a.price);

  const [results, setResults] = useState({});   // addr -> { status, confidence, summary, sources, signals }
  const [queue, setQueue] = useState([]);        // addresses currently being researched
  const [filter, setFilter] = useState("All");
  const [expanded, setExpanded] = useState(null);
  const [runningAll, setRunningAll] = useState(false);

  const researchDeal = async (txn) => {
    const key = txn.addr;
    if (queue.includes(key)) return;
    setQueue(q => [...q, key]);
    setResults(r => ({ ...r, [key]: { status: "Researching…", confidence: "Researching…" } }));

    const cleanAddr = txn.addr.replace(/,\s*\d{5}/, "").trim();
    const bbl = txn.bbl || "";

    const prompt = `You are a NYC real estate analyst. Determine if this property was purchased as a DEVELOPMENT SITE (demolish and build new, or vacant land as the main value).

IMPORTANT: You MUST use web search at least 2–3 times before answering. Search for this specific address, the buyer name, and DOB/permits. Do not guess or default to "Possible Dev" without doing real searches.

Property: ${cleanAddr}
Sale Price: ${fmt(txn.price)}
Building Class: ${txn.bc || "Unknown"}
Zoning: ${txn.zoning || "Unknown"}
Current Asset Class: ${txn.assetClass}
Borough: ${txn.borough}
Buyer: ${txn.buyer || "Unknown"}

Required searches (perform these):
1. NYC DOB — new building or demolition permits at this address after the sale (search "DOB [address]" or "NYC BIS [address]")
2. Address + development — e.g. "${cleanAddr} development" or "${cleanAddr} new building" on YIMBY, The Real Deal, Bisnow
3. Buyer "${txn.buyer || "Unknown"}" — are they a known developer? Search "[buyer name] developer NYC"

After researching, return ONLY this JSON (no other text):
{
  "confidence": "Confirmed Dev" | "Likely Dev" | "Possible Dev" | "Not Dev",
  "summary": "2-3 sentence summary of what you actually found in your searches",
  "signals": ["specific finding 1", "specific finding 2", ...],
  "sources": ["source 1", "source 2", ...]
}

Confidence rules — be strict:
- "Confirmed Dev": You found a DOB new-building or demolition permit, or a clear news article stating development plans at this address.
- "Likely Dev": Vacant land (V0/V1) or you found strong evidence (e.g. buyer is a known developer with a track record, or article strongly implies dev plans).
- "Possible Dev": You found some relevant signals (e.g. zoning supports dev, or one weak mention) but could not confirm. Use only when you have real search results that hint at dev.
- "Not Dev": You found no permits, no development news, and no developer profile for the buyer; or you found evidence it is a hold/rental/repositioning play. When in doubt after searching, prefer "Not Dev" over "Possible Dev".`;

    try {
      const result = await callClaude({
        model: "sonnet",
        maxTokens: 4096,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        messages: [{ role: "user", content: prompt }],
      });

      if (!result.ok) {
        const hint = result.status === 403
          ? " Web search may need to be enabled for your API key in the Anthropic console."
          : result.status === 401
          ? " Check ANTHROPIC_API_KEY."
          : "";
        setResults(r => ({ ...r, [key]: { status: "done", confidence: "Error",
          summary: "API error: " + result.error + hint, signals: [], sources: [] } }));
        setQueue(q => q.filter(k => k !== key));
        return;
      }

      let parsed = null;
      try {
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch (_) {}

      if (parsed) {
        const conf = parsed.confidence && ["Confirmed Dev","Likely Dev","Possible Dev","Not Dev"].find(
          c => c.toLowerCase() === String(parsed.confidence).toLowerCase()
        );
        if (conf) parsed.confidence = conf;
        setResults(r => ({ ...r, [key]: { status: "done", ...parsed } }));
      } else {
        const noText = !result.text || result.text.trim().length === 0;
        const summary = noText
          ? "No response text from Claude. Enable web search for your API key in Anthropic Console (Settings → Privacy), then re-research."
          : result.text.slice(0, 280) + " (JSON could not be parsed — re-research to get a classification.)";
        setResults(r => ({ ...r, [key]: { status: "done", confidence: "Possible Dev",
          summary, signals: [], sources: [] } }));
      }
    } catch (err) {
      setResults(r => ({ ...r, [key]: { status: "error", confidence: "Possible Dev",
        summary: "Research failed: " + err.message, signals: [], sources: [] } }));
    }
    setQueue(q => q.filter(k => k !== key));
  };

  const researchAll = async () => {
    setRunningAll(true);
    const unresearched = candidates.filter(t => !results[t.addr]);
    // Batch with small delay to avoid rate limits
    for (let i = 0; i < unresearched.length; i++) {
      await researchDeal(unresearched[i]);
      if (i < unresearched.length - 1) await new Promise(r => setTimeout(r, 800));
    }
    setRunningAll(false);
  };

  const filterOpts = ["All","Confirmed Dev","Likely Dev","Possible Dev","Not Dev","Pending","Error"];
  const shown = candidates.filter(t => {
    if (filter === "All") return true;
    if (filter === "Pending") return !results[t.addr];
    if (filter === "Error") return results[t.addr]?.confidence === "Error";
    return results[t.addr]?.confidence === filter;
  });

  const counts = {
    "Confirmed Dev": candidates.filter(t => results[t.addr]?.confidence === "Confirmed Dev").length,
    "Likely Dev":    candidates.filter(t => results[t.addr]?.confidence === "Likely Dev").length,
    "Possible Dev":  candidates.filter(t => results[t.addr]?.confidence === "Possible Dev").length,
    "Not Dev":       candidates.filter(t => results[t.addr]?.confidence === "Not Dev").length,
    researched:      candidates.filter(t => results[t.addr]?.status === "done").length,
  };

  return (
    <div>
      {/* Header */}
      <div style={{ background: BK, borderRadius: 10, padding: "20px 28px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ color: WHITE, fontWeight: 800, fontSize: 16 }}>
              Dev Site Intelligence
            </div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, marginTop: 4 }}>
              {candidates.length} candidate deals · Live web research via DOB, YIMBY, The Real Deal & more
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
              {counts.researched}/{candidates.length} researched
            </div>
            <button onClick={researchAll} disabled={runningAll}
              style={{ background: runningAll ? "#444" : R, color: WHITE, border: "none",
                padding: "9px 20px", borderRadius: 6, fontSize: 12, fontWeight: 700,
                cursor: runningAll ? "not-allowed" : "pointer" }}>
              {runningAll ? "⏳ Researching All…" : "🔍 Research All Deals"}
            </button>
          </div>
        </div>

        {/* Confidence summary row */}
        {counts.researched > 0 && (
          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {[["Confirmed Dev","✅"],["Likely Dev","⚡"],["Possible Dev","🔎"],["Not Dev","✗"]].map(([label, icon]) => (
              <div key={label} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 6,
                padding: "8px 16px", cursor: "pointer",
                border: filter === label ? `1px solid ${CONF_COLORS[label]}` : "1px solid transparent" }}
                onClick={() => setFilter(filter === label ? "All" : label)}>
                <div style={{ color: CONF_COLORS[label], fontSize: 18, fontWeight: 900 }}>
                  {icon} {counts[label]}
                </div>
                <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, letterSpacing: "1px",
                  textTransform: "uppercase", marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filter pills */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {filterOpts.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: "5px 14px", borderRadius: 20, border: "none", cursor: "pointer",
              fontSize: 12, fontWeight: 600,
              background: filter === f ? BK : "#E8E8E8",
              color: filter === f ? WHITE : GRAY }}>
            {f} {f === "Pending" ? `(${candidates.filter(t => !results[t.addr]).length})` :
                  f !== "All" ? `(${candidates.filter(t => results[t.addr]?.confidence === f).length})` :
                  `(${candidates.length})`}
          </button>
        ))}
      </div>

      {/* Deal list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {shown.map(txn => {
          const res = results[txn.addr];
          const isOpen = expanded === txn.addr;
          const isLoading = queue.includes(txn.addr);
          return (
            <div key={txn.addr}
              style={{ background: WHITE, borderRadius: 8, overflow: "hidden",
                border: isOpen ? `1px solid ${R}` : "1px solid #E8E8E8",
                transition: "border-color 0.15s" }}>

              {/* Row */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px",
                cursor: "pointer" }}
                onClick={() => setExpanded(isOpen ? null : txn.addr)}>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: BK,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {txn.addr}
                  </div>
                  <div style={{ fontSize: 11, color: GRAY, marginTop: 2 }}>
                    {txn.assetClass} · {txn.borough}
                    {txn.zoning && <span> · {txn.zoning}</span>}
                    {txn.isPortfolio && <span style={{ color: R }}> · Portfolio</span>}
                  </div>
                </div>

                <div style={{ fontSize: 14, fontWeight: 800, color: BK, flexShrink: 0 }}>
                  {fmt(txn.price)}
                </div>

                {isLoading ? (
                  <div style={{ fontSize: 11, color: GRAY, fontStyle: "italic",
                    flexShrink: 0, width: 120, textAlign: "right" }}>
                    ⏳ Searching…
                  </div>
                ) : res ? (
                  <div style={{ flexShrink: 0 }}>
                    <ConfBadge label={res.confidence} />
                  </div>
                ) : (
                  <button onClick={(e) => { e.stopPropagation(); researchDeal(txn); }}
                    style={{ background: LGRAY, color: BK, border: "none",
                      padding: "6px 14px", borderRadius: 5, fontSize: 11,
                      fontWeight: 700, cursor: "pointer", flexShrink: 0,
                      whiteSpace: "nowrap" }}>
                    🔍 Research
                  </button>
                )}

                <div style={{ color: GRAY, fontSize: 16, flexShrink: 0,
                  transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>
                  ›
                </div>
              </div>

              {/* Expanded panel */}
              {isOpen && res && res.status !== "Researching…" && (
                <div style={{ borderTop: "1px solid #F0F0F0", padding: "16px 18px",
                  background: "#FAFAFA" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                    <ConfBadge label={res.confidence} />
                    <div style={{ fontSize: 12, color: GRAY }}>AI Research Summary</div>
                  </div>

                  <p style={{ fontSize: 13, color: BK, lineHeight: 1.65, marginBottom: 14,
                    margin: "0 0 14px" }}>
                    {res.summary}
                  </p>

                  {res.signals?.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: GRAY,
                        letterSpacing: "1.5px", textTransform: "uppercase",
                        marginBottom: 6 }}>Key Signals</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {res.signals.map((s, i) => (
                          <span key={i} style={{ background: "#F0F0F0", color: BK,
                            padding: "4px 10px", borderRadius: 4, fontSize: 11 }}>
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {res.sources?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: GRAY,
                        letterSpacing: "1.5px", textTransform: "uppercase",
                        marginBottom: 6 }}>Sources Checked</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {res.sources.map((s, i) => (
                          <div key={i} style={{ fontSize: 11, color: GRAY,
                            display: "flex", gap: 6, alignItems: "flex-start" }}>
                            <span style={{ color: R, flexShrink: 0 }}>·</span>
                            <span>{s}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                 <div
  style={{
    marginTop: 14,
    paddingTop: 12,
    borderTop: "1px solid #EBEBEB",
    display: "flex",
    gap: 8,
  }}
>
  <button
    onClick={() => researchDeal(txn)}
    style={{
      background: "none",
      border: `1px solid #DDD`,
      color: GRAY,
      padding: "5px 14px",
      borderRadius: 4,
      fontSize: 11,
      cursor: "pointer",
    }}
  >
    ↺ Re-research
  </button>

  <a
    href={`https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?boro=${
      txn.borough === "Manhattan"
        ? 1
        : txn.borough === "Bronx"
        ? 2
        : txn.borough === "Brooklyn"
        ? 3
        : txn.borough === "Queens"
        ? 4
        : 5
    }&houseno=${encodeURIComponent(txn.addr.split(" ")[0])}&street=${encodeURIComponent(
      txn.addr.split(",")[0].replace(/^\d+\s+/, "")
    )}`}
    target="_blank"
    rel="noopener noreferrer"
    style={{
      background: "none",
      border: `1px solid #DDD`,
      color: GRAY,
      padding: "5px 14px",
      borderRadius: 4,
      fontSize: 11,
      cursor: "pointer",
      textDecoration: "none",
    }}
  >
    🏛 NYC DOB →
  </a>

  <a
    href={"https://yimby.com/?s=" + encodeURIComponent(txn.addr.split(",")[0])}
    target="_blank"
    rel="noopener noreferrer"
    style={{
      background: "none",
      border: `1px solid #DDD`,
      color: GRAY,
      padding: "5px 14px",
      borderRadius: 4,
      fontSize: 11,
      cursor: "pointer",
      textDecoration: "none",
    }}
  >
    🏗 YIMBY →
  </a>

  <a
    href={
      "https://therealdeal.com/search/?q=" +
      encodeURIComponent(txn.addr.split(",")[0]) +
      "+" +
      encodeURIComponent(txn.borough)
    }
    target="_blank"
    rel="noopener noreferrer"
    style={{
      background: "none",
      border: "1px solid #DDD",
      color: GRAY,
      padding: "5px 14px",
      borderRadius: 4,
      fontSize: 11,
      textDecoration: "none",
    }}
  >
    📰 TRD →
  </a>

  <a
    href={"https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(txn.addr)}
    target="_blank"
    rel="noopener noreferrer"
    style={{
      background: "none",
      border: "1px solid #DDD",
      color: GRAY,
      padding: "5px 14px",
      borderRadius: 4,
      fontSize: 11,
      textDecoration: "none",
    }}
  >
    🗺 Maps →
  </a>
</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── ENTITY INTELLIGENCE VIEW ────────────────────────────────────────────────
function EntityIntelView({ data }) {
  const { deduped, txns } = data;
  const [entityResults, setEntityResults] = useState(() => {
    // Pre-populate from localStorage cache
    const cached = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("schuckman_entity_")) {
          const val = JSON.parse(localStorage.getItem(key));
          if (val && Date.now() - val.cachedAt < 7 * 24 * 60 * 60 * 1000) {
            cached[val.entityName] = val;
          }
        }
      }
    } catch (_) {}
    return cached;
  });
  const [loadingEntity, setLoadingEntity] = useState(null);
  const [expandedEntity, setExpandedEntity] = useState(null);
  const [entityFilter, setEntityFilter] = useState("buyers");

  // Build entity list from transactions
  const buildEntities = (type) => {
    const map = {};
    const source = txns || deduped;
    for (const t of source) {
      const name = type === "buyers" ? t.buyer : t.seller;
      if (!name || name.trim().length < 2) continue;
      const key = name.trim();
      if (!map[key]) map[key] = { name: key, deals: 0, volume: 0, boroughs: new Set(), assetClasses: new Set() };
      map[key].deals++;
      map[key].volume += t.price;
      if (t.borough) map[key].boroughs.add(t.borough);
      if (t.assetClass) map[key].assetClasses.add(t.assetClass);
    }
    return Object.values(map)
      .map(e => ({ ...e, boroughs: [...e.boroughs], assetClasses: [...e.assetClasses] }))
      .sort((a, b) => b.volume - a.volume);
  };

  const entities = buildEntities(entityFilter);

  const researchEntity = async (entity) => {
    const cached = getCachedEntity(entity.name);
    if (cached) {
      setEntityResults(r => ({ ...r, [entity.name]: cached }));
      return;
    }
    setLoadingEntity(entity.name);

    const result = await callClaude({
      model: "sonnet",
      maxTokens: 2048,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [{ role: "user", content: `You are a NYC commercial real estate analyst. Research this ${entityFilter === "buyers" ? "buyer" : "seller"} entity.

Entity: "${entity.name}"
Context: ${entity.deals} deal(s) totaling ${fmt(entity.volume)} in this period
Boroughs: ${entity.boroughs.join(", ")}
Asset classes: ${entity.assetClasses.join(", ")}

Perform 2-3 web searches to find:
1. What type of entity is this? (developer, investor, REIT, fund, individual, LLC, etc.)
2. Any known portfolio, recent deals, or development activity
3. Key principals or parent company
4. Investment strategy or focus areas

After searching, return ONLY this JSON:
{
  "entityType": "Developer" | "Investor" | "Fund/REIT" | "Individual" | "LLC/Unknown",
  "description": "2-3 sentence description of what you found",
  "knownDeals": ["deal 1", "deal 2"],
  "strategy": "brief investment strategy if identifiable",
  "principals": "key people if found",
  "sources": ["source 1", "source 2"]
}

If you cannot find information, set entityType to "LLC/Unknown" and describe what you searched for.` }],
    });

    if (result.ok && result.text) {
      let parsed = null;
      try {
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch (_) {}

      if (parsed) {
        parsed.entityName = entity.name;
        setEntityResults(r => ({ ...r, [entity.name]: parsed }));
        cacheEntity(entity.name, parsed);
      } else {
        setEntityResults(r => ({ ...r, [entity.name]: {
          entityName: entity.name, entityType: "LLC/Unknown",
          description: result.text.slice(0, 300), sources: [] } }));
      }
    } else {
      setEntityResults(r => ({ ...r, [entity.name]: {
        entityName: entity.name, entityType: "Error",
        description: result.error || "Research failed", sources: [] } }));
    }
    setLoadingEntity(null);
  };

  const clearEntityCache = () => {
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("schuckman_entity_")) toRemove.push(key);
      }
      toRemove.forEach(k => localStorage.removeItem(k));
      setEntityResults({});
    } catch (_) {}
  };

  const TYPE_COLORS = {
    Developer: "#16A34A", Investor: "#3D5A80", "Fund/REIT": "#7C3AED",
    Individual: "#F5A623", "LLC/Unknown": "#9CA3AF", Error: "#DC2626",
  };

  return (
    <div>
      {/* Header */}
      <div style={{ background: BK, borderRadius: 10, padding: "20px 28px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ color: WHITE, fontWeight: 800, fontSize: 16 }}>
              Entity Intelligence
            </div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, marginTop: 4 }}>
              AI-powered buyer & seller research · ~$0.15 per lookup · Results cached 7 days
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.1)",
              borderRadius: 6, padding: 3 }}>
              {["buyers","sellers"].map(f => (
                <button key={f} onClick={() => setEntityFilter(f)}
                  style={{ padding: "6px 16px", borderRadius: 4, border: "none", cursor: "pointer",
                    fontSize: 12, fontWeight: 600, textTransform: "capitalize",
                    background: entityFilter === f ? R : "transparent",
                    color: WHITE }}>
                  {f}
                </button>
              ))}
            </div>
            <button onClick={clearEntityCache}
              style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)",
                color: "rgba(255,255,255,0.5)", padding: "6px 14px", borderRadius: 4,
                cursor: "pointer", fontSize: 11 }}>
              Clear Cache
            </button>
          </div>
        </div>
      </div>

      {/* Entity list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entities.slice(0, 50).map(entity => {
          const res = entityResults[entity.name];
          const isOpen = expandedEntity === entity.name;
          const isLoading = loadingEntity === entity.name;
          return (
            <div key={entity.name}
              style={{ background: WHITE, borderRadius: 8, overflow: "hidden",
                border: isOpen ? `1px solid ${R}` : "1px solid #E8E8E8" }}>

              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px",
                cursor: "pointer" }}
                onClick={() => setExpandedEntity(isOpen ? null : entity.name)}>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: BK,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entity.name}
                  </div>
                  <div style={{ fontSize: 11, color: GRAY, marginTop: 2 }}>
                    {entity.deals} deal{entity.deals > 1 ? "s" : ""} · {entity.boroughs.join(", ")}
                    {entity.assetClasses.length > 0 && ` · ${entity.assetClasses.join(", ")}`}
                  </div>
                </div>

                <div style={{ fontSize: 14, fontWeight: 800, color: BK, flexShrink: 0 }}>
                  {fmt(entity.volume)}
                </div>

                {res ? (
                  <span style={{ background: `${TYPE_COLORS[res.entityType] || "#9CA3AF"}22`,
                    color: TYPE_COLORS[res.entityType] || "#9CA3AF",
                    border: `1px solid ${TYPE_COLORS[res.entityType] || "#9CA3AF"}55`,
                    padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                    whiteSpace: "nowrap", flexShrink: 0 }}>
                    {res.entityType}
                  </span>
                ) : isLoading ? (
                  <div style={{ fontSize: 11, color: GRAY, fontStyle: "italic", flexShrink: 0 }}>
                    Researching…
                  </div>
                ) : (
                  <button onClick={(e) => { e.stopPropagation(); researchEntity(entity); }}
                    style={{ background: LGRAY, color: BK, border: "none",
                      padding: "6px 14px", borderRadius: 5, fontSize: 11,
                      fontWeight: 700, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" }}>
                    Research
                  </button>
                )}

                <div style={{ color: GRAY, fontSize: 16, flexShrink: 0,
                  transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>
                  ›
                </div>
              </div>

              {isOpen && res && (
                <div style={{ borderTop: "1px solid #F0F0F0", padding: "16px 18px",
                  background: "#FAFAFA" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                    <span style={{ background: `${TYPE_COLORS[res.entityType] || "#9CA3AF"}22`,
                      color: TYPE_COLORS[res.entityType] || "#9CA3AF",
                      padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                      {res.entityType}
                    </span>
                    <div style={{ fontSize: 12, color: GRAY }}>AI Research Summary</div>
                  </div>

                  <p style={{ fontSize: 13, color: BK, lineHeight: 1.65, margin: "0 0 14px" }}>
                    {res.description}
                  </p>

                  {res.principals && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: GRAY,
                        letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 4 }}>
                        Key Principals
                      </div>
                      <div style={{ fontSize: 12, color: BK }}>{res.principals}</div>
                    </div>
                  )}

                  {res.strategy && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: GRAY,
                        letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 4 }}>
                        Strategy
                      </div>
                      <div style={{ fontSize: 12, color: BK }}>{res.strategy}</div>
                    </div>
                  )}

                  {res.knownDeals?.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: GRAY,
                        letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 6 }}>
                        Known Deals / Activity
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {res.knownDeals.map((d, i) => (
                          <span key={i} style={{ background: "#F0F0F0", color: BK,
                            padding: "4px 10px", borderRadius: 4, fontSize: 11 }}>
                            {d}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {res.sources?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: GRAY,
                        letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 6 }}>
                        Sources
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {res.sources.map((s, i) => (
                          <div key={i} style={{ fontSize: 11, color: GRAY,
                            display: "flex", gap: 6, alignItems: "flex-start" }}>
                            <span style={{ color: R, flexShrink: 0 }}>·</span>
                            <span>{s}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #EBEBEB",
                    display: "flex", gap: 8 }}>
                    <button onClick={() => { delete entityResults[entity.name]; researchEntity(entity); }}
                      style={{ background: "none", border: "1px solid #DDD", color: GRAY,
                        padding: "5px 14px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>
                      Re-research
                    </button>
                    <a href={`https://www.google.com/search?q=${encodeURIComponent(entity.name + " NYC real estate")}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ background: "none", border: "1px solid #DDD", color: GRAY,
                        padding: "5px 14px", borderRadius: 4, fontSize: 11, textDecoration: "none" }}>
                      Google
                    </a>
                    <a href={`https://therealdeal.com/search/?q=${encodeURIComponent(entity.name)}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ background: "none", border: "1px solid #DDD", color: GRAY,
                        padding: "5px 14px", borderRadius: 4, fontSize: 11, textDecoration: "none" }}>
                      TRD
                    </a>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {entities.length > 50 && (
        <div style={{ textAlign: "center", padding: 16, fontSize: 12, color: GRAY }}>
          Showing top 50 of {entities.length} entities by volume
        </div>
      )}
    </div>
  );
}
