/**
 * Hexagonal architecture boundaries for the Morning Edition SvelteKit app.
 *
 * Binding rules (deps point inward):
 *   - domain-zero-outward-deps: `src/lib/domain/**` (the domain core) depends on
 *     nothing outside itself — zero I/O, zero framework, zero app code.
 *   - adapters-not-importing-routes: server/adapters code never imports route
 *     modules — routes call inward, adapters never reach back out.
 *
 * When you add a NEW adapter folder (e.g. `src/lib/adapters/<x>/`), extend the
 * `from.path` regex of `adapters-not-importing-routes` so it is covered.
 */
module.exports = {
  forbidden: [
    {
      name: "domain-zero-outward-deps",
      severity: "error",
      comment:
        "The domain core must not depend on anything outside src/lib/domain. " +
        "*.test.ts files are excluded (they import vitest, which is dev-only). " +
        "Unresolved $lib/domain/** specifiers are excluded (SvelteKit alias for the domain itself); " +
        "all $lib imports inside the domain are guarded textually by the oxlint no-restricted-imports override.",
      from: { path: "^src/lib/domain", pathNot: "\\.test\\.[jt]s$" },
      to: { path: "^(?!src/lib/domain)", pathNot: "^\\$lib/domain/" },
    },
    {
      name: "adapters-not-importing-routes",
      severity: "error",
      comment: "Adapters/server code must never import SvelteKit route modules.",
      from: { path: "^src/lib/(server|adapters)" },
      to: { path: "^src/routes" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
  },
};
