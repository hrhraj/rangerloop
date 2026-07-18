import type { CallOutcome, FoundSlot } from './types.js';

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const WORD_ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20,
  'twenty first': 21, 'twenty second': 22, 'twenty third': 23,
  'twenty fourth': 24, 'twenty fifth': 25, 'twenty sixth': 26,
  'twenty seventh': 27, 'twenty eighth': 28, 'twenty ninth': 29,
  thirtieth: 30, 'thirty first': 31,
};

export function isSlotCompliant(slotISO: string, dueDateISO: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}/.test(slotISO)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dueDateISO)) {
      const slotDate = slotISO.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
      return slotDate !== undefined && Number.isFinite(Date.parse(slotISO)) && slotDate <= dueDateISO;
    }
    const slotTime = Date.parse(slotISO);
    const dueTime = Date.parse(dueDateISO);
    return Number.isFinite(slotTime) && Number.isFinite(dueTime) && slotTime <= dueTime;
  }

  const dueMatch = dueDateISO.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dueMatch === null) return false;

  const monthMatch = slotISO.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+/i);
  if (monthMatch === null || monthMatch.index === undefined) return false;

  const [, dueYearText, dueMonthText, dueDayText] = dueMatch;
  const [, monthName] = monthMatch;
  if (dueYearText === undefined || dueMonthText === undefined || dueDayText === undefined
    || monthName === undefined) return false;

  const dayText = slotISO.slice(monthMatch.index + monthMatch[0].length)
    .toLowerCase()
    .replaceAll('-', ' ');
  const numericDay = dayText.match(/^(\d{1,2})(?:st|nd|rd|th)?\b/)?.[1];
  const wordDay = Object.entries(WORD_ORDINALS)
    .find(([ordinal]) => dayText === ordinal || dayText.startsWith(`${ordinal} `))?.[1];

  const year = Number(dueYearText);
  const dueMonth = Number(dueMonthText) - 1;
  const dueDay = Number(dueDayText);
  const slotMonth = MONTHS[monthName.toLowerCase()];
  const slotDay = numericDay === undefined ? wordDay : Number(numericDay);
  if (slotMonth === undefined || slotDay === undefined) return false;

  const slotDate = new Date(Date.UTC(year, slotMonth, slotDay));
  if (slotDate.getUTCMonth() !== slotMonth || slotDate.getUTCDate() !== slotDay) return false;

  return slotDate.getTime() <= Date.UTC(year, dueMonth, dueDay);
}

export function interpretCenterOutcome(
  outcome: CallOutcome,
  centerId: string,
  dueDateISO: string,
): { reached: CallOutcome['reached']; slot?: FoundSlot } {
  const earliestSlot = outcome.captured.earliest_slot;
  if (typeof earliestSlot !== 'string') return { reached: outcome.reached };

  const referenceNumber = outcome.captured.reference_number;
  const faxNeeded = outcome.captured.fax_needed;
  return {
    reached: outcome.reached,
    slot: {
      id: `${centerId}:${earliestSlot}`,
      centerId,
      slotISO: earliestSlot,
      compliant: isSlotCompliant(earliestSlot, dueDateISO),
      ...(typeof referenceNumber === 'string' ? { referenceNumber } : {}),
      ...(typeof faxNeeded === 'boolean' ? { faxNeeded } : {}),
    },
  };
}

export function interpretPatientOutcome(outcome: CallOutcome): {
  reached: CallOutcome['reached'];
  acceptedSlotId?: string;
  clinicalQuestion: boolean;
  declined: boolean;
} {
  const acceptedSlot = outcome.captured.accepted_slot;
  const identityVerified = outcome.captured.identity_verified === true;
  const confirmedSlot = identityVerified
    && typeof acceptedSlot === 'string'
    && acceptedSlot.trim() !== ''
    ? acceptedSlot
    : undefined;
  return {
    reached: outcome.reached,
    ...(confirmedSlot === undefined ? {} : { acceptedSlotId: confirmedSlot }),
    clinicalQuestion: outcome.guardrail.flags.includes('question_outside_scope')
      || outcome.captured.asked_clinical_question === true,
    declined: outcome.captured.declined === true,
  };
}
