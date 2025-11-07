import posthog from 'posthog-js'
import type { Properties } from 'posthog-js'
import { z } from 'zod'
import { isAnalyticsEnabled } from './config'

// Event names (prefix ui_ to separate from server events later)
export const Events = {
  WorkflowListViewed: 'ui_workflow_list_viewed',
  WorkflowCreateClicked: 'ui_workflow_create_clicked',
  WorkflowBuilderLoaded: 'ui_workflow_builder_loaded',
  WorkflowCreated: 'ui_workflow_created',
  WorkflowSaved: 'ui_workflow_saved',
  WorkflowRunStarted: 'ui_workflow_run_started',
  NodeAdded: 'ui_node_added',
  SecretCreated: 'ui_secret_created',
  SecretDeleted: 'ui_secret_deleted',
} as const

type EventName = (typeof Events)[keyof typeof Events]

// Payload schemas (each must be assignable to PostHog Properties)
const payloadSchemas: { [K in EventName]: z.ZodSchema<Properties> } = {
  [Events.WorkflowListViewed]: z.object({
    workflows_count: z.number().int().nonnegative().optional(),
  }),
  [Events.WorkflowCreateClicked]: z.object({}),
  [Events.WorkflowBuilderLoaded]: z.object({
    workflow_id: z.string().optional(),
    is_new: z.boolean(),
    node_count: z.number().int().nonnegative().optional(),
  }),
  [Events.WorkflowCreated]: z.object({
    workflow_id: z.string(),
    node_count: z.number().int().nonnegative(),
    edge_count: z.number().int().nonnegative(),
  }),
  [Events.WorkflowSaved]: z.object({
    workflow_id: z.string(),
    node_count: z.number().int().nonnegative(),
    edge_count: z.number().int().nonnegative(),
  }),
  [Events.WorkflowRunStarted]: z.object({
    workflow_id: z.string(),
    run_id: z.string().optional(),
    node_count: z.number().int().nonnegative().optional(),
    has_manual_trigger: z.boolean().optional(),
  }),
  [Events.NodeAdded]: z.object({
    workflow_id: z.string().optional(),
    component_slug: z.string(),
  }),
  [Events.SecretCreated]: z.object({
    has_tags: z.boolean().optional(),
    tag_count: z.number().int().nonnegative().optional(),
    name_length: z.number().int().nonnegative().optional(),
  }),
  [Events.SecretDeleted]: z.object({
    name_length: z.number().int().nonnegative().optional(),
  }),
}

export function track<T extends EventName>(event: T, payload: unknown = {}): void {
  // If PostHog isn't initialised (e.g., keys missing), fail silently.
  // Narrowly validate payloads to keep data tidy.
  if (!isAnalyticsEnabled()) return
  try {
    const schema = payloadSchemas[event]
    const data = schema.parse(payload) as Properties
    posthog.capture(event, data)
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug('[analytics]', event, data)
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[analytics] capture failed', event, err)
  }
}
