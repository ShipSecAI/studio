import type { TourId } from './store';
import { useWorkflowUiStore } from '@/store/workflowUiStore';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TourStep {
  /** data-tour attribute value to target, or null for a centered modal */
  target: string | null;
  title: string;
  description: string;
  placement: TooltipPlacement;
  /** Action to perform before showing this step (e.g., open a panel, scroll into view) */
  beforeShow?: () => void;
}

export interface TourDefinition {
  id: TourId;
  name: string;
  steps: TourStep[];
}

function dispatchOnboardingEvent(name: string) {
  window.dispatchEvent(new CustomEvent(name));
}

/** Scroll a sidebar nav element into view */
function scrollTourTarget(selector: string) {
  const el = document.querySelector(`[data-tour="${selector}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/** Helper to call workflow UI store actions */
function setWorkflowMode(mode: 'design' | 'execution') {
  useWorkflowUiStore.getState().setMode(mode);
}

function openLibrary() {
  useWorkflowUiStore.getState().setLibraryOpen(true);
}

function setInspectorTab(tab: 'events' | 'logs' | 'artifacts' | 'agent' | 'io' | 'network') {
  useWorkflowUiStore.getState().setInspectorTab(tab);
}

export const appNavigationTour: TourDefinition = {
  id: 'app-navigation',
  name: 'App Navigation',
  steps: [
    {
      target: null,
      title: 'Welcome to ShipSec Studio',
      description:
        "Let's take a quick tour to help you find your way around. You can skip anytime with Escape or the Skip button.",
      placement: 'bottom',
    },
    {
      target: 'nav-sidebar',
      title: 'Navigation Sidebar',
      description:
        'This is your main hub. It organizes all features into clear sections and collapses automatically when you open a workflow.',
      placement: 'right',
    },
    {
      target: 'nav-search',
      title: 'Quick Search',
      description:
        'Press Cmd+K (or Ctrl+K) to search across workflows, pages, and actions. The fastest way to navigate anywhere.',
      placement: 'right',
      beforeShow: () => scrollTourTarget('nav-search'),
    },
    {
      target: 'nav-shipsec-ai',
      title: 'ShipSec AI',
      description:
        'Chat with ShipSec AI to get security insights, ask questions about your findings, or get help building workflows.',
      placement: 'right',
      beforeShow: () => scrollTourTarget('nav-shipsec-ai'),
    },
    {
      target: 'nav-code-security',
      title: 'Code Security',
      description:
        'Manage your GitHub repositories, view scan results, and configure PR protection rules to secure your codebase.',
      placement: 'right',
      beforeShow: () => scrollTourTarget('nav-code-security'),
    },
    {
      target: 'nav-cloud-security',
      title: 'Cloud Security',
      description:
        'Connect cloud accounts (AWS, GCP, Azure), browse your cloud inventory, review security findings, and run cloud scans.',
      placement: 'right',
      beforeShow: () => scrollTourTarget('nav-cloud-security'),
    },
    {
      target: 'nav-attack-surface',
      title: 'Attack Surface Management',
      description:
        'Discover and monitor your external attack surface \u2014 domains, assets, and automated reconnaissance scans.',
      placement: 'right',
      beforeShow: () => scrollTourTarget('nav-attack-surface'),
    },
    {
      target: 'nav-workflows',
      title: 'Workflows',
      description:
        'Build, manage, and automate security workflows. Access the Builder, browse Templates, set up Schedules, and configure Webhooks.',
      placement: 'right',
      beforeShow: () => scrollTourTarget('nav-workflows'),
    },
    {
      target: 'nav-manage-panel',
      title: 'Settings & Integrations',
      description:
        'Configure integrations, manage secrets and API keys, and set up MCP servers from this management section.',
      placement: 'right',
      beforeShow: () => {
        dispatchOnboardingEvent('shipsec:onboarding-open-manage');
        scrollTourTarget('nav-manage-panel');
      },
    },
    {
      target: 'quick-scan-btn',
      title: 'Quick Scan',
      description:
        'Run an instant security scan from anywhere in the app. Enter a target and get results fast without building a full workflow.',
      placement: 'bottom',
    },
    {
      target: 'getting-started',
      title: 'Getting Started',
      description:
        'Follow these steps to set up your security pipeline \u2014 connect GitHub, link cloud accounts, run your first scan, and more.',
      placement: 'left',
    },
    {
      target: null,
      title: "You're All Set!",
      description:
        'You know the key areas of ShipSec Studio. Head to the Workflow Builder to create your first automation!',
      placement: 'bottom',
    },
  ],
};

export const workflowBuilderTour: TourDefinition = {
  id: 'workflow-builder',
  name: 'Workflow Builder',
  steps: [
    {
      target: null,
      title: 'Welcome to the Workflow Builder',
      description:
        "This is where you design and run security automation workflows. Let's walk through everything you need to know.",
      placement: 'bottom',
      beforeShow: () => {
        setWorkflowMode('design');
        openLibrary();
      },
    },
    {
      target: 'wf-name',
      title: 'Workflow Name',
      description:
        'Click here to rename your workflow. Give it a clear, descriptive name so you can find it easily later. You can also pick a custom icon.',
      placement: 'bottom',
      beforeShow: () => setWorkflowMode('design'),
    },
    {
      target: 'wf-library',
      title: 'Component Library',
      description:
        'Browse and drag components onto the canvas. Components are organized by category \u2014 from scanners and enrichers to notification sinks.',
      placement: 'right',
      beforeShow: () => {
        setWorkflowMode('design');
        openLibrary();
      },
    },
    {
      target: 'wf-canvas',
      title: 'Workflow Canvas',
      description:
        'Your workspace. Drag components here, connect them with edges, and arrange your workflow visually. Scroll to zoom, drag to pan.',
      placement: 'left',
      beforeShow: () => setWorkflowMode('design'),
    },
    {
      target: 'wf-mode-toggle',
      title: 'Design & Execute Modes',
      description:
        'Switch between Design mode to edit your workflow and Execute mode to run it and inspect results in real-time.',
      placement: 'bottom',
    },
    {
      target: 'wf-save',
      title: 'Save Workflow',
      description:
        'Save your work with Cmd+S (Ctrl+S). The badge shows sync status \u2014 green means saved, amber means pending changes.',
      placement: 'bottom',
      beforeShow: () => setWorkflowMode('design'),
    },
    {
      target: 'wf-run',
      title: 'Run Workflow',
      description:
        'Execute your workflow. If it has runtime inputs configured in the Entry Point, a dialog will prompt you to fill them in.',
      placement: 'bottom',
    },
    {
      target: 'wf-more-menu',
      title: 'More Options',
      description:
        'Access Undo/Redo, View Analytics, Publish as Template, and Import/Export your workflow from this menu.',
      placement: 'bottom',
    },
    {
      target: 'wf-execution-inspector',
      title: 'Execution Inspector',
      description:
        'When you run a workflow, this panel shows real-time execution details \u2014 select runs, view timelines, and inspect node statuses.',
      placement: 'left',
      beforeShow: () => {
        setWorkflowMode('execution');
        setInspectorTab('events');
      },
    },
    {
      target: 'wf-run-selector',
      title: 'Run History',
      description:
        'Browse previous workflow runs here. Select any run to inspect its timeline, logs, and outputs in detail.',
      placement: 'left',
      beforeShow: () => {
        setWorkflowMode('execution');
      },
    },
    {
      target: 'wf-inspector-tabs',
      title: 'Inspector Tabs',
      description:
        'Switch between Events timeline, Logs, Agent traces, Artifacts, Input/Output inspection, and Network calls for the selected run.',
      placement: 'left',
      beforeShow: () => {
        setWorkflowMode('execution');
        setInspectorTab('events');
      },
    },
    {
      target: 'wf-canvas',
      title: 'Ready to Build!',
      description:
        "You're all set to create powerful security automation workflows. Start by dropping your first component onto the canvas.",
      placement: 'bottom',
      beforeShow: () => {
        setWorkflowMode('design');
        openLibrary();
      },
    },
  ],
};

export const tourDefinitions: Record<TourId, TourDefinition> = {
  'app-navigation': appNavigationTour,
  'workflow-builder': workflowBuilderTour,
};
