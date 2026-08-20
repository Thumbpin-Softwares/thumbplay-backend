import { renderBrandBumper } from './render.service';
import { concatVideos } from '../reel/video-concat.service';
import { uploadToR2, buildUserKey } from '../reel/r2.service';

// Branding is per-generation, not per-account - the same account can
// generate videos for many different properties/developers, each needing
// its own logo/name/contact, so there's nothing sensible to cache or persist
// on the User doc. Callers collect these as optional fields on the
// generation's own request/inputs and pass them straight through here.
export interface BrandingFields {
  logoUrl?: string | undefined;
  agencyName?: string | undefined;
  contactInfo?: string | undefined;
  primaryColor?: string | undefined;
}

export function hasBranding(branding: BrandingFields | undefined | null): boolean {
  return Boolean(branding?.logoUrl?.trim() || branding?.agencyName?.trim() || branding?.contactInfo?.trim());
}

// Renders a fresh bumper for THIS generation's branding fields and wraps the
// given video with it as both intro and outro (see BrandBumper.tsx). Returns
// null (no-op) if no branding fields were provided, so callers can fall back
// to the unbranded video without any extra work on their end.
export async function applyBranding(
  userId: string,
  mainVideoUrl: string,
  branding: BrandingFields | undefined | null,
): Promise<Buffer | null> {
  if (!hasBranding(branding)) return null;

  const bumperBuffer = await renderBrandBumper(branding!);
  const bumperKey = buildUserKey(userId, 'branding', 'mp4', 'brand-bumper');
  const bumperUrl = await uploadToR2(bumperBuffer, bumperKey, 'video/mp4');

  return concatVideos([bumperUrl, mainVideoUrl, bumperUrl]);
}
