import type { ScheduleRule } from "../types.js";
import { scheduleStore } from "../../db/database.js";
import type { QueueManager } from "./QueueManager.js";

const CHECK_INTERVAL_MS = 60_000;

function matchesNow(rule: ScheduleRule, now: Date): boolean {
  if (!rule.enabled) return false;
  if (rule.daysOfWeek.length > 0 && !rule.daysOfWeek.includes(now.getDay())) return false;
  const hour = now.getHours();
  if (rule.startHour === rule.endHour) return true; // full-day rule
  if (rule.startHour < rule.endHour) {
    return hour >= rule.startHour && hour < rule.endHour;
  }
  // wraps midnight, e.g. 22 -> 6
  return hour >= rule.startHour || hour < rule.endHour;
}

/**
 * Applies time-of-day bandwidth caps automatically (e.g. "throttle to
 * 500KB/s during business hours"). Purely additive on top of the manual
 * cap in GlobalSettings: with no rules configured this is a no-op and
 * PUT /api/settings behaves exactly as if the scheduler didn't exist.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  // While a rule is actively overriding the manual cap, this holds
  // whatever cap was in effect immediately before the override started,
  // so it can be restored once no rule matches anymore. `undefined` means
  // "not currently overriding" -- distinct from `null`, which is a
  // legitimate "unlimited" baseline value to restore to.
  private baselineCap: number | null | undefined = undefined;

  constructor(private queue: QueueManager) {}

  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getRules(): ScheduleRule[] {
    return scheduleStore.list();
  }

  setRules(rules: ScheduleRule[]): ScheduleRule[] {
    scheduleStore.replaceAll(rules);
    this.tick();
    return rules;
  }

  private tick(): void {
    const rules = scheduleStore.list();
    const now = new Date();
    const match = rules.find((r) => matchesNow(r, now));

    if (!match) {
      if (this.baselineCap !== undefined) {
        // A rule was overriding the cap and its window just ended (or its
        // rule was removed) -- restore whatever was in effect before the
        // override started, rather than leaving the last rule's cap
        // applied forever. Without this, "throttle 9-17" would throttle
        // permanently after 17:00 too.
        this.queue.applyGlobalBandwidthCap(this.baselineCap);
        this.baselineCap = undefined;
      }
      return;
    }

    if (this.baselineCap === undefined) {
      // First tick where a rule applies -- remember the pre-override cap
      // once, so later ticks (while still matching, possibly a different
      // rule) don't overwrite it with an already-overridden value.
      this.baselineCap = this.queue.getSettings().globalBandwidthCap;
    }
    const current = this.queue.getSettings().globalBandwidthCap;
    if (current !== match.bandwidthCapBytesPerSec) {
      this.queue.applyGlobalBandwidthCap(match.bandwidthCapBytesPerSec);
    }
  }
}
