/**
 * Reported in every manifest as `sdkVersion`, so the platform can warn when an
 * adapter is built against an SDK older than the contract it is talking to.
 *
 * Read from `package.json` rather than written here as a literal, because a
 * literal is a second copy of a number and every copy of a number eventually
 * disagrees with the first one. This one already did: it sat at 0.1.0 while the
 * package shipped 0.2.0, so the platform's SDK-compat warning spent a release
 * comparing adapters against a version that had not existed for months.
 *
 * The lookup is `require`, not an `import`, and that is deliberate. A TypeScript
 * import of `../../package.json` pulls a file outside `rootDir` into the build,
 * which moves every emitted file down a directory and quietly breaks the paths
 * in `exports`. A plain `require` resolves at runtime instead, and resolves
 * correctly in both layouts this package ever has: `dist/runtime/version.js` in
 * the repository, and the same path in the published mirror, are both two
 * directories below the `package.json` that describes them.
 *
 * Nothing in the browser reaches this. `version.ts` is runtime-only, the
 * frontend and the widget import `@smartitory/agorai-adapter/contract`, and the
 * two entry points share no code.
 */
/* eslint-disable @typescript-eslint/no-require-imports, unicorn/prefer-module --
 * The one place in this package where a runtime `require` is the correct tool;
 * the doc comment above is the argument. */
const manifest = require('../../package.json') as { version?: string }
/* eslint-enable @typescript-eslint/no-require-imports, unicorn/prefer-module */

export const SDK_VERSION: string = manifest.version ?? '0.0.0'
