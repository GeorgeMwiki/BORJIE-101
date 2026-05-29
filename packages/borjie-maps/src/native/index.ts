/**
 * @borjie/maps/native — entry for React Native consumers.
 *
 * Usage:
 *   import { View, Text } from 'react-native';
 *   import { createBorjieNativeMap } from '@borjie/maps/native';
 *   export const BorjieMap = createBorjieNativeMap({ View, Text });
 */

export { createBorjieNativeMap } from './BorjieMap.js';
export type { BorjieNativeHostPrimitives } from './BorjieMap.js';
export * from '../types/index.js';
