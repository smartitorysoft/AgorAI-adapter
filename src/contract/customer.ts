import type { StoreContext } from './context'
import type { AdapterPrice } from './product'

/**
 * The logged-in shopper, when the storefront can prove who they are.
 *
 * Identity always arrives as a token the *store* signed, never as a bare user
 * id — an unsigned id in a public request body is a "show me someone else's
 * order history" hole. Verifying it is the adapter's job, because only the
 * adapter shares a secret with that store.
 */

export type AdapterCustomer = {
  id: string
  email: string | null
  displayName: string | null
}

export type AdapterOrderItem = {
  name: string
  sku: string | null
  quantity: number
}

export type AdapterOrderSummary = {
  id: string
  /** Store-native status, e.g. `completed`. Shown to the LLM as-is. */
  status: string
  /** ISO-8601 or a display date; it only ever reaches a prompt. */
  date: string
  total: AdapterPrice | null
  items: AdapterOrderItem[]
}

export type CustomerPort = {
  /**
   * Verify the storefront's signed identity blob and say who it belongs to.
   *
   * Must return `null` — never throw — for an absent, expired or badly signed
   * token. A failed identity check means "treat this as a guest", and a guest
   * chat is a working chat.
   */
  resolveIdentity?(
    ctx: StoreContext,
    token: string
  ): Promise<AdapterCustomer | null>

  /** Recent orders, newest first, for the prompt's background context. */
  listOrders?(
    ctx: StoreContext,
    customerId: string,
    limit: number
  ): Promise<AdapterOrderSummary[]>
}
