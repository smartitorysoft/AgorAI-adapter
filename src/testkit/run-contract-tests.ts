import type { AgorAIAdapter } from '..'
import { checkAdapter } from './check-adapter'
import { CONTRACT_CHECKS } from './checks'
import type { ContractCheckOptions, ContractReport } from './types'

/**
 * Minimal shape of the globals Jest and Vitest both provide. Typed structurally
 * so the SDK needs no test framework in its own dependency tree — an adapter
 * author already has one, and forcing a second copy of Jest into their install
 * to use the testkit would be a poor trade.
 */
type TestGlobals = {
  describe: (name: string, body: () => void) => void
  it: (name: string, body: () => Promise<void> | void) => void
}

/**
 * Drop this into an adapter's own test suite:
 *
 * ```ts
 * runContractTests(() => myAdapter, { context: { ... } })
 * ```
 *
 * Each check becomes one test case, so a failure names the thing that broke
 * rather than reporting "the contract suite failed".
 */
export function runContractTests(
  factory: () => AgorAIAdapter,
  options: ContractCheckOptions
): void {
  const globals = globalThis as unknown as Partial<TestGlobals>
  const { describe, it } = globals

  if (!describe || !it) {
    throw new Error(
      'runContractTests needs a test runner with global describe/it (Jest or Vitest). ' +
        'Outside one, call checkAdapter() directly.'
    )
  }

  describe('AgorAI adapter contract', () => {
    // The checks share discovered state — products found while paginating feed
    // the cart and navigation checks — so they run once and each test then
    // asserts its own result. A holder object rather than a bare `let` keeps
    // the per-check closures free of a mutable binding.
    const state: { report?: ContractReport } = {}

    it('runs every contract check', async () => {
      state.report = await checkAdapter(factory(), options)
    })

    for (const { name } of CONTRACT_CHECKS) {
      it(name, () => {
        assertCheckPassed(state, name)
      })
    }
  })
}

function assertCheckPassed(
  state: { report?: ContractReport },
  name: string
): void {
  const result = state.report?.results.find((entry) => entry.name === name)
  if (!result || result.status === 'skip') return
  if (result.status === 'fail') {
    throw new Error(result.message ?? name)
  }
}
