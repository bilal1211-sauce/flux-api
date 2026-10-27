# React Bits registry setup and APIForge hero

The web app's `components.json` registers both official React Bits registries with `Authorization: Bearer ${REACTBITS_LICENSE_KEY}`. URLs were verified against the [official installation documentation](https://pro.reactbits.dev/docs/installation) and the registry's unauthenticated setup response.

The requested [Hero 13 block](https://pro.reactbits.dev/docs/blocks/hero-section/hero-13) requires a React Bits Pro license. No key was available, and the user confirmed they do not have one. Running the requested install command stopped with a missing `REACTBITS_LICENSE_KEY` error. **The official block is not installed.**

An original APIForge hero is implemented instead in `apps/web/src/components/marketing/apiforge-hero.tsx`, imported by `apps/web/src/app/page.tsx`. It uses existing Lucide icons and APIForge design tokens, with a glow divider, floating icon animations, an explicitly labeled example request, responsive layouts and reduced-motion support. It has no paid dependency. The public homepage is `/`; workspace and authentication remain at `/dashboard`.

If a license is obtained later, add this only to the ignored `apps/web/.env.local`:

```dotenv
REACTBITS_LICENSE_KEY=your_actual_license_key
```

Then run from `apps/web`:

```powershell
npx.cmd shadcn@latest add @reactbits-pro/hero-13
```

Do not prefix the key with `NEXT_PUBLIC_` or paste it directly into `components.json`. The registry configuration is prepared; any dependencies, shared shadcn utilities and theme requirements of the licensed source still need review when it becomes available. The original hero is deliberately named `ApiForgeHero` so it cannot be mistaken for the commercial block.

## Verification ? 18 October 2026

ESLint, strict TypeScript and the production Next.js build passed. Browser checks covered public landing-to-workspace navigation, the existing mobile workspace layout, styled desktop rendering, dark/light themes, widths of 320/390/768 pixels, active animations and reduced-motion preferences. Previews are `docs/previews/hero-desktop.png`, `hero-light.png` and `hero-mobile.png`. The Tailwind loader now excludes `.module.css` files so native Next.js CSS-module exports remain intact. The capture helper explicitly opens `/dashboard` for sign-in previews.
