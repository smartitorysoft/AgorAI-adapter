import { nodeConfig } from '@agorai/eslint-config/node'

// `templates/` holds standalone projects that resolve
// `@smartitory/agorai-adapter` from GitHub, not from this workspace. Linting
// them here would type every SDK import as `any` and drown the real findings.
// They are typechecked instead by `pnpm run verify:template`.
export default nodeConfig({
  tsconfigRootDir: import.meta.dirname,
  ignores: ['templates/**', 'test/**'],
})
