import 'server-only';

import type { ToolRegistry } from '../registry';
import { checkInventoryTool } from './check-inventory.tool';
import { getBusinessInfoTool } from './get-business-info.tool';
import { getCurrentCustomerTool } from './get-current-customer.tool';
import { getOrderTool } from './get-order.tool';
import { getProductTool } from './get-product.tool';
import { searchProductsTool } from './search-products.tool';
import { createOrderTool } from './create-order.tool';
import { updateCustomerDetailsTool } from './update-customer-details.tool';
import { requestOrderCancellationTool } from './request-order-cancellation.tool';

export {
  checkInventoryTool,
  getBusinessInfoTool,
  getCurrentCustomerTool,
  getOrderTool,
  getProductTool,
  searchProductsTool,
  createOrderTool,
  updateCustomerDetailsTool,
  requestOrderCancellationTool,
};

export const allBusinessReadTools = [
  searchProductsTool,
  getProductTool,
  checkInventoryTool,
  getCurrentCustomerTool,
  getOrderTool,
  getBusinessInfoTool,
] as const;

/**
 * Registers all business read tools into a target ToolRegistry.
 */
export function registerBusinessReadTools(registry: ToolRegistry): ToolRegistry {
  for (const tool of allBusinessReadTools) {
    if (!registry.has(tool.name)) {
      registry.register(tool);
    }
  }
  return registry;
}

export const allBusinessWriteTools = [
  createOrderTool,
  updateCustomerDetailsTool,
  requestOrderCancellationTool,
] as const;

/**
 * Registers all business write tools into a target ToolRegistry.
 */
export function registerBusinessWriteTools(registry: ToolRegistry): ToolRegistry {
  for (const tool of allBusinessWriteTools) {
    if (!registry.has(tool.name)) {
      registry.register(tool);
    }
  }
  return registry;
}
