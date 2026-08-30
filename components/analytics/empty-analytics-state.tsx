'use client';

import Link from 'next/link';
import { BarChart3, MessageSquare, Plus, ShoppingBag } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function EmptyAnalyticsState() {
  return (
    <Card className="border-dashed">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <BarChart3 className="h-6 w-6 text-muted-foreground" />
        </div>
        <CardTitle className="text-xl">No analytics data recorded yet</CardTitle>
        <CardDescription className="max-w-md mx-auto">
          Analytics, AI telemetry, and message volumes will appear automatically as your WhatsApp
          business receives conversations and orders.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
        <Button variant="outline" asChild>
          <Link href="/conversations">
            <MessageSquare className="mr-2 h-4 w-4" />
            Open Inbox
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/products/new">
            <Plus className="mr-2 h-4 w-4" />
            Add Product
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/orders/new">
            <ShoppingBag className="mr-2 h-4 w-4" />
            Create Order
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
