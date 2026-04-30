export const SEVERITY_COLORS = {
  critical: { bg: 'bg-red-900', text: 'text-red-300', border: 'border-red-700' },
  high: { bg: 'bg-orange-900', text: 'text-orange-300', border: 'border-orange-700' },
  medium: { bg: 'bg-yellow-900', text: 'text-yellow-300', border: 'border-yellow-700' },
  low: { bg: 'bg-gray-800', text: 'text-gray-400', border: 'border-gray-600' },
} as const;

export type Severity = keyof typeof SEVERITY_COLORS;

export function getSeverityBadge(severity: Severity): string {
  const c = SEVERITY_COLORS[severity];
  return `${c.bg} ${c.text} ${c.border} border rounded px-2 py-0.5 text-xs font-mono uppercase`;
}
