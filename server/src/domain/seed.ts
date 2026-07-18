import { createLoop, reduce } from './reducer.js';
import type { ExtractedOrder, FoundSlot, Loop, Patient, ServiceRequest } from './types.js';

// Curated demo loops so the board reads as a working system (distinct patients +
// distinct states), not test data. These are pre-built state — no calls are placed.

interface SeedStore { getAll(): Loop[]; save(loop: Loop): Loop }

function build(o: {
  id: string; name: string; dob: string; phone: string; study: string;
  laterality?: string | null; reason?: string | null; due: string; provider: string;
}): { order: ExtractedOrder; serviceRequest: ServiceRequest; patient: Patient } {
  const order: ExtractedOrder = {
    order_id: o.id,
    patient: { name: o.name, dob: o.dob, phone: o.phone, preferred_language: 'English' },
    study: { type: o.study, laterality: o.laterality ?? null, reason_code: o.reason ?? null },
    urgency: {
      due_date: o.due, window_days: 14,
      evidence_quote: 'schedule within two weeks of this order', evidence_location: 'Clinical urgency',
    },
    ordering_provider: { name: o.provider, practice: null, callback: null },
    evidence_links: [
      { field: 'study.type', quote: `Study ordered: ${o.study}`, location: 'Study ordered' },
      { field: 'urgency.due_date', quote: 'schedule within two weeks of this order', location: 'Clinical urgency' },
    ],
  };
  const patient: Patient = {
    resourceType: 'Patient', id: `patient-${o.id}`, name: o.name, birthDate: o.dob,
    telecom: [{ system: 'phone', value: o.phone }], communication: [{ language: 'English' }],
  };
  const serviceRequest: ServiceRequest = {
    resourceType: 'ServiceRequest', id: o.id, status: 'active', intent: 'order',
    code: { text: o.study }, occurrenceDateTime: o.due,
    ...(o.reason ? { reasonCode: [{ text: o.reason }] } : {}),
    requester: { display: o.provider }, subject: { reference: `Patient/patient-${o.id}` },
  };
  return { order, serviceRequest, patient };
}

export function seedDemoLoops(store: SeedStore): void {
  if (store.getAll().length > 0) return;

  // 1) Maria Alvarez — obstetric ultrasound — SCHEDULED (generality beyond mammography)
  {
    const { order, serviceRequest, patient } = build({
      id: 'ULT-2026-0718-ALVAREZ', name: 'Maria Alvarez', dob: '1994-02-11', phone: '+14085550137',
      study: 'Obstetric ultrasound', reason: 'Routine prenatal anatomy scan', due: '2026-08-04',
      provider: 'Dr. Priya Rao, Bay Valley OB/GYN',
    });
    const slot: FoundSlot = { id: 'valley-ob:2026-07-24', centerId: 'valley-ob', slotISO: '2026-07-24', compliant: true };
    let l = reduce(createLoop(), { type: 'ORDER_INGESTED', documentText: '' });
    l = reduce(l, { type: 'ORDER_EXTRACTED', order, serviceRequest, patient });
    l = reduce(l, { type: 'CENTER_CALL_STARTED', centerId: 'valley-ob', callId: 'c1', idempotencyKey: 'k1' });
    l = reduce(l, { type: 'CENTER_CALL_COMPLETED', centerId: 'valley-ob', callId: 'c1', reached: 'human', slot });
    l = reduce(l, { type: 'PATIENT_CALL_STARTED', callId: 'p1', idempotencyKey: 'kp1' });
    l = reduce(l, { type: 'PATIENT_CALL_COMPLETED', callId: 'p1', reached: 'human', acceptedSlotId: slot.id, clinicalQuestion: false, declined: false });
    l = reduce(l, { type: 'SMS_SENT', messageId: 'sms1', slotId: slot.id });
    l = reduce(l, { type: 'SCHEDULED', centerId: 'valley-ob', slotId: slot.id });
    store.save(l);
  }

  // 2) Elijah Brooks — CT chest (lung-nodule follow-up) — ESCALATED (patient unreachable)
  {
    const { order, serviceRequest, patient } = build({
      id: 'CT-2026-0717-BROOKS', name: 'Elijah Brooks', dob: '1959-06-30', phone: '+14085550188',
      study: 'CT chest without contrast', reason: 'Follow-up of indeterminate pulmonary nodule', due: '2026-08-05',
      provider: 'Dr. Alan Weiss, Bay Valley Pulmonology',
    });
    const slot: FoundSlot = { id: 'coastal-ct:2026-07-28', centerId: 'coastal-ct', slotISO: '2026-07-28', compliant: true };
    let l = reduce(createLoop(), { type: 'ORDER_INGESTED', documentText: '' });
    l = reduce(l, { type: 'ORDER_EXTRACTED', order, serviceRequest, patient });
    l = reduce(l, { type: 'CENTER_CALL_STARTED', centerId: 'coastal-ct', callId: 'c1', idempotencyKey: 'k1' });
    l = reduce(l, { type: 'CENTER_CALL_COMPLETED', centerId: 'coastal-ct', callId: 'c1', reached: 'human', slot });
    l = reduce(l, { type: 'PATIENT_CALL_STARTED', callId: 'p1', idempotencyKey: 'kp1' });
    l = reduce(l, { type: 'PATIENT_CALL_COMPLETED', callId: 'p1', reached: 'no_answer', clinicalQuestion: false, declined: false });
    l = reduce(l, { type: 'ESCALATED', reason: 'patient_unreachable', context: 'No answer after 3 attempts' });
    store.save(l);
  }

  // 3) Priya Nair — MRI knee — in progress (compliant slot held, about to call patient)
  {
    const { order, serviceRequest, patient } = build({
      id: 'MRI-2026-0718-NAIR', name: 'Priya Nair', dob: '1987-11-03', phone: '+14085550164',
      study: 'MRI left knee without contrast', laterality: 'left', reason: 'Persistent internal derangement', due: '2026-08-08',
      provider: 'Dr. Sam Ortiz, Bay Valley Orthopedics',
    });
    const slot: FoundSlot = { id: 'bayview-mri:2026-07-30', centerId: 'bayview-mri', slotISO: '2026-07-30', compliant: true };
    let l = reduce(createLoop(), { type: 'ORDER_INGESTED', documentText: '' });
    l = reduce(l, { type: 'ORDER_EXTRACTED', order, serviceRequest, patient });
    l = reduce(l, { type: 'CENTER_CALL_STARTED', centerId: 'bayview-mri', callId: 'c1', idempotencyKey: 'k1' });
    l = reduce(l, { type: 'CENTER_CALL_COMPLETED', centerId: 'bayview-mri', callId: 'c1', reached: 'human', slot });
    store.save(l);
  }
}
