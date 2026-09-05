import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatMoney, money } from '@/lib/money';
import type { SupportedCurrency } from '@/config/constants';
import type { TopProductDemand } from '@/server/repositories/revenue-intelligence.repository';
import { Package, TrendingUp } from 'lucide-react';

interface ProductDemandTableProps {
  products: TopProductDemand[];
  currency: SupportedCurrency;
}

export function ProductDemandTable({ products, currency }: ProductDemandTableProps) {
  if (!products || products.length === 0) {
    return (
      <Card className="flex flex-col">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-muted-foreground" aria-hidden />
            <CardTitle>Top In-Demand Products</CardTitle>
          </div>
          <CardDescription>
            Best-selling products based on qualifying customer orders in this period.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
          <Package className="h-10 w-10 text-muted-foreground/40 mb-3" aria-hidden />
          <p className="font-medium text-foreground">No product sales in this period</p>
          <p className="text-xs text-muted-foreground mt-1">
            When customers place orders, top-selling items and units sold will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" aria-hidden />
            <CardTitle>Top In-Demand Products</CardTitle>
          </div>
          <span className="text-xs text-muted-foreground font-mono">
            {products.length} product{products.length === 1 ? '' : 's'} ranked
          </span>
        </div>
        <CardDescription>
          Highest demand products ordered by customers through WhatsApp and store orders.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table aria-label="Top in-demand products">
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-center">#</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Units Sold</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((item, index) => (
              <TableRow key={item.productId || item.name}>
                <TableCell className="text-center font-medium text-muted-foreground">
                  {index + 1}
                </TableCell>
                <TableCell>
                  <div className="font-medium text-foreground">{item.name}</div>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {item.unitsSold.toLocaleString()}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-muted-foreground">
                  {item.orderCount.toLocaleString()}
                </TableCell>
                <TableCell className="text-right font-semibold font-mono text-foreground">
                  {formatMoney(money(item.revenueMinor, currency))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
