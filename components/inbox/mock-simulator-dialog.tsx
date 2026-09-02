'use client';

/**
 * Development-only WhatsApp simulator.
 *
 * Injects an inbound customer message or a delivery receipt so the inbox, the AI and the
 * status ticks can be exercised without a connected Meta account. It never renders in a
 * production build.
 *
 * This is the one surface in the product whose audience is a developer rather than a shop
 * owner, so "wamid" and "E.164" stay — they are the words the person using it is looking
 * for. What was wrong here was not the vocabulary but the construction: a hand-rolled tab
 * strip, a hand-rolled feedback box, raw amber and emerald utilities that do not follow the
 * theme, unlabelled inputs, and every button shrunk with an `h-8 text-xs` override. All of
 * that is now the same `Tabs`, `Alert`, `Label` and `Button` the rest of the product uses.
 */

import { useState } from 'react';
import { AlertCircle, CheckCircle2, FlaskConical, Send } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { FormState } from '@/lib/form-state';
import {
  injectMockInboundAction,
  injectMockStatusAction,
} from '@/server/actions/whatsapp-mock.actions';

type SimulatorTab = 'inbound' | 'status';
type ReceiptStatus = 'DELIVERED' | 'READ' | 'FAILED';
type Feedback = { tone: 'success' | 'error'; message: string };

/**
 * A field-level validation message says more than "check the highlighted fields", and this
 * form has no per-field error slots to put it in — so it is promoted into the one alert.
 */
function failureMessage(result: FormState, fallback: string): string {
  const firstFieldError = result.fieldErrors
    ? Object.values(result.fieldErrors).flat()[0]
    : undefined;
  return firstFieldError ?? result.message ?? fallback;
}

export function MockSimulatorDialog({
  open,
  onOpenChange,
  activeProviderMessageId,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  activeProviderMessageId?: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<SimulatorTab>('inbound');

  const [fromPhone, setFromPhone] = useState('+923001234567');
  const [waProfileName, setWaProfileName] = useState('Simulated customer');
  const [body, setBody] = useState('Hi! Is this available in XL?');

  const [providerMessageId, setProviderMessageId] = useState(activeProviderMessageId ?? '');
  const [receiptStatus, setReceiptStatus] = useState<ReceiptStatus>('DELIVERED');

  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dialogOpen = open ?? isOpen;
  const setDialogOpen = onOpenChange ?? setIsOpen;

  // After the hooks, so the hook order is identical in both builds.
  if (process.env.NODE_ENV === 'production') return null;

  const submit = async (run: () => Promise<Feedback>) => {
    setFeedback(null);
    setIsSubmitting(true);
    try {
      setFeedback(await run());
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'The request did not complete.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInbound = (event: React.FormEvent) => {
    event.preventDefault();
    void submit(async () => {
      const formData = new FormData();
      formData.set('fromPhone', fromPhone);
      formData.set('waProfileName', waProfileName);
      formData.set('body', body);

      const result = await injectMockInboundAction({ status: 'idle' }, formData);

      if (result.status === 'success') {
        setBody('');
        return { tone: 'success', message: result.message ?? 'Inbound message injected.' };
      }
      return { tone: 'error', message: failureMessage(result, 'The message was not injected.') };
    });
  };

  const handleReceipt = (event: React.FormEvent) => {
    event.preventDefault();
    void submit(async () => {
      const formData = new FormData();
      formData.set('providerMessageId', providerMessageId);
      formData.set('status', receiptStatus);

      const result = await injectMockStatusAction({ status: 'idle' }, formData);

      if (result.status === 'success') {
        return { tone: 'success', message: result.message ?? 'Receipt applied.' };
      }
      return { tone: 'error', message: failureMessage(result, 'The receipt was not applied.') };
    });
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      {open === undefined ? (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <FlaskConical aria-hidden />
            Simulate
          </Button>
        </DialogTrigger>
      ) : null}

      <DialogContent>
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>WhatsApp simulator</DialogTitle>
            <Badge variant="warning" size="sm">
              Development only
            </Badge>
          </div>
          <DialogDescription>
            Inject an inbound message or a delivery receipt without a connected Meta account.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(next) => {
            setTab(next as SimulatorTab);
            setFeedback(null);
            if (next === 'status' && activeProviderMessageId && !providerMessageId) {
              setProviderMessageId(activeProviderMessageId);
            }
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="inbound" className="flex-1">
              Inbound message
            </TabsTrigger>
            <TabsTrigger value="status" className="flex-1">
              Delivery receipt
            </TabsTrigger>
          </TabsList>

          {feedback ? (
            <Alert
              variant={feedback.tone === 'success' ? 'success' : 'destructive'}
              live={feedback.tone === 'success' ? 'polite' : 'assertive'}
              className="mt-4 animate-slide-down"
            >
              {feedback.tone === 'success' ? (
                <CheckCircle2 aria-hidden />
              ) : (
                <AlertCircle aria-hidden />
              )}
              <AlertDescription>{feedback.message}</AlertDescription>
            </Alert>
          ) : null}

          <TabsContent value="inbound">
            <form onSubmit={handleInbound} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sim-from-phone">Customer number (E.164)</Label>
                <Input
                  id="sim-from-phone"
                  value={fromPhone}
                  onChange={(event) => setFromPhone(event.target.value)}
                  placeholder="+923001234567"
                  className="font-mono"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sim-profile-name">WhatsApp profile name</Label>
                <Input
                  id="sim-profile-name"
                  value={waProfileName}
                  onChange={(event) => setWaProfileName(event.target.value)}
                  placeholder="Simulated customer"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sim-body">Message</Label>
                <Textarea
                  id="sim-body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="What the customer sends"
                  required
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Close
                </Button>
                <Button type="submit" isLoading={isSubmitting}>
                  <Send aria-hidden />
                  Inject message
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          <TabsContent value="status">
            <form onSubmit={handleReceipt} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sim-wamid">Provider message id (wamid)</Label>
                <Input
                  id="sim-wamid"
                  value={providerMessageId}
                  onChange={(event) => setProviderMessageId(event.target.value)}
                  placeholder="wamid.mock_12345"
                  className="font-mono"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sim-receipt-status">New status</Label>
                <NativeSelect
                  id="sim-receipt-status"
                  value={receiptStatus}
                  onChange={(event) => setReceiptStatus(event.target.value as ReceiptStatus)}
                >
                  <option value="DELIVERED">Delivered — reached the handset</option>
                  <option value="READ">Read — the customer opened it</option>
                  <option value="FAILED">Failed — delivery error</option>
                </NativeSelect>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Close
                </Button>
                <Button type="submit" isLoading={isSubmitting}>
                  <Send aria-hidden />
                  Apply receipt
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
