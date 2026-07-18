import { z } from 'zod';

const evidenceLinkSchema = z.object({
  field: z.string().min(1),
  quote: z.string().min(1),
  location: z.string().min(1),
});

export const extractedOrderSchema = z.object({
  order_id: z.string().min(1),
  patient: z.object({
    name: z.string().min(1),
    dob: z.string().nullable(),
    phone: z.string().nullable(),
    preferred_language: z.string().min(1),
  }),
  study: z.object({
    type: z.string(),
    laterality: z.string().nullable(),
    reason_code: z.string().nullable(),
  }),
  urgency: z.object({
    due_date: z.string().nullable(),
    window_days: z.number().int().positive().nullable(),
    evidence_quote: z.string().nullable(),
    evidence_location: z.string().nullable(),
  }),
  ordering_provider: z.object({
    name: z.string().min(1),
    practice: z.string().nullable(),
    callback: z.string().nullable(),
  }),
  insurance: z.object({
    carrier: z.string().nullable(),
    member_id: z.string().nullable(),
  }).optional(),
  evidence_links: z.array(evidenceLinkSchema).min(1),
});

export type ExtractedOrder = z.infer<typeof extractedOrderSchema>;
