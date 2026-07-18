import type { Loop } from './types.js';

class LoopStore {
  readonly #loops = new Map<string, Loop>();

  get(id: string): Loop | undefined {
    return this.#loops.get(id);
  }

  getAll(): Loop[] {
    return [...this.#loops.values()];
  }

  save(loop: Loop): Loop {
    this.#loops.set(loop.id, loop);
    return loop;
  }
}

export const store = new LoopStore();
