export function HeroBanner() {
  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary/15 via-primary/5 to-background border p-8 sm:p-10">
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-3">
          <img src="/favicon.ico" alt="ShipSec" className="w-10 h-10" />
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Welcome to ShipSec Studio
          </h1>
        </div>
        <p className="text-muted-foreground text-base sm:text-lg max-w-2xl">
          Secure your code, cloud, and dependencies in one place.
        </p>
      </div>
      {/* Decorative background circles */}
      <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-primary/5" />
      <div className="absolute -bottom-8 -right-4 w-32 h-32 rounded-full bg-primary/3" />
    </div>
  );
}
