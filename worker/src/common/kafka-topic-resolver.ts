/**
 * Kafka Topic Resolver
 *
 * Provides instance-aware topic naming for multi-instance deployments.
 * When SHIPSEC_INSTANCE is set, topics are namespaced with the instance number.
 *
 * Environment Variables:
 * - SHIPSEC_INSTANCE: Instance number (0-9) for multi-instance isolation
 * - LOG_KAFKA_TOPIC: Base topic for logs (default: telemetry.logs)
 * - EVENT_KAFKA_TOPIC: Base topic for events (default: telemetry.events)
 * - AGENT_TRACE_KAFKA_TOPIC: Base topic for agent traces (default: telemetry.agent-trace)
 * - NODE_IO_KAFKA_TOPIC: Base topic for node I/O (default: telemetry.node-io)
 */

export interface TopicResolverConfig {
  instanceId?: string;
  enableInstanceSuffix?: boolean;
}

export class KafkaTopicResolver {
  private instanceId: string | undefined;
  private enableInstanceSuffix: boolean;

  constructor(config: TopicResolverConfig = {}) {
    this.instanceId = config.instanceId ?? process.env.SHIPSEC_INSTANCE;
    // Enable instance suffix only if SHIPSEC_INSTANCE is set
    this.enableInstanceSuffix = config.enableInstanceSuffix ?? Boolean(this.instanceId);
  }

  /**
   * Resolve topic name with instance suffix if applicable
   * @param baseTopic The base topic name
   * @returns The topic name with instance suffix (if enabled)
   */
  resolveTopic(baseTopic: string): string {
    if (!this.enableInstanceSuffix || !this.instanceId) {
      return baseTopic;
    }
    return `${baseTopic}.instance-${this.instanceId}`;
  }

  /**
   * Get logs topic
   */
  getLogsTopic(): string {
    const baseTopic = process.env.LOG_KAFKA_TOPIC ?? 'telemetry.logs';
    return this.resolveTopic(baseTopic);
  }

  /**
   * Get events topic
   */
  getEventsTopic(): string {
    const baseTopic = process.env.EVENT_KAFKA_TOPIC ?? 'telemetry.events';
    return this.resolveTopic(baseTopic);
  }

  /**
   * Get agent trace topic
   */
  getAgentTraceTopic(): string {
    const baseTopic = process.env.AGENT_TRACE_KAFKA_TOPIC ?? 'telemetry.agent-trace';
    return this.resolveTopic(baseTopic);
  }

  /**
   * Get node I/O topic
   */
  getNodeIOTopic(): string {
    const baseTopic = process.env.NODE_IO_KAFKA_TOPIC ?? 'telemetry.node-io';
    return this.resolveTopic(baseTopic);
  }

  /**
   * Check if instance isolation is enabled
   */
  isInstanceIsolated(): boolean {
    return this.enableInstanceSuffix;
  }

  /**
   * Get instance ID (if set)
   */
  getInstanceId(): string | undefined {
    return this.instanceId;
  }
}

// Singleton instance
let resolver: KafkaTopicResolver;

/**
 * Get or create the singleton topic resolver
 */
export function getTopicResolver(config?: TopicResolverConfig): KafkaTopicResolver {
  if (!resolver) {
    resolver = new KafkaTopicResolver(config);
  }
  return resolver;
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetTopicResolver(): void {
  resolver = undefined!;
}
