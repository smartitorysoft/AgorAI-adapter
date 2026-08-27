import { StoreContext, type AgorAIAdapter } from '..'
import { CONTRACT_CHECKS, type CheckContext } from './checks'
import type { CheckResult, ContractCheckOptions, ContractReport } from './types'

/**
 * Runs every contract check against an adapter, in process.
 *
 * Framework-agnostic on purpose: the same function backs the Jest binding an
 * adapter author drops into their repo, a `--check` CLI run, and the platform's
 * own verification of a newly connected adapter. One implementation means those
 * three can never disagree about what "conformant" means.
 */
export async function checkAdapter(
  adapter: AgorAIAdapter,
  options: ContractCheckOptions
): Promise<ContractReport> {
  const context: CheckContext = {
    adapter,
    ctx: new StoreContext(options.context),
    options,
    products: [],
  }

  const results: CheckResult[] = []
  for (const check of CONTRACT_CHECKS) {
    try {
      results.push(await check.run(context))
    } catch (error) {
      results.push({
        name: check.name,
        status: 'fail',
        message: `threw: ${(error as Error).message}`,
      })
    }
  }

  const failed = results.filter((result) => result.status === 'fail').length
  const skipped = results.filter((result) => result.status === 'skip').length

  return {
    adapter: adapter.name,
    version: adapter.version,
    results,
    failed,
    skipped,
    passed: failed === 0,
  }
}

/** Renders a report as the lines you would want to read in CI output. */
export function formatReport(report: ContractReport): string {
  const icon = { pass: '✓', fail: '✗', skip: '–' } as const
  const lines = [
    `${report.adapter}@${report.version} — ${report.passed ? 'conformant' : 'NOT conformant'}`,
    ...report.results.map((result) => {
      const suffix = result.message ? `  (${result.message})` : ''
      return `  ${icon[result.status]} ${result.name}${suffix}`
    }),
  ]
  if (report.skipped > 0) {
    lines.push(
      `  ${report.skipped} check(s) skipped — capabilities this adapter does not declare.`
    )
  }
  return lines.join('\n')
}
