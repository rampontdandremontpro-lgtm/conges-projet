import { useState, useMemo, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { motion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, CalendarPlus, FileText, Clock, Paperclip,
  Wallet, Download, Bell, User, ChevronRight, ChevronLeft,
  ChevronDown, Search, X, Check, AlertTriangle, XCircle,
  Upload, LogOut, ArrowRight, MoreHorizontal, Settings,
  Shield, Plus, Loader2, Calendar, Sparkles,
} from "lucide-react";
import {
  format, addMonths, subMonths, endOfMonth, startOfWeek,
  endOfWeek, eachDayOfInterval, isSameDay, isWithinInterval,
  isSameMonth, isToday, getDay, differenceInCalendarDays,
} from "date-fns";
import { fr } from "date-fns/locale";

// ─── Types ────────────────────────────────────────────────────────────────────

type Page =
  | "dashboard" | "new-request" | "requests" | "declare-absence"
  | "justificatifs" | "balances" | "documents" | "notifications" | "profile";
type HalfDay = "AM" | "PM";
type StatusKey =
  | "BROUILLON" | "EN_ATTENTE" | "VALIDÉE" | "REFUSÉE" | "ANNULÉE"
  | "EXPIRÉE" | "JUSTIFICATIF_EN_ATTENTE" | "À_VÉRIFIER_RH"
  | "JUSTIFICATIF_REJETÉ" | "ENREGISTRÉE";
type SelPhase  = "idle" | "selecting";
type BtnVariant = "primary" | "secondary" | "ghost" | "orange" | "danger";
type BtnSize    = "sm" | "md" | "lg" | "xl";

interface NavItemDef { id: Page; label: string; Icon: LucideIcon; badge?: number; }
interface CalSel { start: Date | null; end: Date | null; halfStart: HalfDay; halfEnd: HalfDay; }

// ─── Constants ────────────────────────────────────────────────────────────────

const DEMO_TODAY = new Date(2026, 6, 10); // 10 juillet 2026

const HOLIDAYS = new Set([
  "2026-01-01","2026-04-06","2026-05-01","2026-05-08",
  "2026-05-14","2026-05-25","2026-07-14","2026-08-15",
  "2026-11-01","2026-11-11","2026-12-25",
]);
const HOL_LABELS: Record<string, string> = {
  "2026-07-14":"Fête Nationale","2026-08-15":"Assomption",
  "2026-11-01":"Toussaint","2026-11-11":"Armistice","2026-12-25":"Noël",
  "2026-01-01":"Jour de l'An","2026-04-06":"Lundi de Pâques",
  "2026-05-01":"Fête du Travail","2026-05-08":"Victoire 1945",
  "2026-05-14":"Ascension","2026-05-25":"Lundi de Pentecôte",
};
const CLOSURES = new Set(["2026-08-17","2026-08-18","2026-12-24","2026-12-31"]);

const STATUS_CFG: Record<StatusKey, { label: string; cls: string; Icon: LucideIcon }> = {
  BROUILLON:               { label:"Brouillon",                 cls:"bg-slate-50  text-slate-500  border-slate-200",   Icon:FileText     },
  EN_ATTENTE:              { label:"En attente",                cls:"bg-amber-50  text-amber-700  border-amber-200",   Icon:Clock        },
  VALIDÉE:                 { label:"Validée",                   cls:"bg-emerald-50 text-emerald-700 border-emerald-200", Icon:Check      },
  REFUSÉE:                 { label:"Refusée",                   cls:"bg-rose-50   text-rose-600   border-rose-200",    Icon:XCircle      },
  ANNULÉE:                 { label:"Annulée",                   cls:"bg-slate-50  text-slate-400  border-slate-200",   Icon:X            },
  EXPIRÉE:                 { label:"Expirée",                   cls:"bg-gray-50   text-gray-500   border-gray-200",    Icon:Clock        },
  JUSTIFICATIF_EN_ATTENTE: { label:"Justificatif en attente",   cls:"bg-orange-50 text-orange-700 border-orange-200",  Icon:Upload       },
  À_VÉRIFIER_RH:           { label:"À vérifier par RH",         cls:"bg-blue-50   text-blue-700   border-blue-200",    Icon:AlertTriangle},
  JUSTIFICATIF_REJETÉ:     { label:"Justificatif rejeté",       cls:"bg-red-50    text-red-600    border-red-200",     Icon:XCircle      },
  ENREGISTRÉE:             { label:"Enregistrée",               cls:"bg-teal-50   text-teal-700   border-teal-200",    Icon:Check        },
};

const NAV_ITEMS: NavItemDef[] = [
  { id:"dashboard",        label:"Tableau de bord",     Icon:LayoutDashboard },
  { id:"requests",         label:"Mes demandes",         Icon:FileText,  badge:1 },
  { id:"declare-absence",  label:"Déclarer une absence", Icon:Clock      },
  { id:"justificatifs",    label:"Mes justificatifs",    Icon:Paperclip  },
  { id:"balances",         label:"Mes soldes",           Icon:Wallet     },
  { id:"documents",        label:"Documents PDF",        Icon:Download   },
  { id:"notifications",    label:"Notifications",        Icon:Bell, badge:2 },
];

const PAGE_META: Record<Page, { title: string; crumbs: string[] }> = {
  "dashboard":       { title:"Tableau de bord",      crumbs:["GMES","Tableau de bord"]      },
  "new-request":     { title:"Nouvelle demande",      crumbs:["GMES","Nouvelle demande"]      },
  "requests":        { title:"Mes demandes",          crumbs:["GMES","Mes demandes"]          },
  "declare-absence": { title:"Déclarer une absence",  crumbs:["GMES","Déclarer une absence"]  },
  "justificatifs":   { title:"Mes justificatifs",     crumbs:["GMES","Mes justificatifs"]     },
  "balances":        { title:"Mes soldes",            crumbs:["GMES","Mes soldes"]            },
  "documents":       { title:"Documents PDF",         crumbs:["GMES","Documents PDF"]         },
  "notifications":   { title:"Notifications",         crumbs:["GMES","Notifications"]         },
  "profile":         { title:"Mon profil",            crumbs:["GMES","Mon profil"]            },
};

const LEAVE_TYPES = ["Congés payés","Congés sans solde","Congé pour événement familial","Congé maternité / paternité"];

const SAMPLE_REQUESTS = [
  { id:1, type:"Congés payés",                  start:"14/07/2026", end:"18/07/2026", days:5,   status:"VALIDÉE" as StatusKey              },
  { id:2, type:"Congés payés",                  start:"17/08/2026", end:"21/08/2026", days:4.5, status:"EN_ATTENTE" as StatusKey           },
  { id:3, type:"Absence maladie",               start:"15/03/2026", end:"17/03/2026", days:3,   status:"JUSTIFICATIF_EN_ATTENTE" as StatusKey },
  { id:4, type:"Congés payés",                  start:"25/12/2026", end:"02/01/2027", days:7,   status:"BROUILLON" as StatusKey            },
  { id:5, type:"Congé pour événement familial", start:"08/01/2026", end:"08/01/2026", days:1,   status:"ENREGISTRÉE" as StatusKey          },
  { id:6, type:"Congés payés",                  start:"10/02/2026", end:"14/02/2026", days:5,   status:"REFUSÉE" as StatusKey              },
];

const WEEKDAYS = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmtKey(d: Date) { return format(d, "yyyy-MM-dd"); }
function cap(s: string)  { return s.charAt(0).toUpperCase() + s.slice(1); }

function getCalDays(year: number, month: number) {
  const ms = new Date(year, month, 1);
  return eachDayOfInterval({
    start: startOfWeek(ms, { weekStartsOn: 1 }),
    end:   endOfWeek(endOfMonth(ms), { weekStartsOn: 1 }),
  });
}
function chunk<T>(arr: T[], n: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
}
function countWork(start: Date, end: Date) {
  return eachDayOfInterval({ start, end }).filter(d => {
    const dw = getDay(d);
    return dw !== 0 && dw !== 6 && !HOLIDAYS.has(fmtKey(d)) && !CLOSURES.has(fmtKey(d));
  }).length;
}

// ─── SVG Pictograms ───────────────────────────────────────────────────────────

function GmesLogo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect width="40" height="40" rx="11" fill="#1B6EF3" />
      <rect x="7" y="14" width="26" height="19" rx="3.5" stroke="white" strokeWidth="1.8" fill="none" opacity="0.9" />
      <rect x="7" y="14" width="26" height="7" rx="3.5" fill="white" opacity="0.18" />
      <rect x="13.5" y="10" width="2.5" height="7" rx="1.25" fill="white" opacity="0.95" />
      <rect x="24" y="10" width="2.5" height="7" rx="1.25" fill="white" opacity="0.95" />
      <path d="M14 25.5L18.5 30L26.5 20.5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FaceHappy({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="10" fill="#FEF3C7" stroke="#FCD34D" strokeWidth="1.5" />
      <path d="M7.5 8.5L8.5 7.5L9.5 8.5L8.5 9.5Z" fill="#92400E" />
      <path d="M12.5 8.5L13.5 7.5L14.5 8.5L13.5 9.5Z" fill="#92400E" />
      <path d="M7 13C7.5 15.5 9 16 11 16C13 16 14.5 15.5 15 13" stroke="#92400E" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <circle cx="7.5" cy="12" r="1.5" fill="#FCA5A5" opacity="0.6" />
      <circle cx="14.5" cy="12" r="1.5" fill="#FCA5A5" opacity="0.6" />
    </svg>
  );
}

function FaceRelaxed({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="10" fill="#ECFDF5" stroke="#6EE7B7" strokeWidth="1.5" />
      <path d="M7.5 9.5Q9 7.5 10.5 9.5" stroke="#065F46" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11.5 9.5Q13 7.5 14.5 9.5" stroke="#065F46" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7.5 13.5Q11 16.5 14.5 13.5" stroke="#065F46" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7.5" cy="12.5" r="1.5" fill="#A7F3D0" opacity="0.7" />
      <circle cx="14.5" cy="12.5" r="1.5" fill="#A7F3D0" opacity="0.7" />
    </svg>
  );
}

function SunPic({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="3" fill="#F59E0B" />
      <path d="M8 1.5V3M8 13V14.5M1.5 8H3M13 8H14.5M3.4 3.4L4.4 4.4M11.6 11.6L12.6 12.6M12.6 3.4L11.6 4.4M4.4 11.6L3.4 12.6"
        stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function MoonPic({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M14 10C12.8 12.6 10.1 14.3 7 14.3C3.7 14.3 1 11.6 1 8.3C1 5.2 3 2.8 5.8 2C5.1 3.1 4.7 4.4 4.7 5.8C4.7 9.5 7.7 12.5 11.4 12.5C12.3 12.5 13.2 12.3 14 10Z"
        fill="#6366F1" opacity="0.8" />
    </svg>
  );
}

// ─── UI Primitives ────────────────────────────────────────────────────────────

function Btn({
  children, variant = "primary", size = "md", onClick, disabled, loading,
  className = "", icon, fullWidth,
}: {
  children?: ReactNode; variant?: BtnVariant; size?: BtnSize;
  onClick?: () => void; disabled?: boolean; loading?: boolean;
  className?: string; icon?: ReactNode; fullWidth?: boolean;
}) {
  const base = "inline-flex items-center justify-center gap-2 font-semibold rounded-2xl transition-all duration-150 select-none";
  const sizes: Record<BtnSize, string> = {
    sm: "px-3.5 py-1.5 text-[13px]",
    md: "px-4 py-2 text-sm",
    lg: "px-5 py-2.5 text-[15px]",
    xl: "px-6 py-3.5 text-base",
  };
  const vars: Record<BtnVariant, string> = {
    primary:   "bg-[#1B6EF3] text-white hover:bg-[#155FD8] active:scale-[0.98] shadow-sm hover:shadow-md shadow-[#1B6EF3]/20",
    secondary: "bg-white text-[#0A1E45] border border-[rgba(10,30,69,0.12)] hover:bg-[#EFF3FA] hover:border-[rgba(10,30,69,0.2)]",
    ghost:     "text-[#6B7FA3] hover:text-[#0A1E45] hover:bg-[#E4EDF9]",
    orange:    "bg-[#F76B1C] text-white hover:bg-[#E55F14] active:scale-[0.98] shadow-sm hover:shadow-md shadow-[#F76B1C]/20",
    danger:    "bg-[#E02B4F] text-white hover:bg-[#CC2445] shadow-sm",
  };
  return (
    <button type="button"
      className={`${base} ${sizes[size]} ${vars[variant]} ${fullWidth ? "w-full" : ""} ${(disabled || loading) ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${className}`}
      onClick={onClick} disabled={disabled || loading}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : icon && <span className="flex-shrink-0">{icon}</span>}
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: StatusKey }) {
  const { label, cls, Icon: Ic } = STATUS_CFG[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      <Ic size={10} />{label}
    </span>
  );
}

function Ava({ name, size = "md", online }: { name: string; size?: "sm"|"md"|"lg"; online?: boolean }) {
  const init = name.split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase();
  const sz: Record<string,string> = { sm:"w-7 h-7 text-[11px]", md:"w-9 h-9 text-sm", lg:"w-16 h-16 text-xl" };
  return (
    <div className="relative inline-flex flex-shrink-0">
      <div className={`${sz[size]} rounded-full bg-gradient-to-br from-[#1B6EF3] to-[#0CAAD4] flex items-center justify-center text-white font-black`}>
        {init}
      </div>
      {online && <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-white" />}
    </div>
  );
}

function Toast({ msg, show, type = "success" }: { msg: string; show: boolean; type?: "success"|"error" }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl
      transition-all duration-300 ease-out pointer-events-none
      ${show ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}
      ${type === "success" ? "bg-[#0A1E45] text-white" : "bg-[#E02B4F] text-white"}`}>
      <Check size={16} className="text-emerald-400 flex-shrink-0" />
      <p className="text-sm font-bold">{msg}</p>
    </div>
  );
}

// ─── Month Grid ───────────────────────────────────────────────────────────────

function MonthGrid({
  month, rangeStart, rangeEnd, isSingle, halfStart, halfEnd,
  onDayClick, onDayHover, large,
}: {
  month: Date; rangeStart: Date|null; rangeEnd: Date|null; isSingle: boolean;
  halfStart: HalfDay; halfEnd: HalfDay;
  onDayClick: (d: Date) => void; onDayHover: (d: Date|null, info?: string) => void;
  large?: boolean;
}) {
  const year  = month.getFullYear();
  const mo    = month.getMonth();
  const days  = useMemo(() => getCalDays(year, mo), [year, mo]);
  const weeks = useMemo(() => chunk(days, 7), [days]);
  const label = cap(format(month, "MMMM yyyy", { locale: fr }));
  const cellH = large ? "h-[54px]" : "h-10";
  const numSz = large ? "text-[15px]" : "text-sm";

  return (
    <div>
      <p className={`font-black text-[#0A1E45] text-center mb-4 ${large ? "text-base" : "text-sm"}`}>{label}</p>
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map(d => (
          <div key={d} className="text-center text-[10px] font-black text-[#A8C0E4] uppercase tracking-widest py-1">{d}</div>
        ))}
      </div>
      <div className="space-y-0.5">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((day, di) => {
              const key      = fmtKey(day);
              const inMonth  = isSameMonth(day, month);
              const isSun    = getDay(day) === 0;
              const isSat    = getDay(day) === 6;
              const isHol    = HOLIDAYS.has(key);
              const isCls    = CLOSURES.has(key);
              const todayD   = isToday(day);
              const disabled = isSun || isCls || !inMonth;
              const isStart  = !!rangeStart && isSameDay(day, rangeStart);
              const isEnd    = !!rangeEnd   && isSameDay(day, rangeEnd);
              const single   = isStart && isSingle;
              const inRange  = !!(rangeStart && rangeEnd && isWithinInterval(day, { start: rangeStart, end: rangeEnd }));
              const isMid    = inRange && !isStart && !isEnd;
              const showL    = inRange && !isStart;
              const showR    = inRange && !isEnd;
              const showFace = (isStart || isEnd) && !single && inMonth;
              const isPMst   = isStart && !isSingle && halfStart === "PM";
              const isAMen   = isEnd   && !isSingle && halfEnd   === "AM";

              return (
                <div key={di}
                  className={`relative flex items-center justify-center ${cellH} ${!disabled ? "cursor-pointer group" : "cursor-default"}`}
                  onClick={() => !disabled && onDayClick(day)}
                  onMouseEnter={() => !disabled && onDayHover(day, isHol ? HOL_LABELS[key] : isCls ? "Fermeture GMES" : undefined)}
                  onMouseLeave={() => onDayHover(null)}
                >
                  {/* Selection band */}
                  {showL && <div className="absolute left-0 right-1/2 top-[6px] bottom-[6px] bg-[#1B6EF3]/10 pointer-events-none" />}
                  {showR && <div className="absolute left-1/2 right-0 top-[6px] bottom-[6px] bg-[#1B6EF3]/10 pointer-events-none" />}
                  {isPMst && <div className="absolute left-1/2 right-0 top-[6px] bottom-[6px] bg-[#1B6EF3]/10 pointer-events-none z-10" />}
                  {isAMen && <div className="absolute left-0 right-1/2 top-[6px] bottom-[6px] bg-[#1B6EF3]/10 pointer-events-none z-10" />}

                  {/* Day circle */}
                  <div className={[
                    "relative z-20 w-10 h-10 rounded-full flex flex-col items-center justify-center transition-all duration-150",
                    (isStart || isEnd) && inMonth ? "bg-[#1B6EF3] text-white shadow-md shadow-[#1B6EF3]/30" : "",
                    single && inMonth ? "bg-[#1B6EF3] text-white shadow-md" : "",
                    isMid ? "text-[#1B6EF3] font-bold" : "",
                    todayD && !inRange ? "ring-2 ring-[#1B6EF3]/40 ring-offset-1 text-[#1B6EF3] font-black" : "",
                    !inRange && !todayD && !disabled && !isHol ? "group-hover:bg-[#E4EDF9]" : "",
                    isSun && inMonth ? "opacity-20 line-through" : "",
                    isSat && !inRange && inMonth ? "text-[#0CAAD4] font-semibold" : "",
                    !inMonth ? "text-[#D0DCEF]" : "",
                    isHol && !inRange && inMonth ? "text-[#F76B1C] font-bold" : "",
                    isCls && inMonth ? "opacity-25" : "",
                  ].filter(Boolean).join(" ")}>
                    {showFace && isStart ? (
                      <><FaceHappy size={large ? 15 : 12} /><span className="text-[9px] font-black leading-none mt-0.5">{format(day,"d")}</span></>
                    ) : showFace && isEnd ? (
                      <><FaceRelaxed size={large ? 15 : 12} /><span className="text-[9px] font-black leading-none mt-0.5">{format(day,"d")}</span></>
                    ) : (
                      <span className={`${numSz} leading-none`}>{format(day,"d")}</span>
                    )}
                  </div>

                  {(isHol || isCls) && !inRange && inMonth && (
                    <div className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full z-30 ${isHol ? "bg-[#F76B1C]" : "bg-[#6B7FA3]/50"}`} />
                  )}
                  {isPMst && <div className="absolute top-1.5 right-2 z-30"><MoonPic size={8} /></div>}
                  {isAMen && <div className="absolute top-1.5 left-2 z-30"><SunPic  size={8} /></div>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Two-Month Calendar ───────────────────────────────────────────────────────

function TwoMonthCalendar({ onSelect }: { onSelect: (sel: CalSel) => void }) {
  const [base,      setBase]      = useState(new Date(2026, 6, 1)); // juillet 2026
  const [selStart,  setSelStart]  = useState<Date|null>(null);
  const [selEnd,    setSelEnd]    = useState<Date|null>(null);
  const [hovering,  setHovering]  = useState<Date|null>(null);
  const [phase,     setPhase]     = useState<SelPhase>("idle");
  const [halfStart, setHalfStart] = useState<HalfDay>("AM");
  const [halfEnd,   setHalfEnd]   = useState<HalfDay>("PM");
  const [hoverInfo, setHoverInfo] = useState<string|null>(null);
  const [leaveType, setLeaveType] = useState(LEAVE_TYPES[0]);

  const effEnd = phase === "selecting" && hovering ? hovering : selEnd;
  const [rStart, rEnd] = useMemo(() => {
    if (!selStart || !effEnd) return [selStart, null as Date|null];
    return effEnd < selStart ? [effEnd, selStart] : [selStart, effEnd];
  }, [selStart, effEnd]);
  const isSingle = !!(rStart && rEnd && isSameDay(rStart, rEnd));

  const handleClick = useCallback((d: Date) => {
    if (phase === "idle") {
      setSelStart(d); setSelEnd(null); setPhase("selecting");
    } else {
      if (isSameDay(d, selStart!)) { setSelStart(null); setSelEnd(null); setPhase("idle"); return; }
      const [s, e] = d < selStart! ? [d, selStart!] : [selStart!, d];
      setSelStart(s); setSelEnd(e); setPhase("idle");
    }
  }, [phase, selStart]);

  const handleHover = useCallback((d: Date|null, info?: string) => {
    if (phase === "selecting") setHovering(d);
    setHoverInfo(info ?? null);
  }, [phase]);

  useEffect(() => {
    onSelect({ start: selStart, end: selEnd, halfStart, halfEnd });
  }, [selStart, selEnd, halfStart, halfEnd, onSelect]);

  const multiDay = selStart && selEnd && !isSameDay(selStart, selEnd);
  const shared = { rangeStart: rStart, rangeEnd: rEnd, isSingle, halfStart, halfEnd, onDayClick: handleClick, onDayHover: handleHover, large: true };

  return (
    <div className="space-y-5">
      {/* Leave type tabs */}
      <div className="flex flex-wrap gap-2">
        {LEAVE_TYPES.map(t => (
          <button key={t} type="button" onClick={() => setLeaveType(t)}
            className={`px-4 py-1.5 rounded-xl text-sm font-bold transition-all duration-150 border ${leaveType === t
              ? "bg-[#1B6EF3] text-white border-[#1B6EF3] shadow-sm"
              : "bg-white text-[#6B7FA3] border-[rgba(10,30,69,0.1)] hover:border-[#1B6EF3]/40 hover:text-[#0A1E45]"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Dual month grid */}
      <div className="bg-white rounded-[20px] border border-[rgba(10,30,69,0.07)] shadow-sm p-7">
        <div className="flex items-start gap-3">
          <button type="button" onClick={() => setBase(d => subMonths(d, 1))}
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-[#EFF3FA] text-[#6B7FA3] hover:text-[#0A1E45] transition-colors flex-shrink-0 mt-1">
            <ChevronLeft size={18} />
          </button>
          <div className="grid grid-cols-2 gap-12 flex-1">
            <MonthGrid month={base}               {...shared} />
            <MonthGrid month={addMonths(base, 1)} {...shared} />
          </div>
          <button type="button" onClick={() => setBase(d => addMonths(d, 1))}
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-[#EFF3FA] text-[#6B7FA3] hover:text-[#0A1E45] transition-colors flex-shrink-0 mt-1">
            <ChevronRight size={18} />
          </button>
        </div>

        {hoverInfo && (
          <div className="mt-5 px-3 py-2 bg-[#0A1E45]/80 text-white rounded-xl text-xs font-semibold text-center">
            {hoverInfo}
          </div>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-5 pt-5 border-t border-[rgba(10,30,69,0.06)]">
          {[
            { cls:"w-3 h-3 rounded-full bg-[#1B6EF3]",                          lbl:"Sélection"       },
            { cls:"w-3 h-3 rounded-full ring-2 ring-[#1B6EF3]/40 ring-offset-1 bg-white", lbl:"Aujourd'hui" },
            { cls:"w-3 h-3 rounded-full bg-[#F76B1C]",                          lbl:"Jour férié"      },
            { cls:"w-3 h-3 rounded-full bg-[#0CAAD4]",                          lbl:"Samedi"          },
            { cls:"w-3 h-3 rounded-full bg-[#6B7FA3]/30",                       lbl:"Fermeture GMES"  },
          ].map(({ cls, lbl }) => (
            <div key={lbl} className="flex items-center gap-1.5">
              <div className={cls} />
              <span className="text-[11px] text-[#6B7FA3]">{lbl}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Half-day selector */}
      {multiDay && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
          className="bg-white rounded-[18px] border border-[rgba(10,30,69,0.07)] p-5 shadow-sm">
          <p className="text-[11px] font-black text-[#A8C0E4] uppercase tracking-widest mb-4">Demi-journées</p>
          <div className="flex gap-5">
            {[
              { lbl:"Début de la période", val: halfStart, set: setHalfStart },
              { lbl:"Fin de la période",   val: halfEnd,   set: setHalfEnd   },
            ].map(({ lbl, val, set }) => (
              <div key={lbl} className="flex-1">
                <p className="text-xs font-bold text-[#6B7FA3] mb-2.5">{lbl}</p>
                <div className="flex gap-2">
                  {(["AM","PM"] as HalfDay[]).map(h => (
                    <button key={h} type="button" onClick={() => set(h)}
                      className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all duration-150 flex-1 justify-center ${val === h
                        ? "bg-[#1B6EF3] text-white shadow-sm"
                        : "bg-[#EFF3FA] text-[#6B7FA3] hover:text-[#0A1E45]"}`}>
                      {h === "AM" ? <SunPic size={12} /> : <MoonPic size={12} />}
                      {h === "AM" ? "Matin" : "Après-midi"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ collapsed, setCollapsed, active, setActive }: {
  collapsed: boolean; setCollapsed: (v: boolean) => void;
  active: Page; setActive: (p: Page) => void;
}) {
  return (
    <motion.aside animate={{ width: collapsed ? 64 : 224 }} transition={{ duration: 0.2, ease: "easeInOut" }}
      className="flex-shrink-0 flex flex-col bg-[#071840] h-full overflow-hidden relative z-10">
      {/* Logo */}
      <div className={`flex items-center gap-3 h-[62px] px-4 border-b border-white/[0.05] ${collapsed ? "justify-center" : ""}`}>
        <GmesLogo size={34} />
        {!collapsed && (
          <div className="overflow-hidden">
            <p className="text-white font-black text-[16px] leading-tight tracking-tight whitespace-nowrap">GMES</p>
            <p className="text-[#A8C0E4] text-[10px] font-medium leading-tight whitespace-nowrap">Congés & Absences</p>
          </div>
        )}
      </div>

      {/* CTA */}
      <div className={`px-3 pt-4 pb-2 ${collapsed ? "flex justify-center" : ""}`}>
        <button type="button" onClick={() => setActive("new-request")}
          title={collapsed ? "Nouvelle demande" : undefined}
          className={`flex items-center gap-2.5 bg-[#F76B1C] text-white font-black rounded-2xl shadow-lg shadow-[#F76B1C]/25
            hover:bg-[#E55F14] active:scale-[0.97] transition-all duration-150
            ${active === "new-request" ? "ring-2 ring-white/25" : ""}
            ${collapsed ? "w-10 h-10 justify-center" : "w-full px-4 py-2.5 text-[13px]"}`}>
          <Plus size={16} className="flex-shrink-0" />
          {!collapsed && "Nouvelle demande"}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ id, label, Icon: Ic, badge }) => {
          const on = active === id;
          return (
            <button key={id} type="button" onClick={() => setActive(id)} title={collapsed ? label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 relative
                ${on ? "bg-[#1B6EF3]/16 text-white" : "text-[#A8C0E4] hover:text-white hover:bg-white/5"}
                ${collapsed ? "justify-center" : ""}`}>
              <Ic size={17} className={`flex-shrink-0 ${on ? "text-[#5BAEFF]" : ""}`} />
              {!collapsed && (
                <>
                  <span className="text-[13px] font-semibold flex-1 text-left whitespace-nowrap overflow-hidden">{label}</span>
                  {badge && <span className="w-5 h-5 bg-[#F76B1C] text-white text-[10px] font-black rounded-full flex items-center justify-center">{badge}</span>}
                </>
              )}
              {collapsed && badge && <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-[#F76B1C] rounded-full" />}
            </button>
          );
        })}
      </nav>

      {/* User */}
      <div className={`p-3 border-t border-white/[0.05] ${collapsed ? "flex justify-center" : ""}`}>
        {collapsed ? <Ava name="Thomas Renaud" size="sm" online /> : (
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/5 transition-colors cursor-pointer">
            <Ava name="Thomas Renaud" size="sm" online />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-black text-white truncate">Thomas Renaud</p>
              <p className="text-[10px] text-[#A8C0E4] truncate">Développeur Full Stack</p>
            </div>
            <ChevronDown size={12} className="text-[#A8C0E4]/50 flex-shrink-0" />
          </div>
        )}
      </div>

      <button type="button" onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center h-7 border-t border-white/[0.05] text-[#A8C0E4]/40 hover:text-white hover:bg-white/5 transition-colors">
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </motion.aside>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

function Header({ active, setActive }: { active: Page; setActive: (p: Page) => void }) {
  const [notif, setNotif] = useState(false);
  const [usr,   setUsr]   = useState(false);
  const { title, crumbs } = PAGE_META[active];

  const notifs = [
    { id:1, text:"Votre demande du 14/07 a été validée ✓", time:"Il y a 2h",    read:false },
    { id:2, text:"Rappel : posez vos congés avant le 31/08", time:"Hier",       read:false },
    { id:3, text:"Sophie Marchand a commenté votre dossier", time:"Il y a 3 j", read:true  },
  ];

  return (
    <header className="flex-shrink-0 bg-white border-b border-[rgba(10,30,69,0.07)] h-[62px] px-6 flex items-center gap-4 relative z-20">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 text-[11px] text-[#A8C0E4] mb-0.5">
          {crumbs.map((c,i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={10} />}
              <span className={i === crumbs.length-1 ? "text-[#0A1E45] font-black" : "hover:text-[#0A1E45] cursor-pointer transition-colors"}>{c}</span>
            </span>
          ))}
        </div>
        <h1 className="text-lg font-black text-[#0A1E45] leading-tight tracking-tight truncate">{title}</h1>
      </div>

      <div className="hidden md:flex items-center gap-2 bg-[#EFF3FA] rounded-xl px-3.5 py-2 w-56 border border-transparent focus-within:border-[#1B6EF3]/30 focus-within:bg-white transition-all duration-150">
        <Search size={14} className="text-[#6B7FA3] flex-shrink-0" />
        <input type="text" placeholder="Rechercher…"
          className="bg-transparent text-sm text-[#0A1E45] placeholder:text-[#C4D0E8] outline-none w-full" />
      </div>

      {/* Bell */}
      <div className="relative">
        <button type="button" onClick={() => { setNotif(v => !v); setUsr(false); }}
          className="relative w-10 h-10 rounded-xl flex items-center justify-center hover:bg-[#EFF3FA] transition-colors text-[#6B7FA3] hover:text-[#0A1E45]">
          <Bell size={19} />
          <span className="absolute top-2 right-2 w-2 h-2 bg-[#F76B1C] rounded-full border-2 border-white" />
        </button>
        {notif && (
          <motion.div initial={{ opacity:0, y:-6, scale:0.97 }} animate={{ opacity:1, y:0, scale:1 }} transition={{ duration:0.15 }}
            className="absolute right-0 top-12 w-80 bg-white rounded-2xl shadow-2xl border border-[rgba(10,30,69,0.1)] overflow-hidden z-50">
            <div className="px-5 py-3.5 border-b border-[rgba(10,30,69,0.06)] flex items-center justify-between">
              <p className="text-sm font-black text-[#0A1E45]">Notifications</p>
              <span className="text-xs text-[#1B6EF3] font-bold cursor-pointer hover:underline">Tout lire</span>
            </div>
            {notifs.map(n => (
              <div key={n.id} className={`px-5 py-3 border-b border-[rgba(10,30,69,0.04)] last:border-0 hover:bg-[#FAFBFE] cursor-pointer flex gap-3 ${!n.read ? "bg-[#EFF3FA]/40" : ""}`}>
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${!n.read ? "bg-[#1B6EF3]" : "bg-transparent"}`} />
                <div>
                  <p className={`text-sm leading-snug ${!n.read ? "font-bold text-[#0A1E45]" : "text-[#6B7FA3]"}`}>{n.text}</p>
                  <p className="text-[11px] text-[#A8C0E4] mt-0.5">{n.time}</p>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </div>

      {/* User */}
      <div className="relative">
        <button type="button" onClick={() => { setUsr(v => !v); setNotif(false); }}
          className="flex items-center gap-2.5 hover:bg-[#EFF3FA] rounded-xl px-2 py-1.5 transition-colors">
          <Ava name="Thomas Renaud" size="sm" online />
          <div className="hidden md:block text-left">
            <p className="text-[13px] font-black text-[#0A1E45] leading-tight">Thomas Renaud</p>
            <p className="text-[11px] text-[#6B7FA3] leading-tight">Collaborateur</p>
          </div>
          <ChevronDown size={13} className="text-[#6B7FA3]" />
        </button>
        {usr && (
          <motion.div initial={{ opacity:0, y:-6, scale:0.97 }} animate={{ opacity:1, y:0, scale:1 }} transition={{ duration:0.15 }}
            className="absolute right-0 top-12 w-52 bg-white rounded-2xl shadow-2xl border border-[rgba(10,30,69,0.1)] overflow-hidden z-50">
            <div className="px-4 py-3.5 border-b border-[rgba(10,30,69,0.06)]">
              <p className="text-sm font-black text-[#0A1E45]">Thomas Renaud</p>
              <p className="text-xs text-[#6B7FA3]">t.renaud@gmes.fr</p>
            </div>
            {[{ Ic:User,Lbl:"Mon profil" },{ Ic:Settings,Lbl:"Paramètres" },{ Ic:Shield,Lbl:"Sécurité" }].map(({ Ic, Lbl }) => (
              <button key={Lbl} type="button" onClick={() => { setActive("profile"); setUsr(false); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#6B7FA3] hover:bg-[#FAFBFE] hover:text-[#0A1E45] transition-colors">
                <Ic size={14} />{Lbl}
              </button>
            ))}
            <div className="border-t border-[rgba(10,30,69,0.06)]">
              <button type="button" className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#E02B4F] hover:bg-rose-50 transition-colors">
                <LogOut size={14} />Déconnexion
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </header>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardView({ setActive }: { setActive: (p: Page) => void }) {
  return (
    <div className="space-y-5 max-w-[1200px]">
      <div className="grid grid-cols-12 gap-5">

        {/* Solde principal */}
        <div className="col-span-12 lg:col-span-7">
          <div className="bg-white rounded-[20px] p-8 h-full border border-[rgba(10,30,69,0.06)] shadow-sm relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-[#1B6EF3]/3 via-transparent to-[#0CAAD4]/4 pointer-events-none" />
            <div className="relative">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <p className="text-[11px] font-black text-[#A8C0E4] uppercase tracking-widest mb-0.5">Congés à utiliser</p>
                  <p className="text-[11px] text-[#C4D0E8]">Période 01/06/2026 → 31/05/2027</p>
                </div>
                <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-black border border-emerald-200">
                  <Check size={11} />Solde OK
                </span>
              </div>
              <div className="flex items-baseline gap-3 mb-6">
                <span className="text-[80px] font-black leading-none text-[#0A1E45] tracking-tight tabular-nums" style={{ fontVariantNumeric:"tabular-nums" }}>22,5</span>
                <div className="pb-2">
                  <p className="text-xl font-black text-[#6B7FA3] leading-none">jours</p>
                  <p className="text-sm text-[#A8C0E4] mt-0.5">disponibles</p>
                </div>
              </div>
              <div className="mb-5">
                <div className="h-2 bg-[#E4EDF9] rounded-full overflow-hidden mb-1.5">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#1B6EF3] to-[#0CAAD4]" style={{ width:"80.4%" }} />
                </div>
                <div className="flex justify-between text-xs text-[#A8C0E4]"><span>22,5 j utilisables</span><span>28 j acquis</span></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { lbl:"En acquisition", val:"+5,5 j", c:"text-[#0CAAD4]",  bg:"bg-[#E6F9FF]" },
                  { lbl:"Jours réservés",  val:"−4 j",   c:"text-[#F76B1C]", bg:"bg-[#FFF0E6]" },
                  { lbl:"Solde potentiel",val:"24 j",   c:"text-[#14A870]", bg:"bg-[#E6F9F2]" },
                ].map(({ lbl, val, c, bg }) => (
                  <div key={lbl} className={`${bg} rounded-xl p-3.5`}>
                    <p className={`text-[18px] font-black ${c} tabular-nums leading-none mb-1`}>{val}</p>
                    <p className="text-[11px] text-[#6B7FA3] font-semibold">{lbl}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Prochain congé */}
        <div className="col-span-12 lg:col-span-5">
          <div className="bg-white rounded-[20px] p-7 h-full border border-[rgba(10,30,69,0.06)] shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-36 h-36 bg-gradient-to-bl from-[#1B6EF3]/6 via-transparent to-transparent rounded-[20px] pointer-events-none" />
            <div className="relative">
              <div className="flex items-center justify-between mb-6">
                <p className="text-[11px] font-black text-[#A8C0E4] uppercase tracking-widest">Prochain congé</p>
                <StatusBadge status="VALIDÉE" />
              </div>
              <div className="grid grid-cols-2 gap-5 mb-6">
                <div>
                  <p className="text-[10px] text-[#A8C0E4] uppercase font-black tracking-widest mb-1.5">Dans</p>
                  <p className="text-[52px] font-black text-[#0A1E45] leading-none tabular-nums">4</p>
                  <p className="text-sm text-[#6B7FA3] font-semibold mt-0.5">jours</p>
                </div>
                <div>
                  <p className="text-[10px] text-[#A8C0E4] uppercase font-black tracking-widest mb-1.5">Durée</p>
                  <p className="text-[52px] font-black text-[#1B6EF3] leading-none tabular-nums">5</p>
                  <p className="text-sm text-[#6B7FA3] font-semibold mt-0.5">jours ouvrés</p>
                </div>
              </div>
              <div className="p-4 bg-[#EFF3FA] rounded-xl mb-3">
                <p className="text-sm font-black text-[#0A1E45]">14 → 18 juillet 2026</p>
                <p className="text-xs text-[#6B7FA3] mt-0.5">Congés payés · Sophie Marchand</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-[#E4EDF9] rounded-full overflow-hidden">
                  <div className="h-full bg-[#1B6EF3]/40 rounded-full" style={{ width:"92%" }} />
                </div>
                <span className="text-xs font-black text-[#1B6EF3]">J−4</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-12 gap-5">
        {/* Recent requests */}
        <div className="col-span-12 lg:col-span-8">
          <div className="bg-white rounded-[20px] border border-[rgba(10,30,69,0.06)] shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[rgba(10,30,69,0.06)] flex items-center justify-between">
              <p className="text-sm font-black text-[#0A1E45]">Demandes récentes</p>
              <Btn variant="ghost" size="sm" onClick={() => setActive("requests")} icon={<ArrowRight size={13} />}>Voir tout</Btn>
            </div>
            <div className="divide-y divide-[rgba(10,30,69,0.04)]">
              {SAMPLE_REQUESTS.slice(0,4).map(r => (
                <div key={r.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-[#FAFBFD] transition-colors">
                  <div className="w-9 h-9 rounded-xl bg-[#EFF3FA] flex items-center justify-center flex-shrink-0">
                    <Calendar size={15} className="text-[#1B6EF3]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-black text-[#0A1E45]">{r.type}</span>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="text-xs text-[#6B7FA3] mt-0.5">{r.start} → {r.end} · <strong className="text-[#0A1E45]">{r.days} j</strong></p>
                  </div>
                  <button type="button" className="p-2 rounded-lg hover:bg-[#EFF3FA] transition-colors text-[#C4D0E8] hover:text-[#6B7FA3]">
                    <MoreHorizontal size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CTA + quick notifs */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-4">
          <div className="bg-gradient-to-br from-[#071840] to-[#132C6E] rounded-[20px] p-6 text-white relative overflow-hidden">
            <div className="absolute -right-6 -top-6 w-28 h-28 bg-[#1B6EF3]/15 rounded-full pointer-events-none" />
            <div className="absolute -right-3 -bottom-8 w-20 h-20 bg-[#F76B1C]/12 rounded-full pointer-events-none" />
            <div className="relative">
              <div className="w-10 h-10 bg-[#F76B1C]/20 rounded-xl flex items-center justify-center mb-4">
                <Sparkles size={18} className="text-[#F76B1C]" />
              </div>
              <p className="text-sm font-black mb-1">Planifier un congé</p>
              <p className="text-xs text-white/55 mb-4 leading-relaxed">22,5 jours disponibles.<br />Posez vos vacances facilement.</p>
              <Btn variant="orange" size="md" fullWidth icon={<CalendarPlus size={14} />} onClick={() => setActive("new-request")}>
                Nouvelle demande
              </Btn>
            </div>
          </div>
          <div className="bg-white rounded-[20px] border border-[rgba(10,30,69,0.06)] shadow-sm p-4 flex-1">
            <p className="text-[11px] font-black text-[#A8C0E4] uppercase tracking-widest mb-3">Alertes</p>
            <div className="space-y-2">
              {[
                { t:"Demande du 14/07 validée", c:"text-emerald-700", bg:"bg-emerald-50" },
                { t:"Posez vos congés avant le 31/08", c:"text-[#F76B1C]", bg:"bg-orange-50" },
              ].map(({ t, c, bg }) => (
                <div key={t} className={`${bg} rounded-xl px-3.5 py-2.5 text-xs font-bold ${c} leading-snug`}>{t}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Nouvelle Demande ─────────────────────────────────────────────────────────

function NewRequestView() {
  const [sel,       setSel]     = useState<CalSel>({ start:null, end:null, halfStart:"AM", halfEnd:"PM" });
  const [submit,    setSubmit]  = useState<"idle"|"loading"|"success">("idle");
  const [showToast, setToast]   = useState(false);

  const handleSelect = useCallback((s: CalSel) => setSel(s), []);

  const workdays = useMemo(() => {
    if (!sel.start || !sel.end) return 0;
    let c = countWork(sel.start, sel.end);
    if (sel.halfStart === "PM") c -= 0.5;
    if (sel.halfEnd   === "AM") c -= 0.5;
    return Math.max(0, c);
  }, [sel]);

  const daysUntil  = sel.start ? differenceInCalendarDays(sel.start, DEMO_TODAY) : 0;
  const reqDelay   = workdays > 5 ? 60 : 30;
  const delayOk    = daysUntil >= reqDelay;
  const delayDiff  = daysUntil - reqDelay;
  const balance    = 22.5;
  const reserved   = 4;
  const afterBal   = balance - workdays;
  const hasRange   = sel.start && sel.end;
  const canSubmit  = hasRange && delayOk && afterBal >= 0 && submit === "idle";

  const handleSubmit = () => {
    if (!canSubmit) return;
    setSubmit("loading");
    setTimeout(() => {
      setSubmit("success");
      setToast(true);
      setTimeout(() => { setSubmit("idle"); setToast(false); }, 3000);
    }, 1000);
  };

  return (
    <>
      <div className="flex gap-7 items-start max-w-[1200px]">
        {/* Calendar */}
        <div className="flex-1 min-w-0">
          <TwoMonthCalendar onSelect={handleSelect} />
        </div>

        {/* Panel */}
        <div className="w-[300px] flex-shrink-0 sticky top-6">
          <div className="bg-white rounded-[20px] border border-[rgba(10,30,69,0.08)] shadow-sm overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-[#EFF3FA] to-white border-b border-[rgba(10,30,69,0.06)]">
              <h3 className="text-sm font-black text-[#0A1E45]">Récapitulatif</h3>
            </div>

            {!hasRange ? (
              <div className="px-5 py-10 text-center">
                <div className="w-14 h-14 bg-[#EFF3FA] rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Calendar size={22} className="text-[#C4D0E8]" />
                </div>
                <p className="text-sm font-bold text-[#A8C0E4]">Sélectionnez vos dates</p>
                <p className="text-xs text-[#C4D0E8] mt-1.5 leading-relaxed">Cliquez sur le premier puis le dernier jour dans le calendrier.</p>
              </div>
            ) : (
              <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration:0.2 }}
                className="px-5 py-5 space-y-4">
                {/* Period & duration */}
                <div>
                  <p className="text-[10px] font-black text-[#A8C0E4] uppercase tracking-widest mb-1">Période</p>
                  <p className="font-black text-[#0A1E45] text-[15px]">
                    {format(sel.start!, "d MMM", { locale:fr })} → {format(sel.end!, "d MMM yyyy", { locale:fr })}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[30px] font-black text-[#1B6EF3] tabular-nums leading-none">{workdays}</span>
                    <div>
                      <p className="text-sm font-black text-[#0A1E45] leading-none">jour{workdays > 1 ? "s" : ""}</p>
                      <p className="text-[11px] text-[#6B7FA3]">ouvrés décomptés</p>
                    </div>
                  </div>
                  {(sel.halfStart === "PM" || sel.halfEnd === "AM") && (
                    <p className="text-[11px] text-[#6B7FA3] mt-1 italic">
                      {sel.halfStart === "PM" && "Départ après-midi"}
                      {sel.halfStart === "PM" && sel.halfEnd === "AM" && " · "}
                      {sel.halfEnd === "AM" && "Retour matin"}
                    </p>
                  )}
                </div>

                {/* Delay check */}
                <div className={`p-3 rounded-xl border text-xs ${delayOk ? "bg-emerald-50 border-emerald-200" : "bg-orange-50 border-orange-200"}`}>
                  <div className="flex items-center gap-1.5 font-black mb-0.5 ${delayOk ? 'text-emerald-700' : 'text-orange-700'}">
                    {delayOk ? <Check size={12} className="text-emerald-600" /> : <AlertTriangle size={12} className="text-orange-600" />}
                    <span className={delayOk ? "text-emerald-700" : "text-orange-700"}>
                      {delayOk ? `Délai OK (+${delayDiff} j)` : `Délai insuffisant (−${Math.abs(delayDiff)} j)`}
                    </span>
                  </div>
                  <p className={delayOk ? "text-emerald-600 opacity-80" : "text-orange-600 opacity-80"}>
                    Min. {reqDelay} j · Départ dans {daysUntil} j
                  </p>
                </div>

                {/* Balance */}
                <div className="border-t border-[rgba(10,30,69,0.06)] pt-4 space-y-2">
                  <p className="text-[10px] font-black text-[#A8C0E4] uppercase tracking-widest">Solde Congés payés</p>
                  {[
                    { l:"Solde actuel",       v:`${balance} j`,   cls:"text-[#0A1E45] font-bold" },
                    { l:"Jours réservés",     v:`−${reserved} j`, cls:"text-[#F76B1C]"           },
                    { l:"Cette demande",      v:`−${workdays} j`, cls:"text-[#E02B4F] font-bold"  },
                  ].map(({ l, v, cls }) => (
                    <div key={l} className="flex justify-between">
                      <span className="text-xs text-[#6B7FA3]">{l}</span>
                      <span className={`text-sm tabular-nums ${cls}`}>{v}</span>
                    </div>
                  ))}
                  <div className="border-t border-[rgba(10,30,69,0.07)] pt-2 flex justify-between">
                    <span className="text-xs font-black text-[#0A1E45]">Solde potentiel</span>
                    <span className={`text-base font-black tabular-nums ${afterBal < 0 ? "text-[#E02B4F]" : "text-[#14A870]"}`}>
                      {afterBal.toFixed(1)} j
                    </span>
                  </div>
                </div>

                {/* CTA */}
                <Btn
                  variant={submit === "success" ? "primary" : "orange"}
                  size="lg" fullWidth
                  disabled={!delayOk || afterBal < 0}
                  loading={submit === "loading"}
                  onClick={handleSubmit}
                  icon={submit !== "loading" ? (submit === "success" ? <Check size={16} /> : <ArrowRight size={16} />) : undefined}
                >
                  {submit === "success" ? "Soumise !" : "Soumettre"}
                </Btn>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      <Toast msg="Demande soumise avec succès !" show={showToast} />
    </>
  );
}

// ─── Mes Demandes ─────────────────────────────────────────────────────────────

function RequestsView() {
  const [filter, setFilter] = useState("all");
  const tabs = [
    { k:"all",        l:"Toutes"     },
    { k:"EN_ATTENTE", l:"En attente" },
    { k:"VALIDÉE",    l:"Validées"   },
    { k:"REFUSÉE",    l:"Refusées"   },
    { k:"BROUILLON",  l:"Brouillons" },
  ];
  const list = filter === "all" ? SAMPLE_REQUESTS : SAMPLE_REQUESTS.filter(r => r.status === filter);

  return (
    <div className="max-w-[860px] space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="bg-white rounded-2xl border border-[rgba(10,30,69,0.07)] shadow-sm p-1.5 flex items-center gap-1 flex-wrap">
          {tabs.map(t => (
            <button key={t.k} type="button" onClick={() => setFilter(t.k)}
              className={`px-3.5 py-1.5 rounded-xl text-[13px] font-bold transition-all duration-150 ${filter === t.k ? "bg-[#1B6EF3] text-white shadow-sm" : "text-[#6B7FA3] hover:text-[#0A1E45]"}`}>
              {t.l}
            </button>
          ))}
        </div>
        <Btn variant="orange" size="md" icon={<Plus size={14} />}>Nouvelle demande</Btn>
      </div>
      <div className="space-y-2">
        {list.map(r => (
          <div key={r.id} className="bg-white rounded-[18px] px-5 py-4 border border-[rgba(10,30,69,0.06)] hover:shadow-sm hover:border-[rgba(10,30,69,0.12)] transition-all duration-150 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-[#EFF3FA] flex items-center justify-center flex-shrink-0">
              <Calendar size={18} className="text-[#1B6EF3]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <span className="text-sm font-black text-[#0A1E45]">{r.type}</span>
                <StatusBadge status={r.status} />
              </div>
              <p className="text-xs text-[#6B7FA3]">{r.start} → {r.end} · <strong className="text-[#0A1E45]">{r.days} j</strong></p>
            </div>
            <button type="button" className="p-2 rounded-xl hover:bg-[#EFF3FA] transition-colors text-[#C4D0E8] hover:text-[#6B7FA3]">
              <MoreHorizontal size={15} />
            </button>
          </div>
        ))}
        {list.length === 0 && (
          <div className="bg-white rounded-[18px] p-16 text-center border border-[rgba(10,30,69,0.06)]">
            <p className="text-[#6B7FA3] font-semibold text-sm">Aucune demande dans cette catégorie.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Mes Soldes ───────────────────────────────────────────────────────────────

function SoldesView() {
  return (
    <div className="max-w-[820px] space-y-5">
      <p className="text-[11px] font-black text-[#A8C0E4] uppercase tracking-widest">Période 01/06/2026 → 31/05/2027 · CDI</p>

      {/* Hero */}
      <div className="bg-gradient-to-br from-[#071840] to-[#1B3D7E] rounded-[20px] p-8 text-white relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-48 h-48 bg-[#1B6EF3]/15 rounded-full pointer-events-none" />
        <div className="absolute right-12 -bottom-12 w-32 h-32 bg-[#F76B1C]/10 rounded-full pointer-events-none" />
        <div className="relative grid grid-cols-2 lg:grid-cols-4 gap-7">
          {[
            { n:"Congés à utiliser",      v:"22,5", c:"#5BAEFF", d:"Solde disponible aujourd'hui"       },
            { n:"En cours d'acquisition", v:"5,5",  c:"#5EE8FF", d:"Acquis jusqu'au 31/05/2027"         },
            { n:"Prévisionnels",          v:"28",   c:"#FFFFFF", d:"Projection fin de période"          },
            { n:"Jours réservés",         v:"4",    c:"#FFB347", d:"Demandes validées / en attente"     },
          ].map(({ n, v, c, d }) => (
            <div key={n}>
              <p className="text-[9px] font-black uppercase tracking-widest opacity-50 mb-2">{n}</p>
              <p className="text-[42px] font-black leading-none tabular-nums" style={{ color: c }}>{v}</p>
              <p className="text-[11px] opacity-40 mt-1.5 leading-snug">{d}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Solde potentiel */}
      <div className="bg-white rounded-[20px] p-6 border border-[rgba(10,30,69,0.06)] shadow-sm">
        <p className="text-[11px] font-black text-[#A8C0E4] uppercase tracking-widest mb-4">Solde potentiel fin de période</p>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[48px] font-black text-[#14A870] leading-none tabular-nums">24 j</p>
            <p className="text-sm text-[#6B7FA3] mt-1">Prévisionnels (28) − Réservés (4)</p>
          </div>
          <div className="text-right space-y-1 text-xs">
            <p className="text-[#A8C0E4]">Acquis : <strong className="text-[#0A1E45] font-black">28 j</strong></p>
            <p className="text-[#A8C0E4]">Réservés : <strong className="text-[#F76B1C] font-black">−4 j</strong></p>
            <p className="text-[#A8C0E4]">= Potentiel : <strong className="text-[#14A870] font-black">24 j</strong></p>
          </div>
        </div>
        <div className="h-2.5 bg-[#E4EDF9] rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-[#1B6EF3] to-[#14A870]" style={{ width:`${(24/28)*100}%` }} />
        </div>
      </div>

      {/* Detail grid */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { n:"Congés à utiliser",      v:22.5, c:"#1B6EF3", bg:"#EBF2FE", d:"Solde disponible aujourd'hui"       },
          { n:"En cours d'acquisition", v:5.5,  c:"#0CAAD4", bg:"#E3F6FD", d:"Jours acquis d'ici le 31/05/2027"  },
          { n:"Prévisionnels",          v:28,   c:"#0A1E45", bg:"#E4EDF9", d:"Projection fin de période"          },
          { n:"Jours réservés",         v:4,    c:"#F76B1C", bg:"#FFF0E6", d:"Demandes validées / en attente"     },
        ].map(({ n, v, c, bg, d }) => (
          <div key={n} className="bg-white rounded-[18px] p-5 border border-[rgba(10,30,69,0.06)] shadow-sm hover:shadow-md transition-shadow duration-200">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: bg }}>
              <Wallet size={17} style={{ color: c }} />
            </div>
            <p className="text-[10px] font-black text-[#A8C0E4] uppercase tracking-widest mb-1">{n}</p>
            <p className="text-[32px] font-black leading-none tabular-nums" style={{ color: c }}>{v}</p>
            <p className="text-[11px] text-[#A8C0E4] mt-1.5 leading-snug">{d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Profile ──────────────────────────────────────────────────────────────────

function ProfileView() {
  return (
    <div className="max-w-[640px] space-y-5">
      <div className="bg-white rounded-[20px] p-7 border border-[rgba(10,30,69,0.06)] shadow-sm">
        <div className="flex items-center gap-5 mb-7">
          <Ava name="Thomas Renaud" size="lg" online />
          <div>
            <h2 className="text-xl font-black text-[#0A1E45]">Thomas Renaud</h2>
            <p className="text-sm text-[#6B7FA3] font-semibold">Développeur Full Stack · Équipe Produit</p>
            <p className="text-xs text-[#A8C0E4] mt-0.5">t.renaud@gmes.fr · CDI depuis 01/03/2021</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { l:"Manager",     v:"Sophie Marchand"  },
            { l:"Département", v:"Équipe Produit"   },
            { l:"Contrat",     v:"CDI"              },
            { l:"Ancienneté",  v:"5 ans et 4 mois"  },
            { l:"Site",        v:"Paris — Siège"    },
            { l:"Convention",  v:"Syntec"           },
          ].map(({ l, v }) => (
            <div key={l} className="bg-[#F8FAFD] rounded-xl p-3.5">
              <p className="text-[10px] font-black text-[#A8C0E4] uppercase tracking-widest mb-0.5">{l}</p>
              <p className="text-sm font-bold text-[#0A1E45]">{v}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Stub ─────────────────────────────────────────────────────────────────────

function StubView({ icon: Ic, title, desc }: { icon: LucideIcon; title: string; desc: string }) {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center max-w-xs">
        <div className="w-16 h-16 bg-white rounded-2xl border border-[rgba(10,30,69,0.07)] shadow-sm flex items-center justify-center mx-auto mb-4">
          <Ic size={24} className="text-[#C4D0E8]" />
        </div>
        <h3 className="text-base font-black text-[#0A1E45] mb-1">{title}</h3>
        <p className="text-sm text-[#6B7FA3]">{desc}</p>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [active,    setActive]    = useState<Page>("dashboard");

  return (
    <div className="flex h-screen bg-[#EFF3FA] overflow-hidden" style={{ fontFamily:"'Inter', system-ui, sans-serif" }}>
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} active={active} setActive={setActive} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header active={active} setActive={setActive} />
        <main className="flex-1 overflow-y-auto">
          <div className="p-6 lg:p-8">
            {active === "dashboard"       && <DashboardView setActive={setActive} />}
            {active === "new-request"     && <NewRequestView />}
            {active === "requests"        && <RequestsView />}
            {active === "balances"        && <SoldesView />}
            {active === "profile"         && <ProfileView />}
            {active === "declare-absence" && <StubView icon={Clock}     title="Déclarer une absence"  desc="Signalez une absence imprévue à votre manager."  />}
            {active === "justificatifs"   && <StubView icon={Paperclip} title="Mes justificatifs"     desc="Uploadez et suivez vos justificatifs médicaux."   />}
            {active === "documents"       && <StubView icon={Download}  title="Documents PDF"         desc="Attestations, contrats et bulletins de salaire."  />}
            {active === "notifications"   && <StubView icon={Bell}      title="Notifications"         desc="Historique de vos alertes et messages RH."        />}
          </div>
        </main>
      </div>
    </div>
  );
}
