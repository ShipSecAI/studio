import { Card, CardContent } from '@/components/ui/card';
import { ShieldCheck, Code, Workflow } from 'lucide-react';

const UNLOCK_CARDS = [
  {
    title: 'Code Security',
    description: 'Detect vulnerabilities, secrets, and misconfigurations in your codebase.',
    icon: Code,
    tools: ['OpenGrep', 'TruffleHog'],
  },
  {
    title: 'Cloud Security',
    description: 'Audit your AWS infrastructure for compliance and security posture.',
    icon: ShieldCheck,
    tools: ['Prowler'],
  },
  {
    title: 'Workflows',
    description: 'Automate security scans on PRs, pushes, and schedules.',
    icon: Workflow,
    tools: ['Templates', 'Schedules'],
  },
];

export function WhatYouWillUnlockSection() {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        What You&apos;ll Unlock
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {UNLOCK_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title} className="opacity-70 hover:opacity-100 transition-opacity">
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon className="h-4.5 w-4.5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-sm">{card.title}</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{card.description}</p>
                <div className="flex gap-1.5">
                  {card.tools.map((tool) => (
                    <span
                      key={tool}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
