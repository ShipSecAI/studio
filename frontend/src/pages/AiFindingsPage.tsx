import React, { useState, useMemo } from 'react';
import {
  Globe,
  AlertOctagon,
  Server,
  Key,
  Target,
  Unlock,
  Database,
  Lock,
  Cpu,
  ShieldAlert,
  Filter,
  Terminal,
  ArrowRight,
  Network,
  Crosshair,
  Map,
  Zap,
  Clock,
  HardDrive,
  Shield,
  User,
  Ticket,
  CheckCircle2,
  ChevronDown,
  Activity,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// =============================================================================
// TYPES & MOCK DATA
// =============================================================================

type Status = 'ACTIVE' | 'INVESTIGATING' | 'MITIGATED';
type ActionTier = 'FIX_NOW' | 'FIX_SOON' | 'BACKLOG';

interface PathNode {
  type: string;
  label: string;
  icon: string;
}

interface Telemetry {
  timestamp: string;
  source: string;
  event: string;
}

interface RawFinding {
  id: string;
  source: string;
  rule: string;
  asset: string;
  severity: string;
  evidence: string;
}

interface ThreatCluster {
  id: string;
  title: string;
  score: number;
  status: Status;
  actionTier: ActionTier;
  owner: string;
  team: string;
  complianceVectors: string[];
  sourceChain: string[];
  ticketStatus: string;
  detectedAt: string;
  nodes: string[];
  synthesis: string;
  path: PathNode[];
  telemetry: Telemetry[];
  impactedAssets: string[];
  validation: string[];
  remediation: string[];
  rawFindings: RawFinding[];
}

const ICONS: Record<string, React.ElementType> = {
  Globe,
  AlertOctagon,
  Server,
  Key,
  Target,
  Unlock,
  Database,
  Lock,
  Cpu,
  Map,
  HardDrive,
  Shield,
};

const EXEC_BRIEF = {
  summary:
    'Correlation engine has identified 4 critical attack paths crossing network, identity, and application boundaries. High concentration of risk detected in production payment services due to leaked credentials and public exposure. Immediate remediation of CTX-8892 is recommended.',
  correlatedFindings: 142,
  assetsAtRisk: 18,
  meanTimeToVerify: '4.2m',
  confidence: '98.5%',
  coverage: '100%',
};

const COMPLIANCE_CONTROLS = [
  {
    key: 'SOC2',
    framework: 'SOC 2',
    controls: 'CC6.1, CC6.6, CC7.2',
    impact:
      'Logical access and vulnerability response evidence is incomplete while admin role exposure remains open.',
    coverage: '91%',
  },
  {
    key: 'ISO27001',
    framework: 'ISO 27001',
    controls: 'A.8.8, A.8.16, A.5.15',
    impact:
      'Asset inventory, monitoring, and privileged access controls are directly implicated by active attack paths.',
    coverage: '87%',
  },
  {
    key: 'PCI-DSS',
    framework: 'PCI DSS',
    controls: '6.3.3, 7.2.1, 11.3.1',
    impact:
      'Internet-facing code and cloud findings create a plausible route into cardholder-adjacent systems.',
    coverage: '82%',
  },
  {
    key: 'HIPAA',
    framework: 'HIPAA',
    controls: '164.312(a), 164.312(c)',
    impact:
      'Credential exposure and public data paths weaken access control and integrity safeguards for PHI systems.',
    coverage: '78%',
  },
  {
    key: 'GDPR',
    framework: 'GDPR',
    controls: 'Art. 25, Art. 32',
    impact:
      'PII-bearing assets have exposure chains that would require security-of-processing evidence in audit review.',
    coverage: '80%',
  },
];

const COMPLIANCE_READINESS = [
  {
    key: 'SOC2',
    framework: 'SOC 2',
    posture: 'Not audit-ready',
    status: 'BLOCKED',
    evidenceReady: '91%',
    brokenControls: 3,
    blockers: ['CTX-8892', 'CTX-6190'],
    customerAnswer:
      'Blocked until admin escalation is closed and vulnerability-response evidence is attached.',
  },
  {
    key: 'ISO27001',
    framework: 'ISO 27001',
    posture: 'Not audit-ready',
    status: 'BLOCKED',
    evidenceReady: '87%',
    brokenControls: 3,
    blockers: ['CTX-8892', 'CTX-6190'],
    customerAnswer:
      'Blocked until cloud inventory, monitoring, and privileged-access evidence reconcile.',
  },
  {
    key: 'PCI-DSS',
    framework: 'PCI DSS',
    posture: 'Material risk',
    status: 'AT RISK',
    evidenceReady: '82%',
    brokenControls: 3,
    blockers: ['CTX-8892', 'CTX-5022'],
    customerAnswer: 'At risk until payment-adjacent isolation and access review are verified.',
  },
  {
    key: 'HIPAA',
    framework: 'HIPAA',
    posture: 'Material risk',
    status: 'AT RISK',
    evidenceReady: '78%',
    brokenControls: 2,
    blockers: ['CTX-7431'],
    customerAnswer:
      'At risk until exposed backup credentials are rotated and PHI controls are evidenced.',
  },
  {
    key: 'GDPR',
    framework: 'GDPR',
    posture: 'Needs evidence',
    status: 'WATCH',
    evidenceReady: '80%',
    brokenControls: 2,
    blockers: ['CTX-7431'],
    customerAnswer: 'Watch until security-of-processing evidence covers the exposed backup path.',
  },
];

const COVERAGE_SIGNALS = [
  {
    label: 'Prowler cloud run',
    value: '12m fresh',
    detail: '18 AWS accounts, 100% prod OU coverage',
  },
  {
    label: 'AI code review',
    value: '26m fresh',
    detail: '64 repos scanned; 9 high-risk PR facts linked',
  },
  { label: 'ASM sweep', value: '8m fresh', detail: '2,418 endpoints, 91% verified reachability' },
  {
    label: 'Architecture facts',
    value: '1h fresh',
    detail: 'Service map, data stores, owners, deploy edges',
  },
  {
    label: 'Blind spots',
    value: '3 open',
    detail: 'One Azure tenant, two partner APIs missing credentials',
  },
];

const AGENT_ACTIONS = [
  'Explain to CTO',
  'Create Jira',
  'Generate PR',
  'Verify Fix',
  'Show Audit Evidence',
];

const MOCK_CLUSTERS: ThreatCluster[] = [
  {
    id: 'CTX-8892',
    title: 'Public EC2 to IAM Admin Escalation',
    score: 98,
    status: 'ACTIVE',
    actionTier: 'FIX_NOW',
    owner: 'j.doe',
    team: 'Platform Eng',
    complianceVectors: ['SOC2', 'ISO27001', 'PCI-DSS'],
    sourceChain: ['ASM', 'CSPM', 'SAST'],
    ticketStatus: 'SEC-402 (Open)',
    detectedAt: '2026-04-27T08:12:43Z',
    nodes: ['i-0abcd1234', 'role/app-admin', 'vpc-main'],
    synthesis:
      'Correlation engine identified a continuous path from external internet to full infrastructure compromise. An internet-exposed EC2 instance (i-0abcd1234) running a vulnerable service (CVE-2024-38077) has been assigned an IAM role (app-admin) with AdministratorAccess. Successful RCE yields immediate AWS environment control.',
    path: [
      { type: 'ENTRY', label: '0.0.0.0/0 (Port 443)', icon: 'Globe' },
      { type: 'VULN', label: 'CVE-2024-38077', icon: 'AlertOctagon' },
      { type: 'ASSET', label: 'i-0abcd1234', icon: 'Server' },
      { type: 'ESCALATION', label: 'role/app-admin', icon: 'Key' },
      { type: 'TARGET', label: 'Account Control', icon: 'Target' },
    ],
    telemetry: [
      {
        timestamp: '08:12:43.001',
        source: 'SAST',
        event: 'Discovered hardcoded AWS Key in public terraform/prod.tf',
      },
      {
        timestamp: '08:12:43.045',
        source: 'CSPM',
        event: 'Matched AWS Key to IAM user with AdministratorAccess',
      },
      {
        timestamp: '08:12:44.112',
        source: 'ASM',
        event: 'Confirmed EC2 instance reachable on 0.0.0.0/0 via Port 443',
      },
      {
        timestamp: '08:12:44.890',
        source: 'ENGINE',
        event: 'Correlated graph synthesized. Assigned CTX-8892',
      },
    ],
    impactedAssets: ['prod-web/i-0abcd1234', 'iam/role/app-admin', 'aws-account/prod', 'vpc-main'],
    validation: [
      'Code secret maps to an active AWS principal observed in Prowler IAM output.',
      'ASM reachability confirms the vulnerable host is internet-routable now, not only in IaC.',
      'Facts graph links the instance profile to AdministratorAccess and production account scope.',
    ],
    remediation: [
      'Rotate exposed key and disable the IAM user session immediately.',
      'Detach AdministratorAccess from app-admin and replace with scoped read/write policies.',
      'Patch or isolate i-0abcd1234, then rerun Prowler and ASM verification.',
    ],
    rawFindings: [
      {
        id: 'FND-1001',
        source: 'AI code review',
        rule: 'Hardcoded AWS access key',
        asset: 'terraform/prod.tf:18',
        severity: 'critical',
        evidence: 'Key fingerprint AKIA... matched active IAM user',
      },
      {
        id: 'FND-1002',
        source: 'Prowler IAM',
        rule: 'AdministratorAccess attached',
        asset: 'role/app-admin',
        severity: 'critical',
        evidence: 'Policy arn:aws:iam::aws:policy/AdministratorAccess',
      },
      {
        id: 'FND-1003',
        source: 'ASM',
        rule: 'Internet exposed service',
        asset: '54.12.33.9:443',
        severity: 'high',
        evidence: 'TLS service verified from external vantage point',
      },
    ],
  },
  {
    id: 'CTX-7431',
    title: 'Leaked DB Credentials in Open S3 Bucket',
    score: 85,
    status: 'INVESTIGATING',
    actionTier: 'FIX_NOW',
    owner: 'a.smith',
    team: 'Data Eng',
    complianceVectors: ['HIPAA', 'GDPR'],
    sourceChain: ['CSPM', 'DLP', 'ENGINE'],
    ticketStatus: 'SEC-405 (In Progress)',
    detectedAt: '2026-04-27T07:44:11Z',
    nodes: ['s3://prod-backups', 'rds/main-db', 'github.com/acme/infra'],
    synthesis:
      'A publicly readable S3 bucket (prod-backups) contains a .env file with plaintext credentials to the production RDS database. While the database is within a private subnet, any internal SSRF or compromised container would allow immediate data exfiltration.',
    path: [
      { type: 'ENTRY', label: 's3://prod-backups', icon: 'HardDrive' },
      { type: 'LEAK', label: '.env exposed', icon: 'Unlock' },
      { type: 'ASSET', label: 'rds/main-db', icon: 'Database' },
      { type: 'TARGET', label: 'PII Exfiltration', icon: 'Target' },
    ],
    telemetry: [
      {
        timestamp: '07:44:10.112',
        source: 'CSPM',
        event: 'S3 bucket prod-backups ACL set to public-read',
      },
      {
        timestamp: '07:44:10.550',
        source: 'DLP',
        event: 'Identified .env file in s3://prod-backups/archive/',
      },
      {
        timestamp: '07:44:10.899',
        source: 'ENGINE',
        event: 'Credentials match active RDS instance main-db',
      },
      {
        timestamp: '07:44:11.200',
        source: 'ENGINE',
        event: 'Correlated graph synthesized. Assigned CTX-7431',
      },
    ],
    impactedAssets: [
      's3://prod-backups',
      'rds/main-db',
      'backup/archive/.env',
      'customer-data schema',
    ],
    validation: [
      'Object inventory confirms the public bucket contains a plaintext .env backup.',
      'Credential fingerprint matches a live database login in the facts graph.',
      'RDS classification marks the target as PII-bearing, lifting this from cloud hygiene to data breach risk.',
    ],
    remediation: [
      'Block public S3 access and rotate the database credential pair.',
      'Invalidate backups containing plaintext secrets and replace with KMS-encrypted artifacts.',
      'Attach DLP guardrail checks to the backup pipeline before the next scheduled export.',
    ],
    rawFindings: [
      {
        id: 'FND-2101',
        source: 'Prowler S3',
        rule: 'Bucket allows public read',
        asset: 'prod-backups',
        severity: 'critical',
        evidence: 'PublicAccessBlock disabled; ACL public-read',
      },
      {
        id: 'FND-2102',
        source: 'DLP',
        rule: 'Database secret in object',
        asset: 'archive/.env',
        severity: 'critical',
        evidence: 'POSTGRES_PASSWORD pattern verified',
      },
      {
        id: 'FND-2103',
        source: 'Facts',
        rule: 'Credential targets PII system',
        asset: 'rds/main-db',
        severity: 'high',
        evidence: 'Data catalog marks users, payments, claims tables',
      },
    ],
  },
  {
    id: 'CTX-6190',
    title: 'Container Escape via Privileged DaemonSet',
    score: 91,
    status: 'ACTIVE',
    actionTier: 'FIX_SOON',
    owner: 'k.lee',
    team: 'Infra',
    complianceVectors: ['SOC2', 'ISO27001'],
    sourceChain: ['KSPM', 'SCA'],
    ticketStatus: 'None',
    detectedAt: '2026-04-27T06:22:05Z',
    nodes: ['k8s/kube-system', 'pod/fluentd', 'node/ip-10-4-2-1'],
    synthesis:
      'A DaemonSet deployed in kube-system is running with privileged: true and hostPID: true. A vulnerability in the fluentd container image (CVE-2023-4122) allows arbitrary code execution. Attacker can escape the container to compromise the underlying Kubernetes node.',
    path: [
      { type: 'ENTRY', label: 'CVE-2023-4122', icon: 'AlertOctagon' },
      { type: 'ASSET', label: 'pod/fluentd', icon: 'Cpu' },
      { type: 'ESCALATION', label: 'Privileged Escape', icon: 'Lock' },
      { type: 'TARGET', label: 'K8s Node Control', icon: 'Target' },
    ],
    telemetry: [
      {
        timestamp: '06:22:04.101',
        source: 'SCA',
        event: 'Detected CVE-2023-4122 in fluentd:v1.14 image',
      },
      {
        timestamp: '06:22:04.450',
        source: 'KSPM',
        event: 'Pod fluentd-m9k2 running as privileged with hostPID',
      },
      {
        timestamp: '06:22:05.011',
        source: 'ENGINE',
        event: 'Correlated graph synthesized. Assigned CTX-6190',
      },
    ],
    impactedAssets: ['k8s/kube-system', 'pod/fluentd', 'node/ip-10-4-2-1', 'cluster/prod-eks'],
    validation: [
      'Image vulnerability is reachable inside a privileged DaemonSet.',
      'Kubernetes posture confirms hostPID and hostPath access on every node.',
      'Facts graph maps the compromised node to production ingress and secrets mounts.',
    ],
    remediation: [
      'Roll the DaemonSet to a patched image and remove privileged and hostPID settings.',
      'Drain and recycle exposed nodes after workload migration.',
      'Add admission policy to reject privileged observability workloads outside break-glass.',
    ],
    rawFindings: [
      {
        id: 'FND-3101',
        source: 'SCA',
        rule: 'Critical image CVE',
        asset: 'fluentd:v1.14',
        severity: 'critical',
        evidence: 'CVE-2023-4122 reachable package detected',
      },
      {
        id: 'FND-3102',
        source: 'KSPM',
        rule: 'Privileged pod',
        asset: 'fluentd-m9k2',
        severity: 'high',
        evidence: 'privileged=true, hostPID=true',
      },
      {
        id: 'FND-3103',
        source: 'Facts',
        rule: 'Node controls ingress',
        asset: 'ip-10-4-2-1',
        severity: 'medium',
        evidence: 'Node hosts ingress-adjacent workloads',
      },
    ],
  },
  {
    id: 'CTX-5022',
    title: 'Unauthenticated API Endpoint linked to PII',
    score: 74,
    status: 'MITIGATED',
    actionTier: 'BACKLOG',
    owner: 'm.chen',
    team: 'Product',
    complianceVectors: ['PCI-DSS'],
    sourceChain: ['SAST', 'DAST', 'ASM'],
    ticketStatus: 'SEC-399 (Closed)',
    detectedAt: '2026-04-26T22:15:30Z',
    nodes: ['api/users', 'rds/user-data'],
    synthesis:
      'An API endpoint (/api/v2/users/export) was deployed without authentication middleware. This endpoint queries the user-data RDS instance directly. Unauthenticated attackers can download bulk PII data.',
    path: [
      { type: 'ENTRY', label: 'Unauth API', icon: 'Globe' },
      { type: 'ASSET', label: 'svc/user-export', icon: 'Server' },
      { type: 'TARGET', label: 'rds/user-data', icon: 'Database' },
    ],
    telemetry: [
      {
        timestamp: '22:15:29.055',
        source: 'SAST',
        event: 'Missing auth middleware on /api/v2/users/export',
      },
      {
        timestamp: '22:15:29.300',
        source: 'ASM',
        event: 'Endpoint returns 200 OK without Authorization header',
      },
      {
        timestamp: '22:15:30.120',
        source: 'ENGINE',
        event: 'Correlated graph synthesized. Assigned CTX-5022',
      },
      {
        timestamp: '23:45:00.000',
        source: 'WAF',
        event: 'Virtual patch applied. Status MITIGATED',
      },
    ],
    impactedAssets: ['api/users-export', 'rds/user-data', 'waf/prod-edge', 'repo/core-api'],
    validation: [
      'Code review found missing auth guard and ASM reproduced unauthenticated access.',
      'Architecture facts show the handler reads directly from the user-data database.',
      'WAF event confirms temporary mitigation; code owner still needs a durable fix.',
    ],
    remediation: [
      'Land auth middleware patch and add integration test for unauthenticated export.',
      'Replace temporary WAF block with route-level policy and scoped export permissions.',
      'Attach audit evidence to SEC-399 after deploy verification completes.',
    ],
    rawFindings: [
      {
        id: 'FND-4101',
        source: 'AI code review',
        rule: 'Missing authentication guard',
        asset: 'users/export.ts',
        severity: 'high',
        evidence: 'Route handler bypasses requireAuth middleware',
      },
      {
        id: 'FND-4102',
        source: 'ASM',
        rule: 'Unauthenticated 200 response',
        asset: '/api/v2/users/export',
        severity: 'high',
        evidence: 'External probe retrieved schema metadata',
      },
      {
        id: 'FND-4103',
        source: 'WAF',
        rule: 'Virtual patch applied',
        asset: 'prod-edge',
        severity: 'info',
        evidence: 'Rule 8841 blocks export route pending deploy',
      },
    ],
  },
];

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function StatusBadge({ status }: { status: Status }) {
  const styles = {
    ACTIVE: 'bg-rose-50 text-rose-700 border-rose-200',
    INVESTIGATING: 'bg-amber-50 text-amber-700 border-amber-200',
    MITIGATED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };

  return (
    <span
      className={cn(
        'font-mono text-[9px] px-1.5 py-0.5 border font-bold tracking-widest rounded-sm',
        styles[status],
      )}
    >
      {status}
    </span>
  );
}

function ActionTierBadge({ tier }: { tier: ActionTier }) {
  const styles = {
    FIX_NOW: 'bg-red-50 text-red-700 border-red-200',
    FIX_SOON: 'bg-amber-50 text-amber-700 border-amber-200',
    BACKLOG: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  };

  const icons = {
    FIX_NOW: <AlertTriangle className="w-3 h-3 mr-1" />,
    FIX_SOON: <Clock className="w-3 h-3 mr-1" />,
    BACKLOG: <Activity className="w-3 h-3 mr-1" />,
  };

  return (
    <span
      className={cn(
        'flex items-center font-mono text-[9px] px-1.5 py-0.5 border rounded-sm font-bold tracking-widest',
        styles[tier],
      )}
    >
      {icons[tier]} {tier.replace('_', ' ')}
    </span>
  );
}

function AttackNode({ node, index, total }: { node: PathNode; index: number; total: number }) {
  const Icon = ICONS[node.icon] || AlertOctagon;

  return (
    <div className="flex items-center">
      <div className="flex flex-col items-center w-28 shrink-0 group">
        <div className="w-12 h-12 bg-white border border-zinc-200 rounded-md flex items-center justify-center z-10 shadow-[0_8px_22px_rgba(15,23,42,0.06)] group-hover:border-blue-300 transition-colors relative">
          <Icon className="w-5 h-5 text-zinc-800" />
          {/* Node Sequence Number */}
          <div className="absolute -top-2 -right-2 w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center font-mono text-[9px] font-bold border border-white shadow-sm">
            {index + 1}
          </div>
        </div>
        <span className="mt-3 text-[10px] font-mono font-bold text-zinc-900 tracking-widest uppercase text-center h-4 leading-tight">
          {node.type}
        </span>
        <span className="mt-1 text-[10px] text-zinc-500 text-center leading-tight px-1 font-mono">
          {node.label}
        </span>
      </div>
      {index < total - 1 && (
        <div className="flex-1 -mt-10 mx-2 flex items-center min-w-[32px]">
          <div className="h-[1px] bg-zinc-300 w-full relative">
            <ArrowRight className="w-3 h-3 text-zinc-400 absolute -right-1 top-1/2 -translate-y-1/2 bg-white" />
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MAIN PAGE
// =============================================================================

export function AiFindingsPage() {
  const [activeId, setActiveId] = useState<string>(MOCK_CLUSTERS[0].id);
  const [tierFilter, setTierFilter] = useState<ActionTier | 'ALL'>('ALL');
  const [vectorFilter, setVectorFilter] = useState<string>('ALL');

  const filteredClusters = useMemo(() => {
    return MOCK_CLUSTERS.filter((c) => {
      const matchTier = tierFilter === 'ALL' || c.actionTier === tierFilter;
      const matchVector = vectorFilter === 'ALL' || c.complianceVectors.includes(vectorFilter);
      return matchTier && matchVector;
    });
  }, [tierFilter, vectorFilter]);

  // Ensure activeId is valid after filtering, otherwise pick the first
  const activeCluster = filteredClusters.find((c) => c.id === activeId) || filteredClusters[0];

  const allVectors = Array.from(new Set(MOCK_CLUSTERS.flatMap((c) => c.complianceVectors)));

  return (
    <div className="flex-1 flex flex-col h-full bg-[#F4F6F8] overflow-hidden text-zinc-950 font-sans antialiased selection:bg-blue-900 selection:text-white">
      {/* ── COMMAND HEADER & EXECUTIVE BRIEF ── */}
      <div className="shrink-0 border-b border-zinc-200 bg-[#F4F6F8] px-4 pt-4 pb-3">
        <div className="mx-auto flex w-full max-w-[1640px] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
          {/* Top minimal strip */}
          <div className="h-11 border-b border-zinc-100 flex items-center justify-between px-5">
            <div className="flex items-center gap-4">
              <ShieldAlert className="w-4 h-4 text-blue-600" />
              <span className="font-mono text-[11px] font-bold text-zinc-700 tracking-[0.2em] uppercase">
                ShipSec // Correlation Engine
              </span>
            </div>
            <div className="flex items-center gap-6 text-[10px] font-mono text-zinc-400 tracking-widest max-sm:hidden">
              <div className="flex items-center gap-2">
                <span>STATUS</span>
                <span className="text-zinc-800 font-bold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                  ONLINE
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span>LAST SCAN</span>
                <span className="text-zinc-700 font-bold">JUST NOW</span>
              </div>
            </div>
          </div>

          {/* Executive Strip */}
          <div className="flex items-stretch px-5 py-4 gap-5 max-xl:flex-col">
            <div className="flex-1 pr-6 border-r border-zinc-100 max-xl:border-r-0 max-xl:pr-0">
              <div className="flex items-center gap-2 mb-2">
                <Terminal className="w-3.5 h-3.5 text-zinc-500" />
                <h2 className="font-mono text-[10px] font-bold text-zinc-500 tracking-widest uppercase">
                  Executive Risk Brief
                </h2>
              </div>
              <p className="max-w-4xl text-[13px] text-zinc-700 leading-relaxed font-medium tracking-tight">
                {EXEC_BRIEF.summary}
              </p>
            </div>

            <div className="grid grid-cols-4 gap-3 items-stretch shrink-0 max-xl:grid-cols-4 max-md:grid-cols-2">
              <div className="flex min-w-[142px] flex-col gap-1 rounded-md border border-zinc-100 bg-zinc-50 px-4 py-3">
                <span className="font-mono text-[9px] text-zinc-500 tracking-widest uppercase">
                  Correlated Findings
                </span>
                <span className="font-mono text-2xl text-zinc-950 font-bold leading-none tabular-nums">
                  {EXEC_BRIEF.correlatedFindings}
                </span>
              </div>
              <div className="flex min-w-[142px] flex-col gap-1 rounded-md border border-rose-100 bg-rose-50/70 px-4 py-3">
                <span className="font-mono text-[9px] text-zinc-500 tracking-widest uppercase">
                  Assets at Risk
                </span>
                <span className="font-mono text-2xl text-rose-600 font-bold leading-none tabular-nums">
                  {EXEC_BRIEF.assetsAtRisk}
                </span>
              </div>
              <div className="flex min-w-[142px] flex-col gap-1 rounded-md border border-zinc-100 bg-zinc-50 px-4 py-3">
                <span className="font-mono text-[9px] text-zinc-500 tracking-widest uppercase">
                  Mean Time To Verify
                </span>
                <span className="font-mono text-2xl text-zinc-950 font-bold leading-none tabular-nums">
                  {EXEC_BRIEF.meanTimeToVerify}
                </span>
              </div>
              <div className="flex min-w-[170px] flex-col gap-1 rounded-md border border-emerald-100 bg-emerald-50/70 px-4 py-3">
                <span className="font-mono text-[9px] text-zinc-500 tracking-widest uppercase">
                  Confidence / Coverage
                </span>
                <span className="font-mono text-2xl text-emerald-600 font-bold leading-none tabular-nums">
                  {EXEC_BRIEF.confidence}{' '}
                  <span className="text-zinc-400 text-lg">/ {EXEC_BRIEF.coverage}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── MAIN WORKSPACE ── */}
      <div className="mx-auto flex w-full max-w-[1640px] flex-1 min-h-0 p-4 gap-4 overflow-hidden max-lg:flex-col">
        {/* ── LEFT PANEL: CLUSTER LIST ── */}
        <div className="w-[380px] 2xl:w-[420px] bg-white border border-zinc-200 rounded-lg overflow-hidden flex flex-col shadow-[0_14px_40px_rgba(15,23,42,0.06)] shrink-0 relative z-10 max-lg:w-full max-lg:max-h-[320px]">
          <div className="h-12 border-b border-zinc-200 bg-white flex items-center justify-between px-4 shrink-0">
            <div className="flex items-center gap-2">
              <Network className="w-4 h-4 text-zinc-700" />
              <span className="font-mono text-[11px] font-bold text-zinc-900 tracking-widest uppercase">
                Threat Queue ({filteredClusters.length})
              </span>
            </div>
            <Filter className="w-3.5 h-3.5 text-zinc-400" />
          </div>

          {/* Filter Controls */}
          <div className="px-4 py-3 border-b border-zinc-200 bg-white space-y-3 shrink-0">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <select
                  value={tierFilter}
                  onChange={(e) => setTierFilter(e.target.value as ActionTier | 'ALL')}
                  className="w-full appearance-none bg-zinc-50 border border-zinc-200 text-zinc-700 text-[10px] font-mono font-bold tracking-widest uppercase rounded-md px-3 py-2 pr-8 outline-none focus:border-blue-300 focus:bg-white transition-colors cursor-pointer"
                >
                  <option value="ALL">ACTION TIER: ALL</option>
                  <option value="FIX_NOW">TIER: FIX NOW</option>
                  <option value="FIX_SOON">TIER: FIX SOON</option>
                  <option value="BACKLOG">TIER: BACKLOG</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 pointer-events-none" />
              </div>
              <div className="flex-1 relative">
                <select
                  value={vectorFilter}
                  onChange={(e) => setVectorFilter(e.target.value)}
                  className="w-full appearance-none bg-zinc-50 border border-zinc-200 text-zinc-700 text-[10px] font-mono font-bold tracking-widest uppercase rounded-md px-3 py-2 pr-8 outline-none focus:border-blue-300 focus:bg-white transition-colors cursor-pointer"
                >
                  <option value="ALL">VECTOR: ALL</option>
                  {allVectors.map((v) => (
                    <option key={v} value={v}>
                      VECTOR: {v}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-[#FAFAFA]">
            {filteredClusters.length === 0 ? (
              <div className="p-8 text-center flex flex-col items-center justify-center h-full text-zinc-500">
                <Shield className="w-8 h-8 mb-3 opacity-20" />
                <span className="font-mono text-[11px] tracking-widest uppercase">
                  No threats match filters
                </span>
              </div>
            ) : (
              filteredClusters.map((cluster) => {
                const isActive = cluster.id === activeCluster?.id;
                return (
                  <div
                    key={cluster.id}
                    onClick={() => setActiveId(cluster.id)}
                    className={cn(
                      'group flex flex-col p-4 border-b border-zinc-200 cursor-pointer transition-all relative',
                      isActive
                        ? 'bg-white shadow-[inset_0_0_0_1px_rgba(37,99,235,0.08)]'
                        : 'bg-[#FAFAFA] hover:bg-white',
                      cluster.status === 'MITIGATED' && 'opacity-60',
                    )}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-blue-600" />
                    )}

                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-zinc-800 font-bold tracking-widest">
                          {cluster.id}
                        </span>
                        <ActionTierBadge tier={cluster.actionTier} />
                      </div>
                      <StatusBadge status={cluster.status} />
                    </div>

                    <h3 className="text-[13px] font-semibold text-zinc-900 leading-snug mb-3">
                      {cluster.title}
                    </h3>

                    {/* Rich Metadata Section */}
                    <div className="space-y-2.5 mb-1">
                      {/* Source Chain */}
                      <div className="flex items-center flex-wrap gap-1">
                        {cluster.sourceChain.map((src, i) => (
                          <React.Fragment key={i}>
                            <span className="text-[9px] font-mono bg-zinc-100 border border-zinc-200 text-zinc-600 px-1.5 py-[1px] rounded-sm font-bold tracking-wider">
                              {src}
                            </span>
                            {i < cluster.sourceChain.length - 1 && (
                              <ArrowRight className="w-2.5 h-2.5 text-zinc-400" />
                            )}
                          </React.Fragment>
                        ))}
                      </div>

                      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
                        <span className="flex items-center gap-1.5">
                          <User className="w-3 h-3" /> {cluster.owner} ({cluster.team})
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Ticket className="w-3 h-3" /> {cluster.ticketStatus}
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-mono text-zinc-400 uppercase tracking-widest mr-1">
                            VECTORS:
                          </span>
                          {cluster.complianceVectors.map((v) => (
                            <span
                              key={v}
                              className="border border-zinc-200 bg-white px-1.5 text-[9px] font-mono font-bold text-zinc-500 rounded-sm"
                            >
                              {v}
                            </span>
                          ))}
                        </div>
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-[8px] text-zinc-400 font-mono tracking-widest">
                            RISK
                          </span>
                          <span className="font-mono text-sm font-bold text-zinc-900 leading-none">
                            {cluster.score}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL: DETAILS & TELEMETRY ── */}
        <div className="flex-1 bg-white border border-zinc-200 rounded-lg shadow-[0_14px_40px_rgba(15,23,42,0.06)] flex flex-col overflow-hidden relative min-w-0 z-0">
          {activeCluster ? (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              {/* DETAILS HEADER */}
              <div className="px-7 py-5 border-b border-zinc-200 bg-white flex justify-between items-start shrink-0 gap-6 max-md:flex-col">
                <div className="max-w-[72ch]">
                  <div className="flex items-center gap-3 mb-3">
                    <StatusBadge status={activeCluster.status} />
                    <span className="font-mono text-[11px] font-bold text-zinc-500 tracking-widest">
                      {activeCluster.id}
                    </span>
                    <span className="text-zinc-300">|</span>
                    <span className="font-mono text-[10px] text-zinc-400 tracking-widest flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      DETECTED: {activeCluster.detectedAt}
                    </span>
                  </div>
                  <h1 className="text-xl font-bold text-zinc-950 tracking-tight leading-tight">
                    {activeCluster.title}
                  </h1>
                </div>
                <div className="text-right flex flex-col items-end">
                  <div className="text-[10px] font-mono text-zinc-500 mb-1.5 tracking-widest uppercase">
                    Aggregate Risk
                  </div>
                  <div className="text-5xl font-mono font-bold text-rose-600 tracking-tighter leading-none tabular-nums">
                    {activeCluster.score}
                  </div>
                </div>
              </div>

              {/* SCROLLABLE CONTENT */}
              <div className="flex-1 overflow-y-auto bg-[#FAFAFA]">
                {/* COMPLIANCE READINESS */}
                <div className="border-b border-zinc-200 bg-white p-7">
                  <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[0.72fr_1.28fr]">
                    <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-5 shadow-[0_10px_28px_rgba(225,29,72,0.05)]">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-rose-600" />
                          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-rose-700">
                            Compliance answer
                          </span>
                        </div>
                        <span className="rounded-sm border border-rose-200 bg-white px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-widest text-rose-700">
                          Not good yet
                        </span>
                      </div>

                      <h2 className="max-w-xl text-2xl font-semibold tracking-tight text-zinc-950">
                        Current findings block clean audit posture across security and compliance.
                      </h2>
                      <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-zinc-700">
                        ShipSec should answer the buyer-level question directly: which frameworks
                        are safe to attest, which are blocked, and what evidence will flip the
                        status back to green.
                      </p>

                      <div className="mt-5 grid grid-cols-3 gap-3">
                        <div className="rounded-md border border-white bg-white/80 p-3">
                          <div className="font-mono text-[9px] uppercase tracking-widest text-zinc-500">
                            Blocked frameworks
                          </div>
                          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-rose-600">
                            2
                          </div>
                        </div>
                        <div className="rounded-md border border-white bg-white/80 p-3">
                          <div className="font-mono text-[9px] uppercase tracking-widest text-zinc-500">
                            At risk
                          </div>
                          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-amber-600">
                            3
                          </div>
                        </div>
                        <div className="rounded-md border border-white bg-white/80 p-3">
                          <div className="font-mono text-[9px] uppercase tracking-widest text-zinc-500">
                            Evidence ready
                          </div>
                          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-950">
                            83%
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                      <div className="grid grid-cols-[112px_90px_minmax(0,1fr)_132px] items-center border-b border-zinc-200 bg-zinc-50 px-4 py-2 font-mono text-[9px] font-bold uppercase tracking-widest text-zinc-400 max-xl:hidden">
                        <span>Framework</span>
                        <span>Status</span>
                        <span>Company answer</span>
                        <span>Evidence / blockers</span>
                      </div>
                      {COMPLIANCE_READINESS.map((item) => {
                        const inScope = activeCluster.complianceVectors.includes(item.key);
                        const isBlocked = item.status === 'BLOCKED';
                        const isAtRisk = item.status === 'AT RISK';

                        return (
                          <div
                            key={item.framework}
                            className={cn(
                              'grid grid-cols-1 gap-3 border-b border-zinc-100 px-4 py-3 last:border-b-0 xl:grid-cols-[112px_90px_minmax(0,1fr)_132px] xl:items-center',
                              inScope ? 'bg-blue-50/35' : 'bg-white opacity-80',
                            )}
                          >
                            <div>
                              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-950">
                                {item.framework}
                              </div>
                              <div className="mt-1 text-[12px] font-semibold text-zinc-600">
                                {item.posture}
                              </div>
                            </div>
                            <div>
                              <span
                                className={cn(
                                  'inline-flex rounded-sm border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest',
                                  isBlocked && 'border-rose-200 bg-rose-50 text-rose-700',
                                  isAtRisk && 'border-amber-200 bg-amber-50 text-amber-700',
                                  !isBlocked &&
                                    !isAtRisk &&
                                    'border-zinc-200 bg-zinc-50 text-zinc-500',
                                )}
                              >
                                {item.status}
                              </span>
                            </div>
                            <p className="text-[12px] leading-relaxed text-zinc-600">
                              {item.customerAnswer}
                            </p>
                            <div>
                              <div className="font-mono text-[11px] font-bold text-zinc-950 tabular-nums">
                                {item.evidenceReady}
                                <span className="ml-2 text-[9px] font-medium uppercase tracking-widest text-zinc-400">
                                  {item.brokenControls} controls
                                </span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {item.blockers.map((blocker) => (
                                  <span
                                    key={blocker}
                                    className={cn(
                                      'rounded-sm border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest',
                                      blocker === activeCluster.id
                                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                                        : 'border-zinc-200 bg-zinc-50 text-zinc-500',
                                    )}
                                  >
                                    {blocker}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* AI SYNTHESIS (Terminal block) */}
                <div className="p-7 border-b border-zinc-200">
                  <div className="bg-white border border-zinc-200 border-l-blue-600 border-l-4 p-5 shadow-[0_10px_28px_rgba(15,23,42,0.05)] rounded-lg">
                    <div className="flex items-center gap-3 mb-4 border-b border-zinc-100 pb-4">
                      <Terminal className="w-4 h-4 text-blue-600" />
                      <span className="font-mono text-[10px] font-bold text-zinc-700 tracking-[0.2em] uppercase">
                        Engine Synthesis
                      </span>
                    </div>
                    <p className="text-[13px] text-zinc-700 leading-relaxed max-w-5xl">
                      {activeCluster.synthesis}
                    </p>
                    <div className="mt-6 flex flex-wrap gap-2">
                      {activeCluster.nodes.map((n) => (
                        <span
                          key={n}
                          className="px-2 py-1 bg-blue-50 border border-blue-100 text-blue-700 text-[10px] font-mono tracking-wider flex items-center gap-1.5 rounded-md"
                        >
                          <Crosshair className="w-3 h-3 text-blue-500" />
                          {n}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ATTACK PATH GRAPH */}
                <div className="p-7 border-b border-zinc-200 bg-white">
                  <div className="flex items-center gap-2 mb-8">
                    <Map className="w-4 h-4 text-zinc-900" />
                    <h3 className="font-mono text-[11px] font-bold text-zinc-900 uppercase tracking-[0.2em]">
                      Validated Attack Path
                    </h3>
                  </div>
                  <div className="flex items-start overflow-x-auto pb-4">
                    {activeCluster.path.map((node, i) => (
                      <AttackNode key={i} node={node} index={i} total={activeCluster.path.length} />
                    ))}
                  </div>
                </div>

                {/* CORRELATION PROOF */}
                <div className="grid grid-cols-1 2xl:grid-cols-3 border-b border-zinc-200 bg-white">
                  <div className="p-6 border-b 2xl:border-b-0 2xl:border-r border-zinc-200">
                    <div className="flex items-center gap-2 mb-4">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <h3 className="font-mono text-[10px] font-bold text-zinc-900 uppercase tracking-[0.2em]">
                        Why This Correlates
                      </h3>
                    </div>
                    <div className="space-y-3">
                      {activeCluster.validation.map((item, index) => (
                        <div
                          key={item}
                          className="flex gap-3 text-[12px] leading-relaxed text-zinc-700"
                        >
                          <span className="font-mono text-[10px] text-zinc-400 mt-0.5">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-6 border-b 2xl:border-b-0 2xl:border-r border-zinc-200 bg-[#FAFAFA]">
                    <div className="flex items-center gap-2 mb-4">
                      <Crosshair className="w-4 h-4 text-zinc-900" />
                      <h3 className="font-mono text-[10px] font-bold text-zinc-900 uppercase tracking-[0.2em]">
                        Impacted Assets
                      </h3>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {activeCluster.impactedAssets.map((asset) => (
                        <div
                          key={asset}
                          className="flex items-center justify-between border border-zinc-200 bg-white px-3 py-2"
                        >
                          <span className="font-mono text-[10px] text-zinc-700">{asset}</span>
                          <span className="font-mono text-[9px] text-zinc-400 tracking-widest">
                            IN SCOPE
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <ShieldAlert className="w-4 h-4 text-zinc-900" />
                      <h3 className="font-mono text-[10px] font-bold text-zinc-900 uppercase tracking-[0.2em]">
                        Remediation Runbook
                      </h3>
                    </div>
                    <div className="space-y-3">
                      {activeCluster.remediation.map((step, index) => (
                        <div
                          key={step}
                          className="flex gap-3 text-[12px] leading-relaxed text-zinc-700"
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 font-mono text-[9px] font-bold text-white">
                            {index + 1}
                          </span>
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* COMPLIANCE AND COVERAGE */}
                <div className="grid grid-cols-1 2xl:grid-cols-[1.25fr_0.75fr] border-b border-zinc-200">
                  <div className="p-8 bg-[#FAFAFA] border-b 2xl:border-b-0 2xl:border-r border-zinc-200">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-zinc-900" />
                        <h3 className="font-mono text-[11px] font-bold text-zinc-900 uppercase tracking-[0.2em]">
                          Compliance Blast Radius
                        </h3>
                      </div>
                      <span className="font-mono text-[10px] text-zinc-400 tracking-widest">
                        AUDITOR VIEW
                      </span>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      {COMPLIANCE_CONTROLS.map((control) => {
                        const implicated = activeCluster.complianceVectors.includes(control.key);
                        return (
                          <div
                            key={control.framework}
                            className={cn(
                              'border bg-white p-4 transition-colors rounded-md',
                              implicated
                                ? 'border-rose-200 bg-rose-50/30 shadow-[0_8px_22px_rgba(225,29,72,0.06)]'
                                : 'border-zinc-200 opacity-70',
                            )}
                          >
                            <div className="flex items-start justify-between gap-3 mb-3">
                              <div>
                                <div className="font-mono text-[10px] font-bold tracking-widest text-zinc-900 uppercase">
                                  {control.framework}
                                </div>
                                <div className="mt-1 font-mono text-[9px] text-zinc-500">
                                  {control.controls}
                                </div>
                              </div>
                              <span
                                className={cn(
                                  'font-mono text-[9px] px-1.5 py-0.5 border font-bold tracking-widest',
                                  implicated
                                    ? 'border-rose-200 bg-white text-rose-700'
                                    : 'border-zinc-200 bg-white text-zinc-400',
                                )}
                              >
                                {implicated ? 'BROKEN' : 'WATCH'}
                              </span>
                            </div>
                            <p className="text-[12px] leading-relaxed text-zinc-600">
                              {control.impact}
                            </p>
                            <div className="mt-4 flex items-center justify-between font-mono text-[10px]">
                              <span className="text-zinc-400 tracking-widest">
                                EVIDENCE COVERAGE
                              </span>
                              <span className="font-bold text-zinc-900">{control.coverage}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="p-8 bg-white">
                    <div className="flex items-center gap-2 mb-6">
                      <Activity className="w-4 h-4 text-zinc-900" />
                      <h3 className="font-mono text-[11px] font-bold text-zinc-900 uppercase tracking-[0.2em]">
                        Coverage And Trust
                      </h3>
                    </div>
                    <div className="space-y-3">
                      {COVERAGE_SIGNALS.map((signal) => (
                        <div
                          key={signal.label}
                          className="border border-zinc-200 bg-[#FAFAFA] p-3 rounded-md"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-mono text-[10px] font-bold text-zinc-700 uppercase tracking-widest">
                              {signal.label}
                            </span>
                            <span className="font-mono text-[10px] font-bold text-zinc-950">
                              {signal.value}
                            </span>
                          </div>
                          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                            {signal.detail}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* EVENT TELEMETRY */}
                <div className="p-8">
                  <div className="flex items-center gap-2 mb-6">
                    <Zap className="w-4 h-4 text-zinc-900" />
                    <h3 className="font-mono text-[11px] font-bold text-zinc-900 uppercase tracking-[0.2em]">
                      Evidence Timeline
                    </h3>
                  </div>

                  <div className="font-mono text-[11px] bg-white border border-zinc-300 shadow-sm rounded-sm overflow-hidden">
                    {/* Header */}
                    <div className="flex border-b border-zinc-300 bg-zinc-100 font-bold text-zinc-500 tracking-widest">
                      <div className="w-32 p-3 border-r border-zinc-300">TIMESTAMP (UTC)</div>
                      <div className="w-28 p-3 border-r border-zinc-300">SENSOR</div>
                      <div className="p-3 flex-1">EVENT SUMMARY</div>
                    </div>
                    {/* Body */}
                    {activeCluster.telemetry.map((log, i) => (
                      <div
                        key={i}
                        className="flex border-b border-zinc-200 last:border-0 hover:bg-zinc-50 cursor-crosshair transition-colors"
                      >
                        <div className="w-32 p-3 border-r border-zinc-200 text-zinc-500 shrink-0 flex items-center">
                          {log.timestamp}
                        </div>
                        <div className="w-28 p-3 border-r border-zinc-200 text-zinc-700 shrink-0 bg-zinc-50/30 font-bold flex items-center">
                          {log.source}
                        </div>
                        <div className="p-3 text-zinc-900 flex-1 pr-6 leading-relaxed">
                          {log.event}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 font-mono text-[11px] bg-white border border-zinc-300 shadow-sm rounded-sm overflow-hidden">
                    <div className="flex items-center justify-between border-b border-zinc-300 bg-zinc-100 px-3 py-2">
                      <div className="font-bold text-zinc-500 tracking-widest uppercase">
                        Raw Source Findings
                      </div>
                      <div className="text-[10px] text-zinc-400 tracking-widest">
                        SECONDARY EVIDENCE
                      </div>
                    </div>
                    {activeCluster.rawFindings.map((finding) => (
                      <div
                        key={finding.id}
                        className="grid grid-cols-[88px_120px_1fr_110px] border-b border-zinc-200 last:border-0 text-[10px]"
                      >
                        <div className="p-3 border-r border-zinc-200 text-zinc-500 font-bold">
                          {finding.id}
                        </div>
                        <div className="p-3 border-r border-zinc-200 text-zinc-700">
                          {finding.source}
                        </div>
                        <div className="p-3 border-r border-zinc-200">
                          <div className="font-bold text-zinc-900">{finding.rule}</div>
                          <div className="mt-1 text-zinc-500">
                            {finding.asset} - {finding.evidence}
                          </div>
                        </div>
                        <div className="p-3 text-zinc-600 uppercase tracking-widest">
                          {finding.severity}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* AGENT ACTION RAIL */}
              <div className="p-3 bg-white border-t border-zinc-200 flex items-center gap-3 justify-between shrink-0 shadow-[0_-10px_24px_rgba(15,23,42,0.04)] z-10">
                <div className="hidden 2xl:flex items-center gap-2 min-w-[240px] border border-zinc-200 bg-[#FAFAFA] px-3 py-2 rounded-md">
                  <Terminal className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="font-mono text-[10px] text-zinc-500 tracking-widest">
                    ASK CORRELATION AGENT
                  </span>
                </div>
                <div className="flex flex-wrap gap-2.5 flex-1">
                  {AGENT_ACTIONS.map((action, index) => (
                    <button
                      key={action}
                      className={cn(
                        'h-9 px-4 font-mono text-[10px] font-bold transition-colors uppercase tracking-widest flex items-center gap-2 rounded-md shadow-sm active:scale-[0.96]',
                        index === 0
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-white border border-zinc-200 text-zinc-900 hover:bg-zinc-50',
                      )}
                    >
                      {index === 0 ? (
                        <ShieldAlert className="w-3.5 h-3.5" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      )}
                      {action}
                    </button>
                  ))}
                </div>
                <div className="hidden xl:flex items-center gap-4 shrink-0">
                  <span className="text-[10px] font-mono text-zinc-500 tracking-widest">
                    OWNER: <span className="font-bold text-zinc-700">{activeCluster.owner}</span>
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
