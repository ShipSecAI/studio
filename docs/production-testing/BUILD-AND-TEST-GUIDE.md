# Production Build and Performance Testing Guide

This guide documents the complete process for building production Docker images and testing frontend performance metrics (LCP, FCP, TTFB).

## Prerequisites

- Docker and Docker Compose installed
- `just` task runner installed
- Chrome browser for DevTools Protocol testing
- All dependencies installed (`bun install`)

## Build Process

### 1. Clean Environment

```bash
# Stop all running instances
just dev stop all

# Clean Docker state
docker compose -f docker/docker-compose.full.yml down -v
```

### 2. Build Production Images

```bash
# Build all production images (frontend, backend, worker)
just prod build

# Expected output:
# ✓ Frontend built in ~30s (bundle: ~520 KB / ~150 KB gzipped)
# ✓ Backend: ghcr.io/shipsecai/studio-backend:latest
# ✓ Worker: ghcr.io/shipsecai/studio-worker:latest
# ✓ Frontend: ghcr.io/shipsecai/studio-frontend:latest
```

### 3. Start Production Environment

```bash
# Start all production containers
just prod up

# Verify services are healthy
docker compose -f docker/docker-compose.full.yml ps

# Expected services running:
# - shipsec-nginx (port 80)
# - shipsec-backend (port 3211)
# - shipsec-frontend (port 3000)
# - shipsec-worker
# - postgres, redis, temporal, opensearch, redpanda
```

### 4. Wait for Backend Warm-up

**Critical**: Wait 3-5 minutes after backend startup for realistic production metrics.

```bash
# Monitor backend logs
just prod logs backend

# Wait for:
# ✓ Database connections pooled
# ✓ AWS SDK initialized
# ✓ Temporal client connected
# ✓ Redis/Kafka connections established
```

## Performance Testing

### Method 1: Chrome DevTools MCP (Recommended)

Use the Chrome DevTools MCP for accurate Performance API measurements:

```bash
# Open Chrome DevTools MCP session
# Navigate to: http://localhost

# Capture metrics with Performance Observer:
const metrics = {
  TTFB: performance.timing.responseStart - performance.timing.requestStart,
  DOM_Interactive: performance.timing.domInteractive - performance.timing.navigationStart,
  FCP: null, // Use PerformanceObserver
  LCP: null  // Use PerformanceObserver
};

// Use PerformanceObserver for FCP/LCP
new PerformanceObserver((list) => {
  list.getEntries().forEach((entry) => {
    console.log(entry.name, entry.startTime);
  });
}).observe({ entryTypes: ['paint', 'largest-contentful-paint'] });
```

### Method 2: Chrome DevTools Performance Panel

1. Open Chrome DevTools (F12)
2. Go to Performance tab
3. Clear cache and hard reload (Cmd+Shift+R)
4. Record page load
5. Stop recording
6. Check Web Vitals in the timeline

### Method 3: Lighthouse CI

```bash
# Run Lighthouse audit
npx lighthouse http://localhost --output=html --output-path=./lighthouse-report.html

# View report
open lighthouse-report.html
```

## Test Scenarios

### Scenario 1: Cold Backend (Initial Startup)

**When to test**: Immediately after `just prod up`

**Expected metrics**:

- TTFB: 2-4 seconds (backend cold start)
- FCP: 5-6 seconds
- LCP: 7-9 seconds

**Purpose**: Understand deployment cold start penalty

### Scenario 2: Warm Backend (Production Realistic)

**When to test**: 5+ minutes after backend startup, after navigating to a few pages

**Expected metrics**:

- TTFB: <300ms
- FCP: <1 second (Templates page: 680ms)
- LCP: <3 seconds (Templates page: 2.6s)

**Purpose**: Validate production performance claims

### Scenario 3: Repeat Navigation

**When to test**: After initial page load, navigate between pages

**Expected metrics**:

- Navigation time: <100ms (instant)
- Route chunks: Already prefetched
- No additional bundle loading

**Purpose**: Validate route prefetching strategy

## Pages to Test

### 1. Home Page (/)

**Characteristics**:

- Multiple API dependencies
- H1 heading as LCP element
- Dynamic dashboard widgets

**Metrics to capture**:

- TTFB
- FCP (when H1 appears)
- LCP (H1 fully rendered)
- API response times: `/api/v1/workflows/summary`, `/api/v1/components`

### 2. Templates Page (/templates)

**Characteristics**:

- Minimal API dependencies
- Image as LCP element
- Static content structure

**Metrics to capture**:

- TTFB
- FCP (fastest expected)
- LCP (image load time)
- Bundle size transferred

### 3. Workflow Builder (/builder)

**Characteristics**:

- Large code-split chunk (194 KB gzipped)
- Heavy React Flow dependencies
- Canvas rendering

**Metrics to capture**:

- Chunk load time
- Time to interactive
- Canvas initialization

## Capturing Bundle Analysis

### Bundle Size Breakdown

```bash
# View Vite build output
just prod build | grep "dist"

# Expected output:
# dist/assets/index-{hash}.js                 26.42 kB │ gzip:   7.89 kB
# dist/assets/HomePage-{hash}.js              21.08 kB │ gzip:   5.77 kB
# dist/assets/WorkflowBuilder-{hash}.js      733.23 kB │ gzip: 194.38 kB
# ... (90+ chunks total)
```

### Network Transfer Analysis

1. Open Chrome DevTools Network tab
2. Clear cache
3. Load page
4. Check "Transferred" column
5. Filter by "JS" to see chunk loading

**Expected transfer size**: 71-74 KB (gzipped) for initial page load

## Network Request Analysis

### API Response Times

Capture these metrics for each API endpoint:

- **Duration**: Total request time (queuing + response)
- **Response Time**: Server processing time
- **Queuing Time**: Duration - Response Time

### Critical Endpoints

1. `/api/v1/workflows/summary`
   - Target: <500ms response time
   - Common issue: N+1 queries, needs caching

2. `/api/v1/components`
   - Target: <200ms response time
   - Common issue: Request queuing

3. `/api/v1/workflow-templates`
   - Target: <200ms response time
   - Usually fast (cached)

## Troubleshooting

### Issue: Backend Takes >10s to Start

**Symptoms**:

- `just prod logs backend` shows repeated connection errors
- Health checks failing
- TTFB consistently >5s

**Fixes**:

1. Check Docker resource limits (increase memory to 4GB+)
2. Verify DATABASE_URL is correct
3. Check Temporal server is running: `docker ps | grep temporal`
4. Ensure AWS_REGION is set in environment

### Issue: Analytics API Returns 500 Errors

**Symptoms**:

- POST `/api/v1/analytics/query` fails
- Dashboard widgets stuck in loading state
- OpenSearch errors in backend logs

**Fixes**:

1. Seed OpenSearch with sample data
2. Or disable analytics widgets temporarily
3. Check OpenSearch is running: `docker ps | grep opensearch`

### Issue: Bundle Size Exceeds 100 KB

**Symptoms**:

- Network tab shows >100 KB transferred (gzipped)
- Slow initial page load even with warm backend

**Fixes**:

1. Check for missing lazy imports in routes
2. Verify code splitting in vite.config.ts
3. Run bundle analyzer: `bun --cwd frontend run build -- --analyze`

### Issue: LCP Element Not Rendering

**Symptoms**:

- LCP metric not captured
- PerformanceObserver doesn't fire
- Page appears blank

**Fixes**:

1. Check for JavaScript errors in console
2. Verify API responses are successful
3. Check React Suspense boundaries aren't hanging
4. Ensure CSP headers allow inline styles

## Baseline Metrics Reference

See `PERFORMANCE-BASELINE.md` for target metrics and acceptable ranges.

## Reporting Findings

After testing, document:

1. **Metrics captured** (TTFB, FCP, LCP for each page)
2. **Bundle analysis** (transfer size, chunk count)
3. **API performance** (response times, failures)
4. **Issues found** (errors, warnings, slow endpoints)
5. **Comparison** (cold vs warm, dev vs production)

Save reports in `.context/` directory with naming format:

- `PRODUCTION-BUILD-TEST-REPORT-YYYY-MM-DD.md`
- `WARM-BACKEND-PERFORMANCE-REPORT-YYYY-MM-DD.md`

## Cleanup

```bash
# Stop production environment
just prod down

# Remove volumes (WARNING: deletes data)
just prod down -v

# Restart dev environment
just dev
```

## References

- Chrome DevTools Protocol MCP: Used for automated performance testing
- Core Web Vitals: https://web.dev/vitals/
- Vite Build Optimization: https://vitejs.dev/guide/build.html
- Performance API: https://developer.mozilla.org/en-US/docs/Web/API/Performance
