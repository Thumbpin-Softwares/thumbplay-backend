// Trimmed port of thumbpinclient/src/lib/remotion/Root.jsx — only the
// "ActionReel" composition is registered here (the one shared by all three
// reel pipelines in this backend). The source also registers SeedanceReel/
// NewsAnchor/NewsAnchorBroll compositions, which belong to other pipelines
// (home-tour/news-anchor) not in this port's scope.
import { Composition } from 'remotion';
import { ActionReelComposition, calcActionReelDurationInFrames, ActionReelCompositionProps } from './ActionReelComposition';
import { calcActionReelBaseDurationInFrames } from './duration';

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="ActionReel"
        component={ActionReelComposition}
        fps={30}
        width={1080}
        height={1920}
        durationInFrames={calcActionReelBaseDurationInFrames()}
        defaultProps={{
          part1VideoUrl: '',
          part2VideoUrl: '',
          part1Duration: 15,
          part2Duration: 15,
          overlays: [],
          musicUrl: '',
          musicTrimStartSeconds: 0,
          musicVolume: 0.25,
          cutRanges: [],
        }}
        calculateMetadata={async ({ props }: { props: ActionReelCompositionProps }) => ({
          durationInFrames: calcActionReelDurationInFrames({
            part1Duration: props.part1Duration,
            part2Duration: props.part2Duration,
            cutRanges: props.cutRanges,
          }),
        })}
      />
    </>
  );
};
