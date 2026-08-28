import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common'

import {
  ADAPTER_ROUTES,
  AdapterUnsupportedError,
  EMPTY_CART,
  isClientCart,
  StoreContext,
  type AdapterCart,
  type AdapterHealthResult,
  type AdapterManifest,
  type CartApplyResponse,
  type CartNormalizeResponse,
  type CartReadResponse,
  type CatalogCategoriesResponse,
  type CatalogGetResponse,
  type CatalogListResponse,
  type AgorAIAdapter,
  type CustomerOrdersResponse,
  type CustomerResolveResponse,
  type DownloadResponse,
  type NavigationResolveResponse,
} from '../contract'
import { ADAPTER } from './adapter.token'
import { buildManifest } from './define-adapter'
import {
  CartApplyDto,
  CartNormalizeDto,
  CatalogGetDto,
  CatalogListDto,
  ContextRequestDto,
  CustomerOrdersDto,
  CustomerResolveDto,
  DownloadDto,
  NavigationResolveDto,
  type StoreContextDto,
} from './dto'
import { toNavigationTarget } from './navigation.mapper'
import { SkipSignature } from './public.decorator'

/** How many products a fallback health check pulls when the adapter has no `health`. */
const HEALTH_PROBE_SIZE = 1

@Controller()
export class AdapterController {
  constructor(@Inject(ADAPTER) private readonly adapter: AgorAIAdapter) {}

  /**
   * Unsigned on purpose: the platform reads this *before* a shared secret has
   * been agreed, and it describes the adapter rather than any store — no
   * credentials, no catalogue, no shopper data.
   */
  @Get(ADAPTER_ROUTES.manifest)
  @SkipSignature()
  manifest(): AdapterManifest {
    return buildManifest(this.adapter)
  }

  /** Liveness only. Deliberately makes no call to any store. */
  @Get(ADAPTER_ROUTES.liveness)
  @SkipSignature()
  liveness(): { status: 'ok'; adapter: string; version: string } {
    return {
      status: 'ok',
      adapter: this.adapter.name,
      version: this.adapter.version,
    }
  }

  /**
   * Behind the "Test connection" button.
   *
   * An adapter that provides its own `health` should make a real call, because
   * a manifest that parses proves nothing about whether the credentials work.
   * Without one, a single-product catalogue read is the weakest check that still
   * exercises authentication.
   */
  @Post(ADAPTER_ROUTES.health)
  @HttpCode(HttpStatus.OK)
  async health(@Body() dto: ContextRequestDto): Promise<AdapterHealthResult> {
    const ctx = context(dto.context)

    if (this.adapter.health) {
      return this.adapter.health(ctx)
    }

    const page = await this.adapter.catalog.list(ctx, {
      limit: HEALTH_PROBE_SIZE,
    })
    return {
      ok: true,
      productCount: page.total ?? null,
      currency: page.items[0]?.price?.currency ?? null,
      warnings: [
        'This adapter has no health check of its own, so only catalogue access was verified.',
      ],
    }
  }

  /**
   * Render one of the files this adapter declared.
   *
   * Signed like every other POST, and for the ordinary reason: the body
   * carries the project's config, and a rendered file is very often that
   * config with a secret in it.
   *
   * The key is checked against the declared list rather than passed through.
   * `render` is adapter-authored code taking a string from a request, and an
   * adapter that reached for the filesystem with it should be given a key it
   * has already published, not an arbitrary one.
   */
  @Post(ADAPTER_ROUTES.download)
  @HttpCode(HttpStatus.OK)
  async download(@Body() dto: DownloadDto): Promise<DownloadResponse> {
    const declared = this.adapter.downloads?.find(
      (entry) => entry.key === dto.key
    )
    if (!declared || !this.adapter.render) {
      throw new AdapterUnsupportedError(
        `This adapter does not offer a download named "${dto.key}".`
      )
    }

    const rendered = await this.adapter.render.render(
      context(dto.context),
      declared.key,
      dto.target
    )

    return {
      filename: rendered.filename ?? declared.filename,
      contentType: declared.contentType,
      body: rendered.body,
      encoding: rendered.encoding ?? 'utf8',
    }
  }

  @Post(ADAPTER_ROUTES.catalogList)
  @HttpCode(HttpStatus.OK)
  async catalogList(@Body() dto: CatalogListDto): Promise<CatalogListResponse> {
    return this.adapter.catalog.list(context(dto.context), dto.options ?? {})
  }

  @Post(ADAPTER_ROUTES.catalogGet)
  @HttpCode(HttpStatus.OK)
  async catalogGet(@Body() dto: CatalogGetDto): Promise<CatalogGetResponse> {
    if (dto.ids.length === 0) return { items: [] }
    const items = await this.adapter.catalog.get(context(dto.context), dto.ids)
    return { items }
  }

  @Post(ADAPTER_ROUTES.catalogCategories)
  @HttpCode(HttpStatus.OK)
  async catalogCategories(
    @Body() dto: ContextRequestDto
  ): Promise<CatalogCategoriesResponse> {
    const { catalog } = this.adapter
    if (!catalog.categories) {
      throw new AdapterUnsupportedError(
        'This adapter does not expose product categories.'
      )
    }
    const items = await catalog.categories(context(dto.context))
    return { items }
  }

  @Post(ADAPTER_ROUTES.cartRead)
  @HttpCode(HttpStatus.OK)
  async cartRead(@Body() dto: ContextRequestDto): Promise<CartReadResponse> {
    const cart = this.requireCart()
    const ctx = context(dto.context)

    if (isClientCart(cart)) {
      return { mode: 'client', recipe: cart.readRecipe(ctx) }
    }
    return { mode: 'server', cart: await cart.get(ctx) }
  }

  @Post(ADAPTER_ROUTES.cartApply)
  @HttpCode(HttpStatus.OK)
  async cartApply(@Body() dto: CartApplyDto): Promise<CartApplyResponse> {
    const cart = this.requireCart()
    const ctx = context(dto.context)

    if (isClientCart(cart)) {
      const recipes = cart.writeRecipe(ctx, dto.op, dto.cart ?? EMPTY_CART)
      return { mode: 'client', recipes: asArray(recipes) }
    }
    return { mode: 'server', cart: await cart.apply(ctx, dto.op) }
  }

  @Post(ADAPTER_ROUTES.cartClear)
  @HttpCode(HttpStatus.OK)
  async cartClear(@Body() dto: ContextRequestDto): Promise<CartApplyResponse> {
    const cart = this.requireCart()
    const ctx = context(dto.context)

    if (isClientCart(cart)) {
      if (!cart.clearRecipe) {
        throw new AdapterUnsupportedError(
          'This adapter cannot empty the cart in one step.'
        )
      }
      return { mode: 'client', recipes: asArray(cart.clearRecipe(ctx)) }
    }
    return { mode: 'server', cart: await cart.clear(ctx) }
  }

  /**
   * Client-mode only: the widget performed the request against the store and
   * hands back whatever came out. Only the adapter knows how to read it, which
   * is what keeps store-specific parsing out of the widget.
   */
  @Post(ADAPTER_ROUTES.cartNormalize)
  @HttpCode(HttpStatus.OK)
  cartNormalize(@Body() dto: CartNormalizeDto): CartNormalizeResponse {
    const cart = this.requireCart()
    if (!isClientCart(cart)) {
      throw new AdapterUnsupportedError(
        'normalize applies to client-mode carts only; this adapter manages the cart server-side.'
      )
    }
    const normalized: AdapterCart = cart.normalize(
      context(dto.context),
      dto.raw
    )
    return { cart: normalized }
  }

  @Post(ADAPTER_ROUTES.navigationResolve)
  @HttpCode(HttpStatus.OK)
  async navigationResolve(
    @Body() dto: NavigationResolveDto
  ): Promise<NavigationResolveResponse> {
    const { navigation } = this.adapter
    if (!navigation) {
      throw new AdapterUnsupportedError(
        'This adapter does not resolve navigation targets.'
      )
    }
    return navigation.resolve(
      context(dto.context),
      toNavigationTarget(dto.target)
    )
  }

  /**
   * Never throws for a bad token: a failed identity check means "treat this
   * shopper as a guest", and a guest chat is a working chat.
   */
  @Post(ADAPTER_ROUTES.customerResolve)
  @HttpCode(HttpStatus.OK)
  async customerResolve(
    @Body() dto: CustomerResolveDto
  ): Promise<CustomerResolveResponse> {
    const { customer } = this.adapter
    if (!customer?.resolveIdentity) return { customer: null }
    const resolved = await customer.resolveIdentity(
      context(dto.context),
      dto.token
    )
    return { customer: resolved ?? null }
  }

  @Post(ADAPTER_ROUTES.customerOrders)
  @HttpCode(HttpStatus.OK)
  async customerOrders(
    @Body() dto: CustomerOrdersDto
  ): Promise<CustomerOrdersResponse> {
    const { customer } = this.adapter
    if (!customer?.listOrders) {
      throw new AdapterUnsupportedError(
        'This adapter does not expose customer order history.'
      )
    }
    const orders = await customer.listOrders(
      context(dto.context),
      dto.customerId,
      dto.limit
    )
    return { orders }
  }

  private requireCart() {
    const { cart } = this.adapter
    if (!cart) {
      throw new AdapterUnsupportedError(
        'This adapter does not support cart operations.'
      )
    }
    return cart
  }
}

function context(dto: StoreContextDto): StoreContext {
  return new StoreContext(dto)
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value]
}
