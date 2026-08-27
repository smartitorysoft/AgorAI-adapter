/**
 * `@smartitory/agorai-adapter`
 *
 * Implement the ports your store can serve, call `run()`, ship the container.
 * The platform reads the manifest, generates the settings form from it, and
 * turns off whatever you did not implement.
 */
// Side-effect import: NestJS decorators need the metadata polyfill installed
// before any decorated class is evaluated, so it belongs at the entry point.
// eslint-disable-next-line import-x/no-unassigned-import -- polyfill, nothing to bind
import 'reflect-metadata'

export * from './contract'
export * from './runtime'
