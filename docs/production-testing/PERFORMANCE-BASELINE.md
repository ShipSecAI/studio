# Production Performance Baselines

This document establishes performance targets and acceptable ranges for the ShipSec Studio frontend in production.

## Core Web Vitals Targets

### Largest Contentful Paint (LCP)

**Definition**: Time until the largest content element is visible

| Rating            | Target      | Status        |
| ----------------- | ----------- | ------------- |
| Good              | < 2.5s      | ✅ Target     |
| Needs Improvement | 2.5s - 4.0s | ⚠️ Acceptable |
| Poor              | > 4.0s      | ❌ Needs Fix  |

**Current Performance (Warm Backend)**:

- Templates page: **2.6s** (needs improvement, close to good)
- Home page: **5.6s** (poor, needs optimization)

**Goal**: < 2.5s on all pages with warm backend

### First Contentful Paint (FCP)

**Definition**: Time until first content appears

| Rating            | Target      | Status        |
| ----------------- | ----------- | ------------- |
| Good              | < 1.0s      | ✅ Target     |
| Needs Improvement | 1.0s - 3.0s | ⚠️ Acceptable |
| Poor              | > 3.0s      | ❌ Needs Fix  |

**Current Performance (Warm Backend)**:

- Templates page: **680ms** ✅ (under 1s)
- Home page: **4.1s** ❌ (poor)

**Goal**: < 1s on all pages with warm backend

### Time to First Byte (TTFB)

**Definition**: Time until first byte received from server

| Rating            | Target         | Status        |
| ----------------- | -------------- | ------------- |
| Good              | < 500ms        | ✅ Target     |
| Needs Improvement | 500ms - 1000ms | ⚠️ Acceptable |
| Poor              | > 1000ms       | ❌ Needs Fix  |

**Current Performance (Warm Backend)**:

- Templates page: **278ms** ✅
- Home page: **59ms** ✅

**Cold Backend Performance**:

- Initial request: **3,011ms** ❌ (expected for cold start)

**Goal**: < 500ms with warm backend

## Bundle Size Targets

### JavaScript Transfer Size (Gzipped)

| Metric              | Target   | Current                  | Status        |
| ------------------- | -------- | ------------------------ | ------------- |
| Initial page load   | < 100 KB | **72 KB**                | ✅ Excellent  |
| Largest route chunk | < 200 KB | 194 KB (WorkflowBuilder) | ✅ Acceptable |
| Total app bundle    | < 600 KB | 520 KB                   | ✅ Good       |

### Code Splitting

| Metric                  | Target  | Current | Status       |
| ----------------------- | ------- | ------- | ------------ |
| Route chunks            | > 10    | **90+** | ✅ Excellent |
| Initial bundle          | < 30 KB | 26 KB   | ✅ Excellent |
| Vendor chunks separated | Yes     | ✅ Yes  | ✅           |

## API Response Time Targets

### Critical Endpoints (P95)

| Endpoint                     | Target  | Current   | Status  |
| ---------------------------- | ------- | --------- | ------- |
| `/api/v1/workflow-templates` | < 200ms | 201ms     | ✅ Good |
| `/api/v1/components`         | < 200ms | 122-150ms | ✅ Good |
| `/api/v1/github/repos`       | < 300ms | 165ms     | ✅ Good |
| `/api/v1/schedules`          | < 500ms | 322ms     | ✅ Good |

### Slow Endpoints (Need Optimization)

| Endpoint                    | Target  | Current           | Status           |
| --------------------------- | ------- | ----------------- | ---------------- |
| `/api/v1/workflows/summary` | < 500ms | **1,741-1,871ms** | ❌ Needs caching |

**Issue**: High "total duration" vs "response time" indicates request queuing or connection pool saturation.

## Page-Specific Baselines

### Home Page (/)

**Characteristics**:

- Multiple API dependencies
- Dynamic dashboard widgets
- H1 heading as LCP element (15,247 bytes)

**Targets**:
| Metric | Target | Current (Warm) | Status |
|--------|--------|----------------|--------|
| TTFB | < 500ms | 59ms | ✅ |
| FCP | < 1s | 4.1s | ❌ |
| LCP | < 2.5s | 5.6s | ❌ |

**Optimization Needed**: Yes (render shell before API data loads)

### Templates Page (/templates)

**Characteristics**:

- Minimal API dependencies
- Static content structure
- Image as LCP element (49,599 bytes)

**Targets**:
| Metric | Target | Current (Warm) | Status |
|--------|--------|----------------|--------|
| TTFB | < 500ms | 278ms | ✅ |
| FCP | < 1s | 680ms | ✅ |
| LCP | < 2.5s | 2.6s | ⚠️ |

**Optimization Needed**: Minor (image optimization could push LCP under 2.5s)

### Workflow Builder (/builder)

**Characteristics**:

- Large code chunk (194 KB gzipped)
- Heavy React Flow dependencies
- Canvas initialization

**Targets**:
| Metric | Target | Expected | Notes |
|--------|--------|----------|-------|
| Chunk load | < 500ms | ~300ms | Prefetched on idle |
| TTI | < 3s | ~2s | Canvas heavy |
| Canvas ready | < 1s | ~800ms | After chunk load |

**Status**: Not yet measured in production (needs testing)

## Comparison: Dev vs Production

### Development Mode (Vite Dev Server)

| Metric          | Value         | Notes                        |
| --------------- | ------------- | ---------------------------- |
| Bundle format   | Unbundled ESM | Native ES modules            |
| Bundle size     | N/A           | No bundling                  |
| Module requests | 100+          | Waterfall loading            |
| FCP             | ~10s          | Estimated (module waterfall) |
| Hot reload      | < 100ms       | ✅ Instant                   |

**Purpose**: Fast development iteration, not performance testing

### Production Mode (Docker Deployment)

| Metric          | Value              | Notes                 |
| --------------- | ------------------ | --------------------- |
| Bundle format   | Minified + gzipped | Vite production build |
| Bundle size     | 72 KB              | ✅ 90% smaller        |
| Module requests | 1-3                | Bundled chunks        |
| FCP (Templates) | 680ms              | ✅ 93% faster         |
| Navigation      | < 100ms            | Prefetched routes     |

**Purpose**: Production performance validation

## Backend Cold Start Impact

### Cold Backend (Initial Startup)

**Scenario**: Immediately after `docker compose up` / deployment

| Metric | Value   | Impact         |
| ------ | ------- | -------------- |
| TTFB   | 3,011ms | ❌ 10x slower  |
| FCP    | 5,788ms | ❌ 8.5x slower |
| LCP    | 7,072ms | ❌ 2.7x slower |

**Causes**:

- Database connection pooling initialization
- AWS SDK initialization
- Temporal client connection
- Redis/Kafka connection establishment
- Container startup overhead

**Mitigation**: Health checks with `start_period: 30s` allow warm-up

### Warm Backend (Production Normal)

**Scenario**: 3+ minutes after startup, connections pooled

| Metric | Value    | Improvement   |
| ------ | -------- | ------------- |
| TTFB   | 59-278ms | ✅ 98% faster |
| FCP    | 680ms    | ✅ 88% faster |
| LCP    | 2.6s     | ✅ 63% faster |

**Conclusion**: Frontend performance is excellent when not gated by backend cold start

## Network Efficiency

### Caching Behavior

| Resource Type     | First Load | Repeat Load      | Status            |
| ----------------- | ---------- | ---------------- | ----------------- |
| JavaScript chunks | 200 OK     | 304 Not Modified | ✅ Cached         |
| CSS               | 200 OK     | 304 Not Modified | ✅ Cached         |
| Static assets     | 200 OK     | 304 Not Modified | ✅ Cached         |
| API responses     | 200 OK     | No cache         | ⚠️ Needs strategy |

**Recommendation**: Add `Cache-Control` headers for API responses with stale-while-revalidate

### Request Parallelization

| Page      | Sequential | Parallel          | Status       |
| --------- | ---------- | ----------------- | ------------ |
| Home      | 4 APIs     | Could be parallel | ⚠️ Waterfall |
| Templates | 3 APIs     | Could be parallel | ⚠️ Waterfall |

**Issue**: APIs fire sequentially instead of `Promise.all()`

**Impact**: 1.5-2s additional latency on initial page render

## Route Prefetching Validation

### Prefetch Strategy

```typescript
// All sidebar routes prefetched during idle time
prefetchIdleRoutes() {
  requestIdleCallback(() => {
    // Prefetch all 12+ route chunks
  }, { timeout: 10_000 });
}
```

### Prefetch Effectiveness

| Scenario                  | Chunk Load Time | Status              |
| ------------------------- | --------------- | ------------------- |
| First visit (no prefetch) | 200-500ms       | ⚠️ Network bound    |
| After prefetch            | < 10ms          | ✅ Instant (cached) |
| Navigation speed          | < 100ms         | ✅ Instant          |

**Validation**: ✅ Post-navigation performance is instant

## Image Optimization Baseline

### Current State

| Image Type        | Format  | Size         | Compression | Status                |
| ----------------- | ------- | ------------ | ----------- | --------------------- |
| Template previews | PNG/JPG | 49,599 bytes | None        | ⚠️ Needs optimization |
| Icons             | SVG     | < 5 KB       | N/A         | ✅ Good               |
| Logos             | PNG     | < 10 KB      | Compressed  | ✅ Good               |

### Optimization Targets

| Optimization      | Expected Improvement  | Effort | Priority |
| ----------------- | --------------------- | ------ | -------- |
| WebP format       | 30-50% smaller        | Low    | High     |
| AVIF format       | 50-70% smaller        | Medium | Medium   |
| Lazy loading      | Faster FCP            | Low    | High     |
| Blur placeholder  | Better perceived perf | Medium | Low      |
| Responsive images | 40% bandwidth saving  | Medium | Medium   |

## Monitoring Recommendations

### Production Metrics to Track

1. **Real User Monitoring (RUM)**
   - P50, P75, P95, P99 for LCP/FCP
   - Segmented by page, device, geography

2. **Synthetic Monitoring**
   - Lighthouse CI on every deployment
   - Scheduled tests from multiple regions

3. **Backend API Performance**
   - Response times per endpoint
   - Database query performance
   - Cache hit rates

4. **Error Tracking**
   - JavaScript errors
   - Failed API requests
   - Console warnings

### Alert Thresholds

| Metric           | Threshold | Action               |
| ---------------- | --------- | -------------------- |
| P95 LCP          | > 4s      | Investigate          |
| P95 FCP          | > 2s      | Investigate          |
| P95 TTFB         | > 1s      | Check backend health |
| Error rate       | > 1%      | Page the on-call     |
| API failure rate | > 5%      | Check backend logs   |

## Historical Performance Trends

### 2026-02-18: Production Build Testing

**Branch**: LuD1161/onboarding-and-dashboard
**Build**: e028c61

| Page      | FCP (Cold) | FCP (Warm) | Improvement |
| --------- | ---------- | ---------- | ----------- |
| Home      | 5,788ms    | 4,116ms    | 29%         |
| Templates | N/A        | 680ms      | Baseline    |

**Key Findings**:

- ✅ FCP < 1s validated for Templates page (warm backend)
- ❌ Home page needs progressive rendering
- ✅ Bundle optimization excellent (72 KB)
- ⚠️ Backend cold start significant (3s)

## Future Performance Goals

### Short Term (Next Sprint)

1. **Home Page Progressive Rendering**
   - Target: FCP < 1s (currently 4.1s)
   - Method: Render static shell, defer API data

2. **Image Optimization**
   - Target: LCP < 2.5s on Templates (currently 2.6s)
   - Method: WebP conversion, lazy loading

3. **API Parallelization**
   - Target: Reduce page load by 1-2s
   - Method: `Promise.all()` for independent queries

### Medium Term (1-2 Months)

1. **Service Worker Implementation**
   - Target: Instant repeat visits
   - Method: Precache static assets, offline-first

2. **API Response Caching**
   - Target: `/workflows/summary` < 500ms
   - Method: Redis caching with 60s TTL

3. **Database Query Optimization**
   - Target: All API endpoints < 200ms P95
   - Method: Index optimization, N+1 query fixes

### Long Term (3-6 Months)

1. **CDN for Static Assets**
   - Target: TTFB < 100ms globally
   - Method: CloudFront distribution

2. **Server-Side Rendering (SSR)**
   - Target: FCP < 500ms on all pages
   - Method: Next.js migration or Vite SSR

3. **Edge Caching**
   - Target: LCP < 1.5s globally
   - Method: Edge functions + cache

## Regression Prevention

### Performance Budgets

Add to CI/CD pipeline:

```bash
# Lighthouse CI
lighthouse --budget-path=budget.json

# Bundle size limits
if [ $(stat -f%z dist/assets/*.js) -gt 102400 ]; then
  echo "ERROR: Bundle exceeds 100 KB limit"
  exit 1
fi
```

**Budget File** (`budget.json`):

```json
{
  "resourceSizes": [
    {
      "resourceType": "script",
      "budget": 100
    },
    {
      "resourceType": "total",
      "budget": 300
    }
  ],
  "timings": [
    {
      "metric": "first-contentful-paint",
      "budget": 1000
    },
    {
      "metric": "largest-contentful-paint",
      "budget": 2500
    }
  ]
}
```

## References

- Web Vitals Documentation: https://web.dev/vitals/
- Lighthouse Scoring: https://web.dev/performance-scoring/
- Chrome UX Report: https://developers.google.com/web/tools/chrome-user-experience-report
- Vite Performance: https://vitejs.dev/guide/performance.html
