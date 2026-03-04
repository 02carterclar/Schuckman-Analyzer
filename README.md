import { useState, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

// ─── BRAND ────────────────────────────────────────────────────────────────────
const R     = "#E8192C";
const BK    = "#1A1A1A";
const GRAY  = "#6B6B6B";
const LGRAY = "#F2F2F2";
const WHITE = "#FFFFFF";

const ASSET_COLORS = {
  Multifamily:  "#E8192C",
  "Mixed-Use":  "#FF6B35",
  Development:  "#F5A623",
  Retail:       "#2C3E50",
  Industrial:   "#7F8C8D",
  Office:       "#3D5A80",
  Other:        "#BDC3C7",
};

// ─── ZIP → NEIGHBORHOOD ───────────────────────────────────────────────────────
const ZIP_NBD = {
  "11201":"Brooklyn Heights","11203":"East Flatbush","11204":"Borough Park",
  "11205":"Fort Greene","11206":"Bushwick","11207":"East New York",
  "11208":"East New York","11209":"Bay Ridge","11210":"Flatbush",
  "11211":"Williamsburg","11212":"Brownsville","11213":"Crown Heights",
  "11214":"Bensonhurst","11215":"Park Slope","11216":"Bed-Stuy",
  "11217":"Boerum Hill","11218":"Kensington","11219":"Borough Park",
  "11220":"Sunset Park","11221":"Bed-Stuy","11222":"Greenpoint",
  "11223":"Gravesend","11224":"Coney Island","11225":"Crown Heights",
  "11226":"Flatbush","11228":"Dyker Heights","11229":"Sheepshead Bay",
  "11230":"Midwood","11231":"Carroll Gardens","11232":"Sunset Park",
  "11233":"Brownsville","11234":"Canarsie","11235":"Brighton Beach",
  "11236":"Canarsie","11237":"Bushwick","11238":"Prospect Heights",
  "11239":"East New York",
  "11101":"Long Island City","11102":"Astoria","11103":"Astoria",
  "11104":"Sunnyside","11105":"Astoria","11106":"Astoria",
  "11354":"Flushing","11355":"Flushing","11356":"College Point",
  "11357":"Whitestone","11358":"Fresh Meadows","11361":"Bayside",
  "11362":"Little Neck","11363":"Little Neck","11364":"Oakland Gardens",
  "11365":"Fresh Meadows","11366":"Fresh Meadows","11367":"Kew Gardens Hills",
  "11368":"Corona","11369":"East Elmhurst","11370":"East Elmhurst",
  "11371":"East Elmhurst","11372":"Jackson Heights","11373":"Elmhurst",
  "11374":"Rego Park","11375":"Forest Hills","11377":"Woodside",
  "11378":"Maspeth","11379":"Middle Village","11385":"Ridgewood",
  "11411":"Cambria Heights","11412":"St. Albans","11413":"Springfield Gardens",
  "11414":"Howard Beach","11415":"Kew Gardens","11416":"Ozone Park",
  "11417":"Ozone Park","11418":"Richmond Hill","11419":"South Ozone Park",
  "11420":"South Ozone Park","11421":"Woodhaven","11422":"Rosedale",
  "11423":"Hollis","11426":"Bellerose","11427":"Queens Village",
  "11428":"Queens Village","11429":"Queens Village","11432":"Jamaica",
  "11433":"Jamaica","11434":"Jamaica","11435":"Jamaica","11436":"Jamaica",
  "11691":"Far Rockaway","11692":"Arverne","11694":"Rockaway Park",
};

// ─── CLASSIFICATION ───────────────────────────────────────────────────────────
// Always extracts the LAST parenthetical — where the actual NYC building code lives.
// e.g. "Multi-Story Retail Building (2 or More) (K2)"  →  "K2"
// e.g. "Two family Converted (From One Family) (B3)"   →  "B3"
function extractCode(bc) {
  if (!bc) return "";
  const matches = [...String(bc).matchAll(/\(([^)]+)\)/g)];
  return matches.length ? matches[matches.length - 1][1].trim() : "";
}

function classifyAsset(bc) {
  const code = extractCode(bc);
  if (!code) return "Other";
  const L = code[0];

  // ── FILTER (excluded from all analysis) ────────────────────────────────────
  if (L === "A") return null;                    // all 1-family (A0–A9)
  if (L === "B") return null;                    // all 2-family (B1–B9)
  if (code === "S1" || code === "S2") return null; // 1/2-family with store

  // ── DEVELOPMENT SITES ──────────────────────────────────────────────────────
  if (code === "V0" || code === "V1") return "Development";

  // ── MULTIFAMILY ────────────────────────────────────────────────────────────
  // C0  = 3-family
  // C1  = 7+ families, no stores
  // C2  = 5–6 families
  // C3  = 4 families
  // C4  = old law tenements (pre-1901, 3+ units)
  // C5  = converted rooming houses
  // C6  = walk-up co-ops
  // S3–S5 = 3–6 family with ONE store (res-dominant)
  if (["C0","C1","C2","C3","C4","C5","C6"].includes(code)) return "Multifamily";
  if (["S3","S4","S5"].includes(code)) return "Multifamily";

  // ── MIXED-USE ──────────────────────────────────────────────────────────────
  // C7  = walk-up, 7+ families WITH stores
  // S9  = multiple dwelling with stores/offices (no dominant class)
  // R8  = commercial condo unit inside a small residential building
  if (["C7","S9","R8"].includes(code)) return "Mixed-Use";

  // ── RETAIL ─────────────────────────────────────────────────────────────────
  // K*  = all retail store types (K1 one-story, K2 multi-story, K4 retail+other, K5 food, K9 misc)
  // G*  = garages, gas stations, auto (commercial use; dev potential tracked separately)
  if (L === "K") return "Retail";
  if (L === "G") return "Retail";

  // ── INDUSTRIAL ─────────────────────────────────────────────────────────────
  // E*  = warehouses (E1 fireproof, E2 contractors, E9 misc)
  // F*  = factories/manufacturing (F1 heavy, F4 semi-fireproof, F5 light, F9 misc)
  if (L === "E" || L === "F") return "Industrial";

  // ── OFFICE ─────────────────────────────────────────────────────────────────
  // O*  = all office types (O2 low-rise, O4 high-rise, O5/O6 office+commercial, O7 professional, O9 misc)
  if (L === "O") return "Office";

  // ── OTHER ──────────────────────────────────────────────────────────────────
  // H*  = hotels/hospitality
  // I*  = healthcare/institutional
  // M*  = religious
  // U*  = utilities
  // W*  = educational
  // Z*  = government/miscellaneous
  return "Other";
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function parseAddr(addr) {
  if (!addr) return { borough: "Unknown", neighborhood: "", zip: "" };
  const boroughs = ["Brooklyn","Queens","Manhattan","Bronx","Staten Island"];
  let borough = "Unknown";
  for (const b of boroughs) { if (addr.includes(b)) { borough = b; break; } }
  const zm = addr.match(/\b(\d{5})\b/);
  const zip = zm ? zm[1] : "";
  return { borough, neighborhood: ZIP_NBD[zip] || "", zip };
}

const fmt = (n) => {
  if (!n && n !== 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n.toLocaleString()}`;
};

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// ─── DATA PROCESSING ─────────────────────────────────────────────────────────
function processWorkbook(wb) {
  const MONTH_MAP = {
    "1":"January","2":"February","3":"March","4":"April","5":"May","6":"June",
    "7":"July","8":"August","9":"September","10":"October","11":"November","12":"December",
  };

  let rawRows = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    for (let i = 1; i < rows.length; i++) rawRows.push(rows[i]);
  }

  // Build transaction objects; filter 1/2-fam and sub-$1M
  let txns = [];
  for (const row of rawRows) {
    const [addr,,dateClosed,,price,buyer,seller,bc,zoning,,lotSqft,sqft,resUnits,,totalUnits,floors] = row;
    if (!addr || String(addr).length < 5) continue;
    if (!price || typeof price !== "number" || price < 1000000) continue;
    const assetClass = classifyAsset(bc);
    if (assetClass === null) continue;          // filtered out
    const { borough, neighborhood, zip } = parseAddr(String(addr));
    txns.push({
      addr: String(addr), dateClosed, price, buyer: buyer || "", seller: seller || "",
      bc: bc || "", assetClass, zoning: zoning || "", lotSqft, sqft,
      resUnits, totalUnits, floors, borough, neighborhood, zip,
      isPortfolio: false, portfolioId: null,
    });
  }

  // ── Portfolio detection: same buyer + same close date ──────────────────────
  const groups = {};
  for (const t of txns) {
    const key = `${(t.buyer).toLowerCase().trim()}|||${t.dateClosed}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }
  const portfolios = [];
  let pid = 1;
  for (const grp of Object.values(groups)) {
    if (grp.length < 2) continue;
    const id = `P${pid++}`;
    // Sum unique prices (PropertyShark sometimes repeats the deed total across lines)
    const uniquePrices = [...new Set(grp.map(t => t.price))];
    const totalPrice = uniquePrices.reduce((s, p) => s + p, 0);
    grp.forEach(t => { t.isPortfolio = true; t.portfolioId = id; t._portfolioPrice = totalPrice; });
    portfolios.push({ id, buyer: grp[0].buyer, count: grp.length, totalPrice,
      assetClass: grp[0].assetClass, borough: grp[0].borough, date: grp[0].dateClosed,
      properties: grp.map(t => t.addr) });
  }

  // Deduplicate: keep one row per portfolio
  const seenPortfolios = new Set();
  const deduped = txns.filter(t => {
    if (!t.isPortfolio) return true;
    if (seenPortfolios.has(t.portfolioId)) return false;
    seenPortfolios.add(t.portfolioId);
    return true;
  });

  // Effective price for each deduped transaction
  const getPrice = (t) => t.isPortfolio ? (t._portfolioPrice || t.price) : t.price;

  // ── Aggregate stats ────────────────────────────────────────────────────────
  const totalVolume = deduped.reduce((s, t) => s + getPrice(t), 0);
  const allPrices   = deduped.map(getPrice);
  const medianPrice = median(allPrices);

  const ASSET_ORDER = ["Multifamily","Mixed-Use","Development","Retail","Industrial","Office","Other"];
  const byAsset = ASSET_ORDER.map(cls => ({
    name: cls,
    count:  deduped.filter(t => t.assetClass === cls).length,
    volume: deduped.filter(t => t.assetClass === cls).reduce((s, t) => s + getPrice(t), 0),
  })).filter(a => a.count > 0);

  const BOROUGH_ORDER = ["Brooklyn","Queens","Manhattan","Bronx","Staten Island"];
  const byBorough = BOROUGH_ORDER.map(b => ({
    name: b,
    count:  deduped.filter(t => t.borough === b).length,
    volume: deduped.filter(t => t.borough === b).reduce((s, t) => s + getPrice(t), 0),
  })).filter(b => b.count > 0).sort((a, b) => b.volume - a.volume);

  const topDeals = [...deduped]
    .sort((a, b) => getPrice(b) - getPrice(a))
    .slice(0, 10)
    .map(t => ({ ...t, displayPrice: getPrice(t) }));

  const getTopNbds = (borough) => {
    const map = {};
    deduped.filter(t => t.borough === borough && t.neighborhood).forEach(t => {
      if (!map[t.neighborhood]) map[t.neighborhood] = { count: 0, volume: 0 };
      map[t.neighborhood].count++;
      map[t.neighborhood].volume += getPrice(t);
    });
    return Object.entries(map)
      .sort((a, b) => b[1].volume - a[1].volume)
      .slice(0, 8)
      .map(([name, d]) => ({ name, ...d }));
  };

  // Period label from sheet names
  const first = wb.SheetNames[0] || "";
  const mm = first.match(/^(\d+)\./);
  const ym = (wb.SheetNames[wb.SheetNames.length - 1] || "").match(/(\d{2})$/);
  const period = mm
    ? `${MONTH_MAP[mm[1]] || mm[1]} ${ym ? "20" + ym[1] : ""} Report`.trim()
    : "Monthly Report";

  return {
    txns, portfolios, deduped, getPrice,
    totalVolume, medianPrice,
    count:          deduped.length,
    filteredCount:  txns.length,
    devCount:       deduped.filter(t => t.assetClass === "Development").length,
    portfolioCount: portfolios.length,
    byAsset, byBorough, topDeals,
    bkNbds:  getTopNbds("Brooklyn"),
    qnsNbds: getTopNbds("Queens"),
    period,
  };
}

// ─── LOGO ──────────────────────────────────────────────────────────────────────
function SchuckmanLogo({ size = "md", mono = false }) {
  const sizes = { sm:{fs:18,sub:6,gap:2}, md:{fs:26,sub:8,gap:3}, lg:{fs:38,sub:11,gap:4} };
  const s = sizes[size];
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:s.gap, lineHeight:1 }}>
      <div style={{ fontFamily:"'Arial Black','Franklin Gothic Heavy',sans-serif",
        fontWeight:900, fontSize:s.fs, color: mono ? WHITE : R, letterSpacing:"-0.5px" }}>
        SCHUCKMAN
      </div>
      <div style={{ fontFamily:"Arial,sans-serif", fontWeight:400, fontSize:s.sub,
        color: mono ? "rgba(255,255,255,0.7)" : "#444", letterSpacing:"5px" }}>
        REALTY INC.
      </div>
    </div>
  );
}

// ─── STAT CARD ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent = R }) {
  return (
    <div style={{ background:WHITE, border:"1px solid #E8E8E8", borderRadius:8,
      padding:"16px 20px", borderTop:`3px solid ${accent}` }}>
      <div style={{ fontSize:10, fontWeight:700, color:GRAY, letterSpacing:"1.5px",
        textTransform:"uppercase", marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:28, fontWeight:900, color:BK, lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:GRAY, marginTop:4 }}>{sub}</div>}
    </div>
  );
}

// ─── IG HELPERS ──────────────────────────────────────────────────────────────
function IGSlide({ children, bg = WHITE, style = {} }) {
  return (
    <div style={{ width:540, height:540, background:bg, overflow:"hidden", flexShrink:0,
      display:"flex", flexDirection:"column", position:"relative",
      fontFamily:"Arial,sans-serif", boxShadow:"0 4px 24px rgba(0,0,0,0.15)", ...style }}>
      {children}
    </div>
  );
}
function IGHeader({ period, mono = false }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start",
      padding:"20px 24px 0" }}>
      <SchuckmanLogo size="sm" mono={mono} />
      <div style={{ fontSize:9, fontWeight:600, letterSpacing:"1.5px",
        color: mono ? "rgba(255,255,255,0.55)" : GRAY, textTransform:"uppercase",
        textAlign:"right", lineHeight:1.5 }}>
        NYC INVESTMENT SALES<br />{period?.toUpperCase()}
      </div>
    </div>
  );
}
function IGFooter({ mono = false }) {
  return (
    <div style={{ padding:"0 24px 16px", display:"flex", justifyContent:"space-between",
      alignItems:"center", marginTop:"auto" }}>
      <div style={{ fontSize:8, color: mono ? "rgba(255,255,255,0.35)" : "#BBB",
        letterSpacing:"1px" }}>SOURCE: PROPERTYSHARK</div>
      <div style={{ fontSize:8, color: mono ? "rgba(255,255,255,0.35)" : "#BBB",
        letterSpacing:"1px" }}>SCHUCKMANREALTY.COM</div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab]         = useState("instagram");
  const [slideIdx, setSlideIdx] = useState(0);
  const fileRef = useRef();

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf, { type: "array" });
      setData(processWorkbook(wb));
      setTab("instagram");
      setSlideIdx(0);
    } catch (e) {
      alert("Error reading file: " + e.message);
    }
    setLoading(false);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  const TABS = [
    { id:"instagram", label:"📱 Instagram" },
    { id:"article",   label:"📰 Website Article" },
    { id:"team",      label:"📊 Team Report" },
    { id:"devintel",  label:"🔍 Dev Intelligence" },
  ];

  return (
    <div style={{ minHeight:"100vh", background:"#F0F0F0", fontFamily:"Arial,sans-serif" }}>
      {/* TOP BAR */}
      <div style={{ background:BK, padding:"0 32px", display:"flex", alignItems:"center",
        justifyContent:"space-between", height:60 }}>
        <SchuckmanLogo size="sm" mono={true} />
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", letterSpacing:"2px",
          textTransform:"uppercase" }}>NYC Investment Sales Analyzer</div>
      </div>

      <div style={{ maxWidth:1120, margin:"0 auto", padding:"32px 24px" }}>
        {/* UPLOAD ZONE */}
        {!data && !loading && (
          <div onDrop={onDrop} onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            style={{ background:WHITE, border:"2px dashed #CCC", borderRadius:12,
              padding:"80px 40px", textAlign:"center", cursor:"pointer" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = R}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#CCC"}>
            <input ref={fileRef} type="file" accept=".xlsx,.xls"
              style={{ display:"none" }} onChange={e => handleFile(e.target.files[0])} />
            <div style={{ fontSize:48, marginBottom:16 }}>📂</div>
            <div style={{ fontSize:22, fontWeight:800, color:BK, marginBottom:8 }}>
              Drop Your PropertyShark Export Here
            </div>
            <div style={{ fontSize:14, color:GRAY, marginBottom:24 }}>
              Weekly or monthly XLSX — all sheets combined and analyzed automatically
            </div>
            <div style={{ display:"inline-block", background:R, color:WHITE,
              padding:"12px 32px", borderRadius:6, fontSize:14, fontWeight:700 }}>
              Choose File
            </div>
          </div>
        )}

        {loading && (
          <div style={{ textAlign:"center", padding:80 }}>
            <div style={{ fontSize:14, color:GRAY }}>Processing transactions…</div>
          </div>
        )}

        {data && !loading && (
          <>
            {/* SUMMARY BAR */}
            <div style={{ background:BK, borderRadius:10, padding:"20px 28px", marginBottom:24,
              display:"flex", alignItems:"center", justifyContent:"space-between",
              flexWrap:"wrap", gap:16 }}>
              <div>
                <div style={{ color:WHITE, fontWeight:800, fontSize:18 }}>{data.period}</div>
                <div style={{ color:"rgba(255,255,255,0.45)", fontSize:12, marginTop:3 }}>
                  {data.filteredCount} qualifying transactions · {data.portfolioCount} portfolio{data.portfolioCount!==1?"s":""} identified
                </div>
              </div>
              <div style={{ display:"flex", gap:28 }}>
                {[
                  { label:"VOLUME",       val: fmt(data.totalVolume) },
                  { label:"TRANSACTIONS", val: data.count },
                  { label:"MEDIAN",       val: fmt(data.medianPrice) },
                  { label:"DEV SITES",    val: data.devCount },
                ].map(({ label, val }) => (
                  <div key={label} style={{ textAlign:"center" }}>
                    <div style={{ color:"rgba(255,255,255,0.4)", fontSize:9, letterSpacing:"1px",
                      textTransform:"uppercase" }}>{label}</div>
                    <div style={{ color:WHITE, fontWeight:900, fontSize:20 }}>{val}</div>
                  </div>
                ))}
              </div>
              <button onClick={() => setData(null)}
                style={{ background:"transparent", border:"1px solid rgba(255,255,255,0.2)",
                  color:"rgba(255,255,255,0.5)", padding:"8px 16px", borderRadius:4,
                  cursor:"pointer", fontSize:12 }}>
                ↑ Upload New
              </button>
            </div>

            {/* TABS */}
            <div style={{ display:"flex", gap:4, marginBottom:24 }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  style={{ padding:"10px 22px", borderRadius:6, border:"none", cursor:"pointer",
                    fontSize:13, fontWeight:600, transition:"all 0.15s",
                    background: tab===t.id ? R : WHITE, color: tab===t.id ? WHITE : GRAY,
                    boxShadow: tab===t.id ? "0 2px 8px rgba(232,25,44,0.3)" : "none" }}>
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "instagram" && <InstagramView data={data} slideIdx={slideIdx} setSlideIdx={setSlideIdx} />}
            {tab === "article"   && <ArticleView   data={data} />}
            {tab === "team"      && <TeamView      data={data} />}
            {tab === "devintel"  && <DevIntelView  data={data} />}
          </>
        )}
      </div>
    </div>
  );
}

// ─── INSTAGRAM VIEW ───────────────────────────────────────────────────────────
function InstagramView({ data, slideIdx, setSlideIdx }) {
  const { period, totalVolume, count, medianPrice, byAsset, byBorough,
          topDeals, devCount, portfolioCount } = data;

  const slides = [
    // 1 — Cover
    <IGSlide key="cover" bg={BK}>
      <div style={{ flex:1, display:"flex", flexDirection:"column",
        justifyContent:"center", padding:"32px 40px" }}>
        <div style={{ width:48, height:4, background:R, marginBottom:24 }} />
        <div style={{ color:"rgba(255,255,255,0.5)", fontSize:12, letterSpacing:"3px",
          fontWeight:700, textTransform:"uppercase", marginBottom:12 }}>NYC Investment Sales</div>
        <div style={{ color:WHITE, fontSize:44, fontWeight:900, lineHeight:1.05, marginBottom:20 }}>
          {period?.replace(" Report","")}<br />Market<br />Report
        </div>
        <div style={{ color:"rgba(255,255,255,0.3)", fontSize:11, letterSpacing:"1px" }}>
          SOURCE: PROPERTYSHARK
        </div>
      </div>
      <div style={{ padding:"0 40px 32px", display:"flex", justifyContent:"space-between",
        alignItems:"flex-end" }}>
        <SchuckmanLogo size="md" mono={true} />
        <div style={{ textAlign:"right", color:"rgba(255,255,255,0.35)", fontSize:9,
          letterSpacing:"1.5px", textTransform:"uppercase", lineHeight:1.8 }}>
          Brooklyn · Queens<br />Manhattan · Bronx
        </div>
      </div>
    </IGSlide>,

    // 2 — Market Overview
    <IGSlide key="overview" bg={WHITE}>
      <IGHeader period={period} mono={false} />
      <div style={{ flex:1, padding:"16px 28px 0" }}>
        <div style={{ fontSize:10, fontWeight:700, letterSpacing:"2px",
          color:R, textTransform:"uppercase", marginBottom:16 }}>Market Overview</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          {[
            { label:"Total Volume",  val:fmt(totalVolume), bg:R,     color:WHITE },
            { label:"Transactions",  val:count,            bg:BK,    color:WHITE },
            { label:"Median Price",  val:fmt(medianPrice), bg:LGRAY, color:BK   },
            { label:"Dev Sites",     val:devCount,         bg:LGRAY, color:BK   },
          ].map(({ label, val, bg, color }) => (
            <div key={label} style={{ background:bg, borderRadius:8, padding:"20px",
              display:"flex", flexDirection:"column", justifyContent:"center" }}>
              <div style={{ fontSize:9, fontWeight:700, letterSpacing:"1.5px",
                textTransform:"uppercase", marginBottom:8,
                color: bg===LGRAY ? GRAY : "rgba(255,255,255,0.55)" }}>{label}</div>
              <div style={{ fontSize:36, fontWeight:900, color, lineHeight:1 }}>{val}</div>
            </div>
          ))}
        </div>
        {portfolioCount > 0 && (
          <div style={{ marginTop:12, background:"#FFF5F5", borderLeft:`3px solid ${R}`,
            padding:"8px 12px", borderRadius:"0 6px 6px 0" }}>
            <div style={{ fontSize:11, color:BK, fontWeight:600 }}>
              ⚠ {portfolioCount} portfolio transaction{portfolioCount!==1?"s":""} identified & deduplicated
            </div>
          </div>
        )}
      </div>
      <IGFooter mono={false} />
    </IGSlide>,

    // 3 — Asset Class
    <IGSlide key="assets" bg={WHITE}>
      <IGHeader period={period} mono={false} />
      <div style={{ flex:1, padding:"12px 24px 0" }}>
        <div style={{ fontSize:10, fontWeight:700, letterSpacing:"2px",
          color:R, textTransform:"uppercase", marginBottom:14 }}>By Asset Class</div>
        {byAsset.map(a => {
          const maxVol = Math.max(...byAsset.map(x => x.volume));
          return (
            <div key={a.name} style={{ marginBottom:11 }}>
              <div style={{ display:"flex", justifyContent:"space-between",
                alignItems:"baseline", marginBottom:4 }}>
                <div style={{ fontSize:12, fontWeight:700, color:BK }}>{a.name}</div>
                <div style={{ display:"flex", gap:12 }}>
                  <span style={{ fontSize:11, color:GRAY }}>{a.count} deals</span>
                  <span style={{ fontSize:12, fontWeight:800, color:BK }}>{fmt(a.volume)}</span>
                </div>
              </div>
              <div style={{ background:LGRAY, borderRadius:3, height:8 }}>
                <div style={{ width:`${(a.volume/maxVol)*100}%`, height:8, borderRadius:3,
                  background: ASSET_COLORS[a.name] || R }} />
              </div>
            </div>
          );
        })}
      </div>
      <IGFooter mono={false} />
    </IGSlide>,

    // 4 — Borough
    <IGSlide key="boroughs" bg={BK}>
      <IGHeader period={period} mono={true} />
      <div style={{ flex:1, padding:"12px 28px 0" }}>
        <div style={{ fontSize:10, fontWeight:700, letterSpacing:"2px",
          color:R, textTransform:"uppercase", marginBottom:14 }}>Borough Activity</div>
        {byBorough.map((b, i) => {
          const maxVol = Math.max(...byBorough.map(x => x.volume));
          return (
            <div key={b.name} style={{ marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                <div style={{ fontSize:14, fontWeight:700, color:WHITE }}>{b.name}</div>
                <div>
                  <span style={{ fontSize:13, fontWeight:800, color:WHITE }}>{fmt(b.volume)}</span>
                  <span style={{ fontSize:11, color:"rgba(255,255,255,0.4)",
                    marginLeft:8 }}>{b.count} deals</span>
                </div>
              </div>
              <div style={{ background:"rgba(255,255,255,0.1)", borderRadius:3, height:6 }}>
                <div style={{ width:`${(b.volume/maxVol)*100}%`, height:6, borderRadius:3,
                  background: i===0 ? R : "rgba(255,255,255,0.45)" }} />
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
      <div style={{ flex:1, padding:"12px 24px 0" }}>
        <div style={{ fontSize:10, fontWeight:700, letterSpacing:"2px",
          color:R, textTransform:"uppercase", marginBottom:12 }}>Top Transactions</div>
        {topDeals.slice(0,5).map((t, i) => (
          <div key={i} style={{ display:"flex", gap:12, alignItems:"flex-start",
            paddingBottom:11, marginBottom:11,
            borderBottom: i<4 ? "1px solid #F0F0F0" : "none" }}>
            <div style={{ background: i===0 ? R : LGRAY, color: i===0 ? WHITE : GRAY,
              width:24, height:24, borderRadius:4, display:"flex", alignItems:"center",
              justifyContent:"center", fontSize:11, fontWeight:800, flexShrink:0 }}>
              {i+1}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:11, fontWeight:700, color:BK,
                whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                {t.addr}
              </div>
              <div style={{ fontSize:10, color:GRAY, marginTop:1 }}>
                {t.assetClass} · {t.borough}
                {t.isPortfolio && <span style={{ color:R, fontWeight:700 }}> · Portfolio</span>}
              </div>
            </div>
            <div style={{ fontSize:13, fontWeight:800, color:BK, flexShrink:0 }}>
              {fmt(t.displayPrice)}
            </div>
          </div>
        ))}
      </div>
      <IGFooter mono={false} />
    </IGSlide>,
  ];

  return (
    <div style={{ background:WHITE, borderRadius:10, padding:28 }}>
      <div style={{ display:"flex", justifyContent:"space-between",
        alignItems:"center", marginBottom:20 }}>
        <div>
          <div style={{ fontWeight:800, fontSize:16, color:BK }}>Instagram Slides</div>
          <div style={{ fontSize:12, color:GRAY, marginTop:2 }}>
            {slides.length} slides · 1:1 format · Screenshot each slide to save
          </div>
        </div>
        <div style={{ display:"flex", gap:6 }}>
          {slides.map((_,i) => (
            <button key={i} onClick={() => setSlideIdx(i)}
              style={{ width:32, height:32, borderRadius:4, border:"none", cursor:"pointer",
                fontSize:12, fontWeight:700, background: slideIdx===i ? R : LGRAY,
                color: slideIdx===i ? WHITE : GRAY }}>{i+1}</button>
          ))}
        </div>
      </div>
      <div style={{ display:"flex", justifyContent:"center", gap:28, alignItems:"center" }}>
        <button onClick={() => setSlideIdx(Math.max(0, slideIdx-1))} disabled={slideIdx===0}
          style={{ background:"none", border:`2px solid ${slideIdx===0?"#EEE":R}`,
            color: slideIdx===0?"#CCC":R, width:40, height:40, borderRadius:20,
            fontSize:20, cursor: slideIdx===0?"default":"pointer", fontWeight:700 }}>‹</button>
        {slides[slideIdx]}
        <button onClick={() => setSlideIdx(Math.min(slides.length-1, slideIdx+1))}
          disabled={slideIdx===slides.length-1}
          style={{ background:"none",
            border:`2px solid ${slideIdx===slides.length-1?"#EEE":R}`,
            color: slideIdx===slides.length-1?"#CCC":R,
            width:40, height:40, borderRadius:20, fontSize:20,
            cursor: slideIdx===slides.length-1?"default":"pointer", fontWeight:700 }}>›</button>
      </div>
      <div style={{ textAlign:"center", marginTop:14, fontSize:12, color:GRAY }}>
        Slide {slideIdx+1} of {slides.length} — Screenshot or right-click to save
      </div>
    </div>
  );
}

// ─── ARTICLE VIEW ─────────────────────────────────────────────────────────────
function ArticleView({ data }) {
  const { period, totalVolume, count, medianPrice, byAsset, byBorough,
          topDeals, devCount, portfolioCount, bkNbds, qnsNbds } = data;
  const [copied, setCopied] = useState(false);

  const topBorough = byBorough[0] || {};
  const topAsset   = [...byAsset].sort((a,b)=>b.volume-a.volume)[0] || {};
  const mfData     = byAsset.find(a => a.name==="Multifamily") || {};

  const plainText = [
    `NYC INVESTMENT SALES MARKET REPORT — ${period}`,
    ``,
    `The New York City investment sales market recorded ${count} qualifying transactions totaling ${fmt(totalVolume)} in ${period}, with a median transaction price of ${fmt(medianPrice)}. Data sourced from PropertyShark; single-family and two-family sales excluded. ${portfolioCount} portfolio transaction${portfolioCount!==1?"s":""} identified and deduplicated.`,
    ``,
    `BOROUGH BREAKDOWN`,
    ...byBorough.map(b => `${b.name}: ${b.count} transactions · ${fmt(b.volume)}`),
    ``,
    `ASSET CLASS BREAKDOWN`,
    ...byAsset.map(a => `${a.name}: ${a.count} transactions · ${fmt(a.volume)}`),
    ``,
    bkNbds.length ? `TOP BROOKLYN NEIGHBORHOODS\n${bkNbds.map((n,i)=>`${i+1}. ${n.name} — ${n.count} deals · ${fmt(n.volume)}`).join("\n")}` : "",
    ``,
    qnsNbds.length ? `TOP QUEENS NEIGHBORHOODS\n${qnsNbds.map((n,i)=>`${i+1}. ${n.name} — ${n.count} deals · ${fmt(n.volume)}`).join("\n")}` : "",
    ``,
    `TOP TRANSACTIONS`,
    ...topDeals.slice(0,5).map((t,i)=>`${i+1}. ${t.addr} — ${t.assetClass}${t.isPortfolio?" (Portfolio)":""} — ${fmt(t.displayPrice)}`),
    ``,
    `Source: PropertyShark | Analysis: Schuckman Realty Inc.`,
  ].join("\n");

  const copy = () => {
    navigator.clipboard.writeText(plainText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ background:WHITE, borderRadius:10, padding:32 }}>
      <div style={{ display:"flex", justifyContent:"space-between",
        alignItems:"center", marginBottom:24 }}>
        <div>
          <div style={{ fontWeight:800, fontSize:16, color:BK }}>Website Article</div>
          <div style={{ fontSize:12, color:GRAY, marginTop:2 }}>Copy-paste into your CMS</div>
        </div>
        <button onClick={copy}
          style={{ background: copied?"#22C55E":R, color:WHITE, border:"none",
            padding:"10px 24px", borderRadius:6, fontSize:13, fontWeight:700, cursor:"pointer" }}>
          {copied ? "✓ Copied!" : "Copy Article Text"}
        </button>
      </div>

      <div style={{ background:"#FAFAFA", border:"1px solid #E8E8E8", borderRadius:8,
        padding:"40px 48px", maxWidth:740, margin:"0 auto" }}>
        <div style={{ marginBottom:28 }}><SchuckmanLogo size="md" /></div>
        <div style={{ borderLeft:`4px solid ${R}`, paddingLeft:20, marginBottom:28 }}>
          <div style={{ fontSize:26, fontWeight:900, color:BK, lineHeight:1.2, marginBottom:6 }}>
            NYC Investment Sales Market Report
          </div>
          <div style={{ fontSize:16, color:R, fontWeight:700 }}>{period}</div>
        </div>
        <p style={{ fontSize:15, lineHeight:1.75, color:"#333", marginBottom:24 }}>
          The New York City investment sales market recorded <strong>{count}</strong> qualifying
          transactions totaling <strong>{fmt(totalVolume)}</strong> in {period}, with a median
          transaction price of <strong>{fmt(medianPrice)}</strong>. Data sourced from PropertyShark;
          single-family and two-family sales excluded.{" "}
          <strong>{portfolioCount} portfolio transaction{portfolioCount!==1?"s":""}</strong> identified
          and deduplicated.
        </p>

        {/* KPI bar */}
        <div style={{ background:BK, borderRadius:8, padding:"22px 28px",
          display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16, marginBottom:28 }}>
          {[
            { label:"Total Volume",  val:fmt(totalVolume) },
            { label:"Transactions",  val:count },
            { label:"Median Price",  val:fmt(medianPrice) },
          ].map(({ label, val }) => (
            <div key={label} style={{ textAlign:"center" }}>
              <div style={{ color:"rgba(255,255,255,0.45)", fontSize:9, letterSpacing:"1.5px",
                textTransform:"uppercase", marginBottom:6 }}>{label}</div>
              <div style={{ color:WHITE, fontWeight:900, fontSize:22 }}>{val}</div>
            </div>
          ))}
        </div>

        {/* Asset table */}
        <div style={{ fontSize:13, fontWeight:800, color:R, letterSpacing:"2px",
          textTransform:"uppercase", marginBottom:14 }}>Asset Class Breakdown</div>
        <div style={{ marginBottom:28 }}>
          {byAsset.map(a => (
            <div key={a.name} style={{ display:"flex", justifyContent:"space-between",
              padding:"10px 0", borderBottom:"1px solid #EEE", alignItems:"center" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:10, height:10, borderRadius:2,
                  background: ASSET_COLORS[a.name] }} />
                <span style={{ fontSize:14, fontWeight:600, color:BK }}>{a.name}</span>
              </div>
              <div style={{ display:"flex", gap:20, fontSize:13 }}>
                <span style={{ color:GRAY }}>{a.count} transactions</span>
                <span style={{ fontWeight:700, color:BK }}>{fmt(a.volume)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Neighborhood grids */}
        {[{label:"Brooklyn", nbds:bkNbds},{label:"Queens", nbds:qnsNbds}].map(({ label, nbds }) =>
          nbds.length > 0 ? (
            <div key={label} style={{ marginBottom:28 }}>
              <div style={{ fontSize:13, fontWeight:800, color:R, letterSpacing:"2px",
                textTransform:"uppercase", marginBottom:14 }}>Top {label} Neighborhoods</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                {nbds.slice(0,6).map(n => (
                  <div key={n.name} style={{ background:LGRAY, borderRadius:6, padding:"12px 14px" }}>
                    <div style={{ fontSize:13, fontWeight:700, color:BK }}>{n.name}</div>
                    <div style={{ fontSize:11, color:GRAY, marginTop:2 }}>
                      {n.count} deals · {fmt(n.volume)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null
        )}

        {/* Top deals */}
        <div style={{ fontSize:13, fontWeight:800, color:R, letterSpacing:"2px",
          textTransform:"uppercase", marginBottom:14 }}>Top Transactions</div>
        {topDeals.slice(0,5).map((t,i) => (
          <div key={i} style={{ display:"flex", gap:14, paddingBottom:12, marginBottom:12,
            borderBottom:"1px solid #EEE" }}>
            <div style={{ fontSize:18, fontWeight:900, color: i===0?R:"#CCC",
              width:28, flexShrink:0 }}>#{i+1}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:14, fontWeight:700, color:BK }}>{t.addr}</div>
              <div style={{ fontSize:12, color:GRAY, marginTop:2 }}>
                {t.assetClass} · {t.borough}
                {t.isPortfolio && <span style={{ color:R }}> · Portfolio</span>}
              </div>
            </div>
            <div style={{ fontSize:16, fontWeight:900, color:BK, flexShrink:0 }}>
              {fmt(t.displayPrice)}
            </div>
          </div>
        ))}

        <div style={{ marginTop:36, paddingTop:18, borderTop:"1px solid #EEE",
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <SchuckmanLogo size="sm" />
          <div style={{ fontSize:9, color:"#CCC", letterSpacing:"1px" }}>SOURCE: PROPERTYSHARK</div>
        </div>
      </div>
    </div>
  );
}

// ─── TEAM REPORT VIEW ─────────────────────────────────────────────────────────
function TeamView({ data }) {
  const { period, totalVolume, count, medianPrice, byAsset, byBorough,
          topDeals, devCount, portfolioCount, bkNbds, qnsNbds, deduped, getPrice } = data;
  const [activeBorough, setActiveBorough] = useState("All");
  const boroughs = ["All", ...byBorough.map(b => b.name)];

  const filtered = activeBorough === "All" ? deduped
    : deduped.filter(t => t.borough === activeBorough);

  const ASSET_ORDER = ["Multifamily","Mixed-Use","Development","Retail","Industrial","Office","Other"];
  const assetBreakdown = ASSET_ORDER.map(cls => ({
    name: cls,
    count:  filtered.filter(t => t.assetClass === cls).length,
    volume: filtered.filter(t => t.assetClass === cls).reduce((s,t) => s + getPrice(t), 0),
  })).filter(a => a.count > 0);

  const filteredVolume = filtered.reduce((s,t) => s + getPrice(t), 0);
  const filteredMedian = median(filtered.map(getPrice));

  return (
    <div>
      <div style={{ background:BK, borderRadius:10, padding:"20px 28px", marginBottom:18,
        display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12 }}>
        <div>
          <SchuckmanLogo size="sm" mono={true} />
          <div style={{ color:"rgba(255,255,255,0.4)", fontSize:11, marginTop:8,
            letterSpacing:"1.5px", textTransform:"uppercase" }}>
            Investment Sales · Team Report · {period}
          </div>
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {boroughs.map(b => (
            <button key={b} onClick={() => setActiveBorough(b)}
              style={{ padding:"6px 14px", borderRadius:4, border:"none", cursor:"pointer",
                fontSize:12, fontWeight:600,
                background: activeBorough===b ? R : "rgba(255,255,255,0.1)", color:WHITE }}>
              {b}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:18 }}>
        <StatCard label="Total Volume"  value={fmt(filteredVolume)} accent={R} />
        <StatCard label="Transactions"  value={filtered.length} sub={`${portfolioCount} portfolios identified`} accent={BK} />
        <StatCard label="Median Price"  value={fmt(filteredMedian)} accent={GRAY} />
        <StatCard label="Dev Sites"     value={filtered.filter(t=>t.assetClass==="Development").length}
          sub="Vacant land transactions" accent="#F5A623" />
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:18 }}>
        {[
          { title:"Volume by Asset Class", key:"volume", tickFmt: v => v>=1e6?`$${(v/1e6).toFixed(0)}M`:`$${v}` },
          { title:"Deal Count by Asset Class", key:"count", tickFmt: v => v },
        ].map(({ title, key, tickFmt }) => (
          <div key={title} style={{ background:WHITE, borderRadius:10, padding:20 }}>
            <div style={{ fontSize:11, fontWeight:700, color:BK, marginBottom:14,
              letterSpacing:"1px", textTransform:"uppercase" }}>{title}</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={assetBreakdown} margin={{ top:0, right:0, left:0, bottom:0 }}>
                <XAxis dataKey="name" tick={{ fontSize:9, fill:GRAY }} />
                <YAxis tick={{ fontSize:9, fill:GRAY }} tickFormatter={tickFmt} />
                <Tooltip formatter={v => [key==="volume"?fmt(v):v, key==="volume"?"Volume":"Deals"]}
                  contentStyle={{ fontSize:12 }} />
                <Bar dataKey={key} radius={[3,3,0,0]}>
                  {assetBreakdown.map(a => <Cell key={a.name} fill={ASSET_COLORS[a.name]||R} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:18 }}>
        {[{label:"Brooklyn",nbds:bkNbds},{label:"Queens",nbds:qnsNbds}].map(({ label, nbds }) => (
          <div key={label} style={{ background:WHITE, borderRadius:10, padding:20 }}>
            <div style={{ fontSize:11, fontWeight:700, color:BK, marginBottom:14,
              letterSpacing:"1px", textTransform:"uppercase" }}>{label} — Top Neighborhoods</div>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ borderBottom:`2px solid ${R}` }}>
                  {["Neighborhood","Deals","Volume"].map(h => (
                    <th key={h} style={{ textAlign: h==="Volume"||h==="Deals"?"right":"left",
                      padding:"4px 0", color:GRAY, fontWeight:700, fontSize:10, letterSpacing:"1px",
                      textTransform:"uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {nbds.slice(0,7).map((n,i) => (
                  <tr key={n.name} style={{ borderBottom:"1px solid #F5F5F5" }}>
                    <td style={{ padding:"9px 0", fontWeight:600, color:BK }}>{n.name}</td>
                    <td style={{ padding:"9px 0", textAlign:"right", color:GRAY }}>{n.count}</td>
                    <td style={{ padding:"9px 0", textAlign:"right", fontWeight:700,
                      color: i===0?R:BK }}>{fmt(n.volume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div style={{ background:WHITE, borderRadius:10, padding:20, marginBottom:18 }}>
        <div style={{ fontSize:11, fontWeight:700, color:BK, marginBottom:14,
          letterSpacing:"1px", textTransform:"uppercase" }}>Notable Transactions</div>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead>
            <tr style={{ borderBottom:`2px solid ${R}` }}>
              {["#","Address","Asset Class","Borough","Price","Type"].map(h => (
                <th key={h} style={{ textAlign: h==="Price"?"right":"left",
                  padding:"6px 8px", color:GRAY, fontWeight:700, fontSize:10,
                  letterSpacing:"1px", textTransform:"uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topDeals.slice(0,10).map((t,i) => (
              <tr key={i} style={{ borderBottom:"1px solid #F5F5F5",
                background: i%2===0?WHITE:"#FAFAFA" }}>
                <td style={{ padding:"10px 8px", fontWeight:800, color: i<3?R:GRAY }}>{i+1}</td>
                <td style={{ padding:"10px 8px", fontWeight:600, color:BK, maxWidth:260,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.addr}</td>
                <td style={{ padding:"10px 8px" }}>
                  <span style={{ background:`${ASSET_COLORS[t.assetClass]}22`,
                    color:ASSET_COLORS[t.assetClass], padding:"2px 8px", borderRadius:3,
                    fontSize:11, fontWeight:700 }}>{t.assetClass}</span>
                </td>
                <td style={{ padding:"10px 8px", color:GRAY }}>{t.borough}</td>
                <td style={{ padding:"10px 8px", textAlign:"right", fontWeight:800, color:BK }}>
                  {fmt(t.displayPrice)}
                </td>
                <td style={{ padding:"10px 8px" }}>
                  {t.isPortfolio
                    ? <span style={{ color:R, fontSize:11, fontWeight:700 }}>Portfolio</span>
                    : <span style={{ color:"#22C55E", fontSize:11, fontWeight:700 }}>Single</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ background:"#FFF8F8", border:`1px solid ${R}30`,
        borderRadius:8, padding:"12px 18px", fontSize:12, color:GRAY, lineHeight:1.65 }}>
        <strong style={{ color:BK }}>Methodology: </strong>
        1-family (A*) and 2-family (B*, S1, S2) transactions excluded.{" "}
        Building codes extracted from last parenthetical in PropertyShark descriptions.{" "}
        {portfolioCount} portfolio sale{portfolioCount!==1?"s":""} identified by matching buyer + closing date
        — deduplicated and priced as combined totals. V0/V1 classified as Development.
      </div>
    </div>
  );
}

// ─── DEV INTELLIGENCE VIEW ────────────────────────────────────────────────────
const CONF_META = {
  "Confirmed Dev": { color:"#16A34A", icon:"✅", def:"DOB permit filed, demolition pulled, or news confirms plans" },
  "Likely Dev":    { color:"#F5A623", icon:"⚡", def:"Known developer buyer, vacant land, or strong zoning signal" },
  "Possible Dev":  { color:"#3D5A80", icon:"🔎", def:"Some signals present but no hard confirmation" },
  "Not Dev":       { color:"#9CA3AF", icon:"✗",  def:"Evidence points to investment/repositioning" },
};

function ConfBadge({ label }) {
  const meta = CONF_META[label];
  if (!meta) return null;
  return (
    <span style={{ background:`${meta.color}18`, color:meta.color,
      border:`1px solid ${meta.color}44`, padding:"3px 10px", borderRadius:20,
      fontSize:11, fontWeight:700, whiteSpace:"nowrap" }}>
      {meta.icon} {label}
    </span>
  );
}

function DevIntelView({ data }) {
  const { deduped, getPrice } = data;

  // Candidates: all V0/V1 + any deal $1.5M+ that isn't pure office
  // G* (parking lots/garages) are included — common dev plays in NYC
  const candidates = deduped.filter(t =>
    t.assetClass === "Development" ||
    (t.assetClass !== "Office" && getPrice(t) >= 1500000)
  ).sort((a,b) => getPrice(b) - getPrice(a));

  const [results,    setResults]    = useState({});
  const [queue,      setQueue]      = useState([]);
  const [filter,     setFilter]     = useState("All");
  const [expanded,   setExpanded]   = useState(null);
  const [runningAll, setRunningAll] = useState(false);

  const researchDeal = async (txn) => {
    const key = txn.addr;
    if (queue.includes(key)) return;
    setQueue(q => [...q, key]);
    setResults(r => ({ ...r, [key]: { status:"loading", confidence:"Researching…" } }));

    const cleanAddr = txn.addr.replace(/,\s*\d{5}/, "").trim();
    const prompt = `You are a NYC commercial real estate analyst. Research this property and determine if it was purchased as a DEVELOPMENT SITE.

Property: ${cleanAddr}
Sale Price: ${fmt(getPrice(txn))}
Building Class: ${txn.bc || "Unknown"}
Zoning: ${txn.zoning || "Unknown"}
Current Asset Class: ${txn.assetClass}
Borough: ${txn.borough}
Buyer: ${txn.buyer || "Unknown"}

Search the web for:
1. NYC DOB (nyc.gov/buildings) — any new building (NB) permits or demolition permits filed at this address
2. YIMBY NY (yimby.com) — any development coverage of this address or buyer
3. The Real Deal, Bisnow, Crain's, CoStar — any sale or development articles
4. The buyer "${txn.buyer || ""}" — are they a known NYC developer? What have they built?
5. Zoning analysis — does ${txn.zoning || "the zoning"} allow significantly more development than what currently exists?

Return ONLY a valid JSON object, no other text:
{
  "confidence": "Confirmed Dev" or "Likely Dev" or "Possible Dev" or "Not Dev",
  "summary": "2-3 sentence plain English explanation of what you found and why you assigned this confidence level",
  "signals": ["brief signal 1", "brief signal 2"],
  "sources": ["source name and what it showed 1", "source name and what it showed 2"]
}`;

    try {
      const resp = await fetch("/api/research", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          tools: [{ type:"web_search_20250305", name:"web_search" }],
          messages: [{ role:"user", content: prompt }],
        }),
      });
      const json = await resp.json();

      // Find last text block in response (after tool use)
      let raw = "";
      for (const block of (json.content || [])) {
        if (block.type === "text") raw = block.text;
      }

      let parsed = null;
      try {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      } catch (_) {}

      if (parsed?.confidence) {
        setResults(r => ({ ...r, [key]: { status:"done", ...parsed } }));
      } else {
        setResults(r => ({ ...r, [key]: { status:"done", confidence:"Possible Dev",
          summary: raw.slice(0,400) || "No structured result returned.",
          signals:[], sources:[] } }));
      }
    } catch (err) {
      setResults(r => ({ ...r, [key]: { status:"error", confidence:"Possible Dev",
        summary:"Research failed: " + err.message, signals:[], sources:[] } }));
    }
    setQueue(q => q.filter(k => k !== key));
  };

  const researchAll = async () => {
    setRunningAll(true);
    const pending = candidates.filter(t => !results[t.addr] && !queue.includes(t.addr));
    for (let i = 0; i < pending.length; i++) {
      await researchDeal(pending[i]);
      if (i < pending.length - 1) await new Promise(r => setTimeout(r, 1000));
    }
    setRunningAll(false);
  };

  const counts = Object.fromEntries(
    Object.keys(CONF_META).map(k => [k, candidates.filter(t => results[t.addr]?.confidence === k).length])
  );
  const totalDone = candidates.filter(t => results[t.addr]?.status === "done").length;

  const filterOpts = ["All","Confirmed Dev","Likely Dev","Possible Dev","Not Dev","Pending"];
  const shown = candidates.filter(t => {
    if (filter === "All")     return true;
    if (filter === "Pending") return !results[t.addr];
    return results[t.addr]?.confidence === filter;
  });

  const boroughNum = (b) =>
    ({Manhattan:1,Bronx:2,Brooklyn:3,Queens:4,"Staten Island":5})[b] || 1;

  const dobUrl = (txn) => {
    const num = txn.addr.match(/^(\d+)/)?.[1] || "";
    const street = txn.addr.split(",")[0].replace(/^\d+\s+/,"").trim();
    return `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?boro=${boroughNum(txn.borough)}&houseno=${encodeURIComponent(num)}&street=${encodeURIComponent(street)}`;
  };

  return (
    <div>
      {/* Header */}
      <div style={{ background:BK, borderRadius:10, padding:"20px 28px", marginBottom:14 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          flexWrap:"wrap", gap:12 }}>
          <div>
            <div style={{ color:WHITE, fontWeight:800, fontSize:16 }}>Dev Site Intelligence</div>
            <div style={{ color:"rgba(255,255,255,0.4)", fontSize:12, marginTop:4 }}>
              {candidates.length} candidate deals · Live research via DOB, YIMBY, The Real Deal &amp; more
            </div>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)" }}>
              {totalDone} / {candidates.length} researched
            </div>
            <button onClick={researchAll} disabled={runningAll || queue.length > 0}
              style={{ background: runningAll?"#444":R, color:WHITE, border:"none",
                padding:"9px 20px", borderRadius:6, fontSize:12, fontWeight:700,
                cursor: runningAll?"not-allowed":"pointer" }}>
              {runningAll ? "⏳ Researching All…" : "🔍 Research All Deals"}
            </button>
          </div>
        </div>

        {/* Confidence summary */}
        {totalDone > 0 && (
          <div style={{ display:"flex", gap:12, marginTop:18, flexWrap:"wrap" }}>
            {Object.entries(CONF_META).map(([label, meta]) => (
              <div key={label} onClick={() => setFilter(filter===label?"All":label)}
                style={{ background:"rgba(255,255,255,0.06)", borderRadius:6,
                  padding:"10px 18px", cursor:"pointer", transition:"border 0.15s",
                  border: filter===label ? `1px solid ${meta.color}` : "1px solid transparent" }}>
                <div style={{ color:meta.color, fontSize:20, fontWeight:900 }}>
                  {meta.icon} {counts[label]}
                </div>
                <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, letterSpacing:"1px",
                  textTransform:"uppercase", marginTop:3 }}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ background:WHITE, borderRadius:8, padding:"12px 18px",
        marginBottom:14, display:"flex", gap:20, flexWrap:"wrap" }}>
        {Object.entries(CONF_META).map(([label, meta]) => (
          <div key={label} style={{ fontSize:11, color:GRAY, display:"flex",
            gap:6, alignItems:"center" }}>
            <span style={{ color:meta.color, fontWeight:700 }}>{meta.icon}</span>
            <strong style={{ color:BK }}>{label}:</strong> {meta.def}
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
        {filterOpts.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding:"5px 14px", borderRadius:20, border:"none", cursor:"pointer",
              fontSize:12, fontWeight:600, background: filter===f?BK:"#E8E8E8",
              color: filter===f?WHITE:GRAY }}>
            {f} ({f==="All" ? candidates.length :
                  f==="Pending" ? candidates.filter(t=>!results[t.addr]).length :
                  counts[f] ?? 0})
          </button>
        ))}
      </div>

      {/* Deal list */}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {shown.map(txn => {
          const res   = results[txn.addr];
          const isOpen  = expanded === txn.addr;
          const isLoading = queue.includes(txn.addr);

          return (
            <div key={txn.addr} style={{ background:WHITE, borderRadius:8, overflow:"hidden",
              border: isOpen ? `1px solid ${R}` : "1px solid #E8E8E8" }}>
              {/* Row */}
              <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 18px",
                cursor:"pointer" }} onClick={() => setExpanded(isOpen ? null : txn.addr)}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:13, color:BK,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {txn.addr}
                  </div>
                  <div style={{ fontSize:11, color:GRAY, marginTop:2 }}>
                    {txn.assetClass} · {txn.borough}
                    {txn.zoning && <> · <span style={{ color:"#3D5A80" }}>{txn.zoning}</span></>}
                    {txn.isPortfolio && <span style={{ color:R }}> · Portfolio</span>}
                  </div>
                </div>
                <div style={{ fontSize:14, fontWeight:800, color:BK, flexShrink:0 }}>
                  {fmt(getPrice(txn))}
                </div>
                {isLoading ? (
                  <div style={{ fontSize:11, color:GRAY, fontStyle:"italic",
                    flexShrink:0, minWidth:120, textAlign:"right" }}>⏳ Searching web…</div>
                ) : res?.confidence && res.confidence !== "Researching…" ? (
                  <div style={{ flexShrink:0 }}><ConfBadge label={res.confidence} /></div>
                ) : (
                  <button onClick={e => { e.stopPropagation(); researchDeal(txn); }}
                    style={{ background:LGRAY, color:BK, border:"none", padding:"6px 14px",
                      borderRadius:5, fontSize:11, fontWeight:700, cursor:"pointer",
                      flexShrink:0 }}>
                    🔍 Research
                  </button>
                )}
                <div style={{ color:GRAY, fontSize:16, flexShrink:0,
                  transform: isOpen ? "rotate(90deg)" : "none", transition:"transform 0.2s" }}>
                  ›
                </div>
              </div>

              {/* Expanded */}
              {isOpen && res && res.status !== "loading" && (
                <div style={{ borderTop:"1px solid #F0F0F0", padding:"18px 20px",
                  background:"#FAFAFA" }}>
                  <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:12 }}>
                    <ConfBadge label={res.confidence} />
                    <div style={{ fontSize:12, color:GRAY }}>AI Research Summary</div>
                  </div>

                  <p style={{ fontSize:13, color:BK, lineHeight:1.7, margin:"0 0 14px" }}>
                    {res.summary}
                  </p>

                  {res.signals?.length > 0 && (
                    <div style={{ marginBottom:12 }}>
                      <div style={{ fontSize:10, fontWeight:700, color:GRAY, letterSpacing:"1.5px",
                        textTransform:"uppercase", marginBottom:6 }}>Key Signals</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                        {res.signals.map((s,i) => (
                          <span key={i} style={{ background:"#F0F0F0", color:BK,
                            padding:"4px 10px", borderRadius:4, fontSize:11 }}>{s}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {res.sources?.length > 0 && (
                    <div style={{ marginBottom:14 }}>
                      <div style={{ fontSize:10, fontWeight:700, color:GRAY, letterSpacing:"1.5px",
                        textTransform:"uppercase", marginBottom:6 }}>Sources Checked</div>
                      {res.sources.map((s,i) => (
                        <div key={i} style={{ fontSize:11, color:GRAY, display:"flex",
                          gap:6, marginBottom:3 }}>
                          <span style={{ color:R, flexShrink:0 }}>·</span><span>{s}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    <button onClick={() => researchDeal(txn)}
                      style={{ background:"none", border:"1px solid #DDD", color:GRAY,
                        padding:"5px 14px", borderRadius:4, fontSize:11, cursor:"pointer" }}>
                      ↺ Re-research
                    </button>
                    <a href={dobUrl(txn)} target="_blank" rel="noopener noreferrer"
                      style={{ background:"none", border:"1px solid #DDD", color:GRAY,
                        padding:"5px 14px", borderRadius:4, fontSize:11, textDecoration:"none" }}>
                      🏛 NYC DOB →
                    </a>
                    <a href={`https://www.yimby.com/search?q=${encodeURIComponent(txn.addr.split(",")[0])}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ background:"none", border:"1px solid #DDD", color:GRAY,
                        padding:"5px 14px", borderRadius:4, fontSize:11, textDecoration:"none" }}>
                      🏗 YIMBY →
                    </a>
                    <a href={`https://therealdeal.com/search/?q=${encodeURIComponent(txn.addr.split(",")[0])}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ background:"none", border:"1px solid #DDD", color:GRAY,
                        padding:"5px 14px", borderRadius:4, fontSize:11, textDecoration:"none" }}>
                      📰 The Real Deal →
                    </a>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {shown.length === 0 && (
        <div style={{ background:WHITE, borderRadius:8, padding:"48px 32px", textAlign:"center" }}>
          <div style={{ fontSize:32, marginBottom:12 }}>🔎</div>
          <div style={{ fontSize:14, color:GRAY }}>No deals in this category yet.</div>
        </div>
      )}

      <div style={{ marginTop:14, background:"#FFF8F8", border:`1px solid ${R}30`,
        borderRadius:8, padding:"12px 18px", fontSize:11, color:GRAY, lineHeight:1.7 }}>
        <strong style={{ color:BK }}>Methodology: </strong>
        Each deal triggers a live web search across NYC DOB permits, YIMBY NY, The Real Deal,
        Bisnow, Crain's, and broker/developer press releases. Confidence assigned on hard evidence
        (permits, articles) vs. signals only (zoning, price, known developer). G* codes (garages,
        parking lots) are included as candidates — common dev acquisition targets in NYC.
        Re-research any deal at any time.
      </div>
    </div>
  );
}
