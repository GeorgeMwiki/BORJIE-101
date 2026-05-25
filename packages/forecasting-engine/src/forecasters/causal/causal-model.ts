/**
 * CausalModel — generic "X% change in V causes Y% change in O".
 *
 * Wraps a hand-coded function with metadata (units, monotonicity,
 * domain bounds, source). Lets the orchestrator plug in retention
 * + pricing + others through a single shape.
 */

export interface CausalModelMeta {
  readonly id: string;
  readonly description: string;
  readonly inputName: string;
  readonly outputName: string;
  readonly monotonicity: 'increasing' | 'decreasing' | 'non-monotonic';
  readonly domain: { readonly min: number; readonly max: number };
  readonly source: 'hand-coded' | 'learned-v1' | 'learned-v2';
}

export interface CausalModel<I, O> {
  readonly meta: CausalModelMeta;
  apply(input: I): O;
}

export interface CausalModelRegistry {
  register<I, O>(model: CausalModel<I, O>): void;
  get<I, O>(id: string): CausalModel<I, O> | undefined;
  list(): ReadonlyArray<CausalModelMeta>;
}

class RegistryImpl implements CausalModelRegistry {
  private models: ReadonlyMap<string, CausalModel<unknown, unknown>> = new Map();

  register<I, O>(model: CausalModel<I, O>): void {
    const next = new Map(this.models);
    next.set(model.meta.id, model as unknown as CausalModel<unknown, unknown>);
    this.models = next;
  }

  get<I, O>(id: string): CausalModel<I, O> | undefined {
    return this.models.get(id) as CausalModel<I, O> | undefined;
  }

  list(): ReadonlyArray<CausalModelMeta> {
    return Array.from(this.models.values()).map((m) => m.meta);
  }
}

export function createRegistry(): CausalModelRegistry {
  return new RegistryImpl();
}
