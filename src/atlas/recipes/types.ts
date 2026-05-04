/**
 * Shared recipe types. Per Phase 4.A.2 code-review nit N6: this type
 * was originally colocated in `src/atlas/recipes/floor.ts`, which made
 * the floor recipe an accidental shared-types module (six other
 * recipes plus `src/atlas/generate.ts` and `src/registries/atlas-recipes.ts`
 * imported `RecipeContext` from `./floor`). Phase 5.A.1 drift sweep
 * relocates the type to its own module so recipe authors do not have
 * to know which sibling happened to declare the shared type first.
 */

export type RecipeContext = {
  readonly tileSize: 16;
  readonly slotName: string;
  readonly atlasSeed: string;
};
