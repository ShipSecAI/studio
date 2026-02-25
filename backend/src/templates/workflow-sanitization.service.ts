import { Injectable, Logger } from '@nestjs/common';
import { RequiredSecret } from '../database/schema/templates';

/**
 * Workflow Sanitization Service
 * Removes secrets from workflows before publishing as templates
 */
@Injectable()
export class WorkflowSanitizationService {
  private readonly logger = new Logger(WorkflowSanitizationService.name);

  /**
   * Sanitize a workflow graph by removing all secret references
   * Returns the sanitized graph along with detected secrets
   */
  sanitizeWorkflow(graph: Record<string, unknown>): {
    sanitizedGraph: Record<string, unknown>;
    requiredSecrets: RequiredSecret[];
    removedSecrets: string[];
  } {
    const requiredSecrets: RequiredSecret[] = [];
    const removedSecrets: string[] = [];

    // Deep clone to avoid mutating original
    const sanitizedGraph = JSON.parse(JSON.stringify(graph));

    // Traverse the graph to find and remove secret references
    this.traverseAndSanitize(sanitizedGraph, requiredSecrets, removedSecrets);

    this.logger.log(`Sanitized workflow: removed ${removedSecrets.length} secrets`);

    return {
      sanitizedGraph,
      requiredSecrets,
      removedSecrets,
    };
  }

  /**
   * Deep traverse the graph and sanitize secret references
   */
  private traverseAndSanitize(
    obj: unknown,
    requiredSecrets: RequiredSecret[],
    removedSecrets: string[],
    parentPath = '',
  ): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        this.traverseAndSanitize(obj[i], requiredSecrets, removedSecrets, `${parentPath}[${i}]`);
      }
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      const currentPath = parentPath ? `${parentPath}.${key}` : key;

      // Check for secret reference pattern
      if (this.isSecretReference(value, key)) {
        const secretInfo = this.extractSecretInfo(value, key);
        if (secretInfo) {
          requiredSecrets.push(secretInfo);
          removedSecrets.push(secretInfo.name);

          // Replace with placeholder
          (obj as Record<string, unknown>)[key] = this.createPlaceholder(secretInfo);
        }
      } else if (typeof value === 'object' && value !== null) {
        this.traverseAndSanitize(value, requiredSecrets, removedSecrets, currentPath);
      }
    }
  }

  /**
   * Check if a value is a secret reference
   */
  private isSecretReference(value: unknown, key: string): boolean {
    // Check for connection type references
    if (key === 'connectionType' && typeof value === 'object' && value !== null) {
      const connection = value as Record<string, unknown>;
      return connection.kind === 'secret' || connection.kind === 'primitive_secret';
    }

    // Check for secret references in specific fields
    if (key === 'secretId' || key === 'secret_name' || key === 'apiKey') {
      return true;
    }

    // Check for secret pattern in strings
    if (typeof value === 'string') {
      return value.startsWith('{{secret:') || value.startsWith('{{ secrets.');
    }

    return false;
  }

  /**
   * Extract secret information from a secret reference
   */
  private extractSecretInfo(value: unknown, key: string): RequiredSecret | null {
    if (typeof value === 'object' && value !== null) {
      const connection = value as Record<string, unknown>;
      if (connection.kind === 'secret' || connection.kind === 'primitive_secret') {
        return {
          name: (connection.name as string) || `secret_${key}`,
          type: (connection.type as string) || 'string',
          description: connection.description as string | undefined,
          placeholder: this.generatePlaceholder((connection.name as string) || key),
        };
      }
    }

    if (typeof value === 'string') {
      const match = value.match(/{{secret:(.+?)}}/) || value.match(/{{secrets\.(.+?)}}/);
      if (match) {
        return {
          name: match[1].trim(),
          type: 'string',
          placeholder: this.generatePlaceholder(match[1].trim()),
        };
      }
    }

    return {
      name: `secret_${key}`,
      type: 'string',
      placeholder: this.generatePlaceholder(key),
    };
  }

  /**
   * Create a placeholder for a secret
   */
  private createPlaceholder(secretInfo: RequiredSecret): string {
    return secretInfo.placeholder || `{{REPLACE_WITH_${secretInfo.name.toUpperCase()}}`;
  }

  /**
   * Generate a placeholder string
   */
  private generatePlaceholder(secretName: string): string {
    return `REPLACE_WITH_${secretName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  }

  /**
   * Validate that a sanitized workflow graph is still valid
   */
  validateSanitizedGraph(graph: Record<string, unknown>): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check if graph has required structure
    if (!graph.nodes || !Array.isArray(graph.nodes)) {
      errors.push('Graph must have a nodes array');
    }

    if (!graph.edges || !Array.isArray(graph.edges)) {
      errors.push('Graph must have an edges array');
    }

    // Check if nodes have required properties
    if (Array.isArray(graph.nodes) && graph.nodes.length > 0) {
      for (const node of graph.nodes) {
        if (typeof node !== 'object' || node === null) {
          errors.push('All nodes must be objects');
          continue;
        }

        if (!('id' in node)) {
          errors.push(`Node missing required field: id`);
        }

        if (!('componentId' in node)) {
          errors.push(`Node ${node.id || 'unknown'} missing required field: componentId`);
        }
      }
    }

    // Check for remaining secret references that shouldn't be there
    const graphStr = JSON.stringify(graph);
    const secretPatterns = ['{{secret:', '{{secrets.', 'connectionType.secret'];
    for (const pattern of secretPatterns) {
      if (graphStr.includes(pattern)) {
        errors.push(`Graph still contains secret references: ${pattern}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Generate a template manifest from workflow and metadata
   */
  generateManifest(params: {
    name: string;
    description: string;
    category: string;
    tags: string[];
    author: string;
    graph: Record<string, unknown>;
    requiredSecrets: RequiredSecret[];
  }): Record<string, unknown> {
    const { name, description, category, tags, author, graph, requiredSecrets } = params;

    // Detect entry point (first trigger node)
    const entryPoint = this.findEntryPoint(graph);

    return {
      name,
      description,
      version: '1.0.0',
      author,
      category: category || 'other',
      tags: tags || [],
      requiredSecrets: requiredSecrets.map((s) => ({
        name: s.name,
        type: s.type,
        description: s.description || `Secret required for ${s.name}`,
      })),
      entryPoint,
      nodeCount: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
      edgeCount: Array.isArray(graph.edges) ? graph.edges.length : 0,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Find the entry point node (first trigger node)
   */
  private findEntryPoint(graph: Record<string, unknown>): string | undefined {
    if (!graph.nodes || !Array.isArray(graph.nodes)) {
      return undefined;
    }

    const triggerNode = graph.nodes.find((node: unknown) => {
      if (typeof node === 'object' && node !== null) {
        const n = node as Record<string, unknown>;
        return n.componentType === 'trigger';
      }
      return false;
    });

    return triggerNode?.id as string | undefined;
  }
}
