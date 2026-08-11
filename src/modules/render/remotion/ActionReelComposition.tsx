// Port of thumbpinclient/src/lib/remotion/ActionReelComposition.jsx - the
// shared "ActionReel" composition used by all three reel pipelines'
// render-remotion export (composition id "ActionReel" is literally shared
// across seedance-reel/action-reel/comedy-reel in the source).
//
// Background music uses the classic, stable `remotion` Audio (ffmpeg-based
// extraction) rather than @remotion/media's - that package is explicitly
// "Experimental WebCodecs-based media tags" and would silently drop the
// music track on codec/format edge cases some stock MP3s hit.
import { AbsoluteFill, Img, Sequence, OffthreadVideo, useVideoConfig, Audio } from 'remotion';
import { getOverlayFontCss, hexToRgba } from './overlay-fonts';
import { applyCutRanges, calcActionReelBaseDurationInFrames, CutRange } from './duration';

export interface ReelOverlay {
  id: string;
  type: 'text' | 'image';
  x: number;
  y: number;
  width: number;
  hidden?: boolean;
  // image
  url?: string;
  // text
  text?: string;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  bgColor?: string;
  bgOpacity?: number;
}

function Overlay({ overlay }: { overlay: ReelOverlay }) {
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${overlay.x}%`,
    top: `${overlay.y}%`,
    width: `${overlay.width}%`,
    transform: 'translate(-50%, -50%)',
  };

  if (overlay.type === 'image') {
    return (
      <div style={style}>
        <Img src={overlay.url ?? ''} style={{ width: '100%', display: 'block' }} />
      </div>
    );
  }

  return (
    <div
      style={{
        ...style,
        boxSizing: 'border-box',
        fontSize: overlay.fontSize || 48,
        color: overlay.color || '#ffffff',
        fontWeight: 700,
        textAlign: 'center',
        fontFamily: getOverlayFontCss(overlay.fontFamily),
        whiteSpace: 'pre-wrap',
        textShadow: '0 2px 10px rgba(0,0,0,0.55)',
        backgroundColor: hexToRgba(overlay.bgColor, overlay.bgOpacity),
        padding: overlay.bgOpacity ? '0.3em 0.5em' : 0,
        borderRadius: overlay.bgOpacity ? 12 : 0,
      }}
    >
      {overlay.text}
    </div>
  );
}

export interface ActionReelContentProps {
  part1VideoUrl?: string | undefined;
  part2VideoUrl?: string | undefined;
  part1Duration?: number | undefined;
  part2Duration?: number | undefined;
  overlays?: ReelOverlay[] | undefined;
  musicUrl?: string | undefined;
  musicTrimStartSeconds?: number | undefined;
  musicVolume?: number | undefined;
}

// part2VideoUrl is optional - a single flattened re-export only ever
// populates part1. Hard cut between the two - no crossfade - matches the
// fast-paced UGC aesthetic.
function ReelContent({
  part1VideoUrl = '',
  part2VideoUrl = '',
  part1Duration = 15,
  part2Duration = 15,
  overlays = [],
  musicUrl = '',
  musicTrimStartSeconds = 0,
  musicVolume = 0.25,
}: ActionReelContentProps) {
  const { fps } = useVideoConfig();
  const part1Frames = Math.round(part1Duration * fps);
  const part2Frames = Math.round(part2Duration * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000000' }}>
      <Sequence from={0} durationInFrames={part1Frames}>
        <AbsoluteFill>
          <OffthreadVideo src={part1VideoUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </AbsoluteFill>
      </Sequence>

      {part2VideoUrl && part2Frames > 0 && (
        <Sequence from={part1Frames} durationInFrames={part2Frames}>
          <AbsoluteFill>
            <OffthreadVideo src={part2VideoUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </AbsoluteFill>
        </Sequence>
      )}

      {/* User text/image overlays - on top of everything, full duration.
          Array order is the stacking order: later entries render on top. */}
      {overlays.length > 0 && (
        <AbsoluteFill>
          {overlays
            .filter((overlay) => !overlay.hidden)
            .map((overlay) => (
              <Overlay key={overlay.id} overlay={overlay} />
            ))}
        </AbsoluteFill>
      )}

      {/* Background music, trimmed to whichever section the user picked in
          the editor. Playback is naturally cut off at the composition's own
          duration, so no explicit trimAfter is needed. */}
      {musicUrl && <Audio src={musicUrl} trimBefore={Math.round(musicTrimStartSeconds * fps)} volume={musicVolume} />}
    </AbsoluteFill>
  );
}

function originalDurationFor(props: ActionReelContentProps): number {
  return calcActionReelBaseDurationInFrames({
    part1Duration: props.part1Duration,
    part2Duration: props.part2Duration,
  });
}

export interface ActionReelCompositionProps extends ActionReelContentProps {
  cutRanges?: CutRange[] | undefined;
}

// Wraps ReelContent with support for the editor's Cut tool: cutRanges
// (original-timeline frame ranges the user deleted) get rippled into a
// shorter virtual timeline via nested Sequences. This pass's own
// generate→render flow never populates cutRanges (always []), so this
// always renders the full, uncut ReelContent in practice - kept for prop
// shape compatibility with the composition the (out-of-scope) editor drives.
export function ActionReelComposition({ cutRanges = [], ...rest }: ActionReelCompositionProps) {
  const totalOriginalFrames = originalDurationFor(rest);
  const { keepRanges } = applyCutRanges(totalOriginalFrames, cutRanges);

  if (keepRanges.length === 0) {
    return <AbsoluteFill style={{ backgroundColor: '#000000' }} />;
  }

  return (
    <AbsoluteFill style={{ backgroundColor: '#000000' }}>
      {keepRanges.map((kr, i) => (
        <Sequence key={i} from={kr.virtualStart} durationInFrames={kr.virtualEnd - kr.virtualStart}>
          <Sequence from={-kr.originalStart} durationInFrames={totalOriginalFrames - kr.originalStart}>
            <ReelContent {...rest} />
          </Sequence>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

// Total composition length after cuts - use this (not the raw
// calcActionReelBaseDurationInFrames) anywhere the actual Player/export
// duration is needed.
export function calcActionReelDurationInFrames({ cutRanges = [], ...rest }: ActionReelCompositionProps): number {
  const total = originalDurationFor(rest);
  const { keptDurationInFrames } = applyCutRanges(total, cutRanges);
  return Math.max(1, keptDurationInFrames);
}
