import { type DynamicModule, Module, type Type } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'

import type { AgorAIAdapter } from '../contract'
import { AdapterController } from './adapter.controller'
import { ADAPTER } from './adapter.token'
import { AdapterExceptionFilter } from './exception.filter'
import { RuntimeOptions } from './options'
import { SignatureGuard } from './signature.guard'

@Module({})
export class AdapterModule {
  /**
   * The guard is registered as `APP_GUARD` rather than on the controller so it
   * covers any route an adapter author adds later — a store-facing webhook
   * endpoint, most likely. Opting out is explicit, via `@SkipSignature()`.
   */
  static register(
    adapter: AgorAIAdapter,
    options: RuntimeOptions,
    imports: Array<DynamicModule | Type> = []
  ): DynamicModule {
    return {
      module: AdapterModule,
      // Where an adapter author's store-facing routes arrive — see
      // `RunOptions.modules`. `APP_GUARD` and `APP_FILTER` are global once
      // declared anywhere in the graph, so the signature guard and the error
      // filter below cover these routes as well.
      //
      // What they do NOT get is `ADAPTER` and `RuntimeOptions`: Nest exports
      // travel to a module's *importer*, not to what it imports. A module here
      // configures itself, which is the right way round anyway — a webhook
      // endpoint's secret is its own concern, not the adapter surface's.
      imports,
      controllers: [AdapterController],
      providers: [
        { provide: ADAPTER, useValue: adapter },
        { provide: RuntimeOptions, useValue: options },
        { provide: APP_GUARD, useClass: SignatureGuard },
        { provide: APP_FILTER, useClass: AdapterExceptionFilter },
      ],
      exports: [ADAPTER, RuntimeOptions],
    }
  }
}
