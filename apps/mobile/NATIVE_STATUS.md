# Bhookmark native app — status

Governing spec: *Bhookmark Native App Motion Implementation Brief* (docx, 2026-09-15), plus the user's follow-up direction (same day): transitions should be bold and dimensional, with pronounced perspective, artwork breaking beyond frames, temporary text movement and selective distortion **during** a transition, and a clear interface on arrival. That direction supersedes the brief's 3° / upright-text limits for the in-flight phase only; it is recorded in `src/motion/policy.ts`.

The existing web app, Express API and Neon database are unchanged.

## Where this stands

| Brief step | State |
|---|---|
| 1. Mobile workspace and brand mapping | Done. Both themes and the four real font families render on Android (Expo Go). |
| 2. MotionLab with the starter | Done, including the bolder in-flight choreography. Verified on the Android emulator only. |
| 3. Real card detail overlay | Built (`src/components/CardOverlay.tsx`, `DishCard.tsx`), after the user said the Step 2 lab looked flat. It runs on 4 lab dishes; the Log and Save buttons are shown but not connected. **Verified on the emulator:** tap opens, the panel settles cleanly, Android Back closes and the grid is restored, with 0 JS errors. A 5× slow-motion recording shows the page recession, the card lift, and the photo pitching and shearing past the panel edge. **Not yet run on the overlay:** the 30-cycle rapid test, the source-removal fade, reduced motion, and the iPhone check. |
| 4. Core product journey (login, search, save, journal) | **Built and verified end to end on the Android emulator against the local API on the Neon test branch**:<br>• Phone sign-in with the on-screen dev code<br>• Crave: search, craving chips from `/venues/categories`, browse from `/dishes/browse`<br>• Dish detail with Save and real ratings from `/dishes/score`<br>• BiteLog: details, confirm, 0–10 rating, done → `/logs`<br>• Bhookmarks journal (`/logs/mine`) with Saved for later, and each log reopening into its detail<br>0 JS errors. Tabs: Crave, Bhookmarks, Log a bite, Circles (placeholder), You.<br>**Not in the app yet:** Google sign-in (needs the native SDK in the app's own build), photo capture and location verification in BiteLog, recommendations, trending, Places near you, Flavor DNA, Circles, the taste game. |
| 5. Physical-device profiling | Not started. **No 90/120 fps claim is made.** |
| 6. Broader migration | Not started. |

## Layout

- `App.tsx`: root wrappers (gesture handler, safe area with initial metrics, theme, motion) and font loading. MotionLab is mounted only under `__DEV__`; release builds show a placeholder.
- `src/theme/brand.ts`: tokens copied from the web's `src/index.css` / `tailwind.config.js`. They match the brief's table exactly, plus `bad`, `badDim`, `scrim` and `shadow`. There's also the type scale and radii.
- `src/theme/fonts.ts`: the 11 weights the web uses, required by file path so no unused weights are bundled.
- `src/theme/ThemeProvider.tsx`: Evening / Daylight / Match device, stored under the web's key `bhookmark.theme`.
- `src/motion/policy.ts`: timings, resting limits, in-flight peaks, quality tiers and `flightPeak`.
- `src/motion/MotionProvider.tsx`: live OS Reduce Motion, in-app Reduce effects and haptics settings, and the performance tier.
- `src/motion/useFrameProbe.ts`: the brief's diagnostic callback counter. It is not presented-frame evidence.
- `src/components/DepthCardLab.tsx`: the depth card.
- `src/screens/MotionLab.tsx`: dev scene with controls, probe readout, type specimen and token swatches.
- `assets/lab/*.jpg`: two existing catalog photos from `public/dishes`.
- `assets/motion/contact-shadow.png`: soft alpha shadow generated locally.

Repo root: `.vercelignore` keeps `apps/` out of web deploys; `.oxlintrc.json` ignores `apps/**`, with the original rules kept.

## Dependency versions (installed with `npx expo install`)

expo ~57.0.22, react-native 0.86.3, react 19.2.3, react-native-reanimated 4.5.1, react-native-worklets 0.10.1, react-native-gesture-handler ~2.32.0, react-native-safe-area-context ~5.7.0, expo-font ~57.0.4, expo-haptics ~57.0.3, expo-system-ui ~57.0.4, @react-native-async-storage/async-storage 2.2.0, @expo-google-fonts/{inter, inter-tight, instrument-serif, ibm-plex-mono} 0.4.x.

## Checks run

- `npx tsc --noEmit` (mobile): exit 0.
- `npx expo-doctor`: 21/21 passed.
- `npx expo export --platform android`: bundles, 13 assets (11 fonts + 2 photos).
- Web `npm run build`: builds. Web `npx oxlint`: the same warnings as before these changes (compared order-insensitively).
- Android emulator (Pixel profile, Android 16, Expo Go 57.0.9, dev JS bundle):
  - Evening and Daylight render with the mapped colours and bundled fonts.
  - Frame breaking: the photo crosses the inner frame's top edge. The background recedes, and the soft contact shadow stays inside the card.
  - In-flight: pitch, shear, extra lift, text drift and dimming are visible in the screen recording. The settled open state has no residual tilt, shear or text offset.
  - Android Back closes the preview without leaving the app.
  - Reopen during close settles identically to a normal open.
  - 60 rapid taps (30 open/close cycles) end in one clean state, with no JS errors.
  - OS Reduce Motion (`transition_animation_scale 0`) shows no lift, perspective, distortion or text movement.
  - Metro and logcat show no errors on a fresh bundle.

## Device matrix

| Device | Display mode | OS | Build | Result |
|---|---|---|---|---|
| Android emulator (arm64, 1080×2400) | 60 Hz emulated | Android 16 | Expo Go, dev bundle | Visual and interaction checks above. **Not performance evidence.** |
| Google Pixel 4a (user's phone, USB) | 60 Hz fixed (read from `dumpsys display`) | Android 13 | Local **debug** dev build (arm64-v8a only) via Metro | The full Step 4 journey passes: sign in, browse, open a dish (hologram corners visible), Save, log 8.5, journal. 0 JS errors. `gfxinfo` for the whole debug session: 4601 frames, 21.9% janky, p50 25 ms / p90 29 ms / p95 31 ms against a 16.7 ms budget. **A debug build is not representative**, so this is a warning, not a verdict. The release build is being measured next. |
| User's iPhone | pending | pending | pending (Expo Go for visuals) | **pending** |

120 Hz, 90 Hz and 60 Hz presentation tests, Perfetto FrameTimeline and Instruments traces, and the 10-minute sustained-use run are all **pending**. They require physical devices and release builds; an emulator or Expo Go cannot certify them.

## Known limitations

- The close transition's in-flight frames were not captured: the emulator recorder dropped frames. Close is covered by the interaction checks, not visually.
- The very first frame after launch wasn't captured, because Expo Go's splash covered it. `initialWindowMetrics` is set, and the layout is correct 2 s after launch.
- No transparent dish cutout asset exists, so the hero is a framed rectangular lift of a real photo.
- The light sweep reads as a translucent diagonal wedge mid-flight. It may need tuning on a real screen.
- There's no animated-duration scaling by quality tier yet, and no automatic downgrade after missed deadlines (Step 5).
- App icon, splash and adaptive icon are still Expo template defaults; no Bhookmark icon exists. `android.package` / `ios.bundleIdentifier` are not set; they're permanent store identifiers, so they need the user's decision.
- The redistribution rights of the two catalog photos are unconfirmed.

## Next executable step

Step 3: replace the demo button with a real card tap and a single root overlay. It needs the measured source rectangle, the idle/opening/open/closing lifecycle with a generation counter, focus and scroll restoration, and source removal. Keep the current in-flight choreography.

In parallel, connect the Android phone with USB debugging, so a development build can run on real hardware and its active refresh rate can be read.

## Remaining store blockers (separate from this motion work)

- **Mobile auth:** Google Sign-In needs the native Google SDK (it's blocked in embedded webviews). Tokens need secure storage. SMS OTP is unconfigured and would be a paid cost.
- **Mobile API:** HTTPS base URL and CORS/session changes.
- **Account deletion:** in-app, plus a web page (Play policy).
- **Privacy policy page.**
- **Moderation and reporting for user-generated photos:** policy review pending.
- **App icon and store listing assets.**
- **Play Console:** a $25 one-time fee, and a 12-tester / 14-day closed test for a new personal account.
- **iOS:** release builds need Xcode (not installed) or EAS plus the Apple Developer Program.
