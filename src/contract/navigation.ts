import type { StoreContext } from './context'

/**
 * Where the bot can send a shopper.
 *
 * consuela had exactly two destinations, `'cart'` and `'checkout'`, baked into
 * the response type. Generalizing them into targets means a store that has no
 * checkout page (or has a search page worth linking) describes that in its
 * manifest, and the platform only ever offers the LLM the kinds that actually
 * resolve.
 */
export type NavigationTarget =
  | { kind: 'cart' }
  | { kind: 'checkout' }
  | { kind: 'product'; id: string }
  | { kind: 'category'; id: string }
  | { kind: 'search'; query: string }
  | { kind: 'page'; slug: string }

export type NavigationKind = NavigationTarget['kind']

export const NAVIGATION_KINDS: NavigationKind[] = [
  'cart',
  'checkout',
  'product',
  'category',
  'search',
  'page',
]

export type NavigationResult = {
  /**
   * Absolute URL, or a path relative to the storefront origin. A relative path
   * is preferred for a widget embedded on the store itself: it survives the
   * store moving domains.
   */
  url: string
  /** Open in a new tab instead of navigating the current one. */
  external?: boolean
}

export type NavigationPort = {
  resolve(
    ctx: StoreContext,
    target: NavigationTarget
  ): Promise<NavigationResult> | NavigationResult
}
