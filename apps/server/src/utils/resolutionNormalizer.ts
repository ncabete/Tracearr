/**
 * Resolution Normalizer
 *
 * Normalizes video resolution from various sources (Plex, Jellyfin, Emby)
 * into consistent, display-friendly labels for Tracearr.
 *
 * Uses width-first logic to correctly classify widescreen/anamorphic content
 * (e.g., 1920x804 should be "1080p", not "720p").
 *
 * This utility is used by:
 * - Session mapper (for live sessions)
 * - History imports (Tautulli, Jellystat)
 */

export interface ResolutionInput {
  /** Resolution string from API (e.g., "1080", "1080p", "4k", "sd") */
  resolution?: string;
  /** Video width in pixels (preferred - handles widescreen correctly) */
  width?: number;
  /** Video height in pixels (fallback) */
  height?: number;
}

/**
 * Normalize video resolution to a display-friendly label
 *
 * Priority:
 * 1. Explicit resolution string from API (most reliable when available)
 * 2. Width-based detection (handles widescreen/anamorphic content correctly)
 * 3. Height-based fallback (when only height is available)
 *
 * @param input - Resolution data from media server
 * @returns Normalized resolution string (e.g., "4K", "1080p", "720p", "SD") or null
 *
 * @example
 * normalizeResolution({ resolution: '1080p' })           // "1080p"
 * normalizeResolution({ width: 1920, height: 804 })      // "1080p" (widescreen)
 * normalizeResolution({ width: 1920, height: 1080 })     // "1080p"
 * normalizeResolution({ width: 3840, height: 1600 })     // "4K" (ultrawide)
 * normalizeResolution({ height: 804 })                   // "720p" (height-only fallback)
 */
export function normalizeResolution(input: ResolutionInput): string | null {
  const { resolution, width, height } = input;

  // 1. Prefer explicit resolution string from API (most reliable)
  if (resolution) {
    const lower = resolution.toLowerCase();

    // Handle 4K/UHD variants
    if (lower === '4k' || lower === '2160' || lower === '2160p' || lower === 'uhd') {
      return '4K';
    }

    // Handle standard resolutions
    if (lower === '1080' || lower === '1080p' || lower === 'fhd') {
      return '1080p';
    }
    if (lower === '720' || lower === '720p' || lower === 'hd') {
      return '720p';
    }
    if (lower === '480' || lower === '480p') {
      return '480p';
    }
    if (lower === 'sd') {
      return 'SD';
    }

    // Handle numeric-only values (e.g., "576" -> "576p")
    if (/^\d+$/.test(lower)) {
      return `${lower}p`;
    }

    // Return as-is if already formatted
    return resolution;
  }

  // 2. Width-based detection (handles widescreen correctly)
  // Width is more reliable than height for widescreen content:
  // - 1920x804 (2.39:1 scope) -> 1080p based on width
  // - 1920x800 (2.40:1) -> 1080p based on width
  // - 3840x1600 (2.40:1 ultrawide) -> 4K based on width
  if (width) {
    if (width >= 3840) return '4K';
    if (width >= 1920) return '1080p';
    if (width >= 1280) return '720p';
    if (width >= 854) return '480p';
    return 'SD';
  }

  // 3. Height-based fallback (when only height is available)
  // Less accurate for widescreen but better than nothing
  if (height) {
    if (height >= 2160) return '4K';
    if (height >= 1080) return '1080p';
    if (height >= 720) return '720p';
    if (height >= 480) return '480p';
    return 'SD';
  }

  return null;
}

/**
 * Build quality display string from session quality data
 * Prefers resolution over bitrate for clarity
 *
 * @param quality - Session quality object
 * @returns Quality string for display (e.g., "4K", "1080p", "54Mbps", "Direct")
 */
export function formatQualityString(quality: {
  videoResolution?: string;
  videoWidth?: number;
  videoHeight?: number;
  bitrate?: number;
  isTranscode?: boolean;
}): string {
  // Prefer resolution-based display
  const resolution = normalizeResolution({
    resolution: quality.videoResolution,
    width: quality.videoWidth,
    height: quality.videoHeight,
  });

  if (resolution) {
    return resolution;
  }

  // Fall back to bitrate if available
  if (quality.bitrate && quality.bitrate > 0) {
    return `${Math.round(quality.bitrate / 1000)}Mbps`;
  }

  // Last resort: transcode status
  return quality.isTranscode ? 'Transcoding' : 'Direct';
}
