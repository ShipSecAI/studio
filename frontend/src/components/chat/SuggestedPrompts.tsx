import { Zap, GraduationCap, Code, Coffee, Sparkles, Workflow, Bug, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type SuggestedPrompt } from '@/store/chatStore';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Zap,
  GraduationCap,
  Code,
  Coffee,
  Sparkles,
  Workflow,
  Bug,
  FileText,
};

// Extended prompts with more specific suggestions
export const extendedPrompts: SuggestedPrompt[] = [
  {
    id: 'create-workflow',
    icon: 'Workflow',
    label: 'Create workflow',
    prompt: 'Help me create a new workflow that',
    category: 'workflow',
  },
  {
    id: 'write-code',
    icon: 'Zap',
    label: 'Write code',
    prompt: 'Write code that',
    category: 'code',
  },
  {
    id: 'learn',
    icon: 'GraduationCap',
    label: 'Learn',
    prompt: 'Teach me about',
    category: 'learn',
  },
  {
    id: 'analyze',
    icon: 'Code',
    label: 'Analyze',
    prompt: 'Analyze this and provide insights:',
    category: 'code',
  },
  {
    id: 'life-stuff',
    icon: 'Coffee',
    label: 'Life stuff',
    prompt: 'Help me with',
    category: 'general',
  },
  {
    id: 'surprise-me',
    icon: 'Sparkles',
    label: 'Surprise me',
    prompt: 'Show me something interesting I can build with ShipSec workflows',
    category: 'general',
  },
];

interface SuggestedPromptsProps {
  onSelectPrompt: (prompt: string) => void;
  className?: string;
  variant?: 'pills' | 'cards';
}

export function SuggestedPrompts({
  onSelectPrompt,
  className,
  variant = 'pills',
}: SuggestedPromptsProps) {
  if (variant === 'cards') {
    return (
      <div className={cn('grid grid-cols-2 md:grid-cols-3 gap-3', className)}>
        {extendedPrompts.slice(0, 6).map((prompt) => {
          const Icon = iconMap[prompt.icon] || Sparkles;
          return (
            <button
              key={prompt.id}
              onClick={() => onSelectPrompt(prompt.prompt)}
              className="group flex flex-col items-start gap-2 p-4 rounded-xl bg-muted/50 border border-border hover:bg-accent hover:border-accent transition-all duration-200 text-left shadow-sm hover:shadow-md"
            >
              <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <span className="text-sm font-medium text-foreground/90 group-hover:text-foreground">
                {prompt.label}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-wrap justify-center gap-2', className)}>
      {extendedPrompts.map((prompt) => {
        const Icon = iconMap[prompt.icon] || Sparkles;
        return (
          <button
            key={prompt.id}
            onClick={() => onSelectPrompt(prompt.prompt)}
            className="group flex items-center gap-2 px-4 py-2.5 rounded-full bg-muted/50 border border-border hover:bg-accent hover:border-primary/30 transition-all duration-200 shadow-sm hover:shadow-md"
          >
            <Icon className="h-4 w-4 text-primary/70 group-hover:text-primary transition-colors" />
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
              {prompt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface QuickActionsBarProps {
  onAction: (action: string) => void;
  className?: string;
}

export function QuickActionsBar({ onAction, className }: QuickActionsBarProps) {
  const actions = [
    { id: 'new-workflow', icon: Workflow, label: 'New Workflow', command: 'Create a new workflow' },
    { id: 'debug', icon: Bug, label: 'Debug', command: 'Help me debug:' },
    {
      id: 'docs',
      icon: FileText,
      label: 'Documentation',
      command: 'Show me the documentation for',
    },
  ];

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            onClick={() => onAction(action.command)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-accent rounded-lg border border-border transition-all duration-200"
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}
