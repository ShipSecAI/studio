export function ReconPage() {
  return (
    <div className="h-full flex items-center justify-center bg-background">
      <div className="text-center space-y-8">
        {/* Animated ShipSec logo */}
        <div className="flex justify-center">
          <img
            src="/icons/shipsecai.svg"
            alt="ShipSec Studio"
            className="w-40 h-40 animate-[breathe_3s_ease-in-out_infinite]"
          />
        </div>

        <div className="space-y-3">
          <h2 className="text-4xl font-semibold text-foreground tracking-tight">
            Something interesting is brewing...
          </h2>
          <p className="text-muted-foreground text-base max-w-md mx-auto">
            Attack Surface Recon is coming soon. Stay tuned.
          </p>
        </div>

        <style>{`
          @keyframes breathe {
            0%, 100% { transform: scale(1); opacity: 0.85; }
            50% { transform: scale(1.08); opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  );
}
