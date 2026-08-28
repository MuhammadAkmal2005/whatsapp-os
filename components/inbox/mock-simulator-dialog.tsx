'use client';

/**
 * Dev-only Mock WhatsApp Simulator Dialog.
 *
 * Provides quick interactive controls in the Inbox to simulate incoming WhatsApp customer messages
 * and status delivery/read receipts without connecting to external Meta servers.
 */

import { useState } from 'react';
import { MessageSquarePlus, RefreshCw, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  injectMockInboundAction,
  injectMockStatusAction,
} from '@/server/actions/whatsapp-mock.actions';

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
  const [activeTab, setActiveTab] = useState<'inbound' | 'status'>('inbound');

  // Form states
  const [fromPhone, setFromPhone] = useState('+923001234567');
  const [waProfileName, setWaProfileName] = useState('Simulated Customer');
  const [body, setBody] = useState('Hi! Is this item available in XL?');

  const [providerMsgId, setProviderMsgId] = useState(activeProviderMessageId ?? '');
  const [status, setStatus] = useState<'DELIVERED' | 'READ' | 'FAILED'>('DELIVERED');

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dialogOpen = open ?? isOpen;
  const setDialogOpen = onOpenChange ?? setIsOpen;

  // Development-only guard
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  const handleInboundSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.set('fromPhone', fromPhone);
      formData.set('waProfileName', waProfileName);
      formData.set('body', body);

      const res = await injectMockInboundAction({ status: 'idle' }, formData);

      if (res.status === 'success') {
        setFeedback({
          type: 'success',
          message: res.message ?? 'Mock customer message received successfully.',
        });
        setBody('');
      } else {
        setFeedback({
          type: 'error',
          message: res.message ?? 'Failed to inject mock message.',
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error submitting form.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.set('providerMessageId', providerMsgId);
      formData.set('status', status);

      const res = await injectMockStatusAction({ status: 'idle' }, formData);

      if (res.status === 'success') {
        setFeedback({
          type: 'success',
          message: res.message ?? `Status set to ${status}.`,
        });
      } else {
        setFeedback({
          type: 'error',
          message: res.message ?? 'Failed to update status.',
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error submitting form.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      {!open && (
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs h-8 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
          >
            <MessageSquarePlus className="size-3.5" aria-hidden />
            Simulate
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[485px]">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <span>WhatsApp Simulator</span>
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
              Dev Only
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Simulate incoming WhatsApp messages or status receipts without connecting to Meta.
          </DialogDescription>
        </DialogHeader>

        {/* Tab switcher */}
        <div className="flex border-b text-xs font-medium gap-4">
          <button
            type="button"
            onClick={() => {
              setActiveTab('inbound');
              setFeedback(null);
            }}
            className={`pb-2 border-b-2 transition-colors ${
              activeTab === 'inbound'
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Inbound Customer Message
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('status');
              setFeedback(null);
              if (activeProviderMessageId && !providerMsgId) {
                setProviderMsgId(activeProviderMessageId);
              }
            }}
            className={`pb-2 border-b-2 transition-colors ${
              activeTab === 'status'
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Status Receipt
          </button>
        </div>

        {feedback && (
          <div
            className={`p-2.5 rounded text-xs font-medium ${
              feedback.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                : 'bg-destructive/10 text-destructive border border-destructive/20'
            }`}
          >
            {feedback.message}
          </div>
        )}

        {activeTab === 'inbound' ? (
          <form onSubmit={handleInboundSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">From Phone (E.164 / National)</Label>
              <Input
                value={fromPhone}
                onChange={(e) => setFromPhone(e.target.value)}
                placeholder="+923001234567"
                className="h-8 text-xs font-mono"
                required
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Customer Name (WhatsApp Profile)</Label>
              <Input
                value={waProfileName}
                onChange={(e) => setWaProfileName(e.target.value)}
                placeholder="Simulated Customer"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Message Body</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Type incoming simulated customer message..."
                className="min-h-[80px] text-xs resize-none"
                required
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDialogOpen(false)}
                className="h-8 text-xs"
              >
                Close
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting} className="h-8 text-xs gap-1.5">
                {isSubmitting ? (
                  <RefreshCw className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Send className="size-3.5" aria-hidden />
                )}
                Inject Inbound
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleStatusSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Provider Message ID (wamid)</Label>
              <Input
                value={providerMsgId}
                onChange={(e) => setProviderMsgId(e.target.value)}
                placeholder="wamid.mock_12345"
                className="h-8 text-xs font-mono"
                required
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status Update</Label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'DELIVERED' | 'READ' | 'FAILED')}
                className="w-full h-8 px-2 rounded-md border bg-background text-xs"
              >
                <option value="DELIVERED">DELIVERED (Delivered to handset)</option>
                <option value="READ">READ (Blue ticks / read by customer)</option>
                <option value="FAILED">FAILED (Delivery error)</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDialogOpen(false)}
                className="h-8 text-xs"
              >
                Close
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting} className="h-8 text-xs gap-1.5">
                {isSubmitting ? (
                  <RefreshCw className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Send className="size-3.5" aria-hidden />
                )}
                Send Status Receipt
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
