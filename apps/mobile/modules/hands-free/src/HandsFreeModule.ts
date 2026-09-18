import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { HandsFreeModuleEvents, PermissionResponse } from './HandsFreeModule.types';

declare class HandsFreeModule extends NativeModule<HandsFreeModuleEvents> {
  getPermission(): Promise<PermissionResponse>;
  requestPermission(): Promise<PermissionResponse>;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Face detection is only needed for head-tracked depth on an open dish. */
  setFaceTracking(on: boolean): void;
}

/** null where the native module isn't built in (iOS for now, Expo Go, web). */
export default requireOptionalNativeModule<HandsFreeModule>('HandsFreeModule');
