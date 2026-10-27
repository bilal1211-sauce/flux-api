# APIForge interface

Graphite application surfaces use a restrained mint primary action, cyan configuration accents, violet helper states, and red failures. Tokens in `src/styles/apiforge.css` support light and dark themes. Theme choice alone is stored in local storage; credentials are not.

The desktop shell has a fixed workspace navigation, grouped observability links, a workspace picker, usage indicator, search and profile controls. Below 760px the sidebar becomes a dismissible drawer. Forms and editor metadata stack on narrow screens; large result tables scroll inside their own container.

Use empty states for metrics without samples. Charts draw only recorded run data. Availability describes successful sampled monitor checks rather than claiming continuous uptime. Actions show loading, validation errors and confirmations for deletion. Dialogs use native modal focus management, controls have accessible labels, and keyboard focus remains visible. Reduced-motion preferences disable animation.

Request Studio supports multiple in-memory drafts, saved request reopening, JSON headers/parameters/assertions, raw body editing, environment variables, response inspection and keyboard shortcuts. Drafts are not promised to survive a page reload; save requests explicitly.

Browser-verified previews are in `docs/previews/`. The screenshots reflect real executions recorded by the local demo or test account, not generated sample analytics. Regenerate demo captures with `node scripts/capture-previews.mjs` while services are running.
