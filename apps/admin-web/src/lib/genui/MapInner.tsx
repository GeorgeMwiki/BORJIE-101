/**
 * Re-export shim — moved to `@borjie/genui`. The `./MapInner.js`
 * dynamic-import path in the old MapView wrapper is no longer used:
 * MapView's lazy chunk now resolves the inner module from inside the
 * shared package.
 */
export {} from '@borjie/genui';
