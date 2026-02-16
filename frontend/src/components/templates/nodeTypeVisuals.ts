export interface NodeVisual {
  label: string;
  color: string;
  iconUrl?: string;
  lucideIcon?: string;
}

const VISUALS: { pattern: RegExp; visual: NodeVisual }[] = [
  {
    pattern: /entrypoint/,
    visual: { label: 'Start', color: '#22c55e', lucideIcon: 'Play' },
  },
  {
    pattern: /scanner\.trufflehog/,
    visual: { label: 'TruffleHog', color: '#3b82f6', iconUrl: '/icons/trufflehog.png' },
  },
  {
    pattern: /scanner\.opengrep/,
    visual: { label: 'OpenGrep', color: '#3b82f6', iconUrl: '/icons/opengrep.png' },
  },
  {
    pattern: /scanner\.prowler/,
    visual: { label: 'Prowler', color: '#f97316', iconUrl: '/icons/prowler.png' },
  },
  {
    pattern: /scanner\.nuclei/,
    visual: { label: 'Nuclei', color: '#3b82f6', iconUrl: '/icons/nuclei.svg' },
  },
  {
    pattern: /scanner\.dependency/,
    visual: { label: 'SafeDep', color: '#3b82f6', iconUrl: '/icons/safedep.png' },
  },
  {
    pattern: /recon\./,
    visual: { label: 'Recon', color: '#a855f7', lucideIcon: 'Search' },
  },
  {
    pattern: /ai\./,
    visual: { label: 'AI Agent', color: '#8b5cf6', iconUrl: '/icons/ai.svg' },
  },
  {
    pattern: /github\./,
    visual: { label: 'GitHub', color: '#6b7280', lucideIcon: 'Github' },
  },
  {
    pattern: /notification|slack/,
    visual: { label: 'Notify', color: '#22c55e', lucideIcon: 'Bell' },
  },
];

const DEFAULT_VISUAL: NodeVisual = {
  label: 'Step',
  color: '#6b7280',
  lucideIcon: 'Box',
};

export function getNodeVisual(nodeType: string): NodeVisual {
  for (const { pattern, visual } of VISUALS) {
    if (pattern.test(nodeType)) return visual;
  }
  return DEFAULT_VISUAL;
}
