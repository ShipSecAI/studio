export function HeroBanner() {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card p-8 sm:p-10">
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-3">
          <img src="/favicon.ico" alt="ShipSec" className="w-10 h-10" />
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Welcome to ShipSec Studio
          </h1>
        </div>
        <p className="text-muted-foreground text-base sm:text-lg max-w-2xl">
          Secure your code, cloud, and dependencies in one place.
        </p>
      </div>
    </div>
  );
}
