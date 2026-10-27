import { DEFAULT_CATEGORY_WEIGHTS, type Config } from './config/schema.js';
import type { CheckResult } from './types.js';

/** Weight for plugin categories that have no configured or default weight. */
export const FALLBACK_CATEGORY_WEIGHT = 10;

export interface CategoryScore {
  id: string;
  /** undefined when every check in the category was skipped or errored. */
  score: number | undefined;
  weight: number;
  checks: string[];
}

export interface ScoreSummary {
  overall: number | undefined;
  grade: Grade | undefined;
  categories: CategoryScore[];
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export function grade(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function weightedMean(items: { value: number; weight: number }[]): number | undefined {
  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  if (totalWeight === 0) return undefined;
  return items.reduce((s, i) => s + i.value * i.weight, 0) / totalWeight;
}

export function categoryWeight(category: string, config: Config): number {
  return config.weights[category] ?? DEFAULT_CATEGORY_WEIGHTS[category] ?? FALLBACK_CATEGORY_WEIGHT;
}

/**
 * Category score = weighted mean of its completed checks' scores (check weight, default 1).
 * Overall = weighted mean of category scores. Categories without a completed check are left
 * out and the remaining weights renormalised, so a skipped runtime phase doesn't drag the
 * score to zero.
 */
export function computeScores(results: CheckResult[], config: Config): ScoreSummary {
  const byCategory = new Map<string, CheckResult[]>();
  for (const r of results) {
    if (r.status === 'skipped') continue;
    byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
  }

  const categories: CategoryScore[] = [...byCategory].map(([id, checks]) => {
    const score = weightedMean(
      checks.flatMap((c) =>
        c.status === 'completed' && c.score !== undefined
          ? [{ value: c.score, weight: c.weight }]
          : [],
      ),
    );
    return {
      id,
      score: score === undefined ? undefined : Math.round(score),
      weight: categoryWeight(id, config),
      checks: checks.map((c) => c.id),
    };
  });

  const overallRaw = weightedMean(
    categories.flatMap((c) =>
      c.score === undefined ? [] : [{ value: c.score, weight: c.weight }],
    ),
  );
  const overall = overallRaw === undefined ? undefined : Math.round(overallRaw);
  return { overall, grade: overall === undefined ? undefined : grade(overall), categories };
}
