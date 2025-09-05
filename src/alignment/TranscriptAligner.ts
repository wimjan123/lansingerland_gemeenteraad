import { findBestSpeakerWindow } from '../utils/time';
import { logger } from '../utils/logger';
import { VTTCue, AgendaItem, SpeakerWindow, TranscriptSegment } from '../types/transcript';

export class TranscriptAligner {
  private graceWindow: number;
  
  constructor(graceWindowSeconds: number = 0.35) {
    this.graceWindow = graceWindowSeconds;
  }

  /**
   * Align VTT cues with speakers and agenda items
   */
  alignTranscript(
    cues: VTTCue[], 
    agendaItems: AgendaItem[]
  ): TranscriptSegment[] {
    logger.info(`Aligning ${cues.length} cues with ${agendaItems.length} agenda items`);
    
    const segments: TranscriptSegment[] = [];
    let segmentId = 1;
    
    // Collect all speakers from all agenda items for global matching
    const allSpeakers = this.collectAllSpeakers(agendaItems);
    
    for (const cue of cues) {
      // Find the best matching speaker
      const matchedSpeaker = findBestSpeakerWindow(
        cue.start, 
        allSpeakers, 
        this.graceWindow
      );
      
      // Find the agenda item for this cue
      const agendaItem = this.findAgendaItemForCue(cue, agendaItems, matchedSpeaker || undefined);
      
      // Create transcript segment
      const segment: TranscriptSegment = {
        segment_id: segmentId.toString().padStart(3, '0'),
        speaker_name: matchedSpeaker?.speakerName || null,
        transcript_text: cue.text,
        video_seconds: Math.floor(cue.start),
        timestamp_start: this.secondsToHHMMSS(cue.start),
        timestamp_end: this.secondsToHHMMSS(cue.end),
        duration_seconds: Math.round(cue.end - cue.start),
        word_count: this.countWords(cue.text),
        char_count: cue.text.length,
        segment_type: 'spoken',
        agenda_item: agendaItem?.title || null
      };
      
      segments.push(segment);
      segmentId++;
    }
    
    // Log alignment statistics
    this.logAlignmentStats(segments, agendaItems);
    
    return segments;
  }

  /**
   * Collect all speaker windows from all agenda items
   */
  private collectAllSpeakers(agendaItems: AgendaItem[]): Array<SpeakerWindow & { agendaItemId: string }> {
    const speakers: Array<SpeakerWindow & { agendaItemId: string }> = [];
    
    for (const item of agendaItems) {
      for (const speaker of item.speakers) {
        speakers.push({
          ...speaker,
          agendaItemId: item.id
        });
      }
    }
    
    // Sort by start time for efficient lookup
    return speakers.sort((a, b) => a.startSec - b.startSec);
  }

  /**
   * Find the most appropriate agenda item for a cue
   */
  private findAgendaItemForCue(
    cue: VTTCue, 
    agendaItems: AgendaItem[], 
    matchedSpeaker?: SpeakerWindow & { agendaItemId?: string }
  ): AgendaItem | null {
    // If we have a matched speaker with agenda item info, use that
    if (matchedSpeaker && 'agendaItemId' in matchedSpeaker && matchedSpeaker.agendaItemId) {
      const item = agendaItems.find(item => item.id === matchedSpeaker.agendaItemId);
      if (item) {
        return item;
      }
    }
    
    // Otherwise, try to find agenda item by time range
    for (const item of agendaItems) {
      if (this.isCueInAgendaItemTimeRange(cue, item)) {
        return item;
      }
    }
    
    // Fallback: return the first agenda item or null
    return agendaItems.length > 0 ? agendaItems[0] : null;
  }

  /**
   * Check if a cue falls within the time range of an agenda item
   */
  private isCueInAgendaItemTimeRange(cue: VTTCue, agendaItem: AgendaItem): boolean {
    if (agendaItem.speakers.length === 0) {
      return false;
    }
    
    // Check if cue time overlaps with any speaker in this agenda item
    for (const speaker of agendaItem.speakers) {
      if (cue.start >= speaker.startSec - this.graceWindow && 
          cue.start < speaker.endSec + this.graceWindow) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Convert seconds to HH:MM:SS format
   */
  private secondsToHHMMSS(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Log alignment statistics
   */
  private logAlignmentStats(segments: TranscriptSegment[], agendaItems: AgendaItem[]): void {
    const totalSegments = segments.length;
    const alignedSpeakers = segments.filter(s => s.speaker_name !== null).length;
    const alignedAgendaItems = segments.filter(s => s.agenda_item !== null).length;
    
    const speakerStats = this.getSpeakerStats(segments);
    const agendaStats = this.getAgendaItemStats(segments, agendaItems);
    
    logger.info('Transcript alignment completed', {
      totalSegments,
      alignedSpeakers,
      alignedAgendaItems,
      speakerAlignment: `${Math.round((alignedSpeakers / totalSegments) * 100)}%`,
      agendaAlignment: `${Math.round((alignedAgendaItems / totalSegments) * 100)}%`,
      uniqueSpeakers: speakerStats.uniqueSpeakers,
      topSpeakers: speakerStats.topSpeakers.slice(0, 5),
      agendaItemCoverage: agendaStats
    });
  }

  /**
   * Get speaker statistics
   */
  private getSpeakerStats(segments: TranscriptSegment[]): {
    uniqueSpeakers: number;
    topSpeakers: Array<{ name: string; segments: number; duration: number }>;
  } {
    const speakerMap = new Map<string, { segments: number; duration: number }>();
    
    for (const segment of segments) {
      if (segment.speaker_name) {
        const current = speakerMap.get(segment.speaker_name) || { segments: 0, duration: 0 };
        current.segments++;
        current.duration += segment.duration_seconds;
        speakerMap.set(segment.speaker_name, current);
      }
    }
    
    const topSpeakers = Array.from(speakerMap.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.segments - a.segments);
    
    return {
      uniqueSpeakers: speakerMap.size,
      topSpeakers
    };
  }

  /**
   * Get agenda item coverage statistics
   */
  private getAgendaItemStats(segments: TranscriptSegment[], agendaItems: AgendaItem[]): Array<{
    agendaItem: string;
    segments: number;
    coverage: string;
  }> {
    const agendaMap = new Map<string, number>();
    
    for (const segment of segments) {
      if (segment.agenda_item) {
        agendaMap.set(segment.agenda_item, (agendaMap.get(segment.agenda_item) || 0) + 1);
      }
    }
    
    return agendaItems.map(item => ({
      agendaItem: item.title,
      segments: agendaMap.get(item.title) || 0,
      coverage: agendaMap.has(item.title) ? '✓' : '✗'
    }));
  }

  /**
   * Validate alignment results
   */
  validateAlignment(segments: TranscriptSegment[]): {
    valid: boolean;
    warnings: string[];
    errors: string[];
  } {
    const warnings: string[] = [];
    const errors: string[] = [];
    
    if (segments.length === 0) {
      errors.push('No segments generated');
      return { valid: false, warnings, errors };
    }
    
    // Check for missing speakers
    const unalignedSpeakers = segments.filter(s => s.speaker_name === null).length;
    const speakerAlignmentRate = (segments.length - unalignedSpeakers) / segments.length;
    
    if (speakerAlignmentRate < 0.5) {
      warnings.push(`Low speaker alignment rate: ${Math.round(speakerAlignmentRate * 100)}%`);
    }
    
    // Check for missing agenda items
    const unalignedAgenda = segments.filter(s => s.agenda_item === null).length;
    const agendaAlignmentRate = (segments.length - unalignedAgenda) / segments.length;
    
    if (agendaAlignmentRate < 0.3) {
      warnings.push(`Low agenda item alignment rate: ${Math.round(agendaAlignmentRate * 100)}%`);
    }
    
    // Check for timing consistency
    for (let i = 0; i < segments.length - 1; i++) {
      const current = segments[i];
      const next = segments[i + 1];
      
      if (current.video_seconds > next.video_seconds) {
        errors.push(`Timing inconsistency at segment ${current.segment_id}: ${current.video_seconds} > ${next.video_seconds}`);
      }
    }
    
    return {
      valid: errors.length === 0,
      warnings,
      errors
    };
  }

  /**
   * Post-process segments to improve alignment
   */
  postProcessSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
    logger.info('Post-processing transcript segments');
    
    // Fill gaps in speaker assignment using context
    const processed = this.fillSpeakerGaps(segments);
    
    // Merge very short segments from the same speaker
    const merged = this.mergeShortSegments(processed);
    
    logger.info(`Post-processing complete: ${segments.length} → ${merged.length} segments`);
    
    return merged;
  }

  /**
   * Fill gaps in speaker assignment using adjacent context
   */
  private fillSpeakerGaps(segments: TranscriptSegment[]): TranscriptSegment[] {
    const result = [...segments];
    
    for (let i = 0; i < result.length; i++) {
      const segment = result[i];
      
      if (!segment.speaker_name) {
        // Look at adjacent segments for context
        const prevSpeaker = i > 0 ? result[i - 1].speaker_name : null;
        const nextSpeaker = i < result.length - 1 ? result[i + 1].speaker_name : null;
        
        // If both adjacent segments have the same speaker, assign it
        if (prevSpeaker && prevSpeaker === nextSpeaker) {
          segment.speaker_name = prevSpeaker;
          logger.debug(`Filled speaker gap for segment ${segment.segment_id}: ${prevSpeaker}`);
        }
      }
    }
    
    return result;
  }

  /**
   * Merge very short segments from the same speaker
   */
  private mergeShortSegments(segments: TranscriptSegment[], minDurationSeconds: number = 2): TranscriptSegment[] {
    if (segments.length === 0) return segments;
    
    const result: TranscriptSegment[] = [];
    let current = { ...segments[0] };
    
    for (let i = 1; i < segments.length; i++) {
      const next = segments[i];
      
      // Check if we should merge with current
      const shouldMerge = 
        current.speaker_name === next.speaker_name &&
        current.agenda_item === next.agenda_item &&
        current.duration_seconds < minDurationSeconds &&
        (next.video_seconds - (current.video_seconds + current.duration_seconds)) < 5; // Small gap
      
      if (shouldMerge) {
        // Merge into current
        current.transcript_text += ' ' + next.transcript_text;
        current.timestamp_end = next.timestamp_end;
        current.duration_seconds = next.video_seconds + next.duration_seconds - current.video_seconds;
        current.word_count += next.word_count;
        current.char_count += next.char_count;
      } else {
        // Add current to result and start new
        result.push(current);
        current = { ...next };
      }
    }
    
    result.push(current);
    return result;
  }
}