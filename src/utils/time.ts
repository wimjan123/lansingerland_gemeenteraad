/**
 * Convert time string to seconds (supports mm:ss and hh:mm:ss formats)
 */
export function timeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':').map(p => parseInt(p, 10));
  
  if (parts.length === 2) {
    // mm:ss format
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  } else if (parts.length === 3) {
    // hh:mm:ss format
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }
  
  throw new Error(`Invalid time format: ${timeStr}`);
}

/**
 * Convert seconds to HH:MM:SS format
 */
export function secondsToTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Convert WebVTT timestamp (e.g., "0:01:23.850") to seconds
 */
export function vttTimestampToSeconds(timestamp: string): number {
  // Handle both "0:01:23.850" and "01:23.850" formats
  const cleanTimestamp = timestamp.replace(/^(\d):(\d{2}):(\d{2})\.(\d{3})$/, '$1:$2:$3.$4');
  const parts = cleanTimestamp.split(':');
  
  if (parts.length === 3) {
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const [secondsPart, milliseconds] = parts[2].split('.');
    const seconds = parseInt(secondsPart, 10);
    const ms = milliseconds ? parseInt(milliseconds.padEnd(3, '0'), 10) : 0;
    
    return hours * 3600 + minutes * 60 + seconds + ms / 1000;
  }
  
  throw new Error(`Invalid VTT timestamp format: ${timestamp}`);
}

/**
 * Parse speaker line from Sprekers section
 * Format: "00:03:51 - 00:05:46 - Jules Bijl"
 */
export function parseSpeakerLine(line: string): { startSec: number; endSec: number; speakerName: string } | null {
  const regex = /^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(.+?)\s*$/;
  const match = line.match(regex);
  
  if (!match) {
    return null;
  }
  
  const [, startTime, endTime, speakerName] = match;
  
  return {
    startSec: timeToSeconds(startTime),
    endSec: timeToSeconds(endTime),
    speakerName: speakerName.trim()
  };
}

/**
 * Check if time is within a window with grace period
 */
export function isTimeInWindow(time: number, start: number, end: number, graceWindow: number = 0.35): boolean {
  return time >= (start - graceWindow) && time < (end + graceWindow);
}

/**
 * Find the best matching speaker window for a given time
 */
export function findBestSpeakerWindow(time: number, windows: Array<{ startSec: number; endSec: number; speakerName: string }>, graceWindow: number = 0.35): { startSec: number; endSec: number; speakerName: string } | null {
  // Find all matching windows
  const matching = windows.filter(w => isTimeInWindow(time, w.startSec, w.endSec, graceWindow));
  
  if (matching.length === 0) {
    return null;
  }
  
  if (matching.length === 1) {
    return matching[0];
  }
  
  // Multiple matches: choose the one with start time closest to (but before) the cue time
  return matching.reduce((best, current) => {
    const bestDistance = Math.abs(time - best.startSec);
    const currentDistance = Math.abs(time - current.startSec);
    return currentDistance < bestDistance ? current : best;
  });
}