-- Subscription plans table: DB-driven tier limits.
-- Seeded with initial tiers; -1 means unlimited.

CREATE TABLE IF NOT EXISTS subscription_plans (
  id VARCHAR(50) PRIMARY KEY,
  display_name VARCHAR(100) NOT NULL,
  price_usd_cents INTEGER NOT NULL,
  workflow_runs_per_month INTEGER NOT NULL,
  ai_budget_usd_cents INTEGER NOT NULL,
  max_concurrent_runs INTEGER NOT NULL,
  analytics_retention_days INTEGER NOT NULL,
  max_workflows INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO subscription_plans (
  id, display_name, price_usd_cents,
  workflow_runs_per_month, ai_budget_usd_cents, max_concurrent_runs,
  analytics_retention_days, max_workflows
) VALUES
  ('free',       'Free',       0,     50,      500,      1,   7,   5),
  ('pro',        'Pro',        4900,  500,     5000,     3,   30,  -1),
  ('team',       'Team',       14900, 2000,    20000,    10,  90,  -1),
  ('enterprise', 'Enterprise', 0,     -1,      -1,       -1,  365, -1)
ON CONFLICT (id) DO NOTHING;
