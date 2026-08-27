"use strict";
/**
 * The slices of WooCommerce's REST responses this adapter actually reads.
 *
 * Deliberately partial: WooCommerce sends far more than this, and typing only
 * what we consume means a WooCommerce upgrade that adds fields cannot break the
 * build. Everything is optional-ish for the same reason — a plugin that strips
 * a field should degrade a product card, not throw.
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map