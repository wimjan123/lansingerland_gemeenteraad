import { vttTimestampToSeconds } from '../utils/time';
import { logger } from '../utils/logger';
import { VTTCue } from '../types/transcript';

export class VTTProcessor {
  
  /**
   * Parse WebVTT content and extract cues
   */
  parseVTT(vttContent: string): VTTCue[] {
    logger.info('Parsing VTT content', { contentLength: vttContent.length });
    
    const cues: VTTCue[] = [];
    const lines = vttContent.split('\n').map(line => line.trim());
    
    let i = 0;
    
    // Skip header
    while (i < lines.length && !lines[i].startsWith('WEBVTT')) {
      i++;
    }
    i++; // Skip WEBVTT line
    
    while (i < lines.length) {
      // Skip empty lines and comments
      while (i < lines.length && (lines[i] === '' || lines[i].startsWith('NOTE'))) {
        i++;
      }
      
      if (i >= lines.length) break;
      
      // Check if this is a cue identifier (optional)
      let cueId: string | undefined;
      if (!lines[i].includes('-->')) {
        cueId = lines[i];
        i++;
      }
      
      if (i >= lines.length) break;
      
      // Parse timing line
      const timingLine = lines[i];
      const timingMatch = timingLine.match(/^([\d:.,]+)\s*-->\s*([\d:.,]+)(?:\s+(.*))?$/);
      
      if (!timingMatch) {
        logger.warn(`Invalid timing line: ${timingLine}`);
        i++;
        continue;
      }
      
      const [, startTime, endTime] = timingMatch;
      i++;
      
      // Parse cue text (may span multiple lines)
      const textLines: string[] = [];
      while (i < lines.length && lines[i] !== '' && !lines[i].includes('-->')) {
        textLines.push(lines[i]);
        i++;
      }
      
      if (textLines.length === 0) {
        continue;
      }
      
      try {
        const start = this.parseVTTTimestamp(startTime);
        const end = this.parseVTTTimestamp(endTime);
        const text = this.cleanCueText(textLines.join(' '));
        
        if (text.trim().length > 0) {
          cues.push({
            start,
            end,
            text
          });
        }
        
      } catch (error) {
        logger.warn(`Failed to parse cue timing: ${startTime} --> ${endTime}`, error);
      }
    }
    
    logger.info(`Successfully parsed ${cues.length} VTT cues`);
    return cues;
  }

  /**
   * Parse VTT timestamp to seconds
   */
  private parseVTTTimestamp(timestamp: string): number {
    // Handle various VTT timestamp formats
    // Examples: "0:01:23.850", "01:23.850", "1:23:45.678"
    
    // Normalize timestamp format
    let normalized = timestamp.replace(',', '.'); // Handle comma decimal separator
    
    // Handle format like "0:01:23.850"
    if (normalized.match(/^\d:\d{2}:\d{2}\.\d+$/)) {
      return vttTimestampToSeconds(normalized);
    }
    
    // Handle format like "01:23.850" (minutes:seconds.milliseconds)
    const shortMatch = normalized.match(/^(\d{1,2}):(\d{2})\.(\d{1,3})$/);
    if (shortMatch) {
      const [, minutes, seconds, milliseconds] = shortMatch;
      return parseInt(minutes, 10) * 60 + parseInt(seconds, 10) + parseInt(milliseconds.padEnd(3, '0'), 10) / 1000;
    }
    
    // Handle format like "1:23:45.678"
    const longMatch = normalized.match(/^(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})$/);
    if (longMatch) {
      const [, hours, minutes, seconds, milliseconds] = longMatch;
      return parseInt(hours, 10) * 3600 + parseInt(minutes, 10) * 60 + parseInt(seconds, 10) + parseInt(milliseconds.padEnd(3, '0'), 10) / 1000;
    }
    
    // Fallback: try the utility function
    return vttTimestampToSeconds(normalized);
  }

  /**
   * Clean and normalize cue text
   */
  private cleanCueText(text: string): string {
    return text
      // Remove VTT styling tags
      .replace(/<\/?[^>]+>/g, '')
      .replace(/<\/?c[^>]*>/g, '')
      .replace(/<\/?v[^>]*>/g, '')
      // Remove other common tags
      .replace(/<\/?b>/g, '')
      .replace(/<\/?i>/g, '')
      .replace(/<\/?u>/g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Validate VTT content format
   */
  validateVTT(vttContent: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!vttContent.startsWith('WEBVTT')) {
      errors.push('Missing WEBVTT header');
    }
    
    const lines = vttContent.split('\\n');
    let cueCount = 0;
    let hasValidCues = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check for timing lines
      if (line.includes('-->')) {
        cueCount++;
        const timingMatch = line.match(/^([\d:.,]+)\s*-->\s*([\d:.,]+)/);
        if (!timingMatch) {
          errors.push(`Invalid timing format at line ${i + 1}: ${line}`);
        } else {
          hasValidCues = true;
        }
      }
    }
    
    if (cueCount === 0) {
      errors.push('No cues found in VTT content');
    }
    
    if (!hasValidCues) {
      errors.push('No valid cues found in VTT content');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get VTT statistics
   */
  getVTTStats(cues: VTTCue[]): {
    totalCues: number;
    totalDuration: number;
    averageCueDuration: number;
    totalWords: number;
    averageWordsPerCue: number;
    firstCueStart: number;
    lastCueEnd: number;
  } {
    if (cues.length === 0) {
      return {
        totalCues: 0,
        totalDuration: 0,
        averageCueDuration: 0,
        totalWords: 0,
        averageWordsPerCue: 0,
        firstCueStart: 0,
        lastCueEnd: 0
      };
    }
    
    const totalWords = cues.reduce((sum, cue) => sum + cue.text.split(/\s+/).length, 0);
    const totalCueDuration = cues.reduce((sum, cue) => sum + (cue.end - cue.start), 0);
    const firstCueStart = Math.min(...cues.map(c => c.start));
    const lastCueEnd = Math.max(...cues.map(c => c.end));
    
    return {
      totalCues: cues.length,
      totalDuration: lastCueEnd - firstCueStart,
      averageCueDuration: totalCueDuration / cues.length,
      totalWords,
      averageWordsPerCue: totalWords / cues.length,
      firstCueStart,
      lastCueEnd
    };
  }

  /**
   * Filter cues by time range
   */
  filterCuesByTimeRange(cues: VTTCue[], startTime: number, endTime: number): VTTCue[] {
    return cues.filter(cue => 
      (cue.start >= startTime && cue.start < endTime) ||
      (cue.end > startTime && cue.end <= endTime) ||
      (cue.start < startTime && cue.end > endTime)
    );
  }

  /**
   * Merge overlapping or adjacent cues
   */
  mergeCues(cues: VTTCue[], maxGapSeconds: number = 0.5): VTTCue[] {
    if (cues.length === 0) return [];
    
    const sorted = [...cues].sort((a, b) => a.start - b.start);
    const merged: VTTCue[] = [];
    let current = { ...sorted[0] };
    
    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];
      
      // Check if cues should be merged (overlapping or small gap)
      if (next.start <= current.end + maxGapSeconds) {
        // Merge cues
        current.end = Math.max(current.end, next.end);
        current.text = current.text + ' ' + next.text;
      } else {
        // Add current and start new
        merged.push(current);
        current = { ...next };
      }
    }
    
    merged.push(current);
    
    logger.debug(`Merged ${cues.length} cues into ${merged.length} cues`);
    return merged;
  }
}