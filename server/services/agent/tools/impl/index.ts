import 'server-only';

import type { ToolRegistry } from '../registry';
import { checkInventoryTool } from './check-inventory.tool';
import { getCurrentCustomerTool } from './get-current-customer.tool';
import { getOrderTool } from './get-order.tool';
import { getProductTool } from './get-product.tool';
import { searchProductsTool } from './search-products.tool';

export {
  checkInventoryTool,
  getCurrentCustomerTool,
  getOrderTool,
  getProductTool,
  searchProductsTool,
};

export const allBusinessReadTools = [
  searchProductsTool,
  getProductTool,
  checkInventoryTool,
  getCurrentCustomerTool,
  getOrderTool,
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
