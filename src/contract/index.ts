/**
 * The contract: every type the adapter, the platform backend and the admin UI
 * share. Deliberately free of NestJS and of any Node-only API, so a browser
 * bundle can import it for the manifest-driven settings form.
 */
export * from './cart'
export * from './config'
export * from './context'
export type * from './customer'
export * from './errors'
export * from './manifest'
export * from './navigation'
export type * from './ports'
export type * from './product'
export * from './wire'
