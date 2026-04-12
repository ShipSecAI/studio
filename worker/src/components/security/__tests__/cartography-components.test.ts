import { describe, test, expect } from 'bun:test';
import { componentRegistry } from '@shipsec/component-sdk';
import {
  DEFAULT_NEO4J_DATABASE as QUERY_DEFAULT_DATABASE,
  DEFAULT_NEO4J_URI as QUERY_DEFAULT_URI,
} from '../cartography-query';
import {
  DEFAULT_NEO4J_DATABASE as SYNC_DEFAULT_DATABASE,
  DEFAULT_NEO4J_URI as SYNC_DEFAULT_URI,
} from '../cartography-sync';
import '../cartography-query';
import '../cartography-sync';

describe('Cartography components', () => {
  test('cartography query uses host-friendly Neo4j defaults', () => {
    const component: any = componentRegistry.get('mcp.cartography.query');
    const parsed = component.parameters.parse({});

    expect(parsed.neo4jUri).toBe(QUERY_DEFAULT_URI);
    expect(parsed.neo4jDatabase).toBe(QUERY_DEFAULT_DATABASE);
  });

  test('cartography sync uses host-friendly Neo4j defaults', () => {
    const component: any = componentRegistry.get('security.cartography.sync');
    const parsed = component.parameters.parse({});

    expect(parsed.neo4jUri).toBe(SYNC_DEFAULT_URI);
    expect(parsed.neo4jDatabase).toBe(SYNC_DEFAULT_DATABASE);
  });
});
