import { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Search,
  RotateCcw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Scan,
  ArrowRight,
  PlayCircle,
  GitBranch,
} from 'lucide-react';
import { useSecurityDashboardStore } from '@/store/securityDashboardStore';
import { useSecurityViewStore } from '@/store/securityViewStore';
import { useGitHubInstallations, useGitHubScanResults } from '@/hooks/queries/useGithubQueries';
import { useCloudScans } from '@/hooks/queries/useCloudScanQueries';
import { useIntegrationConnections } from '@/hooks/queries/useIntegrationQueries';
import {
  useSecurityFindings,
  useSecurityTimeSeries,
  useFindingDetail,
  useFindingLifecycle,
  useBatchLifecycles,
  useNewFindingHighlights,
} from '@/hooks/queries/useSecurityQueries';
import type { SecurityFinding } from '@/lib/securityQueryHelpers';
import { FindingDetailSheet } from '@/components/security/FindingDetailSheet';
import { SeverityBadge, StatusBadge, formatTimestamp } from '@/components/security/SeverityBadge';
import { FilterPopover } from '@/components/security/FilterPopover';
import { TimeSeriesChart } from '@/components/security/TimeSeriesChart';
import { FirstScanModal } from '@/components/security/FirstScanModal';
import { CloudFirstScanModal } from '@/components/security/CloudFirstScanModal';
import { SEVERITY_CONFIG, TIME_RANGES, PAGE_SIZE } from '@/components/security/constants';
import { cn } from '@/lib/utils';

const SCANNER_LOGO: Record<string, { src?: string; emoji?: string; alt: string }> = {
  opengrep: { src: '/icons/opengrep.ico', alt: 'OpenGrep' },
  trufflehog: { emoji: '🔑', alt: 'TruffleHog' },
  prowler: { src: '/icons/prowler.svg', alt: 'Prowler' },
  nuclei: { src: '/icons/nuclei.svg', alt: 'Nuclei' },
  safedep: { src: '/icons/safedep.png', alt: 'SafeDep' },
};

export function SecurityDashboardContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState('');
  const [timeRange, setTimeRange] = useState('7d');
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(null);

  // Store state (UI/filter state only)
  const filters = useSecurityDashboardStore((s) => s.filters);
  const viewFilter = useSecurityDashboardStore((s) => s.viewFilter);
  const selectedFinding = useSecurityDashboardStore((s) => s.selectedFinding);
  const setFilters = useSecurityDashboardStore((s) => s.setFilters);
  const resetFilters = useSecurityDashboardStore((s) => s.resetFilters);
  const setSelectedFinding = useSecurityDashboardStore((s) => s.setSelectedFinding);

  // TanStack Query hooks for data fetching
  const interval = TIME_RANGES.find((t) => t.key === timeRange)?.interval ?? 'day';
  const {
    data: findingsData,
    isLoading: findingsLoading,
    error,
  } = useSecurityFindings(filters, viewFilter);
  const { data: timeSeriesData, isLoading: timeSeriesLoading } = useSecurityTimeSeries(
    filters,
    viewFilter,
    interval,
  );

  // Derived data from findings query
  const findings = findingsData?.findings ?? [];
  const total = findingsData?.total ?? 0;
  const severityCounts = findingsData?.summary.severityCounts ?? {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  const accounts = findingsData?.summary.accounts ?? [];
  const regions = findingsData?.summary.regions ?? [];
  const services = findingsData?.summary.services ?? [];
  const complianceFrameworks = findingsData?.summary.complianceFrameworks ?? [];
  const checkNames = findingsData?.summary.checkNames ?? [];
  const statusCounts = findingsData?.summary.statusCounts ?? [];
  const scanners = findingsData?.summary.scanners ?? [];
  const repositories = findingsData?.summary.repositories ?? [];
  const ruleIds = findingsData?.summary.ruleIds ?? [];
  const files = findingsData?.summary.files ?? [];
  const timeSeries = timeSeriesData ?? [];
  const summaryLoading = findingsLoading;

  // Batch lifecycles for findings table
  const findingHashes = useMemo(
    () => findings.map((f) => f.finding_hash).filter(Boolean),
    [findings],
  );
  const { data: findingLifecycles = {}, isLoading: findingLifecyclesLoading } =
    useBatchLifecycles(findingHashes);

  // Deep-linked finding detail
  const deepLinkedFindingId = searchParams.get('finding');
  const { data: deepLinkedFinding } = useFindingDetail(deepLinkedFindingId);

  // Track whether user explicitly closed the sheet to prevent deep-link from re-opening
  const userClosedRef = useRef(false);

  // Set deep-linked finding when it loads (only if user hasn't just closed the sheet)
  useEffect(() => {
    if (deepLinkedFinding && !selectedFinding && !userClosedRef.current) {
      setSelectedFinding(deepLinkedFinding);
    }
  }, [deepLinkedFinding, selectedFinding, setSelectedFinding]);

  // Reset the user-closed flag when the finding param changes (new deep link)
  useEffect(() => {
    if (deepLinkedFindingId) {
      userClosedRef.current = false;
    }
  }, [deepLinkedFindingId]);

  // Selected finding lifecycle
  const selectedFindingHash = selectedFinding?.finding_hash ?? null;
  const { data: selectedFindingLifecycle = null, isLoading: selectedFindingLifecycleLoading } =
    useFindingLifecycle(selectedFindingHash);

  // New finding highlights
  const newFindingIds = useNewFindingHighlights(findings);

  // Parse URL params on mount
  useEffect(() => {
    const initial: Partial<typeof filters> = {};
    const account = searchParams.get('account');
    const severity = searchParams.get('severity');
    const status = searchParams.get('status');
    const region = searchParams.get('region');
    const service = searchParams.get('service');
    const tags = searchParams.get('tags');
    const compliance = searchParams.get('compliance');
    const checkName = searchParams.get('checkName');
    const scanner = searchParams.get('scanner');
    const repository = searchParams.get('repository');
    const ruleId = searchParams.get('ruleId');
    const file = searchParams.get('file');
    const language = searchParams.get('language');
    const q = searchParams.get('q');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const page = searchParams.get('page');
    const sort = searchParams.get('sort');
    const order = searchParams.get('order');

    if (account) initial.account = account;
    if (severity) initial.severity = severity.split(',');
    if (status) initial.status = status.split(',');
    if (region) initial.region = region.split(',');
    if (service) initial.service = service.split(',');
    if (tags) initial.tags = tags.split(',');
    if (compliance) initial.compliance = compliance.split(',');
    if (checkName) initial.checkName = checkName.split(',');
    if (scanner) initial.scanner = scanner.split(',');
    if (repository) initial.repository = repository.split(',');
    if (ruleId) initial.ruleId = ruleId.split(',');
    if (file) initial.file = file.split(',');
    if (language) initial.language = language.split(',');
    if (q) {
      initial.search = q;
      setSearchInput(q);
    }
    if (from) initial.from = from;
    if (to) initial.to = to;
    if (page) initial.page = parseInt(page, 10) || 1;
    if (sort) initial.sort = sort;
    if (order === 'asc' || order === 'desc') initial.order = order;

    if (Object.keys(initial).length > 0) {
      setFilters(initial);
    }
  }, []);

  // Sync filters -> URL
  useEffect(() => {
    setSearchParams(
      () => {
        const params = new URLSearchParams();
        const currentViewId = useSecurityViewStore.getState().activeViewId;
        if (currentViewId && currentViewId !== 'home') {
          params.set('view', currentViewId);
        }

        if (filters.account) params.set('account', filters.account);
        if (filters.severity.length) params.set('severity', filters.severity.join(','));
        if (filters.status.length) params.set('status', filters.status.join(','));
        if (filters.region.length) params.set('region', filters.region.join(','));
        if (filters.service.length) params.set('service', filters.service.join(','));
        if (filters.tags.length) params.set('tags', filters.tags.join(','));
        if (filters.compliance.length) params.set('compliance', filters.compliance.join(','));
        if (filters.checkName.length) params.set('checkName', filters.checkName.join(','));
        if (filters.scanner.length) params.set('scanner', filters.scanner.join(','));
        if (filters.repository.length) params.set('repository', filters.repository.join(','));
        if (filters.ruleId.length) params.set('ruleId', filters.ruleId.join(','));
        if (filters.file.length) params.set('file', filters.file.join(','));
        if (filters.language.length) params.set('language', filters.language.join(','));
        if (filters.search) params.set('q', filters.search);
        if (filters.from) params.set('from', filters.from);
        if (filters.to) params.set('to', filters.to);
        if (filters.page > 1) params.set('page', String(filters.page));
        if (filters.sort !== '@timestamp') params.set('sort', filters.sort);
        if (filters.order !== 'desc') params.set('order', filters.order);
        if (selectedFinding) {
          params.set('finding', selectedFinding._id);
        } else if (deepLinkedFindingId && !userClosedRef.current) {
          // Preserve the finding param while the deep-linked finding is still loading
          params.set('finding', deepLinkedFindingId);
        }
        return params;
      },
      { replace: true },
    );
  }, [filters, selectedFinding, deepLinkedFindingId, setSearchParams]);

  // Debounced search
  const handleSearchInput = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        setFilters({ search: value, page: 1 });
      }, 300);
    },
    [setFilters],
  );

  // Severity card click
  const toggleSeverityFilter = useCallback(
    (severity: string) => {
      const current = filters.severity;
      const next = current.includes(severity)
        ? current.filter((s) => s !== severity)
        : [...current, severity];
      setFilters({ severity: next, page: 1 });
    },
    [filters.severity, setFilters],
  );

  // Time range change
  const handleTimeRangeChange = useCallback((range: string) => {
    setTimeRange(range);
  }, []);

  // Multi-select toggles
  const toggleStatusFilter = useCallback(
    (value: string) => {
      const current = filters.status;
      const next = current.includes(value)
        ? current.filter((s) => s !== value)
        : [...current, value];
      setFilters({ status: next, page: 1 });
    },
    [filters.status, setFilters],
  );

  const toggleRegionFilter = useCallback(
    (value: string) => {
      const current = filters.region;
      const next = current.includes(value)
        ? current.filter((s) => s !== value)
        : [...current, value];
      setFilters({ region: next, page: 1 });
    },
    [filters.region, setFilters],
  );

  const toggleServiceFilter = useCallback(
    (value: string) => {
      const current = filters.service;
      const next = current.includes(value)
        ? current.filter((s) => s !== value)
        : [...current, value];
      setFilters({ service: next, page: 1 });
    },
    [filters.service, setFilters],
  );

  const toggleTagFilter = useCallback(
    (value: string) => {
      const current = filters.tags;
      const next = current.includes(value)
        ? current.filter((s) => s !== value)
        : [...current, value];
      setFilters({ tags: next, page: 1 });
    },
    [filters.tags, setFilters],
  );

  const toggleComplianceFilter = useCallback(
    (value: string) => {
      const current = filters.compliance;
      const next = current.includes(value)
        ? current.filter((s) => s !== value)
        : [...current, value];
      setFilters({ compliance: next, page: 1 });
    },
    [filters.compliance, setFilters],
  );

  const toggleCheckNameFilter = useCallback(
    (value: string) => {
      const current = filters.checkName;
      const next = current.includes(value)
        ? current.filter((s) => s !== value)
        : [...current, value];
      setFilters({ checkName: next, page: 1 });
    },
    [filters.checkName, setFilters],
  );

  const toggleScannerFilter = useCallback(
    (value: string) => {
      const current = filters.scanner;
      const next = current.includes(value)
        ? current.filter((s) => s !== value)
        : [...current, value];
      setFilters({ scanner: next, page: 1 });
    },
    [filters.scanner, setFilters],
  );

  const toggleRepositoryFilter = useCallback(
    (value: string) => {
      const current = filters.repository;
      const next = current.includes(value)
        ? current.filter((s) => s !== value)
        : [...current, value];
      setFilters({ repository: next, page: 1 });
    },
    [filters.repository, setFilters],
  );

  const toggleRuleIdFilter = useCallback(
    (value: string) => {
      const current = filters.ruleId;
      const next = current.includes(value)
        ? current.filter((s) => s !== value)
        : [...current, value];
      setFilters({ ruleId: next, page: 1 });
    },
    [filters.ruleId, setFilters],
  );

  const toggleFileFilter = useCallback(
    (value: string) => {
      const current = filters.file;
      const next = current.includes(value)
        ? current.filter((s) => s !== value)
        : [...current, value];
      setFilters({ file: next, page: 1 });
    },
    [filters.file, setFilters],
  );

  const toggleLanguageFilter = useCallback(
    (value: string) => {
      const current = filters.language;
      const next = current.includes(value)
        ? current.filter((s) => s !== value)
        : [...current, value];
      setFilters({ language: next, page: 1 });
    },
    [filters.language, setFilters],
  );

  // Sort
  const handleSort = useCallback(
    (column: string) => {
      if (filters.sort === column) {
        setFilters({ order: filters.order === 'asc' ? 'desc' : 'asc' });
      } else {
        setFilters({ sort: column, order: 'desc' });
      }
    },
    [filters.sort, filters.order, setFilters],
  );

  // Pagination
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const showFrom = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1;
  const showTo = Math.min(filters.page * PAGE_SIZE, total);

  // Active view for conditional rendering
  const activeViewId = useSecurityViewStore((s) => s.activeViewId);
  const showAccountTabs = activeViewId === 'cloud-security';
  const isCodeSecurityView = activeViewId === 'code-security';

  // Account tab value
  const accountTab = filters.account ?? 'all';

  // Available filter options from aggregations
  const statusOptions = useMemo(() => statusCounts.map((s) => s.key), [statusCounts]);
  const regionOptions = useMemo(() => regions.map((r) => r.key), [regions]);
  const serviceOptions = useMemo(() => services.map((s) => s.key), [services]);
  const complianceOptions = useMemo(
    () => complianceFrameworks.map((c) => c.key),
    [complianceFrameworks],
  );
  const checkNameOptions = useMemo(() => checkNames.map((c) => c.key), [checkNames]);
  const scannerOptions = useMemo(() => scanners.map((s) => s.key), [scanners]);
  const repositoryOptions = useMemo(
    () => repositories.map((r) => r.key).filter(Boolean),
    [repositories],
  );
  // For code-security view, only show SAST-style rule IDs (dotted identifiers like "php.lang.security...")
  // This excludes prowler check names ("prowler-cloudtrail_...") and trufflehog detector types ("GitHub", "AWS")
  const ruleIdOptions = useMemo(() => {
    const all = ruleIds.map((r) => r.key).filter(Boolean);
    if (!isCodeSecurityView) return all;
    return all.filter((id) => id.includes('.'));
  }, [ruleIds, isCodeSecurityView]);
  const fileOptions = useMemo(() => files.map((f) => f.key).filter(Boolean), [files]);

  // Derive language options from rule ID prefixes (e.g. "php.lang.security..." → "php")
  // Always include currently selected languages so they don't vanish when the filter narrows results
  const languageOptions = useMemo(() => {
    const langs = new Set<string>(filters.language);
    for (const r of ruleIds) {
      const firstDot = r.key.indexOf('.');
      if (firstDot > 0) {
        langs.add(r.key.slice(0, firstDot));
      }
    }
    return Array.from(langs).sort();
  }, [ruleIds, filters.language]);

  // Collect unique tag keys from current findings for tag filter options
  const tagKeyOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const f of findings) {
      if (f.resource_tags) {
        for (const k of Object.keys(f.resource_tags)) {
          keys.add(k);
        }
      }
    }
    return Array.from(keys).sort();
  }, [findings]);

  // Finding sheet
  const handleFindingClick = useCallback(
    (finding: SecurityFinding) => {
      setSelectedFinding(finding);
    },
    [setSelectedFinding],
  );

  const handleSheetClose = useCallback(
    (open: boolean) => {
      if (!open) {
        userClosedRef.current = true;
        setSelectedFinding(null);
      }
    },
    [setSelectedFinding],
  );

  const handleReset = useCallback(() => {
    resetFilters();
    setSearchInput('');
  }, [resetFilters]);

  const totalFindings =
    severityCounts.critical + severityCounts.high + severityCounts.medium + severityCounts.low;

  // Check if any filters are active (user-applied, not view-level)
  const hasActiveFilters =
    filters.severity.length > 0 ||
    filters.status.length > 0 ||
    filters.region.length > 0 ||
    filters.service.length > 0 ||
    filters.tags.length > 0 ||
    filters.compliance.length > 0 ||
    filters.checkName.length > 0 ||
    filters.scanner.length > 0 ||
    filters.repository.length > 0 ||
    filters.ruleId.length > 0 ||
    filters.file.length > 0 ||
    filters.language.length > 0 ||
    !!filters.search ||
    !!filters.account;

  // Format AWS account ID: "006514117437" -> "0065-1411-7437"
  const formatAccountId = useCallback((id: string) => {
    if (/^\d{12}$/.test(id)) {
      return `${id.slice(0, 4)}-${id.slice(4, 8)}-${id.slice(8)}`;
    }
    return id;
  }, []);

  // GitHub connection status (for code/dependency empty states)
  const { data: githubInstallations = [] } = useGitHubInstallations();
  const { data: orgConnections = [] } = useIntegrationConnections();
  const [firstScanModalOpen, setFirstScanModalOpen] = useState(false);

  const hasGitHub = githubInstallations.length > 0;
  const hasAws = orgConnections.some((c) => c.provider === 'aws');

  // Build account_id → display name map from AWS connections
  const accountNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const conn of orgConnections) {
      if (conn.provider !== 'aws') continue;
      const meta = conn.metadata as Record<string, string> | undefined;
      const roleArn = meta?.roleArn;
      if (roleArn) {
        const match = roleArn.match(/:(\d{12}):/);
        if (match?.[1] && conn.displayName) {
          map.set(match[1], conn.displayName);
        }
      }
    }
    return map;
  }, [orgConnections]);
  const isGitHubView =
    activeViewId === 'code-security' ||
    activeViewId === 'dependency-security' ||
    activeViewId === 'container-security';

  // Check if scans have been previously run (to distinguish "never scanned" from "0 findings")
  const { data: githubScans } = useGitHubScanResults({ limit: 1 });
  const { data: cloudScans } = useCloudScans({ limit: 1 });
  const hasGitHubScans = (githubScans?.data?.length ?? 0) > 0;
  const hasCloudScans = (cloudScans?.runs?.length ?? 0) > 0;

  const errorMessage = error instanceof Error ? error.message : error ? String(error) : null;

  // --- Empty state: no findings and no active filters -> show CTA ---
  // Skip entirely if scans have already been run (0 findings is a valid result, show normal dashboard)
  const hasAnyScans = hasGitHubScans || hasCloudScans;
  if (
    totalFindings === 0 &&
    !hasActiveFilters &&
    !hasAnyScans &&
    (!summaryLoading || errorMessage)
  ) {
    // For cloud-security view when AWS is already connected, show "Run First Scan"
    if (activeViewId === 'cloud-security' && hasAws) {
      return (
        <div className="flex-1 bg-background">
          <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Scan className="h-7 w-7 text-primary" />
            </div>
            <h2 className="text-lg font-semibold mb-1">No cloud findings yet</h2>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              AWS is connected. Run your first Prowler scan to discover cloud security findings.
            </p>
            <button
              onClick={() => setFirstScanModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <PlayCircle className="h-4 w-4" />
              Run First Scan
            </button>
          </div>
          <CloudFirstScanModal
            open={firstScanModalOpen}
            onClose={() => setFirstScanModalOpen(false)}
          />
        </div>
      );
    }

    // For code/dependency views when GitHub is already connected, show "Run First Scan"
    if (isGitHubView && hasGitHub) {
      const scanCategory =
        activeViewId === 'code-security'
          ? 'code'
          : activeViewId === 'container-security'
            ? 'container'
            : 'dependency';
      const title =
        activeViewId === 'code-security'
          ? 'No code findings yet'
          : activeViewId === 'container-security'
            ? 'No container findings yet'
            : 'No dependency findings yet';
      const description =
        activeViewId === 'code-security'
          ? 'GitHub is connected. Run your first code security scan to discover vulnerabilities.'
          : activeViewId === 'container-security'
            ? 'GitHub is connected. Run a container scan to discover image vulnerabilities.'
            : 'GitHub is connected. Run a dependency scan to discover vulnerable packages.';

      return (
        <div className="flex-1 bg-background">
          <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Scan className="h-7 w-7 text-primary" />
            </div>
            <h2 className="text-lg font-semibold mb-1">{title}</h2>
            <p className="text-sm text-muted-foreground max-w-md mb-6">{description}</p>
            <button
              onClick={() => setFirstScanModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <PlayCircle className="h-4 w-4" />
              Run First Scan
            </button>
          </div>
          <FirstScanModal
            open={firstScanModalOpen}
            onClose={() => setFirstScanModalOpen(false)}
            scanCategory={scanCategory}
          />
        </div>
      );
    }

    const viewCtas: Record<
      string,
      { title: string; description: string; href: string; linkLabel: string }
    > = {
      'cloud-security': {
        title: 'No cloud findings yet',
        description:
          'Connect your AWS account and run a Prowler scan to discover cloud security findings.',
        href: '/cloud/accounts',
        linkLabel: 'Connect AWS',
      },
      'code-security': {
        title: 'No code findings yet',
        description:
          'Connect GitHub and run your first code security scan to discover vulnerabilities.',
        href: '/github/repositories',
        linkLabel: 'Connect GitHub',
      },
      'dependency-security': {
        title: 'No dependency findings yet',
        description: 'Connect GitHub and run a dependency scan to discover vulnerable packages.',
        href: '/github/repositories',
        linkLabel: 'Connect GitHub',
      },
      'container-security': {
        title: 'No container findings yet',
        description: 'Connect GitHub and run a container scan to discover image vulnerabilities.',
        href: '/github/repositories',
        linkLabel: 'Connect GitHub',
      },
    };

    const cta = viewCtas[activeViewId] ?? {
      title: 'No findings yet',
      description:
        'Run your first security scan to discover findings across your infrastructure and code.',
      href: '/templates',
      linkLabel: 'Browse templates',
    };

    return (
      <div className="flex-1 bg-background">
        <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <Scan className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-lg font-semibold mb-1">{cta.title}</h2>
          <p className="text-sm text-muted-foreground max-w-md mb-6">{cta.description}</p>
          <Link
            to={cta.href}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {cta.linkLabel}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto px-3 md:px-4 pt-2 md:pt-3 pb-4 md:pb-8 space-y-4 md:space-y-6">
        {/* Account Tabs (only on Cloud Security) + Reset button */}
        <div className="flex items-center justify-between gap-2">
          {showAccountTabs && accounts.length > 0 ? (
            <Tabs
              value={accountTab}
              onValueChange={(v) => setFilters({ account: v === 'all' ? null : v, page: 1 })}
              className="min-w-0"
            >
              <TabsList className="h-auto flex-wrap">
                <TabsTrigger value="all" className="text-xs">
                  All Accounts
                  {!summaryLoading && (
                    <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                      {totalFindings}
                    </Badge>
                  )}
                </TabsTrigger>
                {accounts.map((acct) => (
                  <TabsTrigger key={acct.key} value={acct.key} className="text-xs">
                    {accountNameMap.get(acct.key) ?? formatAccountId(acct.key)}
                    <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                      {acct.doc_count}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : (
            <div />
          )}
          <Button variant="outline" size="sm" className="flex-shrink-0" onClick={handleReset}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Reset
          </Button>
        </div>

        {/* Severity Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {SEVERITY_CONFIG.map((sev) => {
            const count = severityCounts[sev.key as keyof typeof severityCounts];
            const isActive = filters.severity.includes(sev.key);
            const Icon = sev.icon;
            return (
              <button
                key={sev.key}
                onClick={() => toggleSeverityFilter(sev.key)}
                className={`rounded-lg border p-3 md:p-4 text-left transition-colors hover:bg-accent ${
                  isActive ? 'ring-2 ring-primary' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase">
                    {sev.label}
                  </span>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                {summaryLoading ? (
                  <Skeleton className="h-7 w-16 mt-2" />
                ) : (
                  <p className="text-2xl font-bold mt-1">{count}</p>
                )}
              </button>
            );
          })}
        </div>

        {/* Time Series Chart */}
        <TimeSeriesChart
          data={timeSeries}
          loading={timeSeriesLoading}
          timeRange={timeRange}
          onTimeRangeChange={handleTimeRangeChange}
        />

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search findings..."
              value={searchInput}
              onChange={(e) => handleSearchInput(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </div>
          <FilterPopover
            label="Severity"
            options={['critical', 'high', 'medium', 'low']}
            selected={filters.severity}
            onToggle={(v) => toggleSeverityFilter(v)}
          />
          {isCodeSecurityView && languageOptions.length > 0 && (
            <FilterPopover
              label="Language"
              options={languageOptions}
              selected={filters.language}
              onToggle={toggleLanguageFilter}
            />
          )}
          {isCodeSecurityView && scannerOptions.length > 0 && (
            <FilterPopover
              label="Scanner"
              options={scannerOptions}
              selected={filters.scanner}
              onToggle={toggleScannerFilter}
            />
          )}
          {isCodeSecurityView && repositoryOptions.length > 0 && (
            <FilterPopover
              label="Repository"
              options={repositoryOptions}
              selected={filters.repository}
              onToggle={toggleRepositoryFilter}
              wide
            />
          )}
          {isCodeSecurityView && ruleIdOptions.length > 0 && (
            <FilterPopover
              label="Rule"
              options={ruleIdOptions}
              selected={filters.ruleId}
              onToggle={toggleRuleIdFilter}
              wide
            />
          )}
          {isCodeSecurityView && fileOptions.length > 0 && (
            <FilterPopover
              label="File"
              options={fileOptions}
              selected={filters.file}
              onToggle={toggleFileFilter}
              wide
            />
          )}
          {!isCodeSecurityView && (
            <FilterPopover
              label="Status"
              options={statusOptions}
              selected={filters.status}
              onToggle={toggleStatusFilter}
            />
          )}
          {!isCodeSecurityView && (
            <FilterPopover
              label="Region"
              options={regionOptions}
              selected={filters.region}
              onToggle={toggleRegionFilter}
            />
          )}
          {!isCodeSecurityView && (
            <FilterPopover
              label="Service"
              options={serviceOptions}
              selected={filters.service}
              onToggle={toggleServiceFilter}
            />
          )}
          {complianceOptions.length > 0 && (
            <FilterPopover
              label="Compliance"
              options={complianceOptions}
              selected={filters.compliance}
              onToggle={toggleComplianceFilter}
            />
          )}
          {checkNameOptions.length > 0 && (
            <FilterPopover
              label="Check"
              options={checkNameOptions}
              selected={filters.checkName}
              onToggle={toggleCheckNameFilter}
            />
          )}
          {tagKeyOptions.length > 0 && (
            <FilterPopover
              label="Tags"
              options={tagKeyOptions}
              selected={filters.tags}
              onToggle={toggleTagFilter}
            />
          )}
        </div>

        {/* Data Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[250px]">Finding</TableHead>
                <TableHead className="w-[100px]">
                  <button
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => handleSort('severity')}
                  >
                    Severity
                    {filters.sort === 'severity' ? (
                      filters.order === 'asc' ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3 w-3" />
                    )}
                  </button>
                </TableHead>
                {!isCodeSecurityView && <TableHead className="w-[80px]">Status</TableHead>}
                {isCodeSecurityView ? (
                  <>
                    <TableHead className="hidden md:table-cell w-[150px]">Repository</TableHead>
                    <TableHead className="hidden lg:table-cell w-[100px]">Scanner</TableHead>
                  </>
                ) : (
                  <>
                    <TableHead className="hidden lg:table-cell w-[100px]">Service</TableHead>
                    <TableHead className="hidden md:table-cell w-[120px]">Region</TableHead>
                    <TableHead className="hidden md:table-cell w-[130px]">Account</TableHead>
                  </>
                )}
                <TableHead className="hidden xl:table-cell w-[140px]">First Seen</TableHead>
                <TableHead className="w-[140px]">
                  <button
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => handleSort('@timestamp')}
                  >
                    Last Seen
                    {filters.sort === '@timestamp' ? (
                      filters.order === 'asc' ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3 w-3" />
                    )}
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {findingsLoading && findings.length === 0
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={`skel-${i}`}>
                      <TableCell>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                      {!isCodeSecurityView && (
                        <TableCell>
                          <Skeleton className="h-4 w-14" />
                        </TableCell>
                      )}
                      {isCodeSecurityView ? (
                        <>
                          <TableCell className="hidden md:table-cell">
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            <Skeleton className="h-4 w-16" />
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="hidden lg:table-cell">
                            <Skeleton className="h-4 w-16" />
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <Skeleton className="h-4 w-20" />
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                        </>
                      )}
                      <TableCell className="hidden xl:table-cell">
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                    </TableRow>
                  ))
                : null}
              {!findingsLoading && findings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isCodeSecurityView ? 6 : 8} className="text-center py-12">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <ShieldCheck className="h-10 w-10" />
                      <p className="text-sm font-medium">No findings found</p>
                      <p className="text-xs">
                        Run a security scan or adjust your filters to see findings.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
              {findings.map((finding) => (
                <TableRow
                  key={finding._id}
                  className={cn(
                    'cursor-pointer',
                    newFindingIds.has(finding._id) && 'animate-highlight-fade',
                  )}
                  onClick={() => handleFindingClick(finding)}
                >
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium line-clamp-1">
                        {finding.title ?? 'Untitled'}
                      </span>
                      {finding.file && (
                        <span className="text-xs text-muted-foreground line-clamp-1 font-mono">
                          {finding.file}
                          {finding.line ? `:${finding.line}` : ''}
                        </span>
                      )}
                      {!finding.file && !isCodeSecurityView && finding.asset_key && (
                        <span className="text-xs text-muted-foreground line-clamp-1 font-mono">
                          {finding.asset_key}
                        </span>
                      )}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {isCodeSecurityView && finding.rule_id && (
                          <Badge
                            variant="outline"
                            className="h-4 px-1 text-[10px] font-mono font-normal"
                          >
                            {finding.rule_id}
                          </Badge>
                        )}
                        {finding.check_name && (
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {finding.check_name}
                          </span>
                        )}
                        {finding.compliance &&
                          finding.compliance.map((fw) => (
                            <Badge
                              key={fw}
                              variant="outline"
                              className="h-4 px-1 text-[10px] font-normal"
                            >
                              {fw}
                            </Badge>
                          ))}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={finding.severity} />
                  </TableCell>
                  {!isCodeSecurityView && (
                    <TableCell>
                      <StatusBadge status={finding.status} />
                    </TableCell>
                  )}
                  {isCodeSecurityView ? (
                    <>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {finding.shipsec?.trigger_source ? (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <GitBranch className="h-3.5 w-3.5 flex-shrink-0" />
                            <span
                              className="line-clamp-1 font-mono text-xs"
                              title={finding.shipsec.trigger_source}
                            >
                              {finding.shipsec.trigger_source.replace(/#.*$|:.*$/, '')}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          {SCANNER_LOGO[finding.scanner]?.emoji ? (
                            <span
                              className="w-4 h-4 flex items-center justify-center text-sm"
                              role="img"
                              aria-label={SCANNER_LOGO[finding.scanner].alt}
                            >
                              {SCANNER_LOGO[finding.scanner].emoji}
                            </span>
                          ) : SCANNER_LOGO[finding.scanner]?.src ? (
                            <img
                              src={SCANNER_LOGO[finding.scanner].src}
                              alt={SCANNER_LOGO[finding.scanner].alt}
                              className="w-4 h-4 rounded object-contain"
                            />
                          ) : null}
                          {finding.scanner}
                        </div>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                        {finding.service_name ?? '--'}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {finding.region ?? '--'}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm">
                        {finding.account_id ? (
                          <div>
                            <div className="text-foreground truncate max-w-[120px]">
                              {accountNameMap.get(finding.account_id) ??
                                formatAccountId(finding.account_id)}
                            </div>
                            {accountNameMap.has(finding.account_id) && (
                              <div className="text-xs text-muted-foreground font-mono">
                                {formatAccountId(finding.account_id)}
                              </div>
                            )}
                          </div>
                        ) : (
                          '--'
                        )}
                      </TableCell>
                    </>
                  )}
                  <TableCell className="hidden xl:table-cell text-sm text-muted-foreground whitespace-nowrap">
                    {findingLifecycles[finding.finding_hash] ? (
                      formatTimestamp(findingLifecycles[finding.finding_hash].firstSeen)
                    ) : findingLifecyclesLoading ? (
                      <Skeleton className="h-4 w-16" />
                    ) : (
                      '--'
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatTimestamp(finding['@timestamp'])}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {showFrom}-{showTo} of {total}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={filters.page <= 1}
                onClick={() => setFilters({ page: filters.page - 1 })}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (filters.page <= 3) {
                  pageNum = i + 1;
                } else if (filters.page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = filters.page - 2 + i;
                }
                return (
                  <Button
                    key={pageNum}
                    variant={pageNum === filters.page ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setFilters({ page: pageNum })}
                  >
                    {pageNum}
                  </Button>
                );
              })}
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={filters.page >= totalPages}
                onClick={() => setFilters({ page: filters.page + 1 })}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Finding Detail Sheet */}
      <FindingDetailSheet
        finding={selectedFinding}
        open={selectedFinding !== null}
        onOpenChange={handleSheetClose}
        lifecycle={selectedFindingLifecycle}
        lifecycleLoading={selectedFindingLifecycleLoading}
        accountNameMap={accountNameMap}
      />
    </div>
  );
}
