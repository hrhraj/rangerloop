import { createLoop, reduce } from '../domain/reducer.js';
import { store } from '../domain/store.js';
import type { Loop } from '../domain/types.js';
import { extractOrder, toFhir } from './extract.js';
import { markEvidenceTurns, serializeEncounter, type AbridgeEncounter } from './encounter.js';

export async function ingestOrder(documentText: string): Promise<Loop> {
  let loop = reduce(createLoop(), { type: 'ORDER_INGESTED', documentText });
  const result = await extractOrder(documentText);

  if (result.status === 'extracted') {
    loop = reduce(loop, { type: 'ORDER_EXTRACTED', order: result.order, ...toFhir(result.order) });
  } else {
    loop = reduce(loop, { type: 'NEEDS_REVIEW', reasons: result.reasons });
  }

  return store.save(loop);
}

export async function ingestEncounter(encounterInput: AbridgeEncounter): Promise<Loop> {
  const documentText = serializeEncounter(encounterInput);
  let loop = reduce(createLoop(), { type: 'ORDER_INGESTED', documentText });
  const result = await extractOrder(documentText);
  const evidenceQuotes = result.status === 'extracted'
    ? result.order.evidence_links
      .filter(({ field }) => field === 'urgency.due_date' || field === 'study.type')
      .map(({ quote }) => quote)
    : [];
  const studyKeyword = result.status === 'extracted'
    ? (result.order.study.type.toLowerCase().includes('mammogram')
        ? 'mammogram'
        : result.order.study.type.split(/\s+/).find((word) => word.length >= 5) ?? 'imaging')
    : 'mammogram';
  const attached: NonNullable<Loop['encounter']> = {
    title: encounterInput.metadata?.specialty === undefined
      ? 'Ambient encounter'
      : `${encounterInput.metadata.specialty} encounter`,
    ...(encounterInput.metadata?.encounter_date === undefined
      ? {}
      : { date: encounterInput.metadata.encounter_date }),
    transcript: markEvidenceTurns(encounterInput.transcript, evidenceQuotes, studyKeyword),
  };
  loop = reduce(loop, { type: 'ATTACH_ENCOUNTER', encounter: attached });
  loop = result.status === 'extracted'
    ? reduce(loop, { type: 'ORDER_EXTRACTED', order: result.order, ...toFhir(result.order) })
    : reduce(loop, { type: 'NEEDS_REVIEW', reasons: result.reasons });
  return store.save(loop);
}
