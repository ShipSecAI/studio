import { create } from 'zustand';
import { API_BASE_URL, getApiAuthHeaders } from '@/services/api';

export interface Template {
  id: string;
  name: string;
  description?: string;
  category?: string;
  tags: string[];
  author?: string;
  repository: string;
  path: string;
  branch: string;
  version?: string;
  manifest: Record<string, unknown>;
  graph?: Record<string, unknown>;
  requiredSecrets: { name: string; type: string; description?: string }[];
  popularity: number;
  isOfficial: boolean;
  isVerified: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateSubmission {
  id: string;
  templateName: string;
  description?: string;
  category?: string;
  repository: string;
  branch?: string;
  path: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  status: 'pending' | 'approved' | 'rejected' | 'merged';
  submittedBy: string;
  organizationId?: string;
  manifest?: Record<string, unknown>;
  graph?: Record<string, unknown>;
  feedback?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateCategory {
  category: string | null;
  count: number;
}

interface TemplateStore {
  // State
  templates: Template[];
  categories: TemplateCategory[];
  tags: string[];
  mySubmissions: TemplateSubmission[];
  isLoading: boolean;
  error: string | null;
  selectedCategory: string | null;
  selectedTags: string[];
  searchQuery: string;

  // Actions
  fetchTemplates: () => Promise<void>;
  fetchCategories: () => Promise<void>;
  fetchTags: () => Promise<void>;
  fetchMySubmissions: () => Promise<void>;
  publishTemplate: (data: {
    workflowId: string;
    name: string;
    description?: string;
    category: string;
    tags: string[];
    author: string;
  }) => Promise<{ templateId: string; pullRequestUrl: string; pullRequestNumber: number }>;
  useTemplate: (
    templateId: string,
    workflowName: string,
    secretMappings?: Record<string, string>,
  ) => Promise<{ workflowId: string; templateName: string }>;
  syncTemplates: () => Promise<void>;
  setSelectedCategory: (category: string | null) => void;
  setSelectedTags: (tags: string[]) => void;
  setSearchQuery: (query: string) => void;
  clearError: () => void;
}

/**
 * Template Store
 * Manages template library state and operations
 */
export const useTemplateStore = create<TemplateStore>((set, get) => ({
  // Initial state
  templates: [],
  categories: [],
  tags: [],
  mySubmissions: [],
  isLoading: false,
  error: null,
  selectedCategory: null,
  selectedTags: [],
  searchQuery: '',

  /**
   * Fetch templates with current filters
   */
  fetchTemplates: async () => {
    set({ isLoading: true, error: null });
    try {
      const { selectedCategory, selectedTags, searchQuery } = get();

      const params = new URLSearchParams();
      if (selectedCategory) params.set('category', selectedCategory);
      if (searchQuery) params.set('search', searchQuery);
      if (selectedTags.length > 0) params.set('tags', selectedTags.join(','));

      const headers = await getApiAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/v1/templates?${params.toString()}`, {
        headers,
      });

      if (!response.ok) {
        throw new Error('Failed to fetch templates');
      }

      const data = await response.json();
      set({ templates: data, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch templates',
        isLoading: false,
      });
    }
  },

  /**
   * Fetch template categories
   */
  fetchCategories: async () => {
    try {
      const headers = await getApiAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/v1/templates/categories`, {
        headers,
      });

      if (!response.ok) {
        throw new Error('Failed to fetch categories');
      }

      const data = await response.json();
      set({ categories: data });
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  },

  /**
   * Fetch template tags
   */
  fetchTags: async () => {
    try {
      const headers = await getApiAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/v1/templates/tags`, {
        headers,
      });

      if (!response.ok) {
        throw new Error('Failed to fetch tags');
      }

      const data = await response.json();
      set({ tags: data });
    } catch (err) {
      console.error('Failed to fetch tags:', err);
    }
  },

  /**
   * Fetch user's template submissions
   */
  fetchMySubmissions: async () => {
    try {
      const headers = await getApiAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/v1/templates/my`, {
        headers,
      });

      if (!response.ok) {
        throw new Error('Failed to fetch submissions');
      }

      const data = await response.json();
      set({ mySubmissions: data });
    } catch (err) {
      console.error('Failed to fetch submissions:', err);
    }
  },

  /**
   * Publish a workflow as a template
   * Note: This is now a no-op that returns success immediately.
   * The actual GitHub submission is handled by the PublishTemplateModal
   * which opens GitHub directly in the browser.
   */
  publishTemplate: async (data) => {
    // No-op: Return success immediately since the modal handles GitHub
    // The modal will open GitHub in the browser for the user to submit
    return Promise.resolve({
      templateId: data.workflowId,
      pullRequestUrl: '',
      pullRequestNumber: 0,
    });
  },

  /**
   * Use a template to create a new workflow
   */
  useTemplate: async (templateId, workflowName, secretMappings) => {
    set({ isLoading: true, error: null });
    try {
      const headers = await getApiAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/v1/templates/${templateId}/use`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workflowName, secretMappings }),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ message: 'Failed to use template' }));
        throw new Error(errorData.message || 'Failed to use template');
      }

      const result = await response.json();
      set({ isLoading: false });
      return result;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to use template',
        isLoading: false,
      });
      throw err;
    }
  },

  /**
   * Sync templates from GitHub
   */
  syncTemplates: async () => {
    set({ isLoading: true, error: null });
    try {
      const headers = await getApiAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/v1/templates/sync`, {
        method: 'POST',
        headers,
      });

      if (!response.ok) {
        throw new Error('Failed to sync templates');
      }

      // Refresh templates after sync
      await get().fetchTemplates();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to sync templates',
        isLoading: false,
      });
      throw err;
    }
  },

  /**
   * Set selected category filter
   */
  setSelectedCategory: (category) => {
    set({ selectedCategory: category });
    get().fetchTemplates();
  },

  /**
   * Set selected tags filter
   */
  setSelectedTags: (tags) => {
    set({ selectedTags: tags });
    get().fetchTemplates();
  },

  /**
   * Set search query
   */
  setSearchQuery: (query) => {
    set({ searchQuery: query });
    get().fetchTemplates();
  },

  /**
   * Clear error state
   */
  clearError: () => set({ error: null }),
}));
