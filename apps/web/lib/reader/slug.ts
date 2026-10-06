/**
 * URL slug rules for the reader are a public contract shared with the content
 * build (authored links are validated against the same routes), so they live
 * in `@specistry/content`; the reader re-exports them unchanged.
 */
export {
  identifierSlug,
  mediaTypeAnchor,
  methodPathSlug,
  responseAnchor,
  slugify,
  uniqueSlugs,
} from "@specistry/content";
