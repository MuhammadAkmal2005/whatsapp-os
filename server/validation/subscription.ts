import { z } from 'zod';
import { PLAN_KEYS } from '@/config/plans';

export const changePlanSchema = z.object({
  planKey: z.enum(PLAN_KEYS, {
    errorMap: () => ({ message: 'Please select a valid plan.' }),
  }),
});

export type ChangePlanInput = z.infer<typeof changePlanSchema>;
