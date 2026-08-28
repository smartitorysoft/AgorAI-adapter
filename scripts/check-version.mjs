/**
 * `SDK_VERSION` is reported as `sdkVersion` in every manifest, and it is a
 * literal — a second copy of the number in `package.json`. Its own comment
 * already says "bump alongside package.json", and that comment was not enough:
 * the constant sat at 0.1.0 while the package shipped 0.2.0, so the platform's
 * SDK-compat warning was comparing adapters against a version that had not
 * existed for a release.
 *
 * A literal is the right shape here — this package is published to npm and
 * mirrored to a public repo, and reading `package.json` at runtime would drag a
 * file outside `rootDir` into the build output. So the copy stays and this
 * fails `checkup` when the two disagree.
 *
 *   node scripts/check-version.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(HERE, 'src', 'runtime', 'version.ts')

const declared = readVersionLiteral(SOURCE)
const packaged = JSON.parse(
  readFileSync(join(HERE, 'package.json'), 'utf8')
).version

if (declared === null) {
  console.error(
    'FAIL  could not find an SDK_VERSION literal in src/runtime/version.ts — ' +
      'if the constant moved, move this check with it'
  )
  process.exit(1)
}

if (declared !== packaged) {
  console.error(
    `FAIL  SDK_VERSION is ${declared} but package.json says ${packaged} — ` +
      'bump src/runtime/version.ts to match'
  )
  process.exit(1)
}

console.log(`ok    SDK_VERSION and package.json agree on ${packaged}`)

/**
 * Read rather than imported: `checkup` runs before any build, so `dist` may be
 * absent or stale, and a stale `dist` is precisely the failure this is here to
 * catch.
 */
function readVersionLiteral(path) {
  const match = /SDK_VERSION\s*=\s*'([^']+)'/.exec(readFileSync(path, 'utf8'))
  return match === null ? null : match[1]
}
