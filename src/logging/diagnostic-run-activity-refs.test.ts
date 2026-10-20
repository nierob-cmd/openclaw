// Covers release of retained session activity refs for long-lived Gateways.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activityByRef,
  pruneDiagnosticSessionActivityRefs,
  resolveSessionActivity,
} from "./diagnostic-run-activity-state.js";
import {
  closeDiagnosticEmbeddedRunOwner,
  createDiagnosticEmbeddedRunOwner,
  markDiagnosticEmbeddedRunStarted,
  markDiagnosticRunProgress,
  resetDiagnosticRunActivityForTest,
  startDiagnosticRunActivityTracking,
} from "./diagnostic-run-activity.js";

const TTL_MS = 30 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
  resetDiagnosticRunActivityForTest();
});

describe("diagnostic session activity refs", () => {
  it("releases idle activities whose ttl expired", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = Date.parse("2026-10-20T00:00:00Z");
    vi.setSystemTime(startedAt);
    startDiagnosticRunActivityTracking();
    markDiagnosticRunProgress({
      sessionId: "idle-session",
      sessionKey: "agent:main:webchat",
      reason: "model_call:stream_progress",
    });
    expect(activityByRef.size).toBeGreaterThan(0);

    vi.setSystemTime(startedAt + TTL_MS + 60_000);
    pruneDiagnosticSessionActivityRefs(Date.now(), true);

    expect(activityByRef.size).toBe(0);
  });

  it("keeps activities that still have an active embedded run", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = Date.parse("2026-10-20T00:00:00Z");
    vi.setSystemTime(startedAt);
    startDiagnosticRunActivityTracking();
    const ref = {
      sessionId: "active-session",
      sessionKey: "agent:main:webchat",
      runId: "active-run",
    };
    const owner = createDiagnosticEmbeddedRunOwner(ref);
    markDiagnosticEmbeddedRunStarted({ ...ref, owner });
    expect(activityByRef.size).toBeGreaterThan(0);

    vi.setSystemTime(startedAt + TTL_MS + 60_000);
    pruneDiagnosticSessionActivityRefs(Date.now(), true);

    expect(activityByRef.size).toBeGreaterThan(0);
    expect(resolveSessionActivity({ sessionId: ref.sessionId })).toBeDefined();
  });

  it("releases both refs of an evicted activity", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = Date.parse("2026-10-20T00:00:00Z");
    vi.setSystemTime(startedAt);
    startDiagnosticRunActivityTracking();
    markDiagnosticRunProgress({
      sessionId: "paired-session",
      sessionKey: "agent:main:webchat",
      reason: "model_call:stream_progress",
    });
    expect(activityByRef.has("id:paired-session")).toBe(true);
    expect(activityByRef.has("key:agent:main:webchat")).toBe(true);

    vi.setSystemTime(startedAt + TTL_MS + 60_000);
    pruneDiagnosticSessionActivityRefs(Date.now(), true);

    // Releasing only one ref would keep the activity reachable through the other.
    expect(activityByRef.has("id:paired-session")).toBe(false);
    expect(activityByRef.has("key:agent:main:webchat")).toBe(false);
  });

  it("caps the retained activity set", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = Date.parse("2026-10-20T00:00:00Z");
    vi.setSystemTime(startedAt);
    startDiagnosticRunActivityTracking();
    // Each run mints its own session identity, so each adds a distinct activity.
    for (let index = 0; index < 2_100; index++) {
      markDiagnosticRunProgress({
        sessionId: `run-${index}`,
        sessionKey: `agent:main:cron:job:run:${index}`,
        reason: "model_call:stream_progress",
      });
    }
    // The cap holds during normal operation, not only after an explicit prune.
    // An insertion may exceed the cap by one, exactly like the sibling session-state index.
    expect(new Set(activityByRef.values()).size).toBeLessThanOrEqual(2_001);

    pruneDiagnosticSessionActivityRefs(Date.now(), true);

    expect(new Set(activityByRef.values()).size).toBeLessThanOrEqual(2_000);
  });

  it("does not accumulate stale id: aliases for one activity whose sessionKey stays stable across resets", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = Date.parse("2026-10-20T00:00:00Z");
    vi.setSystemTime(startedAt);
    startDiagnosticRunActivityTracking();
    const sessionKey = "agent:main:cron:stable-key";
    // Same sessionKey, a fresh sessionId per reset - the pattern a long-lived Gateway
    // cron/boot/subagent identity produces on every re-arm.
    for (let index = 0; index < 500; index++) {
      vi.setSystemTime(startedAt + index * 1_000);
      markDiagnosticRunProgress({
        sessionId: `rotating-id-${index}`,
        sessionKey,
        reason: "model_call:stream_progress",
      });
    }
    const refs = [...activityByRef.keys()].filter(
      (ref) => ref === `key:${sessionKey}` || ref.startsWith("id:rotating-id-"),
    );
    // Only the current id: ref (plus the stable key: ref) should remain - not one per reset.
    expect(refs).toHaveLength(2);
    expect(activityByRef.has("key:" + sessionKey)).toBe(true);
    expect(activityByRef.has("id:rotating-id-499")).toBe(true);
    expect(activityByRef.has("id:rotating-id-0")).toBe(false);
  });

  it("keeps an activity with a pending recovery cutoff reachable past the idle ttl", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = Date.parse("2026-10-20T00:00:00Z");
    vi.setSystemTime(startedAt);
    startDiagnosticRunActivityTracking();
    const ref = { sessionId: "cutoff-session", sessionKey: "agent:main:cutoff" };
    // Starting and closing an embedded run owner records a recovery cutoff for its runId,
    // which protects against a delayed/queued start event for that same run arriving late.
    for (let index = 0; index < 4; index++) {
      const runId = `cutoff-run-${index}`;
      const owner = createDiagnosticEmbeddedRunOwner({ ...ref, runId });
      markDiagnosticEmbeddedRunStarted({ ...ref, runId, owner });
      closeDiagnosticEmbeddedRunOwner(owner);
    }
    const activity = resolveSessionActivity(ref);
    expect(activity?.recoveredOwnerStartEventCutoffs.size).toBeGreaterThan(0);

    vi.setSystemTime(startedAt + TTL_MS + 60_000);
    pruneDiagnosticSessionActivityRefs(Date.now(), true);

    // A pending cutoff means a queued start for this owner can still arrive; releasing the
    // activity early would let it recreate a phantom activity with no cutoff on replay.
    expect(activityByRef.has("id:cutoff-session")).toBe(true);
    expect(activityByRef.has("key:agent:main:cutoff")).toBe(true);
  });
});
