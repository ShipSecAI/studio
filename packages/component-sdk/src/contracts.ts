import { z } from 'zod';

export interface ComponentContract<T = unknown> {
  name: string;
  schema: z.ZodType<T>;
  summary?: string;
  description?: string;
  fields?: Array<{
    name: string;
    description?: string;
  }>;
}

const contractRegistry = new Map<string, ComponentContract<any>>();

export function registerContract<T>(contract: ComponentContract<T>): void {
  if (contractRegistry.has(contract.name)) {
    throw new Error(`Contract ${contract.name} is already registered`);
  }
  contractRegistry.set(contract.name, contract as ComponentContract<any>);
}

export function getContract<T = unknown>(
  name: string,
): ComponentContract<T> | undefined {
  return contractRegistry.get(name) as ComponentContract<T> | undefined;
}

export function listContracts(): Array<ComponentContract<any>> {
  return Array.from(contractRegistry.values());
}
