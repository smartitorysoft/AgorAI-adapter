"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toProduct = toProduct;
exports.toAttributes = toAttributes;
exports.attributeHints = attributeHints;
exports.stripHtml = stripHtml;
/**
 * Meta keys WordPress and its plugins use for bookkeeping. They are noise in an
 * embedding and occasionally sensitive (`_edit_lock` names a user id), so the
 * underscore convention is honoured rather than filtered key by key.
 */
function isInternalMetaKey(key) {
    return key.startsWith('_');
}
function toProduct(product, currency) {
    const description = [product.short_description, product.description]
        .map((value) => stripHtml(value ?? ''))
        .filter((value) => value.length > 0)
        .join('\n\n');
    return {
        id: String(product.id),
        sku: emptyToNull(product.sku),
        name: product.name,
        url: emptyToNull(product.permalink),
        imageUrl: product.images?.[0]?.src ?? null,
        price: toPrice(product.price, currency),
        inStock: product.stock_status === 'instock',
        stockStatus: emptyToNull(product.stock_status),
        // The platform only lets the bot add `simple` products to a cart: a
        // variable product cannot be added without first choosing a variation, and
        // guessing one on a shopper's behalf is how you sell the wrong size.
        type: emptyToNull(product.type),
        categories: (product.categories ?? []).map((term) => term.name),
        description: emptyToNull(description),
        attributes: toAttributes(product),
        updatedAt: toIso(product.date_modified_gmt),
    };
}
/**
 * Meta first, then product attributes — and attributes never overwrite a meta
 * key of the same name. Meta is where a shop puts its own curated data; a
 * WooCommerce attribute with a colliding slug is far more likely to be a
 * generic "Colour" than the thing the shop actually curated.
 */
function toAttributes(product) {
    const attributes = {};
    for (const meta of product.meta_data ?? []) {
        if (isInternalMetaKey(meta.key))
            continue;
        const value = toAttributeValue(meta);
        if (value !== null)
            attributes[meta.key] = value;
    }
    for (const attribute of product.attributes ?? []) {
        const key = slugify(attribute.name);
        if (key.length === 0 || key in attributes)
            continue;
        const options = (attribute.options ?? [])
            .map((option) => stripHtml(String(option)))
            .filter((option) => option.length > 0);
        if (options.length > 0)
            attributes[key] = options;
    }
    return attributes;
}
/**
 * Attribute keys seen across a sample of the catalogue, for the platform to
 * pre-seed the project's attribute schema with.
 *
 * This cannot go in the manifest: the manifest is served before any credentials
 * exist, and which keys a WooCommerce shop uses is entirely up to that shop.
 */
function attributeHints(products) {
    const kinds = new Map();
    for (const product of products) {
        for (const [key, value] of Object.entries(toAttributes(product))) {
            const kind = Array.isArray(value)
                ? 'list'
                : Number.isFinite(Number(value)) && value.trim().length > 0
                    ? 'number'
                    : 'text';
            // A key seen once as a list is a list: a single-valued sample of a
            // multi-valued field is the common case, not evidence of a scalar.
            if (kinds.get(key) !== 'list')
                kinds.set(key, kind);
        }
    }
    return [...kinds.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, kind]) => ({
        key,
        label: { en: humanize(key) },
        kind,
        suggestEmbedding: true,
        suggestOnCard: false,
    }));
}
function toAttributeValue(meta) {
    const { value } = meta;
    if (Array.isArray(value)) {
        const items = value
            .map((item) => scalarToText(item))
            .filter((item) => item.length > 0);
        return items.length > 0 ? items : null;
    }
    if (value !== null && typeof value === 'object') {
        const items = Object.values(value)
            .map((item) => scalarToText(item))
            .filter((item) => item.length > 0);
        return items.length > 0 ? items : null;
    }
    const text = scalarToText(value);
    return text.length > 0 ? text : null;
}
function scalarToText(value) {
    if (value === null || value === undefined)
        return '';
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (typeof value === 'number')
        return String(value);
    if (typeof value === 'string')
        return stripHtml(value);
    if (Array.isArray(value) || typeof value === 'object') {
        // One level of nesting is as far as this goes on purpose. Deeper structures
        // are plugin internals, and flattening them produces embedding noise.
        return '';
    }
    return '';
}
/**
 * WooCommerce sends HTML in descriptions and occasionally in meta. It has to go:
 * this text is embedded, and tag soup costs tokens and dilutes the vector.
 */
function stripHtml(value) {
    return value
        .replaceAll(/<[^>]*>/g, ' ')
        .replaceAll('&nbsp;', ' ')
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll(/&#0?39;/g, "'")
        .replaceAll(/\s+/g, ' ')
        .trim();
}
function toPrice(amount, currency) {
    const trimmed = (amount ?? '').trim();
    if (trimmed.length === 0)
        return null;
    // Kept as the string WooCommerce sent. Money does not survive IEEE-754, and
    // the platform passes this straight through to a shopper.
    return { amount: trimmed, currency };
}
/** WooCommerce's `*_gmt` fields are ISO-8601 without the zone. Say it is UTC. */
function toIso(value) {
    if (!value)
        return null;
    return value.endsWith('Z') ? value : `${value}Z`;
}
function emptyToNull(value) {
    const trimmed = value?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : null;
}
function slugify(value) {
    return value
        .normalize('NFD')
        .replaceAll(/[\u0300-\u036F]/g, '')
        .toLowerCase()
        .replaceAll(/[^\da-z]+/g, '_')
        .replaceAll(/^_+|_+$/g, '');
}
function humanize(key) {
    const words = key.replaceAll(/[_-]+/g, ' ').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
}
//# sourceMappingURL=product.js.map