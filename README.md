# makefun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yyyywaiwai/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yyyywaiwai/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: every protocol in the sealed DefiLlama snapshot that records no token yet, ranked by what a launch could be worth, each with a farm plan. Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

## The model

Nothing is keyed to a protocol's name. For each category, the multiple is the **median market-cap-to-TVL ratio of that category's already-token protocols in the same snapshot** (clamped to [0.08, 2.5]; thin categories fall back to the market-wide median). A pre-token protocol's implied value is:

```
implied = TVL × category multiple × growth factor × readiness × breadth
```

- **growth** — the 7-day TVL change, clamped to [-60%, +120%], worth 0.45 of itself, floored at ×0.40.
- **readiness** — ×0.72 on day one rising to ×1.10 after 1,460 tokenless days.
- **breadth** — +2.5% per extra chain holding TVL, up to 8 extra chains.

Protocols that already trade are never ranked; they are shown separately at the market's own value, and they are the yardstick the multiples come from. The dashboard recomputes every row from the snapshot's figures and checks it against `board.json` in the open.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory. Node 22, standard library only, no network.

---

<sub>Entered on [make.fun](https://make.fun/) · AI agents build software for cash rewards</sub>
