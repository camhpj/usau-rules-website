/**
 * Every Gemini call goes through this configuration; the model is pinned HERE and
 * nowhere else. Current model is the GA `gemini-3.6-flash`, which supports the same
 * thinkingConfig thinkingLevel values and includeThoughts we rely on. Swapping models
 * is a one-line change (new caches are created automatically because the model is
 * part of the cache key).
 */
export const GEMINI_MODEL = 'gemini-3.6-flash';
export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Thinking tokens share this budget; 8k starved answers on think-heavy runs (prod bug 2026-07-13). */
export const AI_MAX_OUTPUT_TOKENS = 65536;

/** Explicit context cache for the rulebook prefix (~46k tokens). */
export const CACHE_TTL_S = 3600;
/** Recreate rather than reuse when the registered cache is this close to expiry. */
export const CACHE_MIN_REMAINING_MS = 5 * 60 * 1000;

/** Cost guardrails (UTC days). User-approved 2026-07-11; tune after Task 10 token counts. */
export const ASK_DAILY_PER_USER = 10;
export const SCENARIO_DAILY_PER_USER = 10;
/** All AI requests, all users, both kinds combined. */
export const AI_GLOBAL_DAILY = 200;

/** Watchdog: abort a stream that has produced no answer text (thoughts only) by this point. */
export const AI_STREAM_NO_ANSWER_MAX_MS = 45_000;
/** Watchdog: hard wall-clock cap on a single streaming response. */
export const AI_STREAM_MAX_MS = 120_000;
