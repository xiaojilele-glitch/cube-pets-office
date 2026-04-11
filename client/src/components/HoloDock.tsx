import { Toolbar } from "@/components/Toolbar";

/**
 * Legacy dock alias.
 *
 * The navigation-convergence spec collapses all primary navigation semantics
 * into the shared Toolbar so older HoloDock entry points stay aligned.
 */
export function HoloDock() {
  return <Toolbar />;
}
