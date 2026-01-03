import { z } from 'zod';

// ============================================================================
// Action Schemas
// ============================================================================

/**
 * Goto a URL
 */
export const gotoActionSchema = z.object({
  type: z.literal('goto'),
  url: z.string().url('Must be a valid URL'),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).default('load'),
  timeout: z.number().int().positive().optional(),
});

/**
 * Click an element
 */
export const clickActionSchema = z.object({
  type: z.literal('click'),
  selector: z.string().min(1, 'Selector is required'),
  waitForSelector: z.boolean().default(true),
  timeout: z.number().int().positive().optional(),
});

/**
 * Fill a form field
 */
export const fillActionSchema = z.object({
  type: z.literal('fill'),
  selector: z.string().min(1, 'Selector is required'),
  value: z.string(),
  timeout: z.number().int().positive().optional(),
});

/**
 * Take a screenshot
 */
export const screenshotActionSchema = z.object({
  type: z.literal('screenshot'),
  name: z.string().optional().default('screenshot'),
  fullPage: z.boolean().default(false),
});

/**
 * Get page HTML
 */
export const getHTMLActionSchema = z.object({
  type: z.literal('getHTML'),
  selector: z.string().optional(),
});

/**
 * Get text content
 */
export const getTextActionSchema = z.object({
  type: z.literal('getText'),
  selector: z.string().min(1, 'Selector is required'),
});

/**
 * Wait for selector
 */
export const waitForActionSchema = z.object({
  type: z.literal('waitFor'),
  selector: z.string().min(1, 'Selector is required'),
  state: z.enum(['attached', 'detached', 'hidden', 'visible']).default('visible'),
  timeout: z.number().int().positive().optional(),
});

/**
 * Evaluate JavaScript
 */
export const evaluateActionSchema = z.object({
  type: z.literal('evaluate'),
  script: z.string().min(1, 'Script is required'),
});

/**
 * Select option from dropdown
 */
export const selectActionSchema = z.object({
  type: z.literal('select'),
  selector: z.string().min(1, 'Selector is required'),
  value: z.string(),
});

/**
 * Hover over element
 */
export const hoverActionSchema = z.object({
  type: z.literal('hover'),
  selector: z.string().min(1, 'Selector is required'),
  timeout: z.number().int().positive().optional(),
});

/**
 * Scroll to element or position
 */
export const scrollActionSchema = z.object({
  type: z.literal('scroll'),
  selector: z.string().optional(),
  position: z.enum(['top', 'bottom']).optional(),
  timeout: z.number().int().positive().optional(),
});

// Union of all action types
export const browserActionSchema = z.discriminatedUnion('type', [
  gotoActionSchema,
  clickActionSchema,
  fillActionSchema,
  screenshotActionSchema,
  getHTMLActionSchema,
  getTextActionSchema,
  waitForActionSchema,
  evaluateActionSchema,
  selectActionSchema,
  hoverActionSchema,
  scrollActionSchema,
]);

export type BrowserAction = z.infer<typeof browserActionSchema>;

// ============================================================================
// Action Result Schemas
// ============================================================================

export const actionResultBaseSchema = z.object({
  action: z.string(),
  success: z.boolean(),
  timestamp: z.string(),
  duration: z.number(),
  error: z.string().optional(),
});

export const gotoResultSchema = actionResultBaseSchema.extend({
  action: z.literal('goto'),
  url: z.string().optional(),
  title: z.string().optional(),
});

export const clickResultSchema = actionResultBaseSchema.extend({
  action: z.literal('click'),
  selector: z.string().optional(),
});

export const fillResultSchema = actionResultBaseSchema.extend({
  action: z.literal('fill'),
  selector: z.string().optional(),
});

export const screenshotResultSchema = actionResultBaseSchema.extend({
  action: z.literal('screenshot'),
  name: z.string().optional(),
  artifactId: z.string().optional(),
  fileId: z.string().optional(),
  path: z.string().optional(),
});

export const getHTMLResultSchema = actionResultBaseSchema.extend({
  action: z.literal('getHTML'),
  html: z.string().optional(),
  selector: z.string().optional(),
});

export const getTextResultSchema = actionResultBaseSchema.extend({
  action: z.literal('getText'),
  text: z.string().optional(),
  selector: z.string().optional(),
});

export const waitForResultSchema = actionResultBaseSchema.extend({
  action: z.literal('waitFor'),
  selector: z.string().optional(),
});

export const evaluateResultSchema = actionResultBaseSchema.extend({
  action: z.literal('evaluate'),
  result: z.unknown().optional(),
});

export const selectResultSchema = actionResultBaseSchema.extend({
  action: z.literal('select'),
  selector: z.string().optional(),
  value: z.string().optional(),
});

export const hoverResultSchema = actionResultBaseSchema.extend({
  action: z.literal('hover'),
  selector: z.string().optional(),
});

export const scrollResultSchema = actionResultBaseSchema.extend({
  action: z.literal('scroll'),
  selector: z.string().optional(),
  position: z.string().optional(),
});

export const actionResultSchema = z.discriminatedUnion('action', [
  gotoResultSchema,
  clickResultSchema,
  fillResultSchema,
  screenshotResultSchema,
  getHTMLResultSchema,
  getTextResultSchema,
  waitForResultSchema,
  evaluateResultSchema,
  selectResultSchema,
  hoverResultSchema,
  scrollResultSchema,
]);

export type ActionResult = z.infer<typeof actionResultSchema>;

// ============================================================================
// Input/Output Schemas
// ============================================================================

export const browserAutomationInputSchema = z.object({
  // Starting URL
  url: z.string().url().describe('Starting URL for the browser session'),

  // Actions to execute
  actions: z.array(browserActionSchema).default([]).describe('Array of browser actions to execute in sequence'),

  // Browser options
  options: z.object({
    headless: z.boolean().default(true).describe('Run headless (no visible UI)'),
    viewport: z.object({
      width: z.number().int().positive().default(1280),
      height: z.number().int().positive().default(720),
    }).default({ width: 1280, height: 720 }).describe('Browser viewport dimensions'),

    timeout: z.number().int().positive().default(30000).describe('Default timeout for actions (ms)'),

    userAgent: z.string().optional().describe('Custom user agent string'),

    // Screenshot options
    screenshotOnStart: z.boolean().default(false).describe('Take screenshot on start'),
    screenshotOnEnd: z.boolean().default(true).describe('Take screenshot on end'),
    screenshotOnError: z.boolean().default(true).describe('Take screenshot on error'),
    fullPageScreenshots: z.boolean().default(false).describe('Capture full page in screenshots'),

    // Console logging
    captureConsole: z.boolean().default(true).describe('Capture browser console logs'),
    captureNetwork: z.boolean().default(false).describe('Capture network requests (experimental)'),

    // Security options
    blockTracking: z.boolean().default(true).describe('Block common tracking scripts'),
  }).default({
    headless: true,
    viewport: { width: 1280, height: 720 },
    timeout: 30000,
    screenshotOnStart: false,
    screenshotOnEnd: true,
    screenshotOnError: true,
    fullPageScreenshots: false,
    captureConsole: true,
    captureNetwork: false,
    blockTracking: true,
  } as any).describe('Browser execution options'),
});

export type BrowserAutomationInput = z.infer<typeof browserAutomationInputSchema>;

export const browserAutomationOutputSchema = z.object({
  success: z.boolean().describe('Whether the workflow completed successfully'),
  results: z.array(actionResultSchema).describe('Results of each action executed'),
  screenshots: z.array(z.object({
    name: z.string(),
    artifactId: z.string().optional(),
    fileId: z.string().optional(),
    timestamp: z.string(),
    path: z.string().optional(),
  })).describe('Screenshot artifacts captured'),
  consoleLogs: z.array(z.object({
    level: z.enum(['log', 'warn', 'error', 'debug', 'info']),
    text: z.string(),
    timestamp: z.string(),
  })).describe('Browser console logs captured'),
  finalUrl: z.string().optional().describe('Final URL after all actions'),
  pageTitle: z.string().optional().describe('Page title at end'),
  error: z.string().optional().describe('Error message if workflow failed'),
});

export type BrowserAutomationOutput = z.infer<typeof browserAutomationOutputSchema>;
