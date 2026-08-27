import { AdapterError, type NavigationTarget } from '../contract'
import type { NavigationTargetDto } from './dto'

/**
 * Narrows the flat wire form back into the discriminated union.
 *
 * The transport has to carry `id`, `query` and `slug` as independently optional
 * fields because class-validator cannot express a union, so this is where the
 * "a product target actually has an id" guarantee is re-established.
 */
export function toNavigationTarget(dto: NavigationTargetDto): NavigationTarget {
  switch (dto.kind) {
    case 'product':
    case 'category': {
      if (!dto.id) {
        throw new AdapterError(
          'INVALID_REQUEST',
          `A "${dto.kind}" navigation target requires an id.`
        )
      }
      return { kind: dto.kind, id: dto.id }
    }
    case 'search': {
      if (!dto.query) {
        throw new AdapterError(
          'INVALID_REQUEST',
          'A "search" navigation target requires a query.'
        )
      }
      return { kind: 'search', query: dto.query }
    }
    case 'page': {
      if (!dto.slug) {
        throw new AdapterError(
          'INVALID_REQUEST',
          'A "page" navigation target requires a slug.'
        )
      }
      return { kind: 'page', slug: dto.slug }
    }
    case 'cart':
    case 'checkout': {
      return { kind: dto.kind }
    }
  }
}
