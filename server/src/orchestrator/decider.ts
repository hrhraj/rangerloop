import type { Loop } from '../domain/types.js';
import type { OrchestratorAction } from '../policy/actions.js';

export interface DecideContext {
  loop: Loop;
  roster: string[];
  rejection?: string;
}

export interface Decision {
  reasoning?: string;
  action: OrchestratorAction;
}

export interface Decider {
  decide(ctx: DecideContext): Promise<Decision>;
}

export class ScriptedDecider implements Decider {
  readonly contexts: DecideContext[] = [];
  readonly #decisions?: Decision[];
  readonly #decideFn?: (ctx: DecideContext) => Decision | Promise<Decision>;
  #index = 0;

  constructor(decisions: Decision[] | ((ctx: DecideContext) => Decision | Promise<Decision>)) {
    if (typeof decisions === 'function') this.#decideFn = decisions;
    else this.#decisions = decisions;
  }

  async decide(ctx: DecideContext): Promise<Decision> {
    this.contexts.push(ctx);
    if (this.#decideFn !== undefined) return await this.#decideFn(ctx);
    const decision = this.#decisions?.[this.#index];
    if (decision === undefined) throw new Error(`ScriptedDecider: no decision at index ${this.#index}`);
    this.#index += 1;
    return decision;
  }
}
