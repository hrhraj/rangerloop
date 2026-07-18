import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { Tool, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import type { Patient, ServiceRequest } from '../domain/types.js';
import { extractedOrderSchema, type ExtractedOrder } from './schema.js';

export type ExtractResult =
  | { status: 'extracted'; order: ExtractedOrder }
  | { status: 'needs_review'; reasons: string[] };

const extractionInputSchema: Tool.InputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['order_id', 'patient', 'study', 'urgency', 'ordering_provider', 'evidence_links'],
  properties: {
    order_id: { type: 'string' },
    patient: {
      type: 'object', additionalProperties: false,
      required: ['name', 'dob', 'phone', 'preferred_language'],
      properties: {
        name: { type: 'string' }, dob: { type: ['string', 'null'] },
        phone: { type: ['string', 'null'] }, preferred_language: { type: 'string' },
      },
    },
    study: {
      type: 'object', additionalProperties: false,
      required: ['type', 'laterality', 'reason_code'],
      properties: {
        type: { type: 'string' }, laterality: { type: ['string', 'null'] },
        reason_code: { type: ['string', 'null'] },
      },
    },
    urgency: {
      type: 'object', additionalProperties: false,
      required: ['due_date', 'window_days', 'evidence_quote', 'evidence_location'],
      properties: {
        due_date: { type: ['string', 'null'] }, window_days: { type: ['integer', 'null'] },
        evidence_quote: { type: ['string', 'null'] }, evidence_location: { type: ['string', 'null'] },
      },
    },
    ordering_provider: {
      type: 'object', additionalProperties: false,
      required: ['name', 'practice', 'callback'],
      properties: {
        name: { type: 'string' }, practice: { type: ['string', 'null'] },
        callback: { type: ['string', 'null'] },
      },
    },
    insurance: {
      type: 'object', additionalProperties: false,
      required: ['carrier', 'member_id'],
      properties: { carrier: { type: ['string', 'null'] }, member_id: { type: ['string', 'null'] } },
    },
    evidence_links: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false, required: ['field', 'quote', 'location'],
        properties: { field: { type: 'string' }, quote: { type: 'string' }, location: { type: 'string' } },
      },
    },
  },
};

const systemPrompt = `You extract structured medical scheduling orders with strict evidence discipline.
Only extract facts supported by the supplied document. Never infer or guess unsupported values; use null instead.
Every action-driving field (study.type, urgency.due_date, patient.phone) must have an entry in evidence_links containing an exact quote and a precise document location. urgency.evidence_quote and urgency.evidence_location must support the due date. Derive a calendar due_date from an explicit signed date plus an explicit time window only. Submit exactly one submit_extraction tool call.`;

function evidenceReason(order: ExtractedOrder, field: string): string | undefined {
  const evidence = order.evidence_links.find((link) => link.field === field);
  return evidence === undefined ? `${field} is missing evidence` : undefined;
}

export async function extractOrder(documentText: string): Promise<ExtractResult> {
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Extract this signed order:\n\n${documentText}` }],
      tools: [{ name: 'submit_extraction', description: 'Submit the evidence-linked order extraction.', input_schema: extractionInputSchema }],
      tool_choice: { type: 'tool', name: 'submit_extraction' },
    });
    const toolUse = response.content.find(
      (block): block is ToolUseBlock => block.type === 'tool_use' && block.name === 'submit_extraction',
    );
    if (toolUse === undefined) return { status: 'needs_review', reasons: ['Model did not submit an extraction'] };

    const parsed = extractedOrderSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      return { status: 'needs_review', reasons: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) };
    }

    const order = parsed.data;
    const reasons = [
      order.study.type.trim() === '' ? 'study.type is missing' : undefined,
      order.urgency.due_date === null ? 'urgency.due_date is missing' : undefined,
      order.patient.phone === null ? 'patient.phone is missing' : undefined,
      evidenceReason(order, 'study.type'),
      evidenceReason(order, 'urgency.due_date'),
      evidenceReason(order, 'patient.phone'),
      order.urgency.due_date !== null && (order.urgency.evidence_quote === null || order.urgency.evidence_location === null)
        ? 'urgency.due_date is missing urgency evidence'
        : undefined,
    ].filter((reason): reason is string => reason !== undefined);

    return reasons.length > 0 ? { status: 'needs_review', reasons } : { status: 'extracted', order };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown extraction error';
    return { status: 'needs_review', reasons: [`Extraction failed: ${message}`] };
  }
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}

export function toFhir(order: ExtractedOrder): { serviceRequest: ServiceRequest; patient: Patient } {
  const patientId = stableId('patient', `${order.patient.name}|${order.patient.dob ?? ''}`);
  const patient: Patient = {
    resourceType: 'Patient',
    id: patientId,
    name: order.patient.name,
    ...(order.patient.dob === null ? {} : { birthDate: order.patient.dob }),
    ...(order.patient.phone === null ? {} : { telecom: [{ system: 'phone', value: order.patient.phone }] }),
    communication: [{ language: order.patient.preferred_language }],
  };
  const serviceRequest: ServiceRequest = {
    resourceType: 'ServiceRequest',
    id: order.order_id,
    status: 'active',
    intent: 'order',
    code: { text: order.study.type },
    ...(order.urgency.due_date === null ? {} : { occurrenceDateTime: order.urgency.due_date }),
    ...(order.study.reason_code === null ? {} : { reasonCode: [{ text: order.study.reason_code }] }),
    requester: { display: order.ordering_provider.name },
    subject: { reference: `Patient/${patientId}` },
  };
  return { serviceRequest, patient };
}
