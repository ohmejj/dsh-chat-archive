/**
 * Pure archiving decision — no services, no filesystem, fully testable.
 *
 * The runner resolves each durable session's last-activity timestamp first
 * (stat on the backend artifact), then asks this module who crossed the idle
 * threshold. Idempotent by construction: already-archived and live sessions
 * are skipped, so repeated scans (boot, timer, config save, “Archive now”)
 * never double-archive a session.
 */

/** One durable session with its resolved last-activity timestamp. */
export interface SessionActivity {
  /** Durable session id. */
  id: unknown
  /** Last activity in ms epoch; undefined when it cannot be determined. */
  activityMs: number | undefined
}

/** Outcome buckets of one scan pass. */
export interface ScanDecision {
  /** Sessions that crossed the threshold and should be archived now. */
  selected: unknown[]
  /** Sessions skipped: no reliable activity timestamp (backend has no artifact). */
  undeterminable: unknown[]
  /** Sessions skipped: a live session owns them right now. */
  live: unknown[]
  /** Sessions skipped: already in the archive set. */
  alreadyArchived: unknown[]
  /** Sessions skipped: last activity is still newer than the cutoff. */
  recent: unknown[]
}

/**
 * Classify one candidate list against the archive set, the live set and the
 * idle cutoff.
 * @param sessions - durable session candidates with resolved activity.
 * @param archivedIds - registry-global archive set (by session id).
 * @param liveIds - sessions currently live on the Host (never archived).
 * @param cutoff - ms epoch; sessions with activityMs <= cutoff are idle enough.
 * @returns per-bucket decisions.
 */
export function decideArchivable(
  sessions: readonly SessionActivity[],
  archivedIds: ReadonlySet<unknown>,
  liveIds: ReadonlySet<unknown>,
  cutoff: number,
): ScanDecision {
  const decision: ScanDecision = { selected: [], undeterminable: [], live: [], alreadyArchived: [], recent: [] }
  for (const session of sessions) {
    const id = session.id
    if (archivedIds.has(id)) {
      decision.alreadyArchived.push(id)
    } else if (liveIds.has(id)) {
      decision.live.push(id)
    } else if (session.activityMs === undefined) {
      decision.undeterminable.push(id)
    } else if (session.activityMs <= cutoff) {
      decision.selected.push(id)
    } else {
      decision.recent.push(id)
    }
  }
  return decision
}
