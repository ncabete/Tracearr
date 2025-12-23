import { describe, it, expect } from 'vitest';
import {
  normalizeDecision,
  normalizeStreamDecisions,
  normalizePlayMethod,
  parseJellystatPlayMethod,
  isTranscodingFromInfo,
} from '../transcodeNormalizer.js';

describe('transcodeNormalizer', () => {
  describe('normalizeDecision', () => {
    it('should return null for null/undefined input', () => {
      expect(normalizeDecision(null)).toBeNull();
      expect(normalizeDecision(undefined)).toBeNull();
      expect(normalizeDecision('')).toBeNull();
    });

    it('should normalize DirectPlay variants', () => {
      expect(normalizeDecision('DirectPlay')).toBe('directplay');
      expect(normalizeDecision('directplay')).toBe('directplay');
      expect(normalizeDecision('direct play')).toBe('directplay'); // Tautulli format
      expect(normalizeDecision('direct')).toBe('directplay');
      expect(normalizeDecision('DIRECTPLAY')).toBe('directplay');
      expect(normalizeDecision('  DirectPlay  ')).toBe('directplay');
    });

    it('should normalize DirectStream/copy variants', () => {
      expect(normalizeDecision('DirectStream')).toBe('copy');
      expect(normalizeDecision('directstream')).toBe('copy');
      expect(normalizeDecision('copy')).toBe('copy');
      expect(normalizeDecision('Copy')).toBe('copy');
      expect(normalizeDecision('COPY')).toBe('copy');
    });

    it('should normalize Transcode variants', () => {
      expect(normalizeDecision('Transcode')).toBe('transcode');
      expect(normalizeDecision('transcode')).toBe('transcode');
      expect(normalizeDecision('TRANSCODE')).toBe('transcode');
    });

    it('should return null for unknown values', () => {
      expect(normalizeDecision('unknown')).toBeNull();
      expect(normalizeDecision('streaming')).toBeNull();
      expect(normalizeDecision('playing')).toBeNull();
    });
  });

  describe('normalizeStreamDecisions', () => {
    it('should handle Plex format (already lowercase)', () => {
      expect(normalizeStreamDecisions('directplay', 'directplay')).toEqual({
        videoDecision: 'directplay',
        audioDecision: 'directplay',
        isTranscode: false,
      });

      expect(normalizeStreamDecisions('copy', 'copy')).toEqual({
        videoDecision: 'copy',
        audioDecision: 'copy',
        isTranscode: false,
      });

      expect(normalizeStreamDecisions('transcode', 'transcode')).toEqual({
        videoDecision: 'transcode',
        audioDecision: 'transcode',
        isTranscode: true,
      });
    });

    it('should handle mixed decisions', () => {
      expect(normalizeStreamDecisions('copy', 'transcode')).toEqual({
        videoDecision: 'copy',
        audioDecision: 'transcode',
        isTranscode: true,
      });

      expect(normalizeStreamDecisions('transcode', 'copy')).toEqual({
        videoDecision: 'transcode',
        audioDecision: 'copy',
        isTranscode: true,
      });

      expect(normalizeStreamDecisions('directplay', 'transcode')).toEqual({
        videoDecision: 'directplay',
        audioDecision: 'transcode',
        isTranscode: true,
      });
    });

    it('should default null/undefined to directplay', () => {
      expect(normalizeStreamDecisions(null, null)).toEqual({
        videoDecision: 'directplay',
        audioDecision: 'directplay',
        isTranscode: false,
      });

      expect(normalizeStreamDecisions(undefined, 'transcode')).toEqual({
        videoDecision: 'directplay',
        audioDecision: 'transcode',
        isTranscode: true,
      });
    });

    it('should handle Tautulli format (space in "direct play")', () => {
      expect(normalizeStreamDecisions('direct play', 'direct play')).toEqual({
        videoDecision: 'directplay',
        audioDecision: 'directplay',
        isTranscode: false,
      });
    });
  });

  describe('normalizePlayMethod', () => {
    describe('Jellyfin/Emby PlayMethod enum', () => {
      it('should handle DirectPlay', () => {
        expect(normalizePlayMethod('DirectPlay')).toEqual({
          videoDecision: 'directplay',
          audioDecision: 'directplay',
          isTranscode: false,
        });
      });

      it('should handle DirectStream', () => {
        expect(normalizePlayMethod('DirectStream')).toEqual({
          videoDecision: 'copy',
          audioDecision: 'copy',
          isTranscode: false,
        });
      });

      it('should handle Transcode without flags (both transcode)', () => {
        expect(normalizePlayMethod('Transcode')).toEqual({
          videoDecision: 'transcode',
          audioDecision: 'transcode',
          isTranscode: true,
        });
      });

      it('should handle Transcode with IsVideoDirect/IsAudioDirect flags', () => {
        // Video transcoded, audio direct
        expect(normalizePlayMethod('Transcode', false, true)).toEqual({
          videoDecision: 'transcode',
          audioDecision: 'copy',
          isTranscode: true,
        });

        // Video direct, audio transcoded
        expect(normalizePlayMethod('Transcode', true, false)).toEqual({
          videoDecision: 'copy',
          audioDecision: 'transcode',
          isTranscode: true,
        });

        // Both direct (audio-only remux scenario)
        expect(normalizePlayMethod('Transcode', true, true)).toEqual({
          videoDecision: 'copy',
          audioDecision: 'copy',
          isTranscode: false,
        });

        // Both transcoded
        expect(normalizePlayMethod('Transcode', false, false)).toEqual({
          videoDecision: 'transcode',
          audioDecision: 'transcode',
          isTranscode: true,
        });
      });

      it('should default to directplay for null/unknown', () => {
        expect(normalizePlayMethod(null)).toEqual({
          videoDecision: 'directplay',
          audioDecision: 'directplay',
          isTranscode: false,
        });

        expect(normalizePlayMethod(undefined)).toEqual({
          videoDecision: 'directplay',
          audioDecision: 'directplay',
          isTranscode: false,
        });

        expect(normalizePlayMethod('Unknown')).toEqual({
          videoDecision: 'directplay',
          audioDecision: 'directplay',
          isTranscode: false,
        });
      });
    });

    describe('case insensitivity', () => {
      it('should handle lowercase input', () => {
        expect(normalizePlayMethod('directplay')).toEqual({
          videoDecision: 'directplay',
          audioDecision: 'directplay',
          isTranscode: false,
        });

        expect(normalizePlayMethod('transcode', false, true)).toEqual({
          videoDecision: 'transcode',
          audioDecision: 'copy',
          isTranscode: true,
        });
      });
    });
  });

  describe('parseJellystatPlayMethod', () => {
    it('should handle DirectPlay', () => {
      expect(parseJellystatPlayMethod('DirectPlay')).toEqual({
        videoDecision: 'directplay',
        audioDecision: 'directplay',
        isTranscode: false,
      });
    });

    it('should handle DirectStream', () => {
      expect(parseJellystatPlayMethod('DirectStream')).toEqual({
        videoDecision: 'copy',
        audioDecision: 'copy',
        isTranscode: false,
      });
    });

    it('should handle plain Transcode', () => {
      expect(parseJellystatPlayMethod('Transcode')).toEqual({
        videoDecision: 'transcode',
        audioDecision: 'transcode',
        isTranscode: true,
      });
    });

    it('should parse Transcode with codec info', () => {
      // Video direct, audio transcode to AAC
      expect(parseJellystatPlayMethod('Transcode (v:direct a:aac)')).toEqual({
        videoDecision: 'copy',
        audioDecision: 'transcode',
        isTranscode: true,
      });

      // Video transcode to H.264, audio direct
      expect(parseJellystatPlayMethod('Transcode (v:h264 a:direct)')).toEqual({
        videoDecision: 'transcode',
        audioDecision: 'copy',
        isTranscode: true,
      });

      // Both transcoded
      expect(parseJellystatPlayMethod('Transcode (v:h264 a:aac)')).toEqual({
        videoDecision: 'transcode',
        audioDecision: 'transcode',
        isTranscode: true,
      });

      // Both direct (edge case)
      expect(parseJellystatPlayMethod('Transcode (v:direct a:direct)')).toEqual({
        videoDecision: 'copy',
        audioDecision: 'copy',
        isTranscode: true, // Still true because PlayMethod says Transcode
      });
    });

    it('should handle null/undefined', () => {
      expect(parseJellystatPlayMethod(null)).toEqual({
        videoDecision: 'directplay',
        audioDecision: 'directplay',
        isTranscode: false,
      });

      expect(parseJellystatPlayMethod(undefined)).toEqual({
        videoDecision: 'directplay',
        audioDecision: 'directplay',
        isTranscode: false,
      });
    });

    it('should handle unknown formats gracefully', () => {
      expect(parseJellystatPlayMethod('Unknown')).toEqual({
        videoDecision: 'directplay',
        audioDecision: 'directplay',
        isTranscode: false,
      });
    });
  });

  describe('isTranscodingFromInfo', () => {
    it('should return false when no TranscodingInfo', () => {
      expect(isTranscodingFromInfo(false)).toBe(false);
      expect(isTranscodingFromInfo(false, true)).toBe(false);
      expect(isTranscodingFromInfo(false, false)).toBe(false);
    });

    it('should check IsVideoDirect when TranscodingInfo exists', () => {
      // TranscodingInfo exists but video is direct (remux/DirectStream)
      expect(isTranscodingFromInfo(true, true)).toBe(false);

      // TranscodingInfo exists and video is being transcoded
      expect(isTranscodingFromInfo(true, false)).toBe(true);

      // TranscodingInfo exists but IsVideoDirect not specified (ambiguous)
      expect(isTranscodingFromInfo(true, undefined)).toBe(false);
    });
  });
});
