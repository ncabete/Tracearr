/**
 * Transcode Decision Normalizer
 *
 * Normalizes transcode/playback decisions from various sources (Plex, Jellyfin, Emby,
 * Tautulli, Jellystat) into consistent, lowercase values for Tracearr.
 *
 * Input formats by source:
 * - Jellyfin/Emby API: PlayMethod as "DirectPlay", "DirectStream", "Transcode"
 *   with IsVideoDirect/IsAudioDirect boolean flags
 * - Plex API: videoDecision/audioDecision as "directplay", "copy", "transcode"
 * - Tautulli: transcode_decision as "direct play" (with space), "copy", "transcode"
 * - Jellystat: PlayMethod as "DirectPlay", "DirectStream", "Transcode (v:xxx a:yyy)"
 *
 * Output format: lowercase 'directplay' | 'copy' | 'transcode'
 */

/** Normalized transcode decision values */
export type TranscodeDecision = 'directplay' | 'copy' | 'transcode';

/** Result of transcode normalization */
export interface StreamDecisions {
  videoDecision: TranscodeDecision;
  audioDecision: TranscodeDecision;
  isTranscode: boolean;
}

/**
 * Normalize a single decision string to lowercase standard format
 */
export function normalizeDecision(decision: string | null | undefined): TranscodeDecision | null {
  if (!decision) return null;

  const lower = decision.toLowerCase().trim();

  // Direct play variants (Tautulli uses space)
  if (lower === 'directplay' || lower === 'direct play' || lower === 'direct') {
    return 'directplay';
  }

  // Copy/DirectStream (container change, streams untouched)
  if (lower === 'copy' || lower === 'directstream') {
    return 'copy';
  }

  // Transcode
  if (lower === 'transcode') {
    return 'transcode';
  }

  return null;
}

/**
 * Normalize separate video and audio decisions (Plex/Tautulli format)
 */
export function normalizeStreamDecisions(
  videoDecision: string | null | undefined,
  audioDecision: string | null | undefined
): StreamDecisions {
  const video = normalizeDecision(videoDecision) ?? 'directplay';
  const audio = normalizeDecision(audioDecision) ?? 'directplay';

  return {
    videoDecision: video,
    audioDecision: audio,
    isTranscode: video === 'transcode' || audio === 'transcode',
  };
}

/**
 * Normalize PlayMethod with optional granular flags (Jellyfin/Emby format)
 */
export function normalizePlayMethod(
  playMethod: string | null | undefined,
  isVideoDirect?: boolean,
  isAudioDirect?: boolean
): StreamDecisions {
  const method = normalizeDecision(playMethod);

  // DirectPlay: both streams direct
  if (method === 'directplay') {
    return {
      videoDecision: 'directplay',
      audioDecision: 'directplay',
      isTranscode: false,
    };
  }

  // DirectStream (copy): container remuxed, streams copied
  if (method === 'copy') {
    return {
      videoDecision: 'copy',
      audioDecision: 'copy',
      isTranscode: false,
    };
  }

  // Transcode: check individual stream flags
  if (method === 'transcode') {
    const videoDecision: TranscodeDecision = isVideoDirect === true ? 'copy' : 'transcode';
    const audioDecision: TranscodeDecision = isAudioDirect === true ? 'copy' : 'transcode';

    return {
      videoDecision,
      audioDecision,
      isTranscode: videoDecision === 'transcode' || audioDecision === 'transcode',
    };
  }

  // Unknown or null: default to directplay
  return {
    videoDecision: 'directplay',
    audioDecision: 'directplay',
    isTranscode: false,
  };
}

/**
 * Parse Jellystat PlayMethod format with embedded codec info
 * e.g., "Transcode (v:direct a:aac)"
 */
export function parseJellystatPlayMethod(playMethod: string | null | undefined): StreamDecisions {
  if (!playMethod) {
    return {
      videoDecision: 'directplay',
      audioDecision: 'directplay',
      isTranscode: false,
    };
  }

  if (playMethod === 'DirectPlay') {
    return {
      videoDecision: 'directplay',
      audioDecision: 'directplay',
      isTranscode: false,
    };
  }

  if (playMethod === 'DirectStream') {
    return {
      videoDecision: 'copy',
      audioDecision: 'copy',
      isTranscode: false,
    };
  }

  if (playMethod.startsWith('Transcode')) {
    const match = playMethod.match(/\(v:(\w+)\s+a:(\w+)\)/);
    if (match) {
      const [, video, audio] = match;
      const videoDecision: TranscodeDecision = video === 'direct' ? 'copy' : 'transcode';
      const audioDecision: TranscodeDecision = audio === 'direct' ? 'copy' : 'transcode';

      return {
        videoDecision,
        audioDecision,
        isTranscode: true,
      };
    }

    return {
      videoDecision: 'transcode',
      audioDecision: 'transcode',
      isTranscode: true,
    };
  }

  return {
    videoDecision: 'directplay',
    audioDecision: 'directplay',
    isTranscode: false,
  };
}

/**
 * Determine if TranscodingInfo presence indicates transcoding
 * Used as fallback when PlayMethod is not available
 */
export function isTranscodingFromInfo(
  hasTranscodingInfo: boolean,
  isVideoDirect?: boolean
): boolean {
  if (!hasTranscodingInfo) return false;
  return isVideoDirect === false;
}
