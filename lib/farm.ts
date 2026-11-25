// Farm plans: what a reader should actually do, per protocol.
//
// Every plan is derived from the protocol's own record — its category picks the core action, its
// chains pick where the action happens and whether a second chain is worth visiting, its TVL
// picks a sane position size, and its age picks how long the position should be held so the
// activity lands in more than one weekly snapshot. No protocol is named anywhere in this file:
// the same templates score a lending market on Ethereum and a lending market on Base, with the
// record's own figures filled in.

import type { Protocol } from './model.ts';

/** Capital for one farm position, scaled to the protocol's size: big protocols absorb more. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 300;
  if (tvl >= 1_000_000_000) return 200;
  if (tvl >= 250_000_000) return 120;
  if (tvl >= 50_000_000) return 80;
  return 40;
}

/** Gas for one round trip, scaled the same way: a position on a large protocol justifies more. */
function gasFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 10;
  if (tvl >= 100_000_000) return 6;
  return 3;
}

/** Days to hold: a young protocol needs a longer qualifying window than a veteran. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 120) return 75;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

interface CategoryPlan {
  core: (name: string, chain: string, capital: number) => string;
  second: (name: string, chain: string, capital: number) => string;
  weekly: string;
}

const DEFAULT_PLAN: CategoryPlan = {
  core: (name, chain, capital) => `Deposit $${capital} of USDC into ${name} on ${chain} through the protocol's own app and leave the position open.`,
  second: (name, chain, capital) => `Repeat a smaller $${Math.max(20, Math.round(capital / 2))} deposit a week later so the wallet shows two separate entry dates.`,
  weekly: 'one small deposit or withdrawal of a few dollars',
};

/** The plan template per line of business, matched on the category's own words. */
const PLANS: { match: string[]; plan: CategoryPlan }[] = [
  {
    match: ['lending', 'cdp', 'collateralized'],
    plan: {
      core: (name, chain, capital) => `Supply $${capital} of USDC as collateral in ${name} on ${chain} and borrow about a third of it back against the position.`,
      second: (name) => `Repay a slice of the borrow and borrow again once, so the wallet records both sides of the lending market.`,
      weekly: 'one interest check plus a small collateral top-up or partial repay',
    },
  },
  {
    match: ['dex', 'aggregator'],
    plan: {
      core: (name, chain, capital) => `Add $${capital} of liquidity to ${name}'s deepest stablecoin pool on ${chain} and keep the LP position open.`,
      second: (name, chain, capital) => `Route about $${Math.max(20, Math.round(capital / 3))} of swaps through ${name} on ${chain} across two different days.`,
      weekly: 'one swap of $20 or more through the protocol router',
    },
  },
  {
    match: ['bridge', 'canonical'],
    plan: {
      core: (name, chain, capital) => `Bridge $${capital} of USDC through ${name} to ${chain}, then use the bridged funds in one app on the far side.`,
      second: (name, chain, capital) => `Bridge about $${Math.max(20, Math.round(capital / 2))} back a week later so both directions appear in the wallet's history.`,
      weekly: 'one small bridge transfer in either direction',
    },
  },
  {
    match: ['staking', 'restaking', 'staking pool'],
    plan: {
      core: (name, chain, capital) => `Stake $${capital} worth of the chain's staking asset through ${name} on ${chain} and keep the staking receipt in the wallet.`,
      second: (name) => `Claim the staking rewards once and restake them, so the wallet shows a full staking cycle.`,
      weekly: 'one rewards claim or a small additional stake',
    },
  },
  {
    match: ['derivative', 'perpetual', 'options'],
    plan: {
      core: (name, chain, capital) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, then close it after a day.`,
      second: (name, capital) => `Trade a second contract with about $${Math.max(20, Math.round(capital / 3))} of margin so the account holds more than one market's history.`,
      weekly: 'one small trade, opened and closed inside the week',
    },
  },
  {
    match: ['curator', 'allocator', 'vault'],
    plan: {
      core: (name, chain, capital) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares untouched in the wallet.`,
      second: (name, chain, capital) => `Add a second $${Math.max(20, Math.round(capital / 2))} deposit after the next vault reallocation is announced.`,
      weekly: 'one check of the vault allocation page, plus a small top-up monthly',
    },
  },
  {
    match: ['rwa', 'real world'],
    plan: {
      core: (name, chain, capital) => `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} through its own onboarding flow and hold it.`,
      second: (name) => `Complete every identity and accreditation step ${name} offers, even the optional ones, before the position seasons.`,
      weekly: 'one login and a read of the protocol reserve or attestation report',
    },
  },
  {
    match: ['yield'],
    plan: {
      core: (name, chain, capital) => `Deposit $${capital} of USDC into ${name}'s main yield position on ${chain} and leave it compounding.`,
      second: (name, chain, capital) => `Move about $${Math.max(20, Math.round(capital / 3))} into a second strategy the protocol offers on ${chain}.`,
      weekly: 'one harvest or restake of the accrued yield',
    },
  },
  {
    match: ['stablecoin', 'stable'],
    plan: {
      core: (name, chain, capital) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the balance.`,
      second: (name, chain, capital) => `Spend about $${Math.max(20, Math.round(capital / 4))} of the stable asset in one payment or swap on ${chain}.`,
      weekly: 'one transfer or swap using the stable asset',
    },
  },
  {
    match: ['insurance'],
    plan: {
      core: (name, chain, capital) => `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold and keep the policy to expiry.`,
      second: (name) => `Stake a small amount into the underwriting pool as well, so the wallet appears on both sides of the market.`,
      weekly: 'one check of the cover book and the pool solvency page',
    },
  },
  {
    match: ['prediction'],
    plan: {
      core: (name, chain, capital) => `Fund the account with $${capital} and take one position in ${name}'s most liquid market.`,
      second: (name) => `Settle the position at resolution instead of selling early, so the full market cycle is recorded.`,
      weekly: 'one new position in a different market each week',
    },
  },
  {
    match: ['basis', 'funding'],
    plan: {
      core: (name, chain, capital) => `Deposit $${capital} of USDC into ${name}'s basis strategy on ${chain} and keep the strategy shares.`,
      second: (name) => `Read the strategy's funding-rate history once and note the weeks it paid best in the farm log.`,
      weekly: 'one check of the funding dashboard and a small top-up when funding is positive',
    },
  },
];

function planFor(category: string | null): CategoryPlan {
  const c = (category ?? '').toLowerCase();
  for (const entry of PLANS) if (entry.match.some((m) => c.includes(m))) return entry.plan;
  return DEFAULT_PLAN;
}

/** Trim or pad one step into the gate's 20..600 character window. */
function step(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page weekly.`;
  return s;
}

/**
 * One protocol's farm plan: six steps, each an action with its cost and its time, every figure
 * taken from the protocol's record. Steps: set up, the core position, a second surface, the
 * weekly cadence, the hold, and the exit hygiene.
 */
export function farmSteps(p: Protocol, age: number | null): string[] {
  const plan = planFor(p.category);
  const capital = capitalFor(p.tvl_usd);
  const gas = gasFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const first = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const steps = [
    step(
      `Create a fresh wallet for ${p.name} alone, fund it from your main wallet, and store its seed phrase offline on paper.`,
      'under $3 of gas for the funding transfer',
      '10 minutes',
    ),
    step(plan.core(p.name, first, capital), `$${capital} of capital plus about $${gas} of gas`, '15 minutes to set up'),
    step(plan.second(p.name, first, capital), `about $${Math.max(2, Math.round(gas / 2))} of gas`, '10 minutes'),
  ];
  if (secondChain !== null) {
    steps.push(
      step(
        `Repeat the core position with about $${Math.max(20, Math.round(capital / 2))} on ${secondChain}, where ${p.name} also holds TVL, so the farm is not a one-chain wallet.`,
        `about $${gas} of gas plus the bridge fee if the funds move chains`,
        '20 minutes',
      ),
    );
  }
  steps.push(
    step(
      `Every week, make ${plan.weekly} on ${p.name}, and vary the day and the amount slightly so the history reads as use, not a script.`,
      'about $2 of gas a week',
      '10 minutes a week',
    ),
    step(
      `Hold the position for at least ${hold} days before withdrawing anything, so the activity is counted in more than one weekly snapshot of the protocol.`,
      `the $${capital} stays in the position for the whole window`,
      `${hold} days`,
    ),
    step(
      `When a points or rewards page appears, claim only from the link on ${p.name}'s own site, never pay a fee to claim, and write the wallet, dates and transactions into a farm log before you unwind.`,
      'nothing to check; a claim fee is always a scam',
      '15 minutes',
    ),
  );
  return steps.slice(0, 7);
}
