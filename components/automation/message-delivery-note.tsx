import { MessageSquareDashed } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * Says plainly what a message step in an automation does today.
 *
 * The engine writes the message into the conversation and marks it sent, but it never hands it
 * to WhatsApp — the send path used when you reply from the inbox is not the one automations
 * take. So the message appears in the chat for your team and never reaches the customer's
 * phone.
 *
 * That is a gap in the product, not in this screen, and the screen's job is to not let a shop
 * owner discover it from a customer. Shown wherever a message step is on offer: beside the
 * ready-made rules, and above a list that already contains one.
 */
export function MessageDeliveryNote() {
  return (
    <Alert variant="warning">
      <MessageSquareDashed aria-hidden />
      <AlertTitle>Message steps are recorded, not delivered yet</AlertTitle>
      <AlertDescription>
        When an automation sends a message, it is written into the chat so you and your team can
        see it — but it does not reach the customer on WhatsApp. Steps that tag a customer, change
        a chat&apos;s status or priority, move a lead, pause the AI, add a note or alert your team
        all work as described. If the customer needs to hear something, reply from your inbox.
      </AlertDescription>
    </Alert>
  );
}
