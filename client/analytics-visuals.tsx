import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function MetricCard({ label, value, icon: Icon, note, tone = 'green' }: { label: string; value: string; icon: LucideIcon; note?: string; tone?: 'green' | 'blue' | 'amber' }) {
  return <article className={`analytics-metric analytics-metric-${tone}`}><div className="analytics-metric-top"><span>{label}</span><span className="analytics-metric-icon"><Icon size={18} /></span></div><strong>{value}</strong>{note && <small>{note}</small>}</article>;
}

export function PanelHeading({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children?: ReactNode }) {
  return <div className="analytics-panel-heading"><span className="analytics-panel-icon"><Icon size={18} /></span><div><h3>{title}</h3>{children && <p className="analytics-note">{children}</p>}</div></div>;
}

// All points are drawn from the existing API. The adjacent data table remains the
// detailed, accessible view; zero traffic is rendered as a flat line at zero.
export function DailyTrend({ rows, title, primary, secondary }: { rows: { day: string; first: number; second: number }[]; title: string; primary: string; secondary: string }) {
  const id = useId().replace(/:/g, '');
  if (!rows.length) return <p className="analytics-empty">此期間尚無趨勢資料。</p>;
  const max = Math.max(2, Math.ceil(Math.max(0, ...rows.flatMap((row) => [row.first, row.second])) / 2) * 2);
  const x = (index: number) => 48 + index * 644 / Math.max(1, rows.length - 1);
  const y = (value: number) => 178 - value / max * 146;
  const points = (key: 'first' | 'second') => rows.map((row, index) => `${x(index)},${y(row[key])}`).join(' ');
  const format = (value: number) => value.toLocaleString('zh-Hant', { maximumFractionDigits: 1 });
  const midpoint = Math.floor((rows.length - 1) / 2);
  return <div className="analytics-trend"><div className="analytics-chart-legend"><span><i />{primary}</span><span><i />{secondary}</span><small>每日統計 · UTC</small></div>
    <svg viewBox="0 0 720 212" role="img" aria-labelledby={`${id}-title ${id}-description`}>
      <title id={`${id}-title`}>{title}</title><desc id={`${id}-description`}>{rows[0].day} 至 {rows.at(-1)!.day} 的{primary}與{secondary}，完整數值可展開下方每日統計查看。</desc>
      <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#13765f" stopOpacity=".14" /><stop offset="100%" stopColor="#13765f" stopOpacity=".01" /></linearGradient></defs>
      {[0, max / 2, max].map((value, index) => <g key={index}><line x1="48" x2="692" y1={y(value)} y2={y(value)} stroke="#e4ece7" strokeDasharray="4 5" /><text x="35" y={y(value) + 4} textAnchor="end">{format(value)}</text></g>)}
      <polygon points={`48,178 ${points('first')} ${x(rows.length - 1)},178`} fill={`url(#${id}-fill)`} />
      <polyline points={points('first')} fill="none" stroke="#13765f" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={points('second')} fill="none" stroke="#779bcc" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {rows.map((row, index) => <g key={row.day}><title>{row.day} · {primary} {format(row.first)} · {secondary} {format(row.second)}</title><circle cx={x(index)} cy={y(row.first)} r="3" fill="#13765f" /><circle cx={x(index)} cy={y(row.second)} r="2.5" fill="#779bcc" /></g>)}
      {[0, midpoint, rows.length - 1].filter((index, position, values) => values.indexOf(index) === position).map((index) => <text key={index} x={x(index)} y="204" textAnchor={index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle'}>{rows[index].day.slice(5).replace('-', '/')}</text>)}
    </svg>
  </div>;
}
