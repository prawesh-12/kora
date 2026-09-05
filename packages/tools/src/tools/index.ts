import { ToolRegistry } from '../registry.js';
import { cancelSubscription } from './cancel-subscription.js';
import { changePlan } from './change-plan.js';
import { checkPolicy } from './check-policy.js';
import { createRefund } from './create-refund.js';
import { createTicket } from './create-ticket.js';
import { escalateToHuman } from './escalate-to-human.js';
import { getCustomer } from './get-customer.js';
import { getInvoice } from './get-invoice.js';
import { getSubscription } from './get-subscription.js';
import { previewChange } from './preview-change.js';
import { searchKnowledge } from './search-knowledge.js';

export const registry = new ToolRegistry();
for (const tool of [
  getSubscription,
  getCustomer,
  getInvoice,
  previewChange,
  searchKnowledge,
  checkPolicy,
  createRefund,
  cancelSubscription,
  changePlan,
  createTicket,
  escalateToHuman,
]) {
  registry.register(tool as never);
}

export {
  getSubscription,
  getCustomer,
  getInvoice,
  previewChange,
  searchKnowledge,
  checkPolicy,
  createRefund,
  cancelSubscription,
  changePlan,
  createTicket,
  escalateToHuman,
};
