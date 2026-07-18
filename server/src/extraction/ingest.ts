import { createLoop, reduce } from '../domain/reducer.js';
import { store } from '../domain/store.js';
import type { Loop } from '../domain/types.js';
import { extractOrder, toFhir } from './extract.js';

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
