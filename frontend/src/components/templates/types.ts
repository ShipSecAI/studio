export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  icon: string | null;
  screenshotUrl?: string | null;
  isFeatured?: boolean;
  runCount?: number;
  isDefault: boolean;
  createdAt: string;
  graph?: {
    nodes?: {
      id: string;
      type: string;
      position: { x: number; y: number };
      data?: { label?: string; config?: unknown };
    }[];
    edges?: {
      id: string;
      source: string;
      target: string;
      sourceHandle?: string;
      targetHandle?: string;
    }[];
    viewport?: { x: number; y: number; zoom: number };
  };
}

export interface ToolInfo {
  key: string;
  logo: string;
  label: string;
}
