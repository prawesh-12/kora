import { ConfigError } from '@kora/core';
import type { z } from 'zod';
import type { ToolDefinition } from './types.js';

export function defineTool<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  d: ToolDefinition<I, O>,
): ToolDefinition<I, O> {
  return d;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  private static key(name: string, version: number) {
    return `${name}@${version}`;
  }

  register(tool: ToolDefinition): void {
    const key = ToolRegistry.key(tool.name, tool.version);
    if (this.tools.has(key)) {
      throw new ConfigError(`tool ${key} is already registered`, { code: 'DUPLICATE_TOOL' });
    }
    this.tools.set(key, tool);
  }

  get(name: string, version: number): ToolDefinition {
    const tool = this.tools.get(ToolRegistry.key(name, version));
    if (!tool) {
      // Silent version drift is how an agent starts calling a schema it was never tested against.
      throw new ConfigError(
        `tool ${name}@${version} is not registered. Registered: ${[...this.tools.keys()].join(', ')}`,
        { code: 'UNKNOWN_TOOL' },
      );
    }
    return tool;
  }

  has(name: string, version: number): boolean {
    return this.tools.has(ToolRegistry.key(name, version));
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }
}
