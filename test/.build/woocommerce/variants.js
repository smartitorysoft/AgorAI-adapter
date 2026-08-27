"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachVariants = attachVariants;
exports.toVariant = toVariant;
const client_1 = require("./client");
/** WooCommerce's own `per_page` ceiling. */
const MAX_VARIATIONS = 100;
/**
 * How many variable products are read at once.
 *
 * Small on purpose. This runs during a catalogue sync, against a shop whose
 * other visitors are real people, and WooCommerce is not a fast API. Four keeps
 * a page of a hundred products to twenty-five sequential waves rather than a
 * hundred simultaneous requests, which is the shape that gets an adapter rate
 * limited or, worse, gets the shop's PHP-FPM pool exhausted.
 */
const CONCURRENCY = 4;
/**
 * Variations are a per-variant read, so a slow one delays the whole sync page.
 * Shorter than the catalogue timeout because a missing variant list degrades a
 * product card, while a stalled sync blocks every product behind it.
 */
const TIMEOUT_MS = 8000;
/**
 * Fills in `variants` on the variable products in `items`, in place.
 *
 * Never throws. A shop that refuses the variations endpoint — some security
 * plugins do — still gets its catalogue indexed, with the parent products
 * exactly as they arrive without this. Losing the sizes is a worse answer;
 * losing the sync is a broken product.
 */
async function attachVariants(ctx, items, currency) {
    const variable = items.filter((item) => item.type === 'variable');
    if (variable.length === 0)
        return;
    for (let index = 0; index < variable.length; index += CONCURRENCY) {
        const wave = variable.slice(index, index + CONCURRENCY);
        await Promise.all(wave.map(async (product) => {
            const variants = await readVariants(ctx, product.id, currency);
            if (variants.length > 0)
                product.variants = variants;
        }));
    }
}
async function readVariants(ctx, productId, currency) {
    try {
        const { body } = await (0, client_1.wooGet)(ctx, `products/${productId}/variations`, { per_page: MAX_VARIATIONS, status: 'publish' }, TIMEOUT_MS);
        return body.map((variation) => toVariant(variation, currency));
    }
    catch {
        // Deliberately silent per product. A shop with a plugin blocking this
        // endpoint would otherwise emit one warning per variable product per sync.
        return [];
    }
}
function toVariant(variation, currency) {
    const options = {};
    for (const attribute of variation.attributes ?? []) {
        const key = (attribute.name ?? '').trim();
        const value = (attribute.option ?? '').trim();
        // An empty option means "any" in WooCommerce — the variation matches every
        // value of that attribute. Recording it as an empty string would read as a
        // choice the shopper has to make and cannot.
        if (key.length > 0 && value.length > 0)
            options[key] = value;
    }
    const price = (variation.price ?? '').trim();
    return {
        id: String(variation.id),
        sku: (variation.sku ?? '').trim() || null,
        // WooCommerce gives a variation no name of its own; what identifies it to a
        // shopper is the combination it stands for.
        name: describe(options),
        price: price.length > 0 ? { amount: price, currency } : null,
        inStock: variation.stock_status === 'instock',
        options,
    };
}
function describe(options) {
    const parts = Object.entries(options).map(([key, value]) => `${key}: ${value}`);
    return parts.length > 0 ? parts.join(', ') : null;
}
//# sourceMappingURL=variants.js.map