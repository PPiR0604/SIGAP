# BoardUI in SIGAP

SIGAP uses the free BoardUI source components, installed through the BoardUI connector, with Tailwind CSS v4 and React Aria. It remains a Vite React application. No Next.js runtime or BoardUI Pro license is required for the installed components.

- `styles/`: official BoardUI theme, composite typography and shared utilities.
- `components/base/`: installed buttons, icon buttons, input, textarea, chips and tabs.
- `components/foundations/direction/`: Indonesian locale and LTR interaction boundary.
- `src/ui/ActionButton.tsx`: existing action classes mapped to BoardUI variants; preserves native button types, events, refs and disabled state.
- `src/ui/StatusBadge.tsx`: existing operational statuses mapped to BoardUI chips; status text and the legacy `.badge` layout hook are preserved.
- `src/boardui-sigap.css`: semantic token aliases and layout integration for existing operational screens. This imports no external fonts or styles at runtime.

Inter is bundled from the pinned Fontsource package and included in the offline asset cache. The Vite alias `@/` points to the frontend package root, including in the isolated browser-test configuration. Tailwind is compiled through `postcss.config.mjs`.

The installed source's Next.js-only `use client` directives were removed from the components used here because the entire Vite app renders on the client. Other component behavior is retained. Existing domain-specific numeric forms keep their source binding, validation and confirmation logic.

`PillTabList` also establishes an isolated stacking context so its animated thumb and raised labels stay below the sticky application header when scrolled. This keeps the fix local to the control without raising header layers above dialogs or notifications.

Restyling does not grant write permissions, replace the model runtime, bypass human approval, or introduce automatic offline submission.

Registry documentation: https://www.boardui.com/components/button and https://www.boardui.com/skill
