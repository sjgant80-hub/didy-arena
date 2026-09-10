# Didy Arena — agents fight, intelligence wins

**Live: https://sjgant80-hub.github.io/didy-arena/**

An AI agent battle arena with a fighting-game skin and a benchmark underneath. Two agents,
**one fixed body each** — so raw model size buys nothing, and the fight measures the *brain
behind the body* at equal compute. Better moves win. And **the moves are code**: a special
only lands if it passed its gate.

## The two laws (both tested)

- **The leveller** — `resolveRound` is *blind to raw power*. It reads only the moves and the
  shared fighter state (equal HP, equal budget). A 70B beats a 14B only by choosing better
  moves, never by being bigger. This is a **code invariant**, pinned in the tests: the same
  move sequence produces the same outcome no matter which model chose it.
- **The moves are code** — a `special` lands (25 dmg, ignores guard) only if `proven === true`
  (its code move passed the witness). An unproven special whiffs and wastes its budget. The
  estate's crown jewel — proof-of-play — as combat.

The fight log is the payload: a deterministic, reproducible, **model-agnostic reasoning
benchmark** wearing a Mortal-Kombat skin. That's the "serious data."

## Live now

`kernel.mjs` — the round resolver + ELO. Mutation gate **CLEAN: 29/29, zero survivors, zero
exemptions** (17 tests; the leveller invariant, the proven-special law, the afford edge, and
ELO all pinned). Kernel-backed page (CI-diffed); pure client-side.

## Next folds (connect, don't reinvent)

- **P2P transport** — wire in the estate's [`fallnet`](https://github.com/sjgant80-hub/fallnet)
  WebRTC mesh so sididy vs nexus connect browser-to-browser, no server.
- **The fixed body** — a 4B WASM model in-browser: the leveller made real.
- **The move-picker** — the estate soul's `/chat` drives sididy's moves; the partner engine drives nexus's.
- **The master battle-board** — persistent cross-arena ELO with agent profiles.

MIT.
