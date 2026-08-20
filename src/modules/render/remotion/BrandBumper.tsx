// Short animated title card rendered once per branding save (not once per
// video) and cached as User.branding.introVideoUrl/outroVideoUrl - every
// subsequent video generation just concatenates the cached clip via
// video-concat.service.ts's concatVideos, rather than re-rendering this
// composition on every export.
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export interface BrandBumperProps {
  logoUrl?: string | undefined;
  agencyName?: string | undefined;
  contactInfo?: string | undefined;
  primaryColor?: string | undefined;
}

export function BrandBumper({
  logoUrl = '',
  agencyName = '',
  contactInfo = '',
  primaryColor = '#0a0a0a',
}: BrandBumperProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, fps * 0.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const scale = interpolate(frame, [0, fps * 0.5], [0.92, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          opacity: fadeIn,
          transform: `scale(${scale})`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 28,
          padding: '0 80px',
          textAlign: 'center',
        }}
      >
        {logoUrl && <Img src={logoUrl} style={{ width: 220, height: 220, objectFit: 'contain' }} />}
        {agencyName && (
          <div style={{ fontSize: 56, fontWeight: 700, color: '#ffffff', lineHeight: 1.2 }}>{agencyName}</div>
        )}
        {contactInfo && <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.8)' }}>{contactInfo}</div>}
      </div>
    </AbsoluteFill>
  );
}

const BUMPER_SECONDS = 2.5;

export function calcBrandBumperDurationInFrames(fps = 30): number {
  return Math.ceil(BUMPER_SECONDS * fps);
}
