import type { StoreContextData } from '../contract'

export type CheckStatus = 'pass' | 'fail' | 'skip'

export type CheckResult = {
  name: string
  status: CheckStatus
  message?: string
}

export type ContractReport = {
  adapter: string
  version: string
  results: CheckResult[]
  passed: boolean
  failed: number
  skipped: number
}

export type ContractCheckOptions = {
  /**
   * A working store context — real credentials against a real (or fake) store.
   * The checks make live calls, because a contract suite that mocks the store
   * proves only that the mock matches the adapter.
   */
  context: StoreContextData
  /** Fail if the catalogue returns fewer than this. Defaults to 1. */
  minProducts?: number
  /** Guards against a `nextCursor` that never goes null. Defaults to 20. */
  maxPages?: number
  /**
   * A product id safe to add to a cart and then remove again. Without one the
   * cart checks fall back to the first in-stock simple product found.
   */
  cartProductId?: string
  /** Skip cart mutation checks against a store you do not want written to. */
  skipCartMutation?: boolean
}
