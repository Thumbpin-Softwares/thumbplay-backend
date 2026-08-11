// Port of thumbpinclient/src/lib/remotion/duration.js, trimmed to what the
// "ActionReel" composition needs: applyCutRanges (the editor's cut/trim
// algorithm - kept since the composition itself is generic over cutRanges,
// even though this pass's own generate→render flow never populates them)
// and calcActionReelBaseDurationInFrames. Skipped: clampBrollClips,
// calcDurationInFrames, mapVirtualRangeToOriginal - all belong to the
// SeedanceReel/NewsAnchor compositions (other pipelines, out of scope) or
// the editor UI itself (out of scope).

export interface CutRange {
  start: number;
  end: number;
}

export interface KeepRange {
  originalStart: number;
  originalEnd: number;
  virtualStart: number;
  virtualEnd: number;
}

export interface AppliedCutRanges {
  keptDurationInFrames: number;
  keepRanges: KeepRange[];
}

// Given the full original timeline length and a list of excluded frame
// ranges, returns the resulting shorter "virtual" timeline plus the
// original<->virtual mapping for each surviving chunk. Overlapping/adjacent
// excluded ranges are merged.
export function applyCutRanges(totalDurationInFrames: number, excludedRanges: CutRange[] = []): AppliedCutRanges {
  const merged = excludedRanges
    .map((r) => ({
      start: Math.max(0, Math.min(r.start, totalDurationInFrames)),
      end: Math.max(0, Math.min(r.end, totalDurationInFrames)),
    }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start)
    .reduce<CutRange[]>((acc, r) => {
      const last = acc[acc.length - 1];
      if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
      else acc.push({ ...r });
      return acc;
    }, []);

  const keepRanges: Array<{ originalStart: number; originalEnd: number }> = [];
  let cursor = 0;
  for (const r of merged) {
    if (r.start > cursor) keepRanges.push({ originalStart: cursor, originalEnd: r.start });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < totalDurationInFrames) {
    keepRanges.push({ originalStart: cursor, originalEnd: totalDurationInFrames });
  }

  let virtualCursor = 0;
  const fullKeepRanges: KeepRange[] = keepRanges.map((kr) => {
    const virtualStart = virtualCursor;
    virtualCursor += kr.originalEnd - kr.originalStart;
    return { ...kr, virtualStart, virtualEnd: virtualCursor };
  });

  return { keptDurationInFrames: virtualCursor, keepRanges: fullKeepRanges };
}

export interface ActionReelDurationInput {
  part1Duration?: number | undefined;
  part2Duration?: number | undefined;
  fps?: number | undefined;
}

// Base duration for the "ActionReel" composition - two independent,
// already-baked-audio Seedance clips back to back. Raw (no cuts) - the
// cuts-aware wrapper is calcActionReelDurationInFrames in
// ActionReelComposition.tsx.
export function calcActionReelBaseDurationInFrames({
  part1Duration = 15,
  part2Duration = 15,
  fps = 30,
}: ActionReelDurationInput = {}): number {
  return Math.ceil((part1Duration + part2Duration) * fps);
}
