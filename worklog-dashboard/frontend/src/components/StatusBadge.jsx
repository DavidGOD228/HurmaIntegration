const STATUS_CONFIG = {
  OK:            { label: 'OK',          bg: 'bg-green-100',  text: 'text-green-800',  ring: 'ring-green-300' },
  ON_LEAVE:      { label: 'On Leave',    bg: 'bg-blue-100',   text: 'text-blue-800',   ring: 'ring-blue-300' },
  UNDERLOGGED:   { label: 'Underlogged', bg: 'bg-yellow-100', text: 'text-yellow-800', ring: 'ring-yellow-300' },
  OVERLOGGED:    { label: 'Overlogged',  bg: 'bg-orange-100', text: 'text-orange-800', ring: 'ring-orange-300' },
  CONTRADICTION: { label: 'Conflict',    bg: 'bg-red-100',    text: 'text-red-800',    ring: 'ring-red-300' },
  UNMAPPED:      { label: 'Unmapped',    bg: 'bg-purple-100', text: 'text-purple-800', ring: 'ring-purple-300' },
  EXCLUDED:      { label: 'Excluded',    bg: 'bg-gray-100',   text: 'text-gray-500',   ring: 'ring-gray-200' },
};

export default function StatusBadge({ status, size = 'sm' }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.EXCLUDED;
  const px  = size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ring-1 ${px} ${cfg.bg} ${cfg.text} ${cfg.ring}`}
    >
      {cfg.label}
    </span>
  );
}

export function SeverityBadge({ severity }) {
  const map = {
    HIGH:   'bg-red-100 text-red-800 ring-red-300',
    MEDIUM: 'bg-yellow-100 text-yellow-800 ring-yellow-300',
    LOW:    'bg-gray-100 text-gray-600 ring-gray-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ring-1 ${map[severity] || map.LOW}`}>
      {severity}
    </span>
  );
}
