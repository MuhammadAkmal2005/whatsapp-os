import { forwardRef } from 'react';

import { cn } from '@/lib/utils';
import { fieldClassName } from '@/components/ui/input';

const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(fieldClassName, 'min-h-20 resize-y px-2.5 py-2 leading-relaxed', className)}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
