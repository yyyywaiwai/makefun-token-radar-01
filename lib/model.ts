// Token Launch Radar — the valuation model.
//
// One sealed DefiLlama snapshot in, one ranked board of pre-token protocols out.
//
// The board ranks protocols that record no token yet. A protocol is pre-token when its snapshot
// record carries no market cap, no CoinGecko id and no symbol. Protocols that already trade are
// never ranked: they are set aside as the "live set" and shown at the market's own value. They
// still work for the model, though — they are its yardstick.
//
// The model, in one paragraph. For every category, the live set's own market caps say what the
// market pays for a dollar of TVL in that line of business: the category multiple is the median
// market-cap-to-TVL ratio of the category's live protocols, read off this snapshot, nothing
// hard-coded. A pre-token protocol's implied value is its TVL priced at its category's multiple,
// then adjusted by three factors that also come from its own record: a growth factor from its
// seven-day TVL change (damped, so one hot week cannot double a board), a readiness factor from
// how long DefiLlama has tracked it with no token (a launch is likelier, and likelier watched,
// the longer a sizeable protocol has run tokenless), and a small breadth factor for the number
// of chains it holds TVL on (more chains, more wallets a launch can reach). Every factor is
// printed on the board, so a reader can recompute any row from the snapshot's figures alone.

import { farmSteps } from './farm.ts';

/** One protocol of the snapshot: exactly the ten fields the sealed input carries. */
export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** The model's constants, printed in the dashboard so the arithmetic is auditable. */
export interface RadarModel {
  /** A category needs at least this many live protocols before its own multiple is trusted. */
  min_live_for_multiple: number;
  /** Category multiples are clamped into this band, so a thin category cannot explode the board. */
  multiple_floor: number;
  multiple_cap: number;
  /** The seven-day change is clamped into this band before it moves a value. */
  growth_floor_pct: number;
  growth_cap_pct: number;
  /** How much of the clamped weekly change becomes value: 0.45 of it, at most. */
  growth_weight: number;
  /** A protocol that has just appeared starts at this readiness; a veteran reaches +range more. */
  readiness_base: number;
  readiness_range: number;
  readiness_days: number;
  /** The age a protocol of unknown listed_at is scored with. */
  unknown_age_days: number;
  /** Each extra chain beyond the first adds this much, up to breadth_max_chains extra chains. */
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: RadarModel = {
  min_live_for_multiple: 3,
  multiple_floor: 0.08,
  multiple_cap: 2.5,
  growth_floor_pct: -60,
  growth_cap_pct: 120,
  growth_weight: 0.45,
  readiness_base: 0.72,
  readiness_range: 0.38,
  readiness_days: 1460,
  unknown_age_days: 400,
  breadth_per_chain: 0.025,
  breadth_max_chains: 8,
};

export const MODEL_VERSION = 'launch-radar-2';

/** How many live-token protocols the dashboard's live set carries, by market cap. */
export const LIVE_ROWS = 30;

/** Why a snapshot cannot be scored. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Whole days from listed_at to the snapshot's as_of; null when either date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether the record shows no token: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version marker: a name ending in a release is another protocol's pool, not a launch. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a below-floor protocol may join the board: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: Protocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The category multiples, read off the snapshot's live set: for each category with enough live
 * protocols, the median of market cap over TVL. Categories too thin to trust, and protocols with
 * no category, fall back to the market-wide median. Returned as a lookup plus the table itself,
 * so the dashboard can print where every multiple came from.
 */
export function categoryMultiples(snapshot: Snapshot, model: RadarModel = MODEL): { multipleOf: Map<string, number>; table: { category: string; live: number; multiple: number }[]; market: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? '(none)';
    const list = ratios.get(key);
    if (list === undefined) ratios.set(key, [ratio]);
    else list.push(ratio);
  }
  const marketRaw = all.length === 0 ? 1 : clamp(median(all), model.multiple_floor, model.multiple_cap);
  const market = round4(marketRaw);
  const multipleOf = new Map<string, number>();
  const table: { category: string; live: number; multiple: number }[] = [];
  for (const [category, list] of [...ratios.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    // The multiple is rounded to the 4 decimals the board and the dashboard print before it
    // prices anything: a reader recomputing a row from the printed multiple must land on the
    // printed implied value to the dollar, not near it.
    const own = list.length >= model.min_live_for_multiple ? round4(clamp(median(list), model.multiple_floor, model.multiple_cap)) : market;
    multipleOf.set(category, own);
    table.push({ category, live: list.length, multiple: own });
  }
  return { multipleOf, table, market };
}

/** The four factors one protocol is priced with, and the value they multiply to. */
export interface Pricing {
  multiple: number;
  growth_pct: number;
  growth_factor: number;
  readiness_factor: number;
  breadth_factor: number;
  age_days: number | null;
  implied_value_usd: number;
}

/** Price one pre-token protocol from its own record and its category's multiple. */
export function price(p: Protocol, asOf: string, multiple: number, model: RadarModel = MODEL): Pricing {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = clamp(p.change_7d ?? 0, model.growth_floor_pct, model.growth_cap_pct);
  const growthFactor = Math.max(0.4, 1 + (growthPct / 100) * model.growth_weight);
  const ageForModel = age ?? model.unknown_age_days;
  const readinessFactor = model.readiness_base + (clamp(ageForModel, 0, model.readiness_days) / model.readiness_days) * model.readiness_range;
  const breadthFactor = 1 + model.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_chains);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthFactor * readinessFactor * breadthFactor));
  return { multiple, growth_pct: growthPct, growth_factor: growthFactor, readiness_factor: readinessFactor, breadth_factor: breadthFactor, age_days: age, implied_value_usd: implied };
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_factor: number;
    readiness_factor: number;
    breadth_factor: number;
  };
  farm_steps: string[];
}

/**
 * The board's selection: every watchlist slug, plus the whole early universe — every rankable
 * pre-token protocol below the floor. On this snapshot that universe is small enough to carry
 * whole (the snapshot itself starts at $5M of TVL), and a radar that silently drops its smallest
 * finds is worse than one that ranks them last: completeness first, the pricing does the ranking.
 */
export function selectBoardProtocols(snapshot: Snapshot): Map<string, Protocol> {
  const chosen = new Map<string, Protocol>();
  for (const p of snapshot.protocols) {
    if (isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  return chosen;
}

/** The ranked board: priced, sorted by implied value, ranks 1..N. */
export function buildBoard(snapshot: Snapshot, model: RadarModel = MODEL): BoardRow[] {
  const { multipleOf, market } = categoryMultiples(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const scored = [...selectBoardProtocols(snapshot).values()].map((p) => {
    const multiple = multipleOf.get(p.category ?? '(none)') ?? market;
    return { p, pricing: price(p, snapshot.as_of, multiple, model) };
  });
  scored.sort(
    (a, b) =>
      b.pricing.implied_value_usd - a.pricing.implied_value_usd ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : 1),
  );
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.pricing.age_days,
    watchlist: watch.has(s.p.slug),
    implied_value_usd: s.pricing.implied_value_usd,
    model: {
      category_multiple: round4(s.pricing.multiple),
      growth_pct: s.pricing.growth_pct,
      growth_factor: round4(s.pricing.growth_factor),
      readiness_factor: round4(s.pricing.readiness_factor),
      breadth_factor: round4(s.pricing.breadth_factor),
    },
    farm_steps: farmSteps(s.p, s.pricing.age_days),
  }));
}

/** A live-token protocol, shown at the market's value and never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

/** The live set: the biggest already-token protocols by market cap. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d, symbol: p.symbol }));
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: RadarModel;
  model_version: string;
  market_multiple: number;
  multiples: { category: string; live: number; multiple: number }[];
  scanned: number;
  pre_token: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Build the board and the dashboard's data from one snapshot. */
export function buildRadar(snapshot: Snapshot, model: RadarModel = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { table, market } = categoryMultiples(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    market_multiple: market,
    multiples: table,
    scanned: snapshot.protocols.length,
    pre_token: snapshot.protocols.filter(isPreToken).length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string' || o.source.length === 0) throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null when it is. Mirrors the gate's board rows. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board names a slug twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `the board names ${r.slug}, which the snapshot does not`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `row ${i + 1} carries rank ${board[i]!.rank}`;
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
    const v = board[i]!.implied_value_usd;
    if (!Number.isSafeInteger(v) || v <= 0 || v > 1e14) return `${board[i]!.slug} has implied value ${v}`;
    const steps = board[i]!.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${board[i]!.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${board[i]!.slug} has a farm step of ${t.length} characters`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  return null;
}

/** data.js: the dashboard's whole dataset as one script — no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
