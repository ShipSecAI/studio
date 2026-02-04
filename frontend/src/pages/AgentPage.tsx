import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Send,
  ArrowUp,
  Sparkles,
  Workflow,
  Shield,
  FileSearch,
  Zap,
  User,
  GitBranch,
  AlertTriangle,
  ChevronRight,
  Clock,
  Loader2,
  Play,
  Bug,
  Lock,
  CloudCog,
  Database,
  Terminal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useChatStore, type ChatMessage } from '@/store/chatStore';
import { useAuthProvider } from '@/auth/auth-context';
import { MarkdownView } from '@/components/ui/markdown';

// GitHub icon component
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

const suggestedActions = [
  {
    icon: Workflow,
    label: 'Run workflow',
    description: 'Execute a security workflow',
  },
  {
    icon: Shield,
    label: 'Scan repository',
    description: 'Analyze code for vulnerabilities',
  },
  {
    icon: FileSearch,
    label: 'Review findings',
    description: 'Check recent security findings',
  },
  {
    icon: AlertTriangle,
    label: 'Investigate alert',
    description: 'Investigate security alerts',
  },
];

// Types for rich message content
type MessageContentType =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'workflow-buttons'; workflows: WorkflowOption[] }
  | { type: 'repo-buttons'; repos: RepoOption[]; intro: string }
  | { type: 'finding-cards'; findings: FindingOption[] }
  | { type: 'quick-action-buttons'; actions: QuickActionOption[] }
  | { type: 'guardduty-alerts'; alerts: GuardDutyAlert[] }
  | { type: 'action-buttons'; buttons: ActionButton[] }
  | { type: 'loading'; content: string };

interface WorkflowOption {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  status: 'active' | 'scheduled' | 'draft';
}

interface RepoOption {
  id: string;
  name: string;
  org: string;
  lastScanned?: string;
  isRecent?: boolean;
}

interface FindingOption {
  id: string;
  source: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  count: number;
  lastRun: string;
  icon: React.ElementType;
}

interface QuickActionOption {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
}

interface GuardDutyAlert {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  timestamp: string;
  instance: string;
  sourceIp: string;
  description: string;
}

interface ActionButton {
  id: string;
  label: string;
  emoji: string;
  variant: 'primary' | 'destructive';
}

// Extended message type for rich content
interface RichChatMessage extends Omit<ChatMessage, 'content'> {
  content: string | MessageContentType[];
  isStreaming?: boolean;
}

// Module-level cache for rich messages across component remounts
// (React Router remounts AgentPage when switching between "/" and "/c/:id" routes)
const richMessagesByConversation = new Map<string, RichChatMessage[]>();

// Collapsible thinking section component (like ChatGPT)
function ThinkingSection({ content, isActive }: { content: string; isActive: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(Date.now());
  const frozenElapsedRef = useRef<number | null>(null);
  const wasEverActiveRef = useRef(isActive);

  useEffect(() => {
    if (isActive) {
      wasEverActiveRef.current = true;
      startTimeRef.current = Date.now();
      frozenElapsedRef.current = null;
      const interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 100);
      return () => clearInterval(interval);
    } else if (wasEverActiveRef.current && frozenElapsedRef.current === null) {
      frozenElapsedRef.current = Math.max(
        1,
        Math.floor((Date.now() - startTimeRef.current) / 1000),
      );
      setElapsed(frozenElapsedRef.current);
    }
  }, [isActive]);

  if (isActive) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
        <Sparkles className="h-3.5 w-3.5 animate-pulse text-primary" />
        <span className="font-medium">Thinking</span>
        {elapsed > 0 && <span className="text-xs tabular-nums opacity-60">{elapsed}s</span>}
      </div>
    );
  }

  const displaySeconds = frozenElapsedRef.current || Math.max(1, elapsed);
  const durationLabel = wasEverActiveRef.current
    ? `Thought for ${displaySeconds} second${displaySeconds !== 1 ? 's' : ''}`
    : 'Thought for a moment';

  return (
    <div className="py-1">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight
          className={cn('h-3 w-3 transition-transform duration-200', isOpen && 'rotate-90')}
        />
        <Sparkles className="h-3 w-3" />
        <span>{durationLabel}</span>
      </button>
      {isOpen && (
        <div className="mt-1.5 ml-[18px] pl-3 border-l-2 border-muted-foreground/20 text-xs text-muted-foreground italic">
          <p>{content}</p>
        </div>
      )}
    </div>
  );
}

// Workflow button component
function WorkflowButton({
  workflow,
  onClick,
}: {
  workflow: WorkflowOption;
  onClick: (workflow: WorkflowOption) => void;
}) {
  const Icon = workflow.icon;
  const statusColors = {
    active: 'bg-green-500/10 text-green-600 border-green-200',
    scheduled: 'bg-blue-500/10 text-blue-600 border-blue-200',
    draft: 'bg-gray-500/10 text-gray-600 border-gray-200',
  };

  return (
    <button
      onClick={() => onClick(workflow)}
      className={cn(
        'flex items-center gap-3 w-full p-3 rounded-lg border',
        'bg-card hover:bg-accent transition-all hover:shadow-sm',
        'text-left group',
      )}
    >
      <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm truncate">{workflow.name}</p>
          <span
            className={cn(
              'text-xs px-2 py-0.5 rounded-full border capitalize',
              statusColors[workflow.status],
            )}
          >
            {workflow.status}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate">{workflow.description}</p>
      </div>
      <Play className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
    </button>
  );
}

// Repository button component
function RepoButton({ repo, onClick }: { repo: RepoOption; onClick: (repo: RepoOption) => void }) {
  return (
    <button
      onClick={() => onClick(repo)}
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg border',
        'bg-card hover:bg-accent transition-all hover:shadow-sm',
        'text-left group',
        repo.isRecent && 'ring-2 ring-primary/20',
      )}
    >
      <div className="p-2 rounded-lg bg-gray-900 text-white">
        <GitHubIcon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm truncate">
            {repo.org}/{repo.name}
          </p>
          {repo.isRecent && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              Last scanned
            </span>
          )}
        </div>
        {repo.lastScanned && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {repo.lastScanned}
          </p>
        )}
      </div>
      <Shield className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
    </button>
  );
}

// Finding card component
function FindingCard({
  finding,
  onClick,
}: {
  finding: FindingOption;
  onClick: (finding: FindingOption) => void;
}) {
  const Icon = finding.icon;
  const severityColors = {
    critical: 'bg-red-500/10 text-red-600 border-red-200',
    high: 'bg-orange-500/10 text-orange-600 border-orange-200',
    medium: 'bg-yellow-500/10 text-yellow-600 border-yellow-200',
    low: 'bg-blue-500/10 text-blue-600 border-blue-200',
  };

  return (
    <button
      onClick={() => onClick(finding)}
      className={cn(
        'flex items-center gap-3 w-full p-3 rounded-lg border',
        'bg-card hover:bg-accent transition-all hover:shadow-sm',
        'text-left group',
      )}
    >
      <div className={cn('p-2 rounded-lg', severityColors[finding.severity])}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm">{finding.source}</p>
          <span
            className={cn(
              'text-xs px-2 py-0.5 rounded-full border capitalize',
              severityColors[finding.severity],
            )}
          >
            {finding.count} {finding.severity}
          </span>
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Last run: {finding.lastRun}
        </p>
      </div>
      <FileSearch className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
    </button>
  );
}

// Quick action button component
function QuickActionButton({
  action,
  onClick,
}: {
  action: QuickActionOption;
  onClick: (action: QuickActionOption) => void;
}) {
  const Icon = action.icon;

  return (
    <button
      onClick={() => onClick(action)}
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg border',
        'bg-card hover:bg-accent transition-all hover:shadow-sm',
        'text-left group',
      )}
    >
      <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{action.name}</p>
        <p className="text-xs text-muted-foreground">{action.description}</p>
      </div>
      <Zap className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
    </button>
  );
}

// GuardDuty alert card component
function GuardDutyAlertCard({
  alert,
  onClick,
}: {
  alert: GuardDutyAlert;
  onClick: (alert: GuardDutyAlert) => void;
}) {
  const severityColors = {
    critical: 'bg-red-500/10 text-red-600 border-red-200',
    high: 'bg-orange-500/10 text-orange-600 border-orange-200',
    medium: 'bg-yellow-500/10 text-yellow-600 border-yellow-200',
    low: 'bg-blue-500/10 text-blue-600 border-blue-200',
  };

  return (
    <button
      onClick={() => onClick(alert)}
      className={cn(
        'flex items-start gap-3 w-full p-3 rounded-lg border',
        'bg-card hover:bg-accent transition-all hover:shadow-sm',
        'text-left group',
      )}
    >
      <div className={cn('p-2 rounded-lg flex-shrink-0', severityColors[alert.severity])}>
        <Shield className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm">{alert.title}</p>
          <span
            className={cn(
              'text-xs px-2 py-0.5 rounded-full border capitalize',
              severityColors[alert.severity],
            )}
          >
            {alert.severity}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{alert.description}</p>
        <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {alert.timestamp}
          </span>
          <span>
            Instance: <code className="text-xs">{alert.instance}</code>
          </span>
          <span>
            IP: <code className="text-xs">{alert.sourceIp}</code>
          </span>
        </div>
      </div>
      <FileSearch className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 mt-1" />
    </button>
  );
}

// Action button group component
function ActionButtonGroup({
  buttons,
  onClick,
}: {
  buttons: ActionButton[];
  onClick: (button: ActionButton) => void;
}) {
  return (
    <div className="flex items-center gap-3 mt-5">
      {buttons.map((button) => (
        <button
          key={button.id}
          onClick={() => onClick(button)}
          className={cn(
            'flex items-center gap-2.5 px-5 py-3 rounded-xl font-semibold text-sm transition-all',
            'shadow-md hover:shadow-lg active:scale-[0.97] border',
            button.variant === 'primary'
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500/30 shadow-emerald-900/20'
              : 'bg-red-600 hover:bg-red-500 text-white border-red-500/30 shadow-red-900/20',
          )}
        >
          <span className="text-base">{button.emoji}</span>
          <span>{button.label}</span>
        </button>
      ))}
    </div>
  );
}

// Rich message content renderer
function RichMessageContent({
  content,
  onWorkflowClick,
  onRepoClick,
  onFindingClick,
  onQuickActionClick,
  onAlertClick,
  onActionButtonClick,
}: {
  content: MessageContentType[];
  onWorkflowClick: (workflow: WorkflowOption) => void;
  onRepoClick: (repo: RepoOption) => void;
  onFindingClick: (finding: FindingOption) => void;
  onQuickActionClick: (action: QuickActionOption) => void;
  onAlertClick: (alert: GuardDutyAlert) => void;
  onActionButtonClick: (button: ActionButton) => void;
}) {
  return (
    <div className="space-y-3">
      {content.map((item, index) => {
        switch (item.type) {
          case 'text':
            return (
              <MarkdownView
                key={index}
                content={item.content}
                className="text-sm prose prose-sm dark:prose-invert max-w-none"
              />
            );
          case 'thinking':
            return (
              <ThinkingSection
                key={index}
                content={item.content}
                isActive={index === content.length - 1}
              />
            );
          case 'loading':
            return (
              <div
                key={index}
                className="flex items-center gap-2 text-muted-foreground text-sm py-2"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{item.content}</span>
              </div>
            );
          case 'workflow-buttons':
            return (
              <div key={index} className="space-y-2 mt-3">
                {item.workflows.map((workflow) => (
                  <WorkflowButton key={workflow.id} workflow={workflow} onClick={onWorkflowClick} />
                ))}
              </div>
            );
          case 'repo-buttons':
            return (
              <div key={index} className="space-y-3 mt-3">
                <p className="text-sm text-muted-foreground">{item.intro}</p>
                <div className="grid grid-cols-1 gap-2">
                  {item.repos.map((repo) => (
                    <RepoButton key={repo.id} repo={repo} onClick={onRepoClick} />
                  ))}
                </div>
              </div>
            );
          case 'finding-cards':
            return (
              <div key={index} className="space-y-2 mt-3">
                {item.findings.map((finding) => (
                  <FindingCard key={finding.id} finding={finding} onClick={onFindingClick} />
                ))}
              </div>
            );
          case 'quick-action-buttons':
            return (
              <div key={index} className="grid grid-cols-2 gap-2 mt-3">
                {item.actions.map((action) => (
                  <QuickActionButton key={action.id} action={action} onClick={onQuickActionClick} />
                ))}
              </div>
            );
          case 'guardduty-alerts':
            return (
              <div key={index} className="space-y-2 mt-3">
                {item.alerts.map((alert) => (
                  <GuardDutyAlertCard key={alert.id} alert={alert} onClick={onAlertClick} />
                ))}
              </div>
            );
          case 'action-buttons':
            return (
              <ActionButtonGroup key={index} buttons={item.buttons} onClick={onActionButtonClick} />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

interface MessageBubbleProps {
  message: RichChatMessage;
  userImageUrl?: string;
  userInitials?: string;
  onWorkflowClick: (workflow: WorkflowOption) => void;
  onRepoClick: (repo: RepoOption) => void;
  onFindingClick: (finding: FindingOption) => void;
  onQuickActionClick: (action: QuickActionOption) => void;
  onAlertClick: (alert: GuardDutyAlert) => void;
  onActionButtonClick: (button: ActionButton) => void;
}

function MessageBubble({
  message,
  userImageUrl,
  userInitials,
  onWorkflowClick,
  onRepoClick,
  onFindingClick,
  onQuickActionClick,
  onAlertClick,
  onActionButtonClick,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isRichContent = Array.isArray(message.content);

  return (
    <div className={cn('flex w-full gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {/* Assistant avatar (left side) */}
      {!isUser && (
        <Avatar className="h-8 w-8 flex-shrink-0">
          <AvatarImage src="/favicon.ico" alt="ShipSec AI" />
          <AvatarFallback className="bg-primary text-primary-foreground text-xs">AI</AvatarFallback>
        </Avatar>
      )}

      <div
        className={cn(
          'rounded-2xl px-4 py-3',
          isUser
            ? 'max-w-[70%] bg-primary text-primary-foreground'
            : 'max-w-[85%] bg-muted text-foreground',
        )}
      >
        {isRichContent ? (
          <RichMessageContent
            content={message.content as MessageContentType[]}
            onWorkflowClick={onWorkflowClick}
            onRepoClick={onRepoClick}
            onFindingClick={onFindingClick}
            onQuickActionClick={onQuickActionClick}
            onAlertClick={onAlertClick}
            onActionButtonClick={onActionButtonClick}
          />
        ) : (
          <MarkdownView
            content={message.content as string}
            className={cn(
              'text-sm prose prose-sm max-w-none',
              isUser ? 'prose-invert' : 'dark:prose-invert',
            )}
          />
        )}
        <span className="text-xs opacity-60 mt-2 block">
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* User avatar (right side) */}
      {isUser && (
        <Avatar className="h-8 w-8 flex-shrink-0">
          <AvatarImage src={userImageUrl} alt="You" />
          <AvatarFallback className="bg-secondary text-secondary-foreground text-xs">
            {userInitials || <User className="h-4 w-4" />}
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}

function WelcomeScreen({ onSuggestedAction }: { onSuggestedAction: (action: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-4">
      {/* Logo and branding */}
      <div className="flex flex-col items-center mb-8">
        <div className="flex items-center gap-3 mb-4">
          <img
            src="/favicon.ico"
            alt="ShipSec"
            className="w-12 h-12"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <div className="flex flex-col">
            <h1 className="text-3xl font-bold">ShipSec AI Agent</h1>
            <p className="text-sm text-muted-foreground text-right">
              Your intelligent security assistant
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
          <Sparkles className="w-3 h-3" />
          <span>Powered by Claude Opus</span>
        </div>
      </div>

      {/* Suggested actions */}
      <div className="grid grid-cols-2 gap-3 max-w-lg w-full">
        {suggestedActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              onClick={() => onSuggestedAction(action.label)}
              className={cn(
                'flex flex-col items-start gap-2 p-4 rounded-xl border border-border',
                'bg-card hover:bg-accent transition-colors text-left',
                'group cursor-pointer',
              )}
            >
              <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="font-medium text-sm">{action.label}</p>
                <p className="text-xs text-muted-foreground">{action.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Metadata footer */}
      <div className="mt-8 text-center">
        <p className="text-xs text-muted-foreground">
          ShipSec AI can help you with security workflows, code scanning, and vulnerability
          management.
        </p>
      </div>
    </div>
  );
}

// Mock data for workflows
const mockWorkflows: WorkflowOption[] = [
  {
    id: 'w1',
    name: 'SAST Code Analysis',
    description: 'Static application security testing with Semgrep',
    icon: Bug,
    status: 'active',
  },
  {
    id: 'w2',
    name: 'Dependency Audit',
    description: 'Check for vulnerable dependencies in your codebase',
    icon: GitBranch,
    status: 'active',
  },
  {
    id: 'w3',
    name: 'Secret Scanner',
    description: 'Detect hardcoded secrets and API keys',
    icon: Lock,
    status: 'active',
  },
  {
    id: 'w4',
    name: 'Infrastructure Review',
    description: 'Analyze IaC templates for misconfigurations',
    icon: CloudCog,
    status: 'scheduled',
  },
  {
    id: 'w5',
    name: 'Container Security',
    description: 'Scan Docker images for vulnerabilities',
    icon: Database,
    status: 'draft',
  },
];

// Mock data for repositories
const mockRepos: RepoOption[] = [
  {
    id: 'r1',
    name: 'studio',
    org: 'ShipSecAI',
    lastScanned: '2 hours ago',
    isRecent: true,
  },
  {
    id: 'r2',
    name: 'api-gateway',
    org: 'ShipSecAI',
    lastScanned: '1 day ago',
  },
  {
    id: 'r3',
    name: 'auth-service',
    org: 'ShipSecAI',
    lastScanned: '3 days ago',
  },
  {
    id: 'r4',
    name: 'frontend-app',
    org: 'ShipSecAI',
    lastScanned: '1 week ago',
  },
];

// Mock data for findings
const mockFindings: FindingOption[] = [
  {
    id: 'f1',
    source: 'AWS Security Hub',
    severity: 'critical',
    count: 3,
    lastRun: 'Today, 2:30 PM',
    icon: CloudCog,
  },
  {
    id: 'f2',
    source: 'GitHub Advanced Security',
    severity: 'high',
    count: 12,
    lastRun: 'Today, 11:00 AM',
    icon: GitBranch,
  },
  {
    id: 'f3',
    source: 'Semgrep SAST',
    severity: 'medium',
    count: 28,
    lastRun: 'Yesterday, 4:15 PM',
    icon: Bug,
  },
  {
    id: 'f4',
    source: 'Trivy Container Scan',
    severity: 'high',
    count: 7,
    lastRun: 'Yesterday, 9:00 AM',
    icon: Database,
  },
  {
    id: 'f5',
    source: 'Checkov IaC Analysis',
    severity: 'low',
    count: 45,
    lastRun: '2 days ago',
    icon: Terminal,
  },
];

// Dynamic date helpers for realistic mock data
function formatAlertTimestamp(date: Date, hours: number, minutes: number): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} UTC`;
}

function formatDateOnly(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateCompact(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

const _now = new Date();
const _today = new Date(_now);
const _yesterday = new Date(_now);
_yesterday.setDate(_yesterday.getDate() - 1);

const ALERT_DATE_PRIMARY = formatAlertTimestamp(_today, 6, 22);
const ALERT_DATE_SECONDARY = formatAlertTimestamp(_yesterday, 18, 47);
const ALERT_DATE_TERTIARY = formatAlertTimestamp(_yesterday, 14, 30);

const _ptoStart = new Date(_today);
_ptoStart.setDate(_ptoStart.getDate() - 5);
const _ptoEnd = new Date(_today);
_ptoEnd.setDate(_ptoEnd.getDate() + 1);
const PTO_START = formatDateOnly(_ptoStart);
const PTO_END = formatDateOnly(_ptoEnd);
const TODAY_COMPACT = formatDateCompact(_today);

// Mock data for GuardDuty alerts
const mockGuardDutyAlerts: GuardDutyAlert[] = [
  {
    id: 'gd1',
    title: 'Unusual SSH Login Detected',
    severity: 'high',
    timestamp: ALERT_DATE_PRIMARY,
    instance: 'i-07abc123d456ef789',
    sourceIp: '189.45.23.18',
    description: 'Suspicious SSH login from unauthorized IP (GeoIP: São Paulo, Brazil)',
  },
  {
    id: 'gd3',
    title: 'IAM Credentials Exfiltration Attempt',
    severity: 'high',
    timestamp: ALERT_DATE_SECONDARY,
    instance: 'i-09f8e7d6c5b4a3210',
    sourceIp: '103.21.244.0',
    description: 'Unusual API call pattern detected from temporary credentials',
  },
  {
    id: 'gd4',
    title: 'S3 Bucket Brute Force Access',
    severity: 'medium',
    timestamp: ALERT_DATE_TERTIARY,
    instance: 'N/A',
    sourceIp: '198.51.100.42',
    description: 'Multiple failed access attempts on private S3 buckets',
  },
];

export function AgentPage() {
  const { conversationId: urlConversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [richMessages, setRichMessages] = useState<RichChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const authProvider = useAuthProvider();
  const { user } = authProvider.context;

  // Get user avatar info
  const userImageUrl =
    user?.imageUrl ||
    'https://img.clerk.com/eyJ0eXBlIjoicHJveHkiLCJzcmMiOiJodHRwczovL2ltYWdlcy5jbGVyay5kZXYvb2F1dGhfZ29vZ2xlL2ltZ18zMkZBb1JVSDBvenQ0bmp1ZG80aHliV0FHclcifQ?width=160';
  const userInitials =
    user?.firstName && user?.lastName
      ? `${user.firstName[0]}${user.lastName[0]}`
      : user?.username
        ? user.username.substring(0, 2).toUpperCase()
        : user?.email
          ? user.email.substring(0, 2).toUpperCase()
          : undefined;

  const {
    activeConversationId,
    createConversation,
    addMessage,
    setMessages,
    getActiveConversation,
    setActiveConversation,
    conversations,
  } = useChatStore();

  // Refs for tracking conversation ownership across effect cycles
  const richMessagesRef = useRef<RichChatMessage[]>([]);
  const activeConvIdRef = useRef<string | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Sync URL param with active conversation (only when navigating to /c/:id directly)
  // Don't clear activeConversation when urlConversationId is absent — the "New Chat"
  // handlers in AgentLayout/AppLayout handle that explicitly via setActiveConversation(null).
  useEffect(() => {
    if (urlConversationId) {
      const exists = conversations.some((c) => c.id === urlConversationId);
      if (exists) {
        setActiveConversation(urlConversationId);
      } else {
        navigate('/', { replace: true });
      }
    }
  }, [urlConversationId, conversations, setActiveConversation, navigate]);

  // Keep richMessagesRef in sync and save to module cache on every change.
  // Also debounce-sync text content to the chatStore for cross-refresh persistence.
  useEffect(() => {
    richMessagesRef.current = richMessages;
    if (activeConvIdRef.current && richMessages.length > 0) {
      // Immediately save to module-level cache (preserves rich components)
      richMessagesByConversation.set(activeConvIdRef.current, [...richMessages]);

      // Debounced sync of text content to chatStore (for page refresh scenarios)
      clearTimeout(syncTimerRef.current);
      const convId = activeConvIdRef.current;
      syncTimerRef.current = setTimeout(() => {
        const textMessages = richMessages
          .map((msg) => {
            const contentStr =
              typeof msg.content === 'string'
                ? msg.content
                : msg.content
                    .filter((c) => c.type === 'text')
                    .map((c) => (c as { type: 'text'; content: string }).content)
                    .join('\n');
            return { role: msg.role as 'user' | 'assistant', content: contentStr };
          })
          .filter((msg) => msg.content);
        if (textMessages.length > 0) {
          setMessages(convId, textMessages);
        }
      }, 500);
    }
    return () => clearTimeout(syncTimerRef.current);
  }, [richMessages, setMessages]);

  // Handle conversation switching: save outgoing, load incoming
  useEffect(() => {
    const prevId = activeConvIdRef.current;

    // Save outgoing conversation's rich messages before switching
    if (prevId && prevId !== activeConversationId && richMessagesRef.current.length > 0) {
      richMessagesByConversation.set(prevId, [...richMessagesRef.current]);
      // Immediate sync to store for the outgoing conversation
      const textMessages = richMessagesRef.current
        .map((msg) => {
          const contentStr =
            typeof msg.content === 'string'
              ? msg.content
              : msg.content
                  .filter((c) => c.type === 'text')
                  .map((c) => (c as { type: 'text'; content: string }).content)
                  .join('\n');
          return { role: msg.role as 'user' | 'assistant', content: contentStr };
        })
        .filter((msg) => msg.content);
      if (textMessages.length > 0) {
        setMessages(prevId, textMessages);
      }
    }

    activeConvIdRef.current = activeConversationId;

    // Load incoming conversation
    if (!activeConversationId) {
      setRichMessages([]);
      return;
    }

    // If we just created this conversation from addRichMessage (transitioning from no conversation),
    // richMessages already contain the correct data — save to cache and don't overwrite
    if (!prevId && richMessagesRef.current.length > 0) {
      richMessagesByConversation.set(activeConversationId, [...richMessagesRef.current]);
      return;
    }

    // Check module cache first (has full rich content with components)
    const cached = richMessagesByConversation.get(activeConversationId);
    if (cached && cached.length > 0) {
      setRichMessages(cached);
      return;
    }

    // Fall back to chatStore (plain text only, for page refresh scenarios)
    const conversation = getActiveConversation();
    if (conversation && conversation.messages.length > 0) {
      const loaded: RichChatMessage[] = conversation.messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
      }));
      setRichMessages(loaded);
    } else {
      setRichMessages([]);
    }
  }, [activeConversationId, getActiveConversation, setMessages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [richMessages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [inputValue]);

  const addRichMessage = useCallback(
    (message: Omit<RichChatMessage, 'id' | 'timestamp'>) => {
      const newMessage: RichChatMessage = {
        ...message,
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
      };
      setRichMessages((prev) => [...prev, newMessage]);

      // Also add to store for persistence (simplified content)
      // Read directly from the store to get the latest value synchronously,
      // avoiding stale closure when multiple addRichMessage calls happen in the same render cycle.
      let conversationId = useChatStore.getState().activeConversationId;
      if (!conversationId) {
        conversationId = createConversation();
        // Update URL without React Router navigation to avoid component remount
        // (React Router treats "/" and "/c/:id" as different routes, causing unmount/remount)
        window.history.replaceState(null, '', `/c/${conversationId}`);
      }
      const contentStr =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .filter((c) => c.type === 'text')
              .map((c) => (c as { type: 'text'; content: string }).content)
              .join('\n');

      if (contentStr) {
        addMessage(conversationId, {
          role: message.role,
          content: contentStr,
        });
      }

      return newMessage.id;
    },
    [createConversation, addMessage],
  );

  const simulateStreamingResponse = useCallback(
    async (content: MessageContentType[]) => {
      // Add initial message with thinking state — thinking stays active until content appears
      const thinkingItem: MessageContentType = {
        type: 'thinking',
        content: 'Analyzing your request and retrieving data...',
      };

      addRichMessage({
        role: 'assistant',
        content: [thinkingItem],
      });

      // Thinking phase — keep active for realistic duration
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Thinking collapses, content appears below (ChatGPT-style)
      setRichMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === 'assistant') {
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: [thinkingItem, ...content],
          };
        }
        return updated;
      });
    },
    [addRichMessage],
  );

  const handleRunWorkflow = useCallback(() => {
    addRichMessage({
      role: 'user',
      content: 'Run workflow',
    });

    simulateStreamingResponse([
      {
        type: 'text',
        content:
          'I found 5 active workflows in your ShipSec Studio. Here are the available security workflows you can run:',
      },
      { type: 'workflow-buttons', workflows: mockWorkflows },
      {
        type: 'text',
        content: 'Click on any workflow to start it, or tell me which one you want to configure.',
      },
    ]);
  }, [addRichMessage, simulateStreamingResponse]);

  const handleScanRepository = useCallback(() => {
    addRichMessage({
      role: 'user',
      content: 'Scan repository',
    });

    simulateStreamingResponse([
      {
        type: 'text',
        content:
          "You have 200 repositories connected to ShipSec Studio. I've identified your most recently scanned repositories:",
      },
      {
        type: 'repo-buttons',
        repos: mockRepos,
        intro:
          'Select a repository to scan, or I can recommend one based on the time since last scan:',
      },
      {
        type: 'text',
        content:
          'Pro tip: The ShipSecAI/studio repository was last scanned 2 hours ago. Would you like to run another scan with the same configuration?',
      },
    ]);
  }, [addRichMessage, simulateStreamingResponse]);

  const handleReviewFindings = useCallback(() => {
    addRichMessage({
      role: 'user',
      content: 'Review findings',
    });

    const thinkingItem: MessageContentType = {
      type: 'thinking',
      content: 'Fetching security findings across all integrated sources...',
    };

    addRichMessage({
      role: 'assistant',
      content: [thinkingItem],
    });

    // Thinking stays active for the full duration, then collapses when content appears
    setTimeout(() => {
      setRichMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === 'assistant') {
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: [
              thinkingItem,
              {
                type: 'text',
                content:
                  "I've retrieved your latest security findings from across all integrated sources. Here's a summary of the last 5 security reports:",
              },
              { type: 'finding-cards', findings: mockFindings },
              {
                type: 'text',
                content:
                  'You have 3 critical findings from AWS Security Hub that require immediate attention. Would you like me to provide detailed remediation steps for those?',
              },
            ],
          };
        }
        return updated;
      });
    }, 2500);
  }, [addRichMessage]);

  const handleWorkflowClick = useCallback(
    (workflow: WorkflowOption) => {
      addRichMessage({
        role: 'user',
        content: `Run ${workflow.name}`,
      });

      simulateStreamingResponse([
        {
          type: 'text',
          content: `Starting **${workflow.name}** workflow...\n\n${workflow.description}\n\nThis workflow will scan your connected repositories and report any findings. I'll notify you when the scan is complete.`,
        },
        {
          type: 'loading',
          content: 'Initializing workflow...',
        },
      ]);

      // Simulate completion — preserve thinking from simulateStreamingResponse
      setTimeout(() => {
        setRichMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.role === 'assistant') {
            const prevContent = updated[lastIdx].content as MessageContentType[];
            const thinkingItems = prevContent.filter((c) => c.type === 'thinking');
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: [
                ...thinkingItems,
                {
                  type: 'text',
                  content: `**${workflow.name}** workflow has been queued successfully!\n\nEstimated completion: 5-10 minutes\nRepositories to scan: 4\nNotification: Enabled\n\nI'll update you when the results are ready. Would you like to run another workflow or review existing findings?`,
                },
              ],
            };
          }
          return updated;
        });
      }, 4500);
    },
    [addRichMessage, simulateStreamingResponse],
  );

  const handleRepoClick = useCallback(
    (repo: RepoOption) => {
      addRichMessage({
        role: 'user',
        content: `Scan ${repo.org}/${repo.name}`,
      });

      simulateStreamingResponse([
        {
          type: 'text',
          content: `Initiating security scan for **${repo.org}/${repo.name}**...\n\nLast scanned: ${repo.lastScanned}\nBranch: main\nScan type: Full security suite`,
        },
        {
          type: 'loading',
          content: 'Running SAST, SCA, and secret detection...',
        },
      ]);

      // Preserve thinking from simulateStreamingResponse
      setTimeout(() => {
        setRichMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.role === 'assistant') {
            const prevContent = updated[lastIdx].content as MessageContentType[];
            const thinkingItems = prevContent.filter((c) => c.type === 'thinking');
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: [
                ...thinkingItems,
                {
                  type: 'text',
                  content: `Scan completed for **${repo.org}/${repo.name}**!\n\n**Results Summary:**\n- Critical: 0\n- High: 2\n- Medium: 8\n- Low: 15\n\nThe 2 high severity findings are related to outdated dependencies. Would you like me to show detailed remediation steps?`,
                },
              ],
            };
          }
          return updated;
        });
      }, 5000);
    },
    [addRichMessage, simulateStreamingResponse],
  );

  const handleFindingClick = useCallback(
    (finding: FindingOption) => {
      addRichMessage({
        role: 'user',
        content: `Show ${finding.source} findings`,
      });

      const thinkingItem: MessageContentType = {
        type: 'thinking',
        content: `Retrieving ${finding.source} findings...`,
      };

      addRichMessage({
        role: 'assistant',
        content: [thinkingItem],
      });

      // Thinking stays active for the full duration, then collapses when content appears
      setTimeout(() => {
        setRichMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.role === 'assistant') {
            const findingDetails: Record<string, string> = {
              'AWS Security Hub': `**AWS Security Hub — CRITICAL Findings**\n\nTotal: ${finding.count} findings\nLast run: ${finding.lastRun}\nRegion: us-east-1\n\n**Finding Details:**\n\n1. **S3 Bucket Public Access Enabled** — \`CRITICAL\`\n   - Resource: \`arn:aws:s3:::prod-user-uploads\`\n   - Control: S3.2 — S3 buckets should prohibit public read access\n   - Account: 491203847561 (production)\n   - Remediation: Enable S3 Block Public Access at the bucket level and review bucket policy for \`Principal: "*"\` statements\n\n2. **IAM Root Account Access Key Active** — \`CRITICAL\`\n   - Resource: \`arn:aws:iam::491203847561:root\`\n   - Control: IAM.4 — IAM root user access key should not exist\n   - Account: 491203847561 (production)\n   - Remediation: Delete root access keys immediately, create an IAM admin user with MFA, and rotate any services using root credentials\n\n3. **RDS Instance Publicly Accessible** — \`CRITICAL\`\n   - Resource: \`arn:aws:rds:us-east-1:491203847561:db/prod-postgres\`\n   - Control: RDS.2 — RDS DB instances should prohibit public access\n   - Account: 491203847561 (production)\n   - Remediation: Modify the RDS instance to disable public accessibility, ensure it resides in a private subnet, and use VPC security groups to restrict access\n\nWould you like me to generate remediation steps or create Jira tickets for these findings?`,

              'GitHub Advanced Security': `**GitHub Advanced Security — HIGH Findings**\n\nTotal: ${finding.count} findings across 4 repositories\nLast run: ${finding.lastRun}\n\n**Finding Details:**\n\n1. **SQL Injection via unsanitized query parameter** — \`HIGH\`\n   - Rule: \`javascript/sql-injection\`\n   - File: \`api-gateway/src/routes/users.ts:87\`\n   - Branch: main\n   - Snippet: \`db.query(\`SELECT * FROM users WHERE id = \${req.params.id}\`)\`\n   - Remediation: Use parameterized queries with \`$1\` placeholders instead of string interpolation\n\n2. **Leaked GitHub Personal Access Token** — \`HIGH\`\n   - Rule: \`secret-scanning/github-token\`\n   - File: \`studio/.env.example:12\`\n   - Branch: main\n   - Remediation: Revoke the token in GitHub Settings > Developer settings > Tokens, rotate and store in a secrets manager\n\n3. **Prototype Pollution in lodash <4.17.21** — \`HIGH\`\n   - Rule: \`dependabot/npm/lodash\`\n   - File: \`frontend-app/package-lock.json\`\n   - Remediation: Run \`npm audit fix\` or update lodash to >=4.17.21\n\n_Showing 3 of ${finding.count} findings. Would you like me to show all findings or generate remediation PRs?_`,

              'Semgrep SAST': `**Semgrep SAST — MEDIUM Findings**\n\nTotal: ${finding.count} findings across 6 repositories\nLast run: ${finding.lastRun}\nRuleset: p/owasp-top-ten, p/typescript\n\n**Top Findings by Category:**\n\n| Category | Count | Severity |\n|---|---|---|\n| Missing input validation | 9 | Medium |\n| Insecure crypto usage | 6 | Medium |\n| Hardcoded configuration | 5 | Medium |\n| Missing error handling | 4 | Medium |\n| Insecure deserialization | 4 | Medium |\n\n**Sample Findings:**\n\n1. **Use of \`Math.random()\` for token generation** — \`MEDIUM\`\n   - Rule: \`javascript.lang.security.insecure-randomness\`\n   - File: \`auth-service/src/utils/token.ts:23\`\n   - Remediation: Replace with \`crypto.randomBytes()\` or \`crypto.randomUUID()\`\n\n2. **Unvalidated redirect URL** — \`MEDIUM\`\n   - Rule: \`javascript.express.security.open-redirect\`\n   - File: \`api-gateway/src/middleware/auth.ts:56\`\n   - Remediation: Validate redirect URLs against an allowlist of trusted domains\n\nWould you like a full breakdown by repository, or should I prioritize remediation for a specific category?`,

              'Trivy Container Scan': `**Trivy Container Scan — HIGH Findings**\n\nTotal: ${finding.count} findings across 3 images\nLast run: ${finding.lastRun}\n\n**Image: \`ghcr.io/shipsecai/api-gateway:latest\`** (4 findings)\n\n1. **CVE-2024-38816 — Spring Framework path traversal** — \`HIGH\` (CVSS 8.1)\n   - Package: \`org.springframework:spring-webmvc 6.1.6\`\n   - Fixed in: 6.1.13\n   - Remediation: Update Spring Boot parent to >=3.3.4\n\n2. **CVE-2024-47554 — Apache Commons IO ReDoS** — \`HIGH\` (CVSS 7.5)\n   - Package: \`commons-io:commons-io 2.11.0\`\n   - Fixed in: 2.14.0\n\n**Image: \`ghcr.io/shipsecai/frontend-app:latest\`** (2 findings)\n\n3. **CVE-2024-21538 — cross-spawn ReDoS** — \`HIGH\` (CVSS 7.5)\n   - Package: \`cross-spawn 7.0.3\`\n   - Fixed in: 7.0.5\n\n**Image: \`ghcr.io/shipsecai/auth-service:latest\`** (1 finding)\n\n4. **GHSA-72xf-g2v4-qvf3 — undici request smuggling** — \`HIGH\` (CVSS 7.5)\n   - Package: \`undici 5.28.3\`\n   - Fixed in: 5.28.4\n\nWould you like me to update the Dockerfiles with patched base images?`,

              'Checkov IaC Analysis': `**Checkov IaC Analysis — LOW Findings**\n\nTotal: ${finding.count} findings across 12 Terraform files\nLast run: ${finding.lastRun}\nFramework: Terraform v1.7.x\n\n**Findings by Category:**\n\n| Category | Count | Severity |\n|---|---|---|\n| Missing resource tagging | 18 | Low |\n| Logging not enabled | 12 | Low |\n| Encryption at rest defaults | 8 | Low |\n| Backup not configured | 7 | Low |\n\n**Sample Findings:**\n\n1. **S3 bucket missing versioning** — \`LOW\`\n   - Check: CKV_AWS_21\n   - File: \`infra/modules/storage/main.tf:34\`\n   - Remediation: Add \`versioning { enabled = true }\` block\n\n2. **CloudWatch log group missing retention policy** — \`LOW\`\n   - Check: CKV_AWS_158\n   - File: \`infra/modules/monitoring/main.tf:12\`\n   - Remediation: Set \`retention_in_days = 90\`\n\n3. **EC2 instance missing detailed monitoring** — \`LOW\`\n   - Check: CKV_AWS_126\n   - File: \`infra/environments/staging/main.tf:67\`\n   - Remediation: Add \`monitoring = true\`\n\nThese are low-severity hygiene items. Would you like me to generate a Terraform PR to fix all tagging issues at once?`,
            };

            updated[lastIdx] = {
              ...updated[lastIdx],
              content: [
                thinkingItem,
                {
                  type: 'text',
                  content:
                    findingDetails[finding.source] ||
                    `**${finding.source} — ${finding.severity.toUpperCase()} Findings**\n\nTotal: ${finding.count} findings\nLast run: ${finding.lastRun}\n\nNo detailed breakdown available for this source. Would you like me to fetch the raw findings data?`,
                },
              ],
            };
          }
          return updated;
        });
      }, 2000);
    },
    [addRichMessage],
  );

  const handleQuickActionClick = useCallback(
    (action: QuickActionOption) => {
      addRichMessage({
        role: 'user',
        content: action.name,
      });

      simulateStreamingResponse([
        {
          type: 'text',
          content: `Executing **${action.name}**...\n\n${action.description}`,
        },
        {
          type: 'loading',
          content: 'Processing...',
        },
      ]);

      // Preserve thinking from simulateStreamingResponse
      setTimeout(() => {
        setRichMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.role === 'assistant') {
            const prevContent = updated[lastIdx].content as MessageContentType[];
            const thinkingItems = prevContent.filter((c) => c.type === 'thinking');
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: [
                ...thinkingItems,
                {
                  type: 'text',
                  content: `**${action.name}** completed!\n\n${
                    action.id === 'qa1'
                      ? 'Your security report has been generated and is available in the Reports section. Key highlights:\n- Overall security score: 78/100\n- 3 critical issues resolved this week\n- 12 new findings require attention'
                      : action.id === 'qa2'
                        ? 'Compliance check completed:\n\n- SOC2: 94% compliant (2 controls pending)\n- HIPAA: 89% compliant (review data retention)\n- PCI-DSS: 97% compliant'
                        : action.id === 'qa3'
                          ? 'Alert settings updated. You will receive notifications for:\n- Critical findings: Immediately\n- High findings: Within 1 hour\n- Medium/Low: Daily digest'
                          : 'Full security suite initiated. Running:\n- SAST analysis\n- Dependency audit\n- Secret scanning\n- Container analysis\n\nEstimated completion: 15-20 minutes'
                  }`,
                },
              ],
            };
          }
          return updated;
        });
      }, 4000);
    },
    [addRichMessage, simulateStreamingResponse],
  );

  // Handler: "Investigate alert" welcome screen button
  const handleInvestigateAlert = useCallback(() => {
    addRichMessage({
      role: 'user',
      content: 'Investigate alert',
    });

    const thinkingItem: MessageContentType = {
      type: 'thinking',
      content: 'Connecting to AWS GuardDuty and fetching recent alerts...',
    };

    addRichMessage({
      role: 'assistant',
      content: [thinkingItem],
    });

    // Thinking stays active for the full duration, then collapses when content appears
    setTimeout(() => {
      setRichMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === 'assistant') {
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: [
              thinkingItem,
              {
                type: 'text',
                content:
                  'I found **3 recent security alerts** in AWS GuardDuty across your monitored accounts:',
              },
              { type: 'guardduty-alerts', alerts: mockGuardDutyAlerts },
              {
                type: 'text',
                content:
                  'Would you like me to investigate any of these alerts? Just describe which one interests you.',
              },
            ],
          };
        }
        return updated;
      });
    }, 2000);
  }, [addRichMessage]);

  // Multi-step investigation flow
  const runInvestigationFlow = useCallback(() => {
    addRichMessage({
      role: 'assistant',
      content: [
        { type: 'thinking', content: 'Analyzing your request and pulling alert details...' },
      ],
    });

    const updateLastAssistant = (content: MessageContentType[]) => {
      setRichMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === 'assistant') {
          updated[lastIdx] = { ...updated[lastIdx], content };
        }
        return updated;
      });
    };

    // Investigation content blocks (accumulated step by step)
    const alertHeader: MessageContentType = {
      type: 'text',
      content:
        '🚨 **Incident Investigation Summary - ShipSec**\n\n🔗 **GuardDuty Alert: Unusual SSH Login Detected**\n\n**Summary:** Suspicious SSH login detected from an unauthorized IP **189.45.23.18** on EC2 instance **i-07abc123d456ef789**.\n\n---\n\n🕵️ **Investigation Timeline** *(Auto-correlated across AWS, GSuite, Rippling)*',
    };

    const guardDutyStep: MessageContentType = {
      type: 'text',
      content: `**1. AWS GuardDuty Alert Triggered**\n\n   **Time:** **${ALERT_DATE_PRIMARY}**\n   **Instance:** **i-07abc123d456ef789**\n   **Source IP:** **189.45.23.18** *(GeoIP: São Paulo, Brazil)*\n   **SSH User:** **ec2-user**`,
    };

    const cloudTrailStep: MessageContentType = {
      type: 'text',
      content:
        '**2. AWS CloudTrail Log Review**\n\n   ✅ Verified SSH access from the IP at the reported time\n   🔘 Session initiated by IAM role **DevOpsAccessRole**',
    };

    const ripplingStep: MessageContentType = {
      type: 'text',
      content: `**3. Rippling (HRMS) Context**\n\n   🎯 IAM role **DevOpsAccessRole** maps to user: **Pranjal Paliwal**\n   🏖️ Pranjal is marked **Out of Office (PTO)** from **${PTO_START}** to **${PTO_END}**\n   ❗ Login occurred during PTO`,
    };

    const gsuiteStep: MessageContentType = {
      type: 'text',
      content:
        '**4. GSuite Activity Check**\n\n   📁 No recent file access from Pranjal in last 72 hrs\n   ✉️ No login to Gmail or Drive from Brazil IP',
    };

    const conclusion: MessageContentType = {
      type: 'text',
      content:
        '---\n\n💡 **Conclusion:**\n\nThe SSH login from **189.45.23.18** appears **unauthorized**. IAM role belongs to a user on PTO with no matching activity in GSuite.',
    };

    const recommendedAction: MessageContentType = {
      type: 'text',
      content:
        '🚨 **Recommended Action:**\n\n   🔐 Temporarily revoke **DevOpsAccessRole** credentials\n   👤 Notify user: *"Hi Pranjal, was this you?"*\n   📋 Initiate IR protocol with SecOps team',
    };

    const actionButtons: MessageContentType = {
      type: 'action-buttons',
      buttons: [
        { id: 'confirm-pranjal', label: 'Confirm with Pranjal', emoji: '✅', variant: 'primary' },
        {
          id: 'revoke-role',
          label: 'Temporarily revoke DevOpsAcc...',
          emoji: '🚫',
          variant: 'destructive',
        },
      ],
    };

    // Step 0: Show alert header + thinking for GuardDuty (1.2s)
    setTimeout(() => {
      updateLastAssistant([
        alertHeader,
        { type: 'thinking', content: 'Fetching full alert details from AWS GuardDuty via MCP...' },
      ]);
    }, 1200);

    // Step 1: GuardDuty details + thinking for CloudTrail (2.7s)
    setTimeout(() => {
      updateLastAssistant([
        alertHeader,
        guardDutyStep,
        { type: 'thinking', content: 'Cross-referencing with AWS CloudTrail logs via MCP...' },
      ]);
    }, 2700);

    // Step 2: CloudTrail + thinking for Rippling (4.2s)
    setTimeout(() => {
      updateLastAssistant([
        alertHeader,
        guardDutyStep,
        cloudTrailStep,
        {
          type: 'thinking',
          content: 'Querying Rippling HRMS via MCP to identify user behind IAM role...',
        },
      ]);
    }, 4200);

    // Step 3: Rippling + thinking for GSuite (5.7s)
    setTimeout(() => {
      updateLastAssistant([
        alertHeader,
        guardDutyStep,
        cloudTrailStep,
        ripplingStep,
        {
          type: 'thinking',
          content: 'Checking GSuite activity via MCP for corroborating evidence...',
        },
      ]);
    }, 5700);

    // Step 4: GSuite + thinking for conclusion (7.2s)
    setTimeout(() => {
      updateLastAssistant([
        alertHeader,
        guardDutyStep,
        cloudTrailStep,
        ripplingStep,
        gsuiteStep,
        { type: 'thinking', content: 'Correlating findings and generating conclusion...' },
      ]);
    }, 7200);

    // Step 5: Full result with conclusion, recommended action, and buttons (8.5s)
    setTimeout(() => {
      updateLastAssistant([
        {
          type: 'thinking',
          content: 'Investigated alert across GuardDuty, CloudTrail, Rippling, and GSuite',
        },
        alertHeader,
        guardDutyStep,
        cloudTrailStep,
        ripplingStep,
        gsuiteStep,
        conclusion,
        recommendedAction,
        actionButtons,
      ]);
    }, 8500);
  }, [addRichMessage]);

  // Handler: GuardDuty alert card click
  const handleAlertClick = useCallback(
    (_alert: GuardDutyAlert) => {
      runInvestigationFlow();
    },
    [runInvestigationFlow],
  );

  // Handler: action button clicks (Confirm with Pranjal / Revoke role)
  const handleActionButtonClick = useCallback(
    (button: ActionButton) => {
      if (button.id === 'confirm-pranjal') {
        addRichMessage({
          role: 'user',
          content: 'Confirm with Pranjal',
        });

        const thinkingItem: MessageContentType = {
          type: 'thinking',
          content: 'Sending Slack notification to Pranjal Paliwal via MCP...',
        };

        addRichMessage({
          role: 'assistant',
          content: [thinkingItem],
        });

        // Thinking stays active, then collapses when content appears
        setTimeout(() => {
          setRichMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (updated[lastIdx]?.role === 'assistant') {
              updated[lastIdx] = {
                ...updated[lastIdx],
                content: [
                  thinkingItem,
                  {
                    type: 'text',
                    content: `✅ **Slack notification sent to Pranjal Paliwal**\n\nUsing **Slack MCP** to send a direct message.\n\n---\n\n**Direct message sent to:** Pranjal Paliwal\n\n**Message preview:**\n> 🔔 **Security Alert — Action Required**\n>\n> Hi Pranjal, we detected an SSH login to EC2 instance **i-07abc123d456ef789** from IP **189.45.23.18** (São Paulo, Brazil) at **${ALERT_DATE_PRIMARY}** using your IAM role **DevOpsAccessRole**.\n>\n> Our records show you are currently on PTO. **Was this you?**\n>\n> Please reply with ✅ if this was authorized or 🚫 if this was not you.\n\n---\n\nI'll monitor for Pranjal's response and update you. If no response within 30 minutes, I'll automatically escalate to the SecOps team.`,
                  },
                ],
              };
            }
            return updated;
          });
        }, 2000);
      } else if (button.id === 'revoke-role') {
        addRichMessage({
          role: 'user',
          content: 'Temporarily revoke DevOpsAccessRole',
        });

        const thinkingItem: MessageContentType = {
          type: 'thinking',
          content: 'Revoking DevOpsAccessRole credentials via AWS IAM MCP...',
        };

        addRichMessage({
          role: 'assistant',
          content: [thinkingItem],
        });

        // Thinking stays active, then collapses when content appears
        setTimeout(() => {
          setRichMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (updated[lastIdx]?.role === 'assistant') {
              updated[lastIdx] = {
                ...updated[lastIdx],
                content: [
                  thinkingItem,
                  {
                    type: 'text',
                    content: `🚫 **DevOpsAccessRole temporarily revoked**\n\nUsing **AWS IAM MCP** to attach a deny-all policy and invalidate active sessions.\n\n---\n\n| Action | Status |\n|---|---|\n| **Inline policy attached** | ✅ DenyAll policy added to DevOpsAccessRole |\n| **Active sessions invalidated** | ✅ All sessions older than now revoked |\n| **CloudTrail logging** | ✅ Enhanced logging enabled for this role |\n| **Rollback window** | 24 hours (auto-restore if confirmed safe) |\n\n**Role ARN:** arn:aws:iam::491203847561:role/DevOpsAccessRole\n**Policy:** ShipSec-EmergencyDenyAll-${TODAY_COMPACT}\n\n---\n\nThe role is now locked down. Any services using this role will lose access. I've also notified the SecOps team in **#incident-response** about this containment action.\n\nWould you like me to initiate the full IR protocol or wait for Pranjal's confirmation first?`,
                  },
                ],
              };
            }
            return updated;
          });
        }, 2500);
      }
    },
    [addRichMessage],
  );

  const handleSend = () => {
    if (!inputValue.trim()) return;

    const userMessage = inputValue.trim();
    const lowerMessage = userMessage.toLowerCase();

    addRichMessage({
      role: 'user',
      content: userMessage,
    });

    // Handle different inputs
    if (lowerMessage.includes('run workflow') || lowerMessage.includes('workflow')) {
      setInputValue('');
      simulateStreamingResponse([
        {
          type: 'text',
          content:
            'I found 5 active workflows in your ShipSec Studio. Here are the available security workflows you can run:',
        },
        { type: 'workflow-buttons', workflows: mockWorkflows },
        {
          type: 'text',
          content: 'Click on any workflow to start it, or tell me which one you want to configure.',
        },
      ]);
      return;
    }

    if (lowerMessage.includes('scan') || lowerMessage.includes('repository')) {
      setInputValue('');
      simulateStreamingResponse([
        {
          type: 'text',
          content:
            'You have 200 repositories connected to ShipSec Studio. Here are your most recently scanned ones:',
        },
        {
          type: 'repo-buttons',
          repos: mockRepos,
          intro: 'Select a repository to scan:',
        },
      ]);
      return;
    }

    if (
      lowerMessage.includes('investigate') ||
      lowerMessage.includes('alert') ||
      lowerMessage.includes('ssh') ||
      lowerMessage.includes('login')
    ) {
      setInputValue('');
      runInvestigationFlow();
      return;
    }

    if (
      lowerMessage.includes('finding') ||
      lowerMessage.includes('review') ||
      lowerMessage.includes('aws')
    ) {
      setInputValue('');
      handleReviewFindings();
      return;
    }

    if (
      lowerMessage.includes('jira') ||
      lowerMessage.includes('ticket') ||
      lowerMessage.includes('create ticket')
    ) {
      setInputValue('');

      const thinkingItem: MessageContentType = {
        type: 'thinking',
        content: 'Connecting to JIRA MCP via ShipSec secure proxy and creating ticket...',
      };

      addRichMessage({
        role: 'assistant',
        content: [thinkingItem],
      });

      // Thinking stays active, then collapses when final content appears
      setTimeout(() => {
        setRichMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.role === 'assistant') {
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: [
                thinkingItem,
                {
                  type: 'text',
                  content: `I've connected to the **JIRA MCP server** via the ShipSec secure HTTP proxy and created a ticket for all 3 critical AWS Security Hub findings. The ticket has been assigned to **Pranjal** as he's the DevOps Lead.\n\n---\n\n**[SD-47](https://shipsec.atlassian.net/browse/SD-47)** — \`Critical AWS Security Hub Findings — Immediate Remediation Required\`\n\n| Field | Value |\n|---|---|\n| **Project** | ShipSec DevOps (SD) |\n| **Type** | Bug |\n| **Priority** | 🔴 Critical |\n| **Assignee** | Pranjal (DevOps Lead) |\n| **Labels** | \`aws\`, \`security-hub\`, \`critical\`, \`production\` |\n| **Due Date** | Feb 7, 2025 |\n\n**Description includes:**\n1. **S3 Bucket Public Access Enabled** — \`prod-user-uploads\` bucket has public read access\n2. **IAM Root Account Access Key Active** — Root access keys exist on production account  \n3. **RDS Instance Publicly Accessible** — \`prod-postgres\` is publicly accessible\n\n**Acceptance Criteria:**\n- [ ] S3 Block Public Access enabled on \`prod-user-uploads\`\n- [ ] Root access keys deleted and IAM admin user created with MFA\n- [ ] RDS instance moved to private subnet with public access disabled\n\n🔗 **Ticket URL:** [https://shipsec.atlassian.net/browse/SD-47](https://shipsec.atlassian.net/browse/SD-47)\n\n---\n\nPranjal has been notified via Slack (\`#devops-alerts\`) and email. Would you like me to add any watchers, link this to an existing epic, or escalate the priority?`,
                },
              ],
            };
          }
          return updated;
        });
      }, 3000);
      return;
    }

    // Default response
    setInputValue('');
    simulateStreamingResponse([
      {
        type: 'text',
        content: `I understand you want help with "${userMessage}". As your security assistant, I can help you with:\n\n• Running security workflows\n• Scanning repositories for vulnerabilities\n• Reviewing security findings\n• Performing quick security actions\n\nWhat would you like to do?`,
      },
    ]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestedAction = (action: string) => {
    const lowerAction = action.toLowerCase();

    if (lowerAction === 'run workflow') {
      handleRunWorkflow();
    } else if (lowerAction === 'scan repository') {
      handleScanRepository();
    } else if (lowerAction === 'review findings') {
      handleReviewFindings();
    } else if (lowerAction === 'investigate alert') {
      handleInvestigateAlert();
    } else {
      setInputValue(action);
      textareaRef.current?.focus();
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {richMessages.length === 0 ? (
          <WelcomeScreen onSuggestedAction={handleSuggestedAction} />
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            {richMessages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                userImageUrl={userImageUrl}
                userInitials={userInitials}
                onWorkflowClick={handleWorkflowClick}
                onRepoClick={handleRepoClick}
                onFindingClick={handleFindingClick}
                onQuickActionClick={handleQuickActionClick}
                onAlertClick={handleAlertClick}
                onActionButtonClick={handleActionButtonClick}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t bg-background/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div
            className={cn(
              'flex items-end gap-2 rounded-xl border border-input bg-background p-2',
              'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
            )}
          >
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message ShipSec AI..."
              rows={1}
              className={cn(
                'flex-1 resize-none bg-transparent px-2 py-2',
                'text-sm placeholder:text-muted-foreground',
                'focus:outline-none',
                'min-h-[40px] max-h-[200px]',
              )}
            />
            <Button
              onClick={handleSend}
              size="icon"
              className="h-10 w-10 rounded-lg flex-shrink-0 bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-transform duration-200 active:scale-95 relative overflow-hidden"
            >
              <span
                className={cn(
                  'absolute inset-0 flex items-center justify-center transition-all duration-300',
                  inputValue.trim()
                    ? 'opacity-0 scale-75 rotate-90'
                    : 'opacity-100 scale-100 rotate-0',
                )}
              >
                <Send className="h-4 w-4" />
              </span>
              <span
                className={cn(
                  'absolute inset-0 flex items-center justify-center transition-all duration-300',
                  inputValue.trim()
                    ? 'opacity-100 scale-100 rotate-0'
                    : 'opacity-0 scale-75 -rotate-90',
                )}
              >
                <ArrowUp className="h-4 w-4" />
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
