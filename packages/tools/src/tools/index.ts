import { ToolRegistry } from '../registry.js';
import { checkPolicy } from './check-policy.js';
import { createReplacement } from './create-replacement.js';
import { escalateToHuman } from './escalate-to-human.js';
import { getCustomer } from './get-customer.js';
import { getOrder } from './get-order.js';
import { searchKnowledge } from './search-knowledge.js';

export const registry = new ToolRegistry();
for (const tool of [
  getOrder,
  getCustomer,
  searchKnowledge,
  checkPolicy,
  createReplacement,
  escalateToHuman,
]) {
  registry.register(tool as never);
}

export { getOrder, getCustomer, searchKnowledge, checkPolicy, createReplacement, escalateToHuman };
