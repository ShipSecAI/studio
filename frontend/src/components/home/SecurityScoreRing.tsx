interface SecurityScoreRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function SecurityScoreRing({
  score,
  size = 80,
  strokeWidth = 6,
  className = '',
}: SecurityScoreRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(100, score));
  const dashOffset = circumference - (progress / 100) * circumference;

  const getColor = (s: number) => {
    if (s >= 80) return 'text-green-500';
    if (s >= 60) return 'text-yellow-500';
    if (s >= 40) return 'text-orange-500';
    return 'text-red-500';
  };

  const getTrackColor = (s: number) => {
    if (s >= 80) return 'text-green-500/15';
    if (s >= 60) return 'text-yellow-500/15';
    if (s >= 40) return 'text-orange-500/15';
    return 'text-red-500/15';
  };

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className={`stroke-current ${getTrackColor(progress)}`}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={`stroke-current ${getColor(progress)} transition-all duration-700`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-lg font-bold ${getColor(progress)}`}>{Math.round(progress)}</span>
      </div>
    </div>
  );
}
