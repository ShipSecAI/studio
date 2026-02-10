import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { Shield } from 'lucide-react';

import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { AuditLogSettings } from '@/pages/settings/AuditLogSettings';
import { cn } from '@/lib/utils';

export function SettingsPage() {
  const roles = useAuthStore((state) => state.roles);
  const isAdmin = hasAdminRole(roles);

  const tabs = [
    {
      label: 'Audit',
      to: '/settings/audit',
      adminOnly: true,
    },
  ];

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 md:mb-8">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold">Settings</h1>
            <p className="text-sm md:text-base text-muted-foreground mt-1">
              Organization and workspace configuration
            </p>
          </div>
        </div>

        {!isAdmin && (
          <div className="mb-4 md:mb-6 rounded-md bg-amber-500/10 p-3 md:p-4 border border-amber-500/20">
            <div className="flex items-start gap-2">
              <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs md:text-sm text-amber-600 dark:text-amber-400 font-medium">
                  Read-Only Access
                </p>
                <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-1">
                  You need admin privileges to view organization audit logs.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div className="flex gap-2 border-b">
            {tabs
              .filter((t) => (t.adminOnly ? isAdmin : true))
              .map((tab) => (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  className={({ isActive }) =>
                    cn(
                      'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                      isActive
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )
                  }
                >
                  {tab.label}
                </NavLink>
              ))}
          </div>

          <Routes>
            <Route path="/" element={<Navigate to="audit" replace />} />
            <Route path="audit" element={<AuditLogSettings />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
