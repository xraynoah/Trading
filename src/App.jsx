import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Home, BookOpen, Plus, Settings, X, Check, Trash2,
  ChevronLeft, ChevronRight, Image as ImageIcon,
  TrendingUp, TrendingDown, Target, BarChart3,
  Save, Edit3, ListChecks, Clock, Camera, Download,
  AlertCircle, ArrowLeft, Trophy, Activity,
  Sun, Moon, Zap, ClipboardCheck, Flame, CalendarCheck
} from 'lucide-react';
import { storage } from './storage';

// ---------- Constants ----------
const SESSIONS = ['Asia', 'London', 'New York', 'Overlap'];
const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DAYS_DE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// Default routines - can be edited later in settings
const DEFAULT_ROUTINES = {
  morning: [
    'Nachrichten-Kalender gecheckt (High-Impact News)',
    'HTF-Bias festgelegt (Daily / 4H-Struktur)',
    'Key Levels markiert (PDH, PDL, Wochen-High/Low, Asia-Range)',
    'Liquidity-Zonen identifiziert',
    'Watchlist auf 2–3 Pairs reduziert',
    'Mentaler Check: ausgeschlafen, fokussiert',
    'Max. Daily Loss und Daily Target definiert',
    'Handy lautlos / Social Media aus',
  ],
  preTrade: [
    'Setup passt zur Signal-Checkliste',
    'Multi-Timeframe-Alignment bestätigt (HTF → MTF → LTF)',
    'Entry, SL und TP vor dem Klick definiert',
    'Risk max. 1% (oder Prop-Firm-Limit)',
    'RRR mindestens 1:2',
    'Keine High-Impact News in den nächsten 30 Min',
    'Confluence vorhanden (mehr als nur ein Signal)',
    'Ich trade das Setup – nicht den P&L oder FOMO',
    'Tageslimit noch nicht erreicht',
  ],
  postTrade: [
    'Screenshot vom Chart (Entry + Exit sichtbar)',
    'Trade im Journal eingetragen',
    'Signal- und Timeframe-Checkliste ausgefüllt',
    'Emotionen beim Trade notiert',
    'Regelbruch? Wenn ja: dokumentiert',
    'Setup-Qualität bewertet (A+, B, C)',
    '5 Min Pause vor dem nächsten Trade',
  ],
  evening: [
    'Alle Trades im Journal komplett mit Screenshots',
    'Tages-P&L notiert (R-Multiple + €)',
    'Best Trade analysiert: was lief richtig?',
    'Worst Trade analysiert: was würde ich anders machen?',
    'Regelbrüche gezählt und dokumentiert',
    'Learning des Tages notiert',
    'Confidence-Level des Tages (1–10)',
    'Charts zu – Feierabend',
  ],
};

const ROUTINE_META = {
  morning:   { label: 'Morning Prep',    icon: Sun,            color: 'amber',   order: 0 },
  preTrade:  { label: 'Pre-Trade',       icon: Zap,            color: 'sky',     order: 1 },
  postTrade: { label: 'Post-Trade',      icon: ClipboardCheck, color: 'emerald', order: 2 },
  evening:   { label: 'Evening Review',  icon: Moon,           color: 'violet',  order: 3 },
};

// ---------- Helpers ----------
const cn = (...c) => c.filter(Boolean).join(' ');
const genId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const todayISO = () => new Date().toISOString().slice(0, 10);

const fmtNum = (n, d = 2) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
};
const fmtSigned = (n, d = 2) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + fmtNum(n, d);
};
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};
const fmtDateShort = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
};

async function safeGet(key) {
  try { const r = await storage.get(key); return r ? r.value : null; }
  catch { return null; }
}

async function compressImage(file, maxWidth = 1200, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = (h * maxWidth) / w; w = maxWidth; }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Convert default routines (array of strings) to items with ids
function stringsToItems(strings) {
  return strings.map(label => ({ id: genId(), label, checked: false }));
}

// ---------- Main App ----------
export default function TradingJournal() {
  const [view, setView] = useState('dashboard');
  const [trades, setTrades] = useState([]);
  const [signalTemplate, setSignalTemplate] = useState([]);
  const [timeframeTemplate, setTimeframeTemplate] = useState([]);
  const [routineTemplates, setRoutineTemplates] = useState(null); // { morning, preTrade, postTrade, evening }
  const [routineDays, setRoutineDays] = useState({}); // { '2026-04-22': { morning: [...], preTrade: [...], ... } }
  const [loading, setLoading] = useState(true);
  const [editingTrade, setEditingTrade] = useState(null);
  const [viewingTrade, setViewingTrade] = useState(null);
  const [toast, setToast] = useState(null);

  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState({ year: now.getFullYear(), month: now.getMonth() });

  useEffect(() => {
    (async () => {
      try {
        // Trades
        const idx = await safeGet('trades-index');
        const ids = idx ? JSON.parse(idx) : [];
        const loaded = [];
        for (const id of ids) {
          const raw = await safeGet(`trade:${id}`);
          if (raw) { try { loaded.push(JSON.parse(raw)); } catch {} }
        }
        loaded.sort((a, b) => new Date(b.date) - new Date(a.date));
        setTrades(loaded);

        // Trade checklists (signal/timeframe)
        const sig = await safeGet('template:signal');
        setSignalTemplate(sig ? JSON.parse(sig) : []);
        const tf = await safeGet('template:timeframe');
        setTimeframeTemplate(tf ? JSON.parse(tf) : []);

        // Routine templates - seed defaults if first run
        const rt = await safeGet('template:routines');
        if (rt) {
          setRoutineTemplates(JSON.parse(rt));
        } else {
          const seeded = {
            morning: stringsToItems(DEFAULT_ROUTINES.morning),
            preTrade: stringsToItems(DEFAULT_ROUTINES.preTrade),
            postTrade: stringsToItems(DEFAULT_ROUTINES.postTrade),
            evening: stringsToItems(DEFAULT_ROUTINES.evening),
          };
          setRoutineTemplates(seeded);
          try { await storage.set('template:routines', JSON.stringify(seeded)); } catch {}
        }

        // Routine days (all)
        const daysIdx = await safeGet('routines-index');
        const dayKeys = daysIdx ? JSON.parse(daysIdx) : [];
        const daysObj = {};
        for (const k of dayKeys) {
          const raw = await safeGet(`routine:${k}`);
          if (raw) { try { daysObj[k] = JSON.parse(raw); } catch {} }
        }
        setRoutineDays(daysObj);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function saveTrade(trade) {
    const id = trade.id || genId();
    const toSave = { ...trade, id };
    try {
      await storage.set(`trade:${id}`, JSON.stringify(toSave));
      const newTrades = [...trades.filter(t => t.id !== id), toSave]
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      setTrades(newTrades);
      await storage.set('trades-index', JSON.stringify(newTrades.map(t => t.id)));
      showToast(trade.id ? 'Trade aktualisiert' : 'Trade gespeichert');
      return true;
    } catch (e) {
      console.error(e);
      showToast('Speichern fehlgeschlagen', 'error');
      return false;
    }
  }

  async function deleteTrade(id) {
    try {
      await storage.delete(`trade:${id}`);
      const newTrades = trades.filter(t => t.id !== id);
      setTrades(newTrades);
      await storage.set('trades-index', JSON.stringify(newTrades.map(t => t.id)));
      showToast('Trade gelöscht');
    } catch (e) { console.error(e); }
  }

  async function updateSignalTemplate(items) {
    setSignalTemplate(items);
    try { await storage.set('template:signal', JSON.stringify(items)); } catch {}
  }
  async function updateTimeframeTemplate(items) {
    setTimeframeTemplate(items);
    try { await storage.set('template:timeframe', JSON.stringify(items)); } catch {}
  }

  async function updateRoutineTemplate(key, items) {
    const newTemplates = { ...routineTemplates, [key]: items };
    setRoutineTemplates(newTemplates);
    try { await storage.set('template:routines', JSON.stringify(newTemplates)); } catch {}
  }

  async function saveRoutineDay(dateISO, day) {
    const newDays = { ...routineDays, [dateISO]: day };
    setRoutineDays(newDays);
    try {
      await storage.set(`routine:${dateISO}`, JSON.stringify(day));
      await storage.set('routines-index', JSON.stringify(Object.keys(newDays)));
    } catch (e) { console.error(e); }
  }

  const showForm = editingTrade !== null;
  const showDetail = viewingTrade !== null;

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-neutral-100 pb-24">
      <div className="fixed inset-0 noise pointer-events-none" />
      <div className="fixed top-0 inset-x-0 h-[300px] bg-gradient-to-b from-emerald-500/[0.04] to-transparent pointer-events-none" />

      <header className="sticky top-0 z-30 backdrop-blur-xl bg-[#0a0a0b]/80 border-b border-neutral-900">
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
                <Activity className="w-4 h-4 text-black" strokeWidth={3} />
              </div>
              <div className="absolute inset-0 rounded-lg bg-emerald-500/40 blur-md -z-10" />
            </div>
            <div>
              <h1 className="font-bold text-base leading-none tracking-tight">Trading Journal</h1>
              <p className="text-[10px] text-neutral-500 font-mono uppercase tracking-widest mt-0.5">SMC Edition</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Trades gesamt</div>
            <div className="num text-sm font-bold text-neutral-200">{trades.length}</div>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-4 relative">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-neutral-500 text-sm">Lädt...</div>
        ) : (
          <>
            {view === 'dashboard' && (
              <DashboardView trades={trades} currentMonth={currentMonth} setCurrentMonth={setCurrentMonth}
                onTradeClick={(t) => setViewingTrade(t)} routineDays={routineDays} />
            )}
            {view === 'routines' && (
              <RoutinesView routineTemplates={routineTemplates} routineDays={routineDays}
                onSaveDay={saveRoutineDay} />
            )}
            {view === 'trades' && (
              <TradesView trades={trades} onTradeClick={(t) => setViewingTrade(t)} onAddNew={() => setEditingTrade({})} />
            )}
            {view === 'settings' && (
              <SettingsView signalTemplate={signalTemplate} timeframeTemplate={timeframeTemplate}
                routineTemplates={routineTemplates}
                onUpdateSignal={updateSignalTemplate} onUpdateTimeframe={updateTimeframeTemplate}
                onUpdateRoutine={updateRoutineTemplate}
                trades={trades} routineDays={routineDays} showToast={showToast} />
            )}
          </>
        )}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-30 bg-[#0a0a0b]/95 backdrop-blur-xl border-t border-neutral-900">
        <div className="max-w-xl mx-auto px-2 py-2 grid grid-cols-5 gap-1">
          <NavBtn icon={Home} label="Home" active={view === 'dashboard'} onClick={() => setView('dashboard')} />
          <NavBtn icon={CalendarCheck} label="Routinen" active={view === 'routines'} onClick={() => setView('routines')} />
          <button onClick={() => setEditingTrade({})} className="flex flex-col items-center justify-center py-1.5 relative group">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/30 -mt-4 group-active:scale-95 transition-transform">
              <Plus className="w-6 h-6 text-black" strokeWidth={3} />
            </div>
            <span className="text-[9px] font-semibold text-emerald-400 mt-0.5">Trade</span>
          </button>
          <NavBtn icon={BookOpen} label="Trades" active={view === 'trades'} onClick={() => setView('trades')} />
          <NavBtn icon={Settings} label="Settings" active={view === 'settings'} onClick={() => setView('settings')} />
        </div>
      </nav>

      {showForm && (
        <TradeFormModal trade={editingTrade} signalTemplate={signalTemplate} timeframeTemplate={timeframeTemplate}
          onClose={() => setEditingTrade(null)}
          onSave={async (t) => { const ok = await saveTrade(t); if (ok) setEditingTrade(null); }} />
      )}

      {showDetail && (
        <TradeDetailModal trade={viewingTrade}
          onClose={() => setViewingTrade(null)}
          onEdit={() => { setEditingTrade(viewingTrade); setViewingTrade(null); }}
          onDelete={async () => { if (confirm('Diesen Trade wirklich löschen?')) { await deleteTrade(viewingTrade.id); setViewingTrade(null); } }} />
      )}

      {toast && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-xl"
             style={{
               background: toast.type === 'error' ? '#7f1d1d' : '#064e3b',
               color: toast.type === 'error' ? '#fecaca' : '#a7f3d0',
               border: `1px solid ${toast.type === 'error' ? '#991b1b' : '#065f46'}`
             }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function NavBtn({ icon: Icon, label, active, onClick }) {
  return (
    <button onClick={onClick}
      className={cn("flex flex-col items-center justify-center py-2 rounded-lg transition-colors",
        active ? "text-emerald-400" : "text-neutral-500 active:text-neutral-300")}>
      <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
      <span className="text-[10px] font-medium mt-0.5">{label}</span>
    </button>
  );
}

// ---------- Discipline stats helpers ----------
function dayCompletionRatio(day) {
  if (!day) return 0;
  let total = 0, done = 0;
  for (const key of Object.keys(ROUTINE_META)) {
    const items = day[key] || [];
    total += items.length;
    done += items.filter(i => i.checked).length;
  }
  return total === 0 ? 0 : done / total;
}

function isDayComplete(day, threshold = 0.8) {
  return dayCompletionRatio(day) >= threshold;
}

function calcStreak(routineDays) {
  // Count consecutive days ending today or yesterday where threshold met
  const today = new Date();
  let streak = 0;
  // Allow streak to skip today if today isn't filled yet (but yesterday was)
  let d = new Date(today);
  // Check if today or yesterday starts a valid streak
  const todayKey = d.toISOString().slice(0, 10);
  if (!isDayComplete(routineDays[todayKey])) {
    d.setDate(d.getDate() - 1);
  }
  while (true) {
    const key = d.toISOString().slice(0, 10);
    if (isDayComplete(routineDays[key])) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function calcMonthScore(routineDays, year, month) {
  // Average completion ratio across all days in the month that have data
  let sum = 0, count = 0;
  for (const [key, day] of Object.entries(routineDays)) {
    const d = new Date(key);
    if (d.getFullYear() === year && d.getMonth() === month) {
      sum += dayCompletionRatio(day);
      count++;
    }
  }
  return { avg: count > 0 ? (sum / count) * 100 : 0, days: count };
}

// ---------- Dashboard ----------
function DashboardView({ trades, currentMonth, setCurrentMonth, onTradeClick, routineDays }) {
  const monthTrades = useMemo(() => trades.filter(t => {
    const d = new Date(t.date);
    return d.getFullYear() === currentMonth.year && d.getMonth() === currentMonth.month;
  }), [trades, currentMonth]);

  const kpis = useMemo(() => {
    const wins = monthTrades.filter(t => (t.pnl || 0) > 0);
    const losses = monthTrades.filter(t => (t.pnl || 0) < 0);
    const totalPnl = monthTrades.reduce((s, t) => s + (t.pnl || 0), 0);
    const winrate = monthTrades.length ? (wins.length / monthTrades.length * 100) : 0;
    const avgPnl = monthTrades.length ? totalPnl / monthTrades.length : 0;
    const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const pf = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99 : 0);
    const best = monthTrades.reduce((m, t) => (t.pnl || 0) > (m?.pnl ?? -Infinity) ? t : m, null);
    const worst = monthTrades.reduce((m, t) => (t.pnl || 0) < (m?.pnl ?? Infinity) ? t : m, null);
    const avgConfidence = monthTrades.length ? monthTrades.reduce((s, t) => s + (t.confidence || 0), 0) / monthTrades.length : 0;
    return { totalPnl, winrate, avgPnl, pf, wins: wins.length, losses: losses.length, total: monthTrades.length, best, worst, avgConfidence };
  }, [monthTrades]);

  const streak = useMemo(() => calcStreak(routineDays), [routineDays]);
  const monthScore = useMemo(() => calcMonthScore(routineDays, currentMonth.year, currentMonth.month), [routineDays, currentMonth]);

  function prevMonth() {
    setCurrentMonth(({ year, month }) => month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 });
  }
  function nextMonth() {
    setCurrentMonth(({ year, month }) => month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 });
  }

  const recentMonthTrades = useMemo(() =>
    [...monthTrades].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5),
    [monthTrades]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-neutral-900/60 border border-neutral-800 rounded-xl px-2 py-2">
        <button onClick={prevMonth} className="p-2 rounded-lg active:bg-neutral-800 text-neutral-400">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-center">
          <div className="font-bold text-base">{MONTHS_DE[currentMonth.month]}</div>
          <div className="num text-[10px] text-neutral-500 uppercase tracking-widest">{currentMonth.year}</div>
        </div>
        <button onClick={nextMonth} className="p-2 rounded-lg active:bg-neutral-800 text-neutral-400">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-neutral-800 bg-gradient-to-br from-neutral-900 to-neutral-950 p-5">
        <div className={cn("absolute -top-16 -right-16 w-48 h-48 rounded-full blur-3xl opacity-30",
          kpis.totalPnl >= 0 ? "bg-emerald-500" : "bg-rose-500")} />
        <div className="relative">
          <div className="flex items-center gap-2 text-[10px] text-neutral-500 uppercase tracking-widest font-medium">
            <BarChart3 className="w-3 h-3" /> Net P&L · {MONTHS_DE[currentMonth.month]}
          </div>
          <div className={cn("num font-bold text-4xl mt-1 tracking-tight",
            kpis.totalPnl > 0 ? "text-emerald-400" : kpis.totalPnl < 0 ? "text-rose-400" : "text-neutral-300")}>
            {fmtSigned(kpis.totalPnl)} €
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs">
            <span className="text-emerald-400 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> {kpis.wins}W</span>
            <span className="text-rose-400 flex items-center gap-1"><TrendingDown className="w-3 h-3" /> {kpis.losses}L</span>
            <span className="text-neutral-500">· {kpis.total} Trades</span>
          </div>
        </div>
      </div>

      {/* Discipline band */}
      <div className="grid grid-cols-2 gap-3">
        <div className="relative overflow-hidden rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-neutral-900/40 p-3">
          <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-amber-500/10 blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-1.5 text-[10px] text-amber-400 uppercase tracking-wider font-medium">
              <Flame className="w-3 h-3" /> Streak
            </div>
            <div className="num text-2xl font-bold text-amber-300 mt-1">{streak}</div>
            <div className="text-[10px] text-neutral-500 mt-0.5">{streak === 1 ? 'Tag in Folge' : 'Tage in Folge'}</div>
          </div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 uppercase tracking-wider font-medium">
            <CalendarCheck className="w-3 h-3" /> Disziplin
          </div>
          <div className={cn("num text-2xl font-bold mt-1",
            monthScore.avg >= 80 ? "text-emerald-400" : monthScore.avg >= 50 ? "text-amber-400" : "text-neutral-300")}>
            {monthScore.days > 0 ? `${fmtNum(monthScore.avg, 0)}%` : '—'}
          </div>
          <div className="text-[10px] text-neutral-500 mt-0.5">
            {monthScore.days > 0 ? `Ø über ${monthScore.days} ${monthScore.days === 1 ? 'Tag' : 'Tage'}` : 'Noch keine Routine'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="Winrate" value={`${fmtNum(kpis.winrate, 1)}%`} accent={kpis.winrate >= 50 ? 'emerald' : 'neutral'} icon={Target} />
        <KpiCard label="Profit Factor" value={kpis.pf === 99 ? '∞' : fmtNum(kpis.pf, 2)} accent={kpis.pf >= 1.5 ? 'emerald' : kpis.pf >= 1 ? 'neutral' : 'rose'} icon={Trophy} />
        <KpiCard label="Avg P&L" value={`${fmtSigned(kpis.avgPnl)} €`} accent={kpis.avgPnl >= 0 ? 'emerald' : 'rose'} icon={BarChart3} />
        <KpiCard label="Avg Confidence" value={kpis.total ? `${fmtNum(kpis.avgConfidence, 1)}/10` : '—'} accent="neutral" icon={Activity} />
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm flex items-center gap-2"><BarChart3 className="w-4 h-4 text-emerald-400" />Profit-Kalender</h3>
          <div className="text-[10px] text-neutral-500 uppercase tracking-wider">{MONTHS_DE[currentMonth.month]} {currentMonth.year}</div>
        </div>
        <ProfitCalendar year={currentMonth.year} month={currentMonth.month} trades={monthTrades}
          onDayClick={(trades) => { if (trades.length === 1) onTradeClick(trades[0]); }} />
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-neutral-800 text-[10px] text-neutral-500">
          <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-emerald-500/70" /> Gewinn</span>
          <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-rose-500/70" /> Verlust</span>
          <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-neutral-700" /> Break-Even</span>
        </div>
      </div>

      {(kpis.best || kpis.worst) && (
        <div className="grid grid-cols-2 gap-3">
          {kpis.best && (
            <div onClick={() => onTradeClick(kpis.best)} className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 active:bg-emerald-500/10 cursor-pointer">
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 uppercase tracking-wider font-medium">
                <Trophy className="w-3 h-3" /> Bester Trade
              </div>
              <div className="num text-lg font-bold text-emerald-400 mt-1">{fmtSigned(kpis.best.pnl)} €</div>
              <div className="text-[11px] text-neutral-400 mt-0.5">{kpis.best.pair || '—'}</div>
            </div>
          )}
          {kpis.worst && (
            <div onClick={() => onTradeClick(kpis.worst)} className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 active:bg-rose-500/10 cursor-pointer">
              <div className="flex items-center gap-1.5 text-[10px] text-rose-400 uppercase tracking-wider font-medium">
                <TrendingDown className="w-3 h-3" /> Schlechtester
              </div>
              <div className="num text-lg font-bold text-rose-400 mt-1">{fmtSigned(kpis.worst.pnl)} €</div>
              <div className="text-[11px] text-neutral-400 mt-0.5">{kpis.worst.pair || '—'}</div>
            </div>
          )}
        </div>
      )}

      {recentMonthTrades.length > 0 && (
        <div>
          <h3 className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold px-1 mb-2">Letzte Trades</h3>
          <div className="space-y-2">
            {recentMonthTrades.map(t => <TradeCard key={t.id} trade={t} onClick={() => onTradeClick(t)} />)}
          </div>
        </div>
      )}

      {monthTrades.length === 0 && (
        <div className="rounded-2xl border border-dashed border-neutral-800 p-8 text-center">
          <BookOpen className="w-10 h-10 text-neutral-700 mx-auto mb-3" />
          <p className="text-neutral-400 text-sm font-medium">Keine Trades in diesem Monat</p>
          <p className="text-neutral-600 text-xs mt-1">Tippe auf <span className="text-emerald-400 font-semibold">+</span> um einen Trade hinzuzufügen</p>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, accent = 'neutral', icon: Icon }) {
  const colors = { emerald: 'text-emerald-400', rose: 'text-rose-400', neutral: 'text-neutral-200' };
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
      <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 uppercase tracking-wider font-medium">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </div>
      <div className={cn("num text-xl font-bold mt-1", colors[accent])}>{value}</div>
    </div>
  );
}

// ---------- Routines View ----------
function RoutinesView({ routineTemplates, routineDays, onSaveDay }) {
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [expanded, setExpanded] = useState('morning'); // which section is open

  if (!routineTemplates) return null;

  // Get the day's state - either saved or fresh from template
  const currentDay = useMemo(() => {
    if (routineDays[selectedDate]) return routineDays[selectedDate];
    return {
      morning: routineTemplates.morning.map(i => ({ ...i, checked: false })),
      preTrade: routineTemplates.preTrade.map(i => ({ ...i, checked: false })),
      postTrade: routineTemplates.postTrade.map(i => ({ ...i, checked: false })),
      evening: routineTemplates.evening.map(i => ({ ...i, checked: false })),
    };
  }, [selectedDate, routineDays, routineTemplates]);

  function toggle(section, itemId) {
    const newItems = currentDay[section].map(i => i.id === itemId ? { ...i, checked: !i.checked } : i);
    const newDay = { ...currentDay, [section]: newItems };
    onSaveDay(selectedDate, newDay);
  }

  function resetSection(section) {
    if (!confirm(`${ROUTINE_META[section].label} für ${fmtDate(selectedDate)} zurücksetzen?`)) return;
    const newItems = currentDay[section].map(i => ({ ...i, checked: false }));
    const newDay = { ...currentDay, [section]: newItems };
    onSaveDay(selectedDate, newDay);
  }

  function shiftDate(days) {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().slice(0, 10));
  }

  const todayRatio = dayCompletionRatio(currentDay);
  const streak = useMemo(() => calcStreak(routineDays), [routineDays]);
  const isToday = selectedDate === todayISO();

  return (
    <div className="space-y-4">
      {/* Date selector */}
      <div className="flex items-center gap-2 bg-neutral-900/60 border border-neutral-800 rounded-xl p-2">
        <button onClick={() => shiftDate(-1)} className="p-2 rounded-lg active:bg-neutral-800 text-neutral-400">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 text-center">
          <div className="font-bold text-sm">{isToday ? 'Heute' : fmtDate(selectedDate)}</div>
          <div className="text-[10px] text-neutral-500 num">{isToday && fmtDate(selectedDate)}</div>
        </div>
        <button onClick={() => shiftDate(1)} disabled={selectedDate >= todayISO()}
          className="p-2 rounded-lg active:bg-neutral-800 text-neutral-400 disabled:opacity-30">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Today hero: streak + progress */}
      <div className="relative overflow-hidden rounded-2xl border border-neutral-800 bg-gradient-to-br from-neutral-900 to-neutral-950 p-5">
        <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="relative flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] text-amber-400 uppercase tracking-widest font-semibold">
              <Flame className="w-3 h-3" /> Aktueller Streak
            </div>
            <div className="num text-4xl font-bold text-amber-300 mt-1 tracking-tight">{streak}</div>
            <div className="text-[11px] text-neutral-500 mt-0.5">{streak === 1 ? 'Tag in Folge' : 'Tage in Folge'} · ≥80% nötig</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-neutral-500 uppercase tracking-widest font-semibold">Dieser Tag</div>
            <div className={cn("num text-3xl font-bold mt-1",
              todayRatio >= 0.8 ? "text-emerald-400" : todayRatio >= 0.5 ? "text-amber-400" : "text-neutral-400")}>
              {fmtNum(todayRatio * 100, 0)}%
            </div>
            <div className="h-1.5 w-24 bg-neutral-800 rounded-full overflow-hidden mt-2">
              <div className={cn("h-full rounded-full transition-all",
                todayRatio >= 0.8 ? "bg-emerald-400" : todayRatio >= 0.5 ? "bg-amber-400" : "bg-neutral-600")}
                style={{ width: `${todayRatio * 100}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* 4 Routines */}
      {Object.keys(ROUTINE_META).sort((a, b) => ROUTINE_META[a].order - ROUTINE_META[b].order).map(key => {
        const meta = ROUTINE_META[key];
        const items = currentDay[key] || [];
        const checkedCount = items.filter(i => i.checked).length;
        const ratio = items.length ? checkedCount / items.length : 0;
        const isOpen = expanded === key;
        const isEmpty = items.length === 0;
        const Icon = meta.icon;

        const colorMap = {
          amber:   { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   bar: 'bg-amber-400' },
          sky:     { text: 'text-sky-400',     bg: 'bg-sky-500/10',     border: 'border-sky-500/30',     bar: 'bg-sky-400' },
          emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', bar: 'bg-emerald-400' },
          violet:  { text: 'text-violet-400',  bg: 'bg-violet-500/10',  border: 'border-violet-500/30',  bar: 'bg-violet-400' },
        };
        const c = colorMap[meta.color];

        return (
          <div key={key} className="rounded-2xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
            <button onClick={() => setExpanded(isOpen ? null : key)}
              className="w-full p-4 flex items-center gap-3 active:bg-neutral-900">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", c.bg, c.border, "border")}>
                <Icon className={cn("w-5 h-5", c.text)} />
              </div>
              <div className="flex-1 text-left">
                <div className="font-bold text-sm">{meta.label}</div>
                <div className="text-[11px] text-neutral-500 num mt-0.5">
                  {isEmpty ? 'Leer – in Settings bearbeiten' : `${checkedCount} / ${items.length} abgehakt`}
                </div>
                {!isEmpty && (
                  <div className="h-1 w-full bg-neutral-800 rounded-full overflow-hidden mt-2">
                    <div className={cn("h-full rounded-full transition-all", c.bar)} style={{ width: `${ratio * 100}%` }} />
                  </div>
                )}
              </div>
              <ChevronRight className={cn("w-5 h-5 text-neutral-600 transition-transform", isOpen && "rotate-90")} />
            </button>

            {isOpen && !isEmpty && (
              <div className="px-4 pb-4 space-y-1 border-t border-neutral-800 pt-3">
                {items.map(i => (
                  <button key={i.id} type="button" onClick={() => toggle(key, i.id)}
                    className={cn("w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-all border",
                      i.checked ? cn(c.bg, c.border) : "bg-neutral-900/60 border-neutral-800 active:bg-neutral-900")}>
                    <div className={cn("w-5 h-5 rounded-md flex items-center justify-center shrink-0 border-2",
                      i.checked ? cn(c.border.replace('/30', ''), c.bar.replace('bg-', 'bg-').replace('-400', '-500')) : "border-neutral-600")}
                      style={i.checked ? {
                        backgroundColor: { amber: '#f59e0b', sky: '#0ea5e9', emerald: '#10b981', violet: '#8b5cf6' }[meta.color],
                        borderColor: { amber: '#f59e0b', sky: '#0ea5e9', emerald: '#10b981', violet: '#8b5cf6' }[meta.color],
                      } : {}}>
                      {i.checked && <Check className="w-3.5 h-3.5 text-black" strokeWidth={3.5} />}
                    </div>
                    <span className={cn("text-sm flex-1", i.checked ? "text-neutral-100" : "text-neutral-300")}>{i.label}</span>
                  </button>
                ))}
                {checkedCount > 0 && (
                  <button onClick={() => resetSection(key)}
                    className="w-full mt-2 py-2 text-[11px] text-neutral-500 active:text-rose-400 uppercase tracking-wider font-semibold">
                    Zurücksetzen
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      <p className="text-center text-[10px] text-neutral-600 pt-2">
        Routinen werden automatisch beim Abhaken gespeichert
      </p>
    </div>
  );
}

// ---------- Profit Calendar ----------
function ProfitCalendar({ year, month, trades, onDayClick }) {
  const tradesByDay = useMemo(() => {
    const m = new Map();
    for (const t of trades) {
      const d = new Date(t.date);
      const k = d.getDate();
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    }
    return m;
  }, [trades]);

  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let firstWeekday = firstDay.getDay() - 1;
  if (firstWeekday < 0) firstWeekday = 6;

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 mb-2">
        {DAYS_DE.map(d => (
          <div key={d} className="text-center text-[9px] text-neutral-600 font-semibold uppercase tracking-wider py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} className="aspect-square" />;
          const dayTrades = tradesByDay.get(d) || [];
          const pnl = dayTrades.reduce((s, t) => s + (t.pnl || 0), 0);
          const has = dayTrades.length > 0;
          const isWin = pnl > 0;
          const isLoss = pnl < 0;
          const isToday = isCurrentMonth && d === today.getDate();
          return (
            <button key={i} onClick={() => has && onDayClick(dayTrades)}
              className={cn("aspect-square rounded-lg p-1 flex flex-col items-start justify-between border transition-all",
                has ? "active:scale-95" : "",
                has && isWin && "bg-emerald-500/10 border-emerald-500/30",
                has && isLoss && "bg-rose-500/10 border-rose-500/30",
                has && !isWin && !isLoss && "bg-neutral-800/50 border-neutral-700",
                !has && "bg-neutral-900/30 border-neutral-800/40",
                isToday && "ring-1 ring-emerald-400/50")}>
              <span className={cn("num text-[10px] font-semibold",
                has ? (isWin ? "text-emerald-300" : isLoss ? "text-rose-300" : "text-neutral-300") : "text-neutral-600",
                isToday && "text-emerald-400")}>{d}</span>
              {has && (
                <div className="w-full text-left">
                  <div className={cn("num text-[9px] font-bold leading-tight truncate",
                    isWin ? "text-emerald-400" : isLoss ? "text-rose-400" : "text-neutral-400")}>
                    {fmtSigned(pnl, 0)}
                  </div>
                  <div className="text-[8px] text-neutral-500 font-mono leading-tight">{dayTrades.length}T</div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TradesView({ trades, onTradeClick, onAddNew }) {
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return trades;
    return trades.filter(t => (t.pair || '').toLowerCase().includes(q));
  }, [trades, filter]);

  const grouped = useMemo(() => {
    const m = new Map();
    for (const t of filtered) {
      const d = new Date(t.date);
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      if (!m.has(k)) m.set(k, { label: `${MONTHS_DE[d.getMonth()]} ${d.getFullYear()}`, trades: [] });
      m.get(k).trades.push(t);
    }
    return [...m.values()];
  }, [filtered]);

  return (
    <div className="space-y-4">
      <input value={filter} onChange={e => setFilter(e.target.value)}
        placeholder="Pair suchen (z.B. EURUSD)..."
        className="flex-1 w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-sm placeholder:text-neutral-600 focus:outline-none focus:border-emerald-500/50" />

      {trades.length === 0 && (
        <div className="rounded-2xl border border-dashed border-neutral-800 p-10 text-center">
          <BookOpen className="w-12 h-12 text-neutral-700 mx-auto mb-3" />
          <p className="text-neutral-300 text-base font-semibold">Noch keine Trades</p>
          <p className="text-neutral-500 text-sm mt-1">Logge deinen ersten Trade</p>
          <button onClick={onAddNew}
            className="mt-4 px-5 py-2.5 bg-emerald-500 text-black rounded-lg font-semibold text-sm active:bg-emerald-400">
            + Neuer Trade
          </button>
        </div>
      )}

      {grouped.map(({ label, trades: ts }) => (
        <div key={label}>
          <h3 className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold px-1 mb-2">{label} · {ts.length}</h3>
          <div className="space-y-2">
            {ts.map(t => <TradeCard key={t.id} trade={t} onClick={() => onTradeClick(t)} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function TradeCard({ trade, onClick }) {
  const pnl = trade.pnl || 0;
  const isWin = pnl > 0;
  const isLoss = pnl < 0;
  return (
    <button onClick={onClick}
      className="w-full text-left rounded-xl bg-neutral-900/60 border border-neutral-800 p-3 active:bg-neutral-900 active:scale-[0.99] transition-all flex items-center gap-3">
      <div className={cn("w-1 self-stretch rounded-full",
        isWin ? "bg-emerald-500" : isLoss ? "bg-rose-500" : "bg-neutral-600")} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm font-mono tracking-tight uppercase">{trade.pair || 'Kein Pair'}</span>
          {trade.session && (
            <span className="text-[9px] bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded uppercase tracking-wider font-medium">{trade.session}</span>
          )}
        </div>
        <div className="text-[11px] text-neutral-500 mt-0.5 flex items-center gap-2">
          <span className="num">{fmtDate(trade.date)}</span>
          {trade.screenshots?.length > 0 && (
            <span className="flex items-center gap-0.5"><ImageIcon className="w-2.5 h-2.5" /> {trade.screenshots.length}</span>
          )}
          {trade.confidence && <span>Conf: <span className="num text-neutral-400">{trade.confidence}/10</span></span>}
        </div>
      </div>
      <div className="text-right">
        <div className={cn("num font-bold text-sm",
          isWin ? "text-emerald-400" : isLoss ? "text-rose-400" : "text-neutral-400")}>
          {fmtSigned(pnl)} €
        </div>
        {trade.rMultiple !== undefined && trade.rMultiple !== null && trade.rMultiple !== '' && (
          <div className="num text-[10px] text-neutral-500 mt-0.5">{fmtSigned(Number(trade.rMultiple), 2)}R</div>
        )}
      </div>
    </button>
  );
}

function TradeFormModal({ trade, signalTemplate, timeframeTemplate, onClose, onSave }) {
  const isEdit = !!trade.id;
  const [date, setDate] = useState(trade.date || new Date().toISOString().slice(0, 10));
  const [pair, setPair] = useState(trade.pair || '');
  const [session, setSession] = useState(trade.session || '');
  const [entry, setEntry] = useState(trade.entry ?? '');
  const [stopLoss, setStopLoss] = useState(trade.stopLoss ?? '');
  const [takeProfit, setTakeProfit] = useState(trade.takeProfit ?? '');
  const [pnl, setPnl] = useState(trade.pnl ?? '');
  const [rMultiple, setRMultiple] = useState(trade.rMultiple ?? '');
  const [confidence, setConfidence] = useState(trade.confidence ?? 5);
  const [emotions, setEmotions] = useState(trade.emotions || '');
  const [notes, setNotes] = useState(trade.notes || '');
  const initSignal = trade.signalChecklist ?? signalTemplate.map(i => ({ ...i, checked: false }));
  const initTf = trade.timeframeChecklist ?? timeframeTemplate.map(i => ({ ...i, checked: false }));
  const [signalChecks, setSignalChecks] = useState(initSignal);
  const [timeframeChecks, setTimeframeChecks] = useState(initTf);
  const [screenshots, setScreenshots] = useState(trade.screenshots || []);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();

  async function handleFiles(files) {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const newShots = [];
      for (const f of files) {
        if (!f.type.startsWith('image/')) continue;
        const dataUrl = await compressImage(f);
        newShots.push({ id: genId(), data: dataUrl, caption: '' });
      }
      setScreenshots(prev => [...prev, ...newShots]);
    } catch (e) { console.error(e); }
    finally { setUploading(false); }
  }

  function toggleCheck(list, setter, id) {
    setter(list.map(i => i.id === id ? { ...i, checked: !i.checked } : i));
  }

  function handleSubmit() {
    if (!pair.trim()) { alert('Bitte Pair angeben'); return; }
    onSave({
      id: trade.id, date, pair: pair.trim().toUpperCase(), session,
      entry: entry === '' ? null : parseFloat(entry),
      stopLoss: stopLoss === '' ? null : parseFloat(stopLoss),
      takeProfit: takeProfit === '' ? null : parseFloat(takeProfit),
      pnl: pnl === '' ? 0 : parseFloat(pnl),
      rMultiple: rMultiple === '' ? null : parseFloat(rMultiple),
      confidence: Number(confidence),
      emotions: emotions.trim(), notes: notes.trim(),
      signalChecklist: signalChecks, timeframeChecklist: timeframeChecks,
      screenshots,
      createdAt: trade.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return (
    <Modal onClose={onClose} title={isEdit ? 'Trade bearbeiten' : 'Neuer Trade'} footer={
      <button onClick={handleSubmit}
        className="w-full bg-emerald-500 active:bg-emerald-400 text-black font-bold py-3.5 rounded-xl text-sm flex items-center justify-center gap-2">
        <Save className="w-4 h-4" /> {isEdit ? 'Änderungen speichern' : 'Trade speichern'}
      </button>
    }>
      <div className="space-y-5">
        <Section title="Basics" icon={Clock}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Datum">
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" />
            </Field>
            <Field label="Session">
              <select value={session} onChange={e => setSession(e.target.value)} className="input">
                <option value="">—</option>
                {SESSIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Pair *">
            <input value={pair} onChange={e => setPair(e.target.value)} placeholder="EURUSD, XAUUSD, ..." className="input uppercase tracking-wide" />
          </Field>
        </Section>

        <Section title="Entry / SL / TP" icon={Target}>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Entry"><input inputMode="decimal" value={entry} onChange={e => setEntry(e.target.value)} placeholder="0.00" className="input num" /></Field>
            <Field label="Stop Loss"><input inputMode="decimal" value={stopLoss} onChange={e => setStopLoss(e.target.value)} placeholder="0.00" className="input num" /></Field>
            <Field label="Take Profit"><input inputMode="decimal" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} placeholder="0.00" className="input num" /></Field>
          </div>
        </Section>

        <Section title="Ergebnis" icon={BarChart3}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="P&L (€)"><input inputMode="decimal" value={pnl} onChange={e => setPnl(e.target.value)} placeholder="-100.50 / 250" className="input num" /></Field>
            <Field label="R-Multiple"><input inputMode="decimal" value={rMultiple} onChange={e => setRMultiple(e.target.value)} placeholder="z.B. 2.5" className="input num" /></Field>
          </div>
        </Section>

        <Section title="Confidence" icon={Activity}>
          <div className="flex items-center gap-3">
            <input type="range" min="1" max="10" step="1" value={confidence} onChange={e => setConfidence(e.target.value)} className="flex-1" />
            <div className="num text-lg font-bold text-emerald-400 w-14 text-right">{confidence}/10</div>
          </div>
          <div className="flex justify-between text-[9px] text-neutral-600 uppercase tracking-wider mt-1 px-1">
            <span>Unsicher</span><span>Sehr sicher</span>
          </div>
        </Section>

        <Section title="Signal-Check" icon={ListChecks}>
          {signalChecks.length === 0 ? <EmptyChecklistHint type="Signal" /> : (
            <div className="space-y-1">
              {signalChecks.map(i => <ChecklistItem key={i.id} item={i} onToggle={() => toggleCheck(signalChecks, setSignalChecks, i.id)} />)}
            </div>
          )}
        </Section>

        <Section title="Timeframe-Check" icon={Clock}>
          {timeframeChecks.length === 0 ? <EmptyChecklistHint type="Timeframe" /> : (
            <div className="space-y-1">
              {timeframeChecks.map(i => <ChecklistItem key={i.id} item={i} onToggle={() => toggleCheck(timeframeChecks, setTimeframeChecks, i.id)} />)}
            </div>
          )}
        </Section>

        <Section title="Screenshots" icon={Camera}>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => handleFiles(Array.from(e.target.files))} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            className="w-full border border-dashed border-neutral-700 bg-neutral-900/50 hover:bg-neutral-900 active:bg-neutral-800 rounded-xl py-6 flex flex-col items-center gap-2 text-neutral-400 transition-colors">
            <Camera className="w-5 h-5" />
            <span className="text-xs font-medium">{uploading ? 'Verarbeite...' : 'Charts hinzufügen'}</span>
            <span className="text-[10px] text-neutral-600">Tippe zum Auswählen oder Kamera öffnen</span>
          </button>
          {screenshots.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mt-3">
              {screenshots.map(s => (
                <div key={s.id} className="relative group rounded-lg overflow-hidden border border-neutral-800 bg-neutral-900">
                  <img src={s.data} alt="" className="w-full aspect-video object-cover" />
                  <button onClick={() => setScreenshots(screenshots.filter(x => x.id !== s.id))}
                    className="absolute top-1 right-1 w-7 h-7 bg-black/70 backdrop-blur-sm rounded-full flex items-center justify-center text-white active:bg-rose-600">
                    <X className="w-4 h-4" />
                  </button>
                  <input value={s.caption}
                    onChange={(e) => setScreenshots(screenshots.map(x => x.id === s.id ? { ...x, caption: e.target.value } : x))}
                    placeholder="Beschriftung..."
                    className="w-full bg-black/50 text-white text-[10px] px-2 py-1 border-t border-neutral-800 focus:outline-none placeholder:text-neutral-500" />
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Emotionen & Psychologie" icon={Activity}>
          <textarea value={emotions} onChange={e => setEmotions(e.target.value)} rows={3}
            placeholder="Wie hast du dich vor/während/nach dem Trade gefühlt? FOMO? Angst? Gier? Diszipliniert?"
            className="input resize-none" />
        </Section>

        <Section title="Notizen" icon={BookOpen}>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
            placeholder="Setup-Beschreibung, was lief gut/schlecht, Learnings, was beim nächsten Mal anders..."
            className="input resize-none" />
        </Section>
      </div>
    </Modal>
  );
}

function Section({ title, icon: Icon, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 px-1">
        {Icon && <Icon className="w-3.5 h-3.5 text-emerald-400" />}
        <h3 className="text-[11px] uppercase tracking-widest text-neutral-400 font-semibold">{title}</h3>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1 px-0.5">{label}</span>
      {children}
    </label>
  );
}

function ChecklistItem({ item, onToggle }) {
  return (
    <button type="button" onClick={onToggle}
      className={cn("w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-all border",
        item.checked ? "bg-emerald-500/10 border-emerald-500/30" : "bg-neutral-900/40 border-neutral-800 active:bg-neutral-900")}>
      <div className={cn("w-5 h-5 rounded-md flex items-center justify-center shrink-0 border-2",
        item.checked ? "bg-emerald-500 border-emerald-500" : "border-neutral-600")}>
        {item.checked && <Check className="w-3.5 h-3.5 text-black" strokeWidth={3.5} />}
      </div>
      <span className={cn("text-sm flex-1", item.checked ? "text-emerald-100" : "text-neutral-300")}>{item.label}</span>
    </button>
  );
}

function EmptyChecklistHint({ type }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-800 p-4 text-center">
      <AlertCircle className="w-5 h-5 text-neutral-600 mx-auto mb-1.5" />
      <p className="text-xs text-neutral-500">
        Noch keine {type}-Einträge. Unter <span className="text-emerald-400 font-medium">Einstellungen</span> eigene Items hinzufügen.
      </p>
    </div>
  );
}

function Modal({ title, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 z-40 bg-[#0a0a0b] flex flex-col">
      <div className="sticky top-0 z-10 backdrop-blur-xl bg-[#0a0a0b]/80 border-b border-neutral-900">
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center gap-2">
          <button onClick={onClose} className="p-2 -ml-2 rounded-lg active:bg-neutral-800 text-neutral-400">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="font-bold text-base">{title}</h2>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-4 py-5 pb-32">{children}</div>
      </div>
      {footer && (
        <div className="sticky bottom-0 backdrop-blur-xl bg-[#0a0a0b]/95 border-t border-neutral-900">
          <div className="max-w-xl mx-auto px-4 py-3 pb-5">{footer}</div>
        </div>
      )}
    </div>
  );
}

function TradeDetailModal({ trade, onClose, onEdit, onDelete }) {
  const pnl = trade.pnl || 0;
  const isWin = pnl > 0;
  const isLoss = pnl < 0;
  const [zoomShot, setZoomShot] = useState(null);
  const signalChecked = (trade.signalChecklist || []).filter(i => i.checked).length;
  const signalTotal = (trade.signalChecklist || []).length;
  const tfChecked = (trade.timeframeChecklist || []).filter(i => i.checked).length;
  const tfTotal = (trade.timeframeChecklist || []).length;

  return (
    <Modal title="Trade-Details" onClose={onClose} footer={
      <div className="flex gap-2">
        <button onClick={onDelete} className="px-4 py-3 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/30 active:bg-rose-500/20 font-semibold text-sm flex items-center gap-2">
          <Trash2 className="w-4 h-4" /> Löschen
        </button>
        <button onClick={onEdit} className="flex-1 py-3 rounded-xl bg-emerald-500 text-black font-bold text-sm active:bg-emerald-400 flex items-center justify-center gap-2">
          <Edit3 className="w-4 h-4" /> Bearbeiten
        </button>
      </div>
    }>
      <div className="space-y-4">
        <div className="rounded-2xl border border-neutral-800 bg-gradient-to-br from-neutral-900 to-neutral-950 p-5 relative overflow-hidden">
          <div className={cn("absolute -top-8 -right-8 w-32 h-32 rounded-full blur-3xl opacity-20",
            isWin ? "bg-emerald-500" : isLoss ? "bg-rose-500" : "bg-neutral-500")} />
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="font-bold text-2xl font-mono tracking-tight uppercase">{trade.pair}</h2>
              {trade.session && (
                <span className="text-[10px] bg-neutral-800 text-neutral-300 px-2 py-0.5 rounded-md uppercase tracking-wider font-medium">{trade.session}</span>
              )}
            </div>
            <div className="text-xs text-neutral-500 num">{fmtDate(trade.date)}</div>
            <div className={cn("num font-bold text-3xl mt-3",
              isWin ? "text-emerald-400" : isLoss ? "text-rose-400" : "text-neutral-300")}>
              {fmtSigned(pnl)} €
            </div>
            {trade.rMultiple !== null && trade.rMultiple !== undefined && trade.rMultiple !== '' && (
              <div className="num text-sm text-neutral-400 mt-0.5">{fmtSigned(Number(trade.rMultiple), 2)}R</div>
            )}
          </div>
        </div>

        {(trade.entry || trade.stopLoss || trade.takeProfit) && (
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Entry" value={trade.entry !== null && trade.entry !== undefined && trade.entry !== '' ? fmtNum(trade.entry, 5) : '—'} />
            <Stat label="Stop Loss" value={trade.stopLoss !== null && trade.stopLoss !== undefined && trade.stopLoss !== '' ? fmtNum(trade.stopLoss, 5) : '—'} color="rose" />
            <Stat label="Take Profit" value={trade.takeProfit !== null && trade.takeProfit !== undefined && trade.takeProfit !== '' ? fmtNum(trade.takeProfit, 5) : '—'} color="emerald" />
          </div>
        )}

        {trade.confidence !== undefined && trade.confidence !== null && (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold">Confidence</span>
              <span className="num text-sm font-bold text-emerald-400">{trade.confidence}/10</span>
            </div>
            <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full"
                style={{ width: `${(trade.confidence / 10) * 100}%` }} />
            </div>
          </div>
        )}

        {trade.screenshots?.length > 0 && (
          <Section title={`Charts (${trade.screenshots.length})`} icon={Camera}>
            <div className="grid grid-cols-2 gap-2">
              {trade.screenshots.map(s => (
                <button key={s.id} onClick={() => setZoomShot(s)}
                  className="rounded-lg overflow-hidden border border-neutral-800 bg-neutral-900 active:scale-95 transition-transform">
                  <img src={s.data} alt="" className="w-full aspect-video object-cover" />
                  {s.caption && <div className="px-2 py-1 text-[10px] text-neutral-400 bg-black/50 truncate text-left">{s.caption}</div>}
                </button>
              ))}
            </div>
          </Section>
        )}

        {signalTotal > 0 && (
          <Section title={`Signal-Check (${signalChecked}/${signalTotal})`} icon={ListChecks}>
            <div className="space-y-1">
              {trade.signalChecklist.map(i => (
                <div key={i.id} className={cn("flex items-center gap-3 p-2.5 rounded-lg border text-sm",
                  i.checked ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-100" : "bg-neutral-900/40 border-neutral-800 text-neutral-500")}>
                  <div className={cn("w-5 h-5 rounded-md flex items-center justify-center shrink-0 border-2",
                    i.checked ? "bg-emerald-500 border-emerald-500" : "border-neutral-700")}>
                    {i.checked && <Check className="w-3.5 h-3.5 text-black" strokeWidth={3.5} />}
                  </div>
                  {i.label}
                </div>
              ))}
            </div>
          </Section>
        )}

        {tfTotal > 0 && (
          <Section title={`Timeframe-Check (${tfChecked}/${tfTotal})`} icon={Clock}>
            <div className="space-y-1">
              {trade.timeframeChecklist.map(i => (
                <div key={i.id} className={cn("flex items-center gap-3 p-2.5 rounded-lg border text-sm",
                  i.checked ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-100" : "bg-neutral-900/40 border-neutral-800 text-neutral-500")}>
                  <div className={cn("w-5 h-5 rounded-md flex items-center justify-center shrink-0 border-2",
                    i.checked ? "bg-emerald-500 border-emerald-500" : "border-neutral-700")}>
                    {i.checked && <Check className="w-3.5 h-3.5 text-black" strokeWidth={3.5} />}
                  </div>
                  {i.label}
                </div>
              ))}
            </div>
          </Section>
        )}

        {trade.emotions && (
          <Section title="Emotionen" icon={Activity}>
            <p className="text-sm text-neutral-300 whitespace-pre-wrap rounded-xl bg-neutral-900/40 border border-neutral-800 p-3 leading-relaxed">{trade.emotions}</p>
          </Section>
        )}

        {trade.notes && (
          <Section title="Notizen" icon={BookOpen}>
            <p className="text-sm text-neutral-300 whitespace-pre-wrap rounded-xl bg-neutral-900/40 border border-neutral-800 p-3 leading-relaxed">{trade.notes}</p>
          </Section>
        )}
      </div>

      {zoomShot && (
        <div onClick={() => setZoomShot(null)} className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4">
          <img src={zoomShot.data} alt="" className="max-w-full max-h-full object-contain" />
          <button onClick={() => setZoomShot(null)} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 backdrop-blur flex items-center justify-center text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, color = 'neutral' }) {
  const colors = { emerald: 'text-emerald-400', rose: 'text-rose-400', neutral: 'text-neutral-200' };
  return (
    <div className="rounded-lg bg-neutral-900/40 border border-neutral-800 p-2.5">
      <div className="text-[9px] text-neutral-500 uppercase tracking-wider font-semibold">{label}</div>
      <div className={cn("num text-sm font-bold mt-0.5", colors[color])}>{value}</div>
    </div>
  );
}

function SettingsView({ signalTemplate, timeframeTemplate, routineTemplates, onUpdateSignal, onUpdateTimeframe, onUpdateRoutine, trades, routineDays, showToast }) {
  function exportData() {
    const blob = new Blob([JSON.stringify({
      trades, signalTemplate, timeframeTemplate, routineTemplates, routineDays,
      exportedAt: new Date().toISOString()
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trading-journal-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Export erstellt');
  }

  return (
    <div className="space-y-4">
      <h3 className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold px-1">Trade-Checklisten</h3>
      <ChecklistEditor title="Signal-Check"
        description="Items, die du bei jedem Trade prüfst (z.B. BOS, CHoCH, OB, FVG, Liquidity Sweep)"
        icon={ListChecks} items={signalTemplate} onUpdate={onUpdateSignal} />
      <ChecklistEditor title="Timeframe-Check"
        description="Timeframe-bezogene Checks (z.B. HTF Bias, MTF Struktur, LTF Entry-Confirmation)"
        icon={Clock} items={timeframeTemplate} onUpdate={onUpdateTimeframe} />

      <h3 className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold px-1 pt-3">Tages-Routinen</h3>
      {routineTemplates && Object.keys(ROUTINE_META).sort((a, b) => ROUTINE_META[a].order - ROUTINE_META[b].order).map(key => {
        const meta = ROUTINE_META[key];
        return (
          <ChecklistEditor key={key} title={meta.label}
            description={`Routine-Items für ${meta.label}. Änderungen gelten ab neuen Tagen – vergangene Tage bleiben unverändert.`}
            icon={meta.icon} items={routineTemplates[key]}
            onUpdate={(items) => onUpdateRoutine(key, items)} />
        );
      })}

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
        <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
          <Download className="w-4 h-4 text-emerald-400" /> Daten-Export
        </h3>
        <p className="text-xs text-neutral-500 mb-3">Backup aller Trades + Routinen + Templates als JSON-Datei.</p>
        <button onClick={exportData}
          className="w-full py-2.5 rounded-lg bg-neutral-800 active:bg-neutral-700 text-neutral-200 text-sm font-medium flex items-center justify-center gap-2">
          <Download className="w-4 h-4" /> Export herunterladen
        </button>
      </div>

      <div className="text-center text-[10px] text-neutral-600 pt-2 pb-4">
        Trading Journal · SMC Edition<br />Daten lokal gespeichert · Mobile-first
      </div>
    </div>
  );
}

function ChecklistEditor({ title, description, icon: Icon, items, onUpdate }) {
  const [newItem, setNewItem] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingLabel, setEditingLabel] = useState('');

  function addItem() {
    const label = newItem.trim();
    if (!label) return;
    onUpdate([...items, { id: genId(), label, checked: false }]);
    setNewItem('');
  }
  function removeItem(id) { onUpdate(items.filter(i => i.id !== id)); }
  function startEdit(item) { setEditingId(item.id); setEditingLabel(item.label); }
  function saveEdit() {
    if (editingLabel.trim()) onUpdate(items.map(i => i.id === editingId ? { ...i, label: editingLabel.trim() } : i));
    setEditingId(null); setEditingLabel('');
  }
  function moveUp(idx) { if (idx === 0) return; const n = [...items]; [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]]; onUpdate(n); }
  function moveDown(idx) { if (idx === items.length - 1) return; const n = [...items]; [n[idx + 1], n[idx]] = [n[idx], n[idx + 1]]; onUpdate(n); }

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex items-center gap-2 mb-1">
        {Icon && <Icon className="w-4 h-4 text-emerald-400" />}
        <h3 className="font-semibold text-sm">{title}</h3>
        <span className="num text-[10px] text-neutral-500 ml-auto">{items.length}</span>
      </div>
      <p className="text-xs text-neutral-500 mb-3">{description}</p>

      <div className="space-y-1.5 mb-3">
        {items.length === 0 ? (
          <div className="text-center py-6 text-xs text-neutral-600 border border-dashed border-neutral-800 rounded-lg">Noch keine Items</div>
        ) : items.map((item, idx) => (
          <div key={item.id} className="flex items-center gap-1.5 bg-neutral-900 border border-neutral-800 rounded-lg p-1.5">
            <div className="flex flex-col">
              <button onClick={() => moveUp(idx)} disabled={idx === 0} className="p-0.5 text-neutral-500 disabled:opacity-20 active:text-neutral-200">
                <ChevronLeft className="w-3 h-3 rotate-90" />
              </button>
              <button onClick={() => moveDown(idx)} disabled={idx === items.length - 1} className="p-0.5 text-neutral-500 disabled:opacity-20 active:text-neutral-200">
                <ChevronLeft className="w-3 h-3 -rotate-90" />
              </button>
            </div>
            {editingId === item.id ? (
              <input value={editingLabel} onChange={e => setEditingLabel(e.target.value)} onBlur={saveEdit}
                onKeyDown={e => e.key === 'Enter' && saveEdit()} autoFocus
                className="flex-1 bg-neutral-800 border border-emerald-500/50 rounded px-2 py-1.5 text-sm text-neutral-100 outline-none" />
            ) : (
              <button onClick={() => startEdit(item)} className="flex-1 text-left px-2 py-1.5 text-sm text-neutral-200 active:text-emerald-400">
                {item.label}
              </button>
            )}
            <button onClick={() => removeItem(item.id)} className="p-1.5 text-neutral-500 active:text-rose-400 rounded-md active:bg-rose-500/10">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input value={newItem} onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addItem()} placeholder="Neues Item hinzufügen..."
          className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-emerald-500/50" />
        <button onClick={addItem} disabled={!newItem.trim()}
          className="px-3 py-2 bg-emerald-500 active:bg-emerald-400 disabled:bg-neutral-800 disabled:text-neutral-600 text-black rounded-lg font-semibold text-sm flex items-center gap-1">
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
    </div>
  );
}
