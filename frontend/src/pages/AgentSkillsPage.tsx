import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useAgentSkills,
  useCreateAgentSkill,
  useUpdateAgentSkill,
  useDeleteAgentSkill,
  useToggleAgentSkill,
  type AgentSkillResponse,
  type CreateAgentSkillInput,
  type UpdateAgentSkillInput,
} from '@/hooks/queries/useAgentSkillQueries';
import { cn } from '@/lib/utils';
import { Plus, Search, Sparkles, Trash2, FileText, Pencil, ChevronRight } from 'lucide-react';

const NAME_PATTERN = /^[a-z0-9-]+$/;

interface SkillFormState {
  name: string;
  description: string;
  content: string;
  allowedTools: string;
}

const INITIAL_FORM: SkillFormState = {
  name: '',
  description: '',
  content: '',
  allowedTools: '',
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

export function AgentSkillsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');

  const { data: skills = [], isLoading } = useAgentSkills();
  const createMutation = useCreateAgentSkill();
  const updateMutation = useUpdateAgentSkill();
  const deleteMutation = useDeleteAgentSkill();
  const toggleMutation = useToggleAgentSkill();

  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<SkillFormState>(INITIAL_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentSkillResponse | null>(null);

  const selectedSkill = useMemo(
    () => skills.find((s) => s.id === selectedId) ?? null,
    [skills, selectedId],
  );

  const filteredSkills = useMemo(() => {
    if (!search.trim()) return skills;
    const q = search.toLowerCase();
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [skills, search]);

  const enabledSkills = useMemo(() => filteredSkills.filter((s) => s.isEnabled), [filteredSkills]);
  const disabledSkills = useMemo(
    () => filteredSkills.filter((s) => !s.isEnabled),
    [filteredSkills],
  );

  const isFormValid = useMemo(
    () =>
      form.name.trim().length > 0 &&
      NAME_PATTERN.test(form.name.trim()) &&
      form.description.trim().length > 0 &&
      form.content.trim().length > 0,
    [form],
  );

  const selectSkill = (id: string) => {
    setSearchParams({ id });
    setIsEditing(false);
    setIsCreating(false);
  };

  const startCreate = () => {
    setForm(INITIAL_FORM);
    setFormError(null);
    setIsCreating(true);
    setIsEditing(false);
    setSearchParams({});
  };

  const startEdit = () => {
    if (!selectedSkill) return;
    setForm({
      name: selectedSkill.name,
      description: selectedSkill.description,
      content: selectedSkill.content,
      allowedTools: selectedSkill.allowedTools ?? '',
    });
    setFormError(null);
    setIsEditing(true);
    setIsCreating(false);
  };

  const cancelForm = () => {
    setIsCreating(false);
    setIsEditing(false);
    setForm(INITIAL_FORM);
    setFormError(null);
  };

  const handleSave = async () => {
    setFormError(null);
    if (isCreating) {
      const input: CreateAgentSkillInput = {
        name: form.name.trim(),
        description: form.description.trim(),
        content: form.content.trim(),
        allowedTools: form.allowedTools.trim() || undefined,
        isEnabled: true,
      };
      try {
        const created = await createMutation.mutateAsync(input);
        setIsCreating(false);
        setForm(INITIAL_FORM);
        setSearchParams({ id: created.id });
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Failed to create skill');
      }
    } else if (isEditing && selectedSkill) {
      const input: UpdateAgentSkillInput = {
        name: form.name.trim(),
        description: form.description.trim(),
        content: form.content.trim(),
        allowedTools: form.allowedTools.trim() || null,
      };
      try {
        await updateMutation.mutateAsync({ id: selectedSkill.id, input });
        setIsEditing(false);
        setForm(INITIAL_FORM);
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Failed to update skill');
      }
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      if (selectedId === deleteTarget.id) setSearchParams({});
      setDeleteTarget(null);
    } catch {
      // handled by mutation
    }
  };

  const handleToggle = async (skill: AgentSkillResponse) => {
    try {
      await toggleMutation.mutateAsync(skill.id);
    } catch {
      // silent
    }
  };

  const handleFieldChange =
    (field: keyof SkillFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
    };

  const showForm = isCreating || isEditing;

  // --- Sidebar skill list item ---
  const SkillListItem = ({ skill }: { skill: AgentSkillResponse }) => {
    const isSelected = skill.id === selectedId && !showForm;
    return (
      <button
        type="button"
        onClick={() => selectSkill(skill.id)}
        className={cn(
          'w-full text-left px-3 py-2.5 rounded-md transition-colors group',
          'hover:bg-accent/50',
          isSelected && 'bg-accent',
        )}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium text-sm truncate flex-1">{skill.name}</span>
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity',
              'group-hover:opacity-100',
              isSelected && 'opacity-100',
            )}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 pl-5.5">
          {skill.description}
        </p>
      </button>
    );
  };

  return (
    <div className="flex h-full">
      {/* ── Sidebar ── */}
      <div className="w-[320px] shrink-0 border-r flex flex-col bg-background">
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">Agent Skills</h1>
            <Button size="sm" onClick={startCreate}>
              <Plus className="h-4 w-4 mr-1" />
              New
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search skills..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {isLoading && skills.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                Loading skills...
              </div>
            ) : filteredSkills.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                {search ? 'No skills match your search.' : 'No skills yet.'}
              </div>
            ) : (
              <>
                {enabledSkills.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Enabled ({enabledSkills.length})
                    </div>
                    {enabledSkills.map((skill) => (
                      <SkillListItem key={skill.id} skill={skill} />
                    ))}
                  </div>
                )}
                {disabledSkills.length > 0 && (
                  <div className={enabledSkills.length > 0 ? 'mt-3' : ''}>
                    <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Disabled ({disabledSkills.length})
                    </div>
                    {disabledSkills.map((skill) => (
                      <SkillListItem key={skill.id} skill={skill} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ── Detail Panel ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {showForm ? (
          /* ── Create / Edit Form ── */
          <div className="flex-1 overflow-auto">
            <div className="max-w-2xl mx-auto p-6 space-y-6">
              <div>
                <h2 className="text-xl font-semibold">
                  {isCreating ? 'Create New Skill' : `Edit "${selectedSkill?.name}"`}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {isCreating
                    ? 'Define a reusable skill that can be injected into AI agent workspaces.'
                    : 'Update the skill definition and content.'}
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    placeholder="e.g. cloud-audit"
                    value={form.name}
                    onChange={handleFieldChange('name')}
                  />
                  {form.name && !NAME_PATTERN.test(form.name) && (
                    <p className="text-xs text-destructive">
                      Only lowercase letters, numbers, and hyphens allowed.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    placeholder="Briefly describe what this skill teaches the agent"
                    value={form.description}
                    onChange={handleFieldChange('description')}
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Content (Markdown)</label>
                  <Textarea
                    placeholder="Markdown instructions injected as SKILL.md into the agent workspace..."
                    value={form.content}
                    onChange={handleFieldChange('content')}
                    rows={16}
                    className="font-mono text-xs"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Allowed Tools{' '}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <Input
                    placeholder="e.g. Bash Read Write"
                    value={form.allowedTools}
                    onChange={handleFieldChange('allowedTools')}
                  />
                  <p className="text-xs text-muted-foreground">
                    Space-separated list of tools the agent is allowed to use with this skill.
                  </p>
                </div>
              </div>

              {formError && <p className="text-sm text-destructive">{formError}</p>}

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleSave}
                  disabled={!isFormValid || createMutation.isPending || updateMutation.isPending}
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? 'Saving...'
                    : isCreating
                      ? 'Create Skill'
                      : 'Save Changes'}
                </Button>
                <Button variant="outline" onClick={cancelForm}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : selectedSkill ? (
          /* ── Skill Detail View ── */
          <div className="flex-1 overflow-auto">
            <div className="max-w-2xl mx-auto p-6 space-y-6">
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-semibold truncate">{selectedSkill.name}</h2>
                    <Badge
                      variant={selectedSkill.isEnabled ? 'default' : 'secondary'}
                      className="shrink-0"
                    >
                      {selectedSkill.isEnabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{selectedSkill.description}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={startEdit}>
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(selectedSkill)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Meta */}
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground border-b pb-4">
                <div>
                  <span className="font-medium text-foreground">Created</span>{' '}
                  {formatDate(selectedSkill.createdAt)}
                </div>
                <div>
                  <span className="font-medium text-foreground">Updated</span>{' '}
                  {formatDate(selectedSkill.updatedAt)}
                </div>
                {selectedSkill.allowedTools && (
                  <div>
                    <span className="font-medium text-foreground">Allowed tools</span>{' '}
                    {selectedSkill.allowedTools}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">Status</span>
                  <Switch
                    checked={selectedSkill.isEnabled}
                    onCheckedChange={() => handleToggle(selectedSkill)}
                    disabled={toggleMutation.isPending}
                  />
                </div>
              </div>

              {/* Content */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  SKILL.md Content
                </div>
                <div className="rounded-md border bg-muted/30 p-4">
                  <pre className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed">
                    {selectedSkill.content}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ── Empty State ── */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-sm">
              <Sparkles className="h-10 w-10 text-muted-foreground/50 mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-1">
                {skills.length === 0 ? 'No skills yet' : 'Select a skill'}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {skills.length === 0
                  ? 'Create your first skill to teach agents specialized knowledge and workflows.'
                  : 'Choose a skill from the sidebar to view its details, or create a new one.'}
              </p>
              {skills.length === 0 && (
                <Button onClick={startCreate}>
                  <Plus className="h-4 w-4 mr-1" />
                  Create Skill
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Skill</DialogTitle>
            <DialogDescription>
              This will permanently remove <strong>{deleteTarget?.name}</strong>. Agents using this
              skill will no longer have access to it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Skill'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
