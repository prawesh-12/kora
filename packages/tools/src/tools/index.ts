import { ToolRegistry } from '../registry.js';
import { cancelOrder } from './cancel-order.js';
import { checkPolicy } from './check-policy.js';
import { createRefund } from './create-refund.js';
import { createReplacement } from './create-replacement.js';
import { createTicket } from './create-ticket.js';
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
  createRefund,
  cancelOrder,
  createTicket,
  escalateToHuman,
]) {
  registry.register(tool as never);
}

export {
  getOrder,
  getCustomer,
  searchKnowledge,
  checkPolicy,
  createReplacement,
  createRefund,
  cancelOrder,
  createTicket,
  escalateToHuman,
};
