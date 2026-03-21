# Production Testing: Issues and Improvements

This document catalogs all issues discovered during production build testing and recommends prioritized improvements.

## Critical Issues

### 1. Home Page Slow First Contentful Paint (4.1s)

**Status**: ❌ Critical
**Impact**: Users see blank screen for 4+ seconds on initial visit
**Root Cause**: H1 heading (LCP element) waits for API data before rendering

**Current Implementation**:

```tsx
// HomePage.tsx (problematic pattern)
const { data } = useQuery({ queryKey: ['workflows'] });
return <h1>{data.title}</h1>; // Waits for API response
```

**Recommended Fix**:

```tsx
// HomePage.tsx (improved pattern)
return (
  <>
    <h1>Welcome to ShipSec Studio</h1>
    <Suspense fallback={<Skeleton />}>
      <DynamicDashboard />
    </Suspense>
  </>
);
```

**Benefits**:

- FCP drops from 4.1s to <1s (estimated 75% improvement)
- Static content renders immediately
- Progressive enhancement for dynamic data
- Better perceived performance

**Effort**: Medium (2-3 hours)
**Priority**: P0 (blocker for production)

**Files to Modify**:

- `frontend/src/pages/HomePage.tsx`
- Consider extracting dynamic sections to separate components

**Test Plan**:

1. Measure FCP before changes
2. Implement static shell rendering
3. Move API-dependent content to Suspense boundaries
4. Measure FCP after changes (target: <1s)
5. Verify no functional regressions

---

### 2. `/api/v1/workflows/summary` Endpoint Slow (1.7-1.9s)

**Status**: ⚠️ High Priority
**Impact**: Blocks Home page render, contributes to slow LCP
**Root Cause**: Likely N+1 queries or missing database indexes

**Current Performance**:
| Metric | Value | Assessment |
|--------|-------|------------|
| Response time | 334-501ms | Reasonable |
| Total duration | 1,741-1,871ms | ⚠️ High queuing |
| Difference | ~1,400ms | Connection pool issue |

**Recommended Fixes**:

#### A. Add Redis Caching (Quick Win)

```typescript
// workflows.service.ts
async getWorkflowsSummary() {
  const cacheKey = 'workflows:summary';
  const cached = await this.redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const summary = await this.db.query(...);
  await this.redis.set(cacheKey, JSON.stringify(summary), 'EX', 60);
  return summary;
}
```

**Benefits**:

- Estimated 80-90% latency reduction
- Reduces database load
- Simple to implement

**Effort**: Low (1-2 hours)
**Priority**: P0

#### B. Optimize Database Query

```sql
-- Add missing indexes (example)
CREATE INDEX idx_workflows_org_status ON workflows(organization_id, status);
CREATE INDEX idx_workflow_runs_workflow_created ON workflow_runs(workflow_id, created_at DESC);
```

**Benefits**:

- Faster query execution
- Reduced CPU usage
- Permanent fix

**Effort**: Medium (need query profiling first)
**Priority**: P1

#### C. Increase Backend Connection Pool

```typescript
// backend/src/config/database.config.ts
pool: {
  min: 10,      // Up from default (usually 2)
  max: 30,      // Up from default (usually 10)
  idleTimeoutMillis: 30000,
}
```

**Benefits**:

- Reduces request queuing
- Better concurrency handling

**Effort**: Low (15 minutes)
**Priority**: P1

**Test Plan**:

1. Profile query with `EXPLAIN ANALYZE`
2. Add caching first (quick win)
3. Load test endpoint: `ab -n 100 -c 10 http://localhost:3211/api/v1/workflows/summary`
4. Add indexes if still slow
5. Increase pool size if queuing persists

---

### 3. Analytics API Failures (ClickHouse Not Seeded)

**Status**: ⚠️ Medium Priority
**Impact**: Dashboard widgets stuck in loading state, console errors
**Root Cause**: ClickHouse has no sample data in production environment

**Current Behavior**:

```bash
POST /api/v1/analytics/query
500 Internal Server Error
"ClickHouseClientError: table not found"
```

**Recommended Fixes**:

#### A. Graceful Degradation (Quick)

```tsx
// SecurityDashboard.tsx
const { data, error } = useQuery({
  queryKey: ['analytics'],
  retry: 1, // Don't retry 500 errors
});

if (error) {
  return <EmptyState message="Analytics unavailable" />;
}
```

**Benefits**:

- No user-facing errors
- Page still usable
- Better UX

**Effort**: Low (30 minutes)
**Priority**: P1

#### B. Seed Sample Data (Production)

```bash
# Create sample findings for testing
just seed-analytics

# Or manual:
curl -X POST http://localhost:3211/api/v1/analytics/seed \
  -H "Content-Type: application/json" \
  -d '{"count": 100}'
```

**Benefits**:

- Realistic production testing
- Validates analytics features
- Demonstrates platform capabilities

**Effort**: Medium (need seed script)
**Priority**: P2

---

## High Priority Improvements

### 4. API Request Waterfall Elimination

**Status**: ⚠️ Optimization
**Impact**: Adds 1-2s to initial page load
**Root Cause**: Sequential API calls instead of parallel

**Current Pattern**:

```tsx
// Sequential (bad)
const workflows = useQuery(['workflows']);
const components = useQuery(['components']);
const repos = useQuery(['repos']);
// Total time: 500ms + 150ms + 165ms = 815ms
```

**Recommended Pattern**:

```tsx
// Parallel (good)
const queries = useQueries({
  queries: [
    { queryKey: ['workflows'], queryFn: fetchWorkflows },
    { queryKey: ['components'], queryFn: fetchComponents },
    { queryKey: ['repos'], queryFn: fetchRepos },
  ],
});
// Total time: max(500ms, 150ms, 165ms) = 500ms
```

**Benefits**:

- 40-60% faster page loads
- Better user experience
- No code complexity increase

**Effort**: Low (1-2 hours)
**Priority**: P1

**Files to Modify**:

- `frontend/src/pages/HomePage.tsx`
- `frontend/src/pages/WorkflowTemplatesPage.tsx`
- Any page with multiple independent queries

---

### 5. Image Optimization (LCP Improvement)

**Status**: ⚠️ Optimization
**Impact**: LCP on Templates page is 2.6s (target: <2.5s)
**Root Cause**: PNG/JPG images not optimized, no lazy loading

**Current State**:

- Template preview: 49,599 bytes PNG
- No WebP/AVIF conversion
- All images loaded eagerly

**Recommended Fixes**:

#### A. Convert to WebP (Quick Win)

```bash
# Batch convert images
for img in public/templates/*.png; do
  cwebp -q 85 "$img" -o "${img%.png}.webp"
done
```

```tsx
// Use <picture> for fallback
<picture>
  <source srcSet="/template.webp" type="image/webp" />
  <img src="/template.png" alt="Template" />
</picture>
```

**Benefits**:

- 30-50% smaller file size
- Faster LCP
- Minimal code changes

**Effort**: Low (1 hour)
**Priority**: P1

#### B. Lazy Loading Below Fold

```tsx
<img
  src="/template.png"
  loading="lazy" // Native browser lazy loading
  decoding="async"
/>
```

**Benefits**:

- Faster initial page load
- Reduced bandwidth
- Zero JavaScript overhead

**Effort**: Low (30 minutes)
**Priority**: P2

#### C. Blur Placeholder

```tsx
import { useState } from 'react';

<img
  src="/template.png"
  style={{
    filter: loaded ? 'none' : 'blur(10px)',
    transition: 'filter 0.3s',
  }}
  onLoad={() => setLoaded(true)}
/>;
```

**Benefits**:

- Better perceived performance
- Progressive image loading
- Modern UX pattern

**Effort**: Medium (2-3 hours)
**Priority**: P2

---

## Medium Priority Improvements

### 6. Service Worker for Offline-First Experience

**Status**: 💡 Enhancement
**Impact**: Instant repeat visits, offline capability
**Implementation**: Workbox with Vite PWA plugin

**Setup**:

```bash
bun add -D vite-plugin-pwa workbox-window
```

```typescript
// vite.config.ts
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\./,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 300,
              },
            },
          },
        ],
      },
    }),
  ],
});
```

**Benefits**:

- Instant repeat visits (cache hit)
- Offline functionality
- Better mobile experience
- Lower server load

**Effort**: Medium (4-6 hours)
**Priority**: P2

**Test Plan**:

1. Enable service worker in production build
2. Visit app, then go offline
3. Navigate between cached routes
4. Verify offline message for API calls
5. Test cache invalidation on updates

---

### 7. Preload Critical Assets

**Status**: 💡 Enhancement
**Impact**: Slightly faster FCP (100-200ms gain)
**Implementation**: Add `<link rel="preload">` hints

**Current**:

```html
<!-- No preloading -->
<script type="module" src="/src/main.tsx"></script>
```

**Recommended**:

```html
<!-- Preload critical chunks -->
<link rel="preload" href="/assets/vendor-react.js" as="script" />
<link rel="preload" href="/assets/index.js" as="script" />
<link rel="preload" href="/fonts/inter.woff2" as="font" crossorigin />

<!-- Preload above-fold images -->
<link rel="preload" href="/template-hero.webp" as="image" />
```

**Benefits**:

- Parallel download of critical resources
- Faster parse start
- Better Core Web Vitals

**Effort**: Low (1-2 hours)
**Priority**: P2

---

### 8. Route Transition Animations

**Status**: 💡 Enhancement
**Impact**: Better perceived performance during navigation
**Implementation**: Framer Motion or CSS transitions

**Example**:

```tsx
import { AnimatePresence, motion } from 'framer-motion';

<AnimatePresence mode="wait">
  <motion.div
    key={location.pathname}
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -10 }}
    transition={{ duration: 0.2 }}
  >
    {children}
  </motion.div>
</AnimatePresence>;
```

**Benefits**:

- Smoother navigation
- Masks loading states
- Modern app feel

**Effort**: Medium (3-4 hours)
**Priority**: P3

---

## Low Priority / Future Enhancements

### 9. CDN for Static Assets

**Status**: 💡 Infrastructure
**Impact**: Global TTFB reduction
**Implementation**: CloudFront + S3

**Setup**:

```bash
# Deploy static assets to S3
aws s3 sync dist/assets s3://shipsec-static/assets

# Configure CloudFront distribution
# Point to S3 bucket
# Enable Brotli compression
# Set cache headers
```

**Benefits**:

- Sub-100ms TTFB globally
- Reduced origin server load
- Better scalability

**Effort**: High (full day)
**Priority**: P3

---

### 10. Bundle Size Optimization (Further)

**Status**: 💡 Enhancement
**Impact**: Marginal improvement (already well-optimized)

**Current Bundle Analysis**:

- `lucide-react`: 549 KB raw / 146 KB gzipped (largest vendor)
- `radix-ui`: 129 KB raw / 40 KB gzipped
- `vendor-analytics`: 172 KB raw / 56 KB gzipped

**Potential Optimizations**:

#### A. Icon Tree-Shaking

```typescript
// Instead of:
import { Home, Settings } from 'lucide-react';

// Use:
import Home from 'lucide-react/dist/esm/icons/home';
import Settings from 'lucide-react/dist/esm/icons/settings';
```

**Benefit**: ~20-30 KB reduction (limited, icons already tree-shaken)

#### B. Replace Heavy Dependencies

- Consider `heroicons` (smaller) instead of `lucide-react`
- Use native `<dialog>` instead of Radix Dialog

**Benefit**: 50-100 KB reduction potential

**Effort**: High (major refactor)
**Priority**: P4 (not worth it currently)

---

### 11. SSR/SSG for Static Pages

**Status**: 💡 Major Change
**Impact**: Sub-500ms FCP on all pages
**Implementation**: Vite SSR or Next.js migration

**Approach**:

```typescript
// Vite SSR entry
export async function render(url: string) {
  const { pipe } = renderToPipeableStream(
    <App url={url} />,
    {
      onShellReady() {
        res.setHeader('Content-Type', 'text/html');
        pipe(res);
      }
    }
  );
}
```

**Benefits**:

- Instant FCP (HTML served immediately)
- Better SEO
- Improved Core Web Vitals

**Effort**: Very High (1-2 weeks)
**Priority**: P4 (future consideration)

---

## Infrastructure Improvements

### 12. Health Check Configuration

**Status**: ✅ Already Implemented
**Configuration**:

```yaml
# docker-compose.full.yml
healthcheck:
  test: ['CMD', 'curl', '-f', 'http://localhost:3211/health']
  interval: 10s
  timeout: 3s
  start_period: 30s # Allows cold start
  retries: 3
```

**Validates**: Backend warm-up before accepting traffic

---

### 13. Backend Connection Pool Monitoring

**Status**: 💡 Observability
**Impact**: Detect connection pool saturation early

**Implementation**:

```typescript
// backend/src/health/health.controller.ts
@Get('health/detailed')
async getDetailedHealth() {
  return {
    database: {
      poolSize: this.db.$pool.totalCount,
      idle: this.db.$pool.idleCount,
      waiting: this.db.$pool.waitingCount,
    },
    redis: await this.redis.ping(),
    temporal: await this.temporal.checkConnection(),
  };
}
```

**Benefits**:

- Proactive issue detection
- Better capacity planning
- Debugging tool

**Effort**: Low (2-3 hours)
**Priority**: P2

---

## Testing and Validation

### 14. Automated Performance Testing in CI

**Status**: 💡 CI/CD Enhancement
**Implementation**: Lighthouse CI + bundle size checks

**GitHub Actions Workflow**:

```yaml
# .github/workflows/performance.yml
- name: Lighthouse CI
  run: |
    npm install -g @lhci/cli
    lhci autorun --config=lighthouserc.js

- name: Bundle Size Check
  run: |
    SIZE=$(stat -f%z dist/assets/index-*.js)
    if [ $SIZE -gt 102400 ]; then
      echo "Bundle size exceeds 100 KB"
      exit 1
    fi
```

**lighthouserc.js**:

```javascript
module.exports = {
  ci: {
    collect: {
      staticDistDir: './dist',
      url: ['http://localhost/', 'http://localhost/templates'],
    },
    assert: {
      assertions: {
        'first-contentful-paint': ['error', { maxNumericValue: 1000 }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 2500 }],
      },
    },
  },
};
```

**Benefits**:

- Catch performance regressions before merge
- Historical trend tracking
- Enforce performance budgets

**Effort**: Medium (4-6 hours)
**Priority**: P2

---

## Summary of Priorities

### P0 - Production Blockers (Must Fix Before Deploy)

1. ✅ Production build fixes (DONE: backend/package.json, IntegrationsManager.tsx, docker-compose.full.yml)
2. ❌ Home page progressive rendering (FCP: 4.1s → <1s)
3. ❌ `/workflows/summary` endpoint caching (1.9s → <500ms)

### P1 - High Priority (Ship Within 1-2 Sprints)

1. ❌ API request parallelization
2. ❌ Image optimization (WebP conversion)
3. ❌ Analytics graceful degradation
4. ❌ Backend connection pool increase

### P2 - Medium Priority (Nice to Have)

1. ❌ Service worker implementation
2. ❌ Preload critical assets
3. ❌ Image lazy loading
4. ❌ Health check monitoring
5. ❌ Lighthouse CI

### P3 - Low Priority (Future)

1. ❌ Route transition animations
2. ❌ CDN for static assets
3. ❌ Blur placeholder images

### P4 - Long Term (6+ Months)

1. ❌ SSR/SSG implementation
2. ❌ Dependency replacement (icons, UI)
3. ❌ Next.js migration consideration

---

## Measurement and Validation

### Before Implementation

1. Capture baseline metrics
2. Screenshot current behavior
3. Document exact reproduction steps

### During Implementation

1. Test locally with production build
2. Verify metrics improve
3. Check for regressions

### After Implementation

1. Re-run performance tests (warm backend)
2. Compare before/after metrics
3. Update baseline documentation
4. Deploy to staging for real-world validation

### Success Criteria

- ✅ FCP < 1s on all pages (warm backend)
- ✅ LCP < 2.5s on all pages
- ✅ Bundle size < 100 KB (initial transfer)
- ✅ No console errors or warnings
- ✅ All automated tests pass

---

## References

- Production Build Test Report: `.context/PRODUCTION-BUILD-TEST-REPORT.md`
- Warm Backend Performance Report: `.context/WARM-BACKEND-PERFORMANCE-REPORT.md`
- Build and Test Guide: `docs/production-testing/BUILD-AND-TEST-GUIDE.md`
- Performance Baselines: `docs/production-testing/PERFORMANCE-BASELINE.md`
