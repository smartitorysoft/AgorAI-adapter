/**
 * `package.json` is the version. Everything else is written from it.
 *
 * The number used to live in four places — `package.json`, the `SDK_VERSION`
 * literal, the pin in each template's `package.json`, and the install line in
 * the README — and each copy was maintained by hand behind a check that failed
 * the build when they disagreed. That check did its job and was still the wrong
 * shape: it turned every release into "bump, watch CI fail, bump again", four
 * times over.
 *
 * So the copies stay, because each one has to be a literal where it sits — a
 * published package cannot compute its own version at install time, and a
 * template is a standalone project with no workspace to ask — but nobody types
 * them any more.
 *
 *   node scripts/sync-version.mjs           # write them
 *   node scripts/sync-version.mjs --check   # fail if any is stale
 *
 * `--check` is what `checkup` and the publish workflow run, so CI reports drift
 * rather than quietly rewriting the tree it was asked to verify.
 *
 * Why each copy cannot simply be derived where it is used:
 *
 *  - **`SDK_VERSION`** is reported as `sdkVersion` in every manifest, and it is
 *    read by code that has been bundled, published to npm and mirrored to a
 *    public repo. Reading `package.json` at runtime would drag a file outside
 *    `rootDir` into the build output.
 *  - **The template pins** are `github:<repo>#v<version>` in projects that get
 *    copied out of this repository entirely. Only the tag makes them install.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')

const VERSION = JSON.parse(
  readFileSync(join(HERE, 'package.json'), 'utf8')
).version

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(VERSION)) {
  fail(`package.json has an unusable version: "${VERSION}"`)
}

/**
 * Each rule finds the *old* version in a file and reports what it should say.
 *
 * The repository in a pin is matched rather than hardcoded, so this script is
 * not a second place the public repo's name is written.
 */
const RULES = [
  {
    file: join(HERE, 'src', 'runtime', 'version.ts'),
    pattern: /(SDK_VERSION\s*=\s*')([^']+)(')/,
    what: 'the SDK_VERSION literal',
  },
  {
    file: join(HERE, 'README.md'),
    pattern: /(pnpm add github:[\w.-]+\/[\w.-]+#v)([^\s`]+)()/,
    what: 'the install line',
  },
  ...templateManifests().map((file) => ({
    file,
    pattern: /("@smartitory\/agorai-adapter":\s*"github:[\w.-]+\/[\w.-]+#v)([^"]+)(")/,
    what: 'the SDK pin',
  })),
]

const stale = []

for (const rule of RULES) {
  const before = readFileSync(rule.file, 'utf8')
  const match = rule.pattern.exec(before)

  if (match === null) {
    // Not "nothing to do": something this script is responsible for has moved,
    // and staying quiet would let the file drift for good.
    fail(`could not find ${rule.what} in ${short(rule.file)}`)
  }
  if (match[2] === VERSION) continue

  stale.push({ ...rule, found: match[2] })
  if (!CHECK) {
    writeFileSync(rule.file, before.replace(rule.pattern, `$1${VERSION}$3`))
  }
}

if (stale.length === 0) {
  console.log(`ok    every copy of the version says ${VERSION}`)
  process.exit(0)
}

for (const entry of stale) {
  const verb = CHECK ? 'says' : 'was'
  console[CHECK ? 'error' : 'log'](
    `${CHECK ? 'FAIL' : 'sync'}  ${short(entry.file)} — ${entry.what} ${verb} ${entry.found}, package.json says ${VERSION}`
  )
}

if (CHECK) {
  console.error('\nRun `pnpm --filter @smartitory/agorai-adapter sync:version`.')
  process.exit(1)
}

console.log(`\n${stale.length} file(s) written. Commit them with the bump.`)

function templateManifests() {
  const root = join(HERE, 'templates')
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, 'package.json'))
}

function short(path) {
  return relative(HERE, path)
}

function fail(message) {
  console.error(`FAIL  ${message}`)
  process.exit(1)
}
