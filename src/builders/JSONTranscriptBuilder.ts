import { format } from 'date-fns';
import { logger } from '../utils/logger';
import { 
  TranscriptJSON, 
  VideoMetadata, 
  TranscriptSegment, 
  MeetingData, 
  WebcastInfo,
  VTTTrack
} from '../types/transcript';

export class JSONTranscriptBuilder {
  
  /**
   * Build complete transcript JSON
   */
  buildTranscriptJSON(
    meetingData: MeetingData,
    webcastInfo: WebcastInfo | null,
    segments: TranscriptSegment[],
    vttTrack?: VTTTrack
  ): TranscriptJSON {
    logger.info('Building transcript JSON', {
      meetingId: meetingData.webcastCode || meetingData.uuid,
      segments: segments.length,
      hasWebcast: !!webcastInfo
    });

    const videoMetadata = this.buildVideoMetadata(meetingData, webcastInfo);
    
    const transcriptJSON: TranscriptJSON = {
      format_version: '1.0',
      import_metadata: {
        source: 'lansingerland_scraper',
        created_at: new Date().toISOString(),
        created_by: 'Claude Code Lansingerland Scraper'
      },
      video: videoMetadata,
      segments: segments
    };

    // Add processing metadata if available
    if (vttTrack && transcriptJSON.import_metadata) {
      transcriptJSON.import_metadata.source_file = `VTT-${vttTrack.id}`;
      transcriptJSON.import_metadata.conversion_notes = `Converted from WebVTT track ${vttTrack.id}, last modified ${vttTrack.lastModified}`;
    }

    this.validateJSON(transcriptJSON);
    
    logger.info('Transcript JSON built successfully', {
      totalSegments: segments.length,
      totalWords: videoMetadata.total_words,
      videoDuration: videoMetadata.duration
    });

    return transcriptJSON;
  }

  /**
   * Build video metadata from meeting and webcast info
   */
  private buildVideoMetadata(
    meetingData: MeetingData, 
    webcastInfo: WebcastInfo | null
  ): VideoMetadata {
    const baseMetadata: VideoMetadata = {
      title: meetingData.title,
      filename: this.generateFilename(meetingData),
      source: 'Gemeente Lansingerland',
      dataset: 'lansingerland_gemeenteraad',
      format: 'Gemeenteraadsvergadering',
      record_type: 'Official Council Meeting'
    };

    // Add optional fields if available
    if (meetingData.date) {
      baseMetadata.date = meetingData.date;
    }

    if (meetingData.location) {
      baseMetadata.place = meetingData.location;
    }

    // Add webcast-specific data if available
    if (webcastInfo) {
      if (webcastInfo.duration) {
        baseMetadata.duration = this.parseDuration(webcastInfo.duration);
      }
      
      if (webcastInfo.description) {
        baseMetadata.description = webcastInfo.description;
      }

      if (webcastInfo.landingPage) {
        baseMetadata.url = webcastInfo.landingPage;
      }
    }

    return baseMetadata;
  }

  /**
   * Generate appropriate filename
   */
  private generateFilename(meetingData: MeetingData): string {
    const webcastCode = meetingData.webcastCode || meetingData.uuid;
    return `${webcastCode}.json`;
  }

  /**
   * Parse duration string to seconds
   */
  private parseDuration(duration: string): number {
    // Handle formats like "02:52:03" or "2:52:03"
    const parts = duration.split(':').map(p => parseInt(p, 10));
    
    if (parts.length === 3) {
      const [hours, minutes, seconds] = parts;
      return hours * 3600 + minutes * 60 + seconds;
    }
    
    if (parts.length === 2) {
      const [minutes, seconds] = parts;
      return minutes * 60 + seconds;
    }
    
    logger.warn(`Could not parse duration: ${duration}`);
    return 0;
  }

  /**
   * Update video metadata with segment statistics
   */
  updateVideoMetadataFromSegments(
    metadata: VideoMetadata, 
    segments: TranscriptSegment[]
  ): VideoMetadata {
    const totalWords = segments.reduce((sum, segment) => sum + segment.word_count, 0);
    const totalSegments = segments.length;

    return {
      ...metadata,
      total_words: totalWords,
      total_segments: totalSegments
    };
  }

  /**
   * Build transcript JSON for future meetings (no video available)
   */
  buildFutureMeetingJSON(meetingData: MeetingData): TranscriptJSON {
    logger.info('Building future meeting JSON', {
      meetingId: meetingData.uuid,
      title: meetingData.title,
      date: meetingData.date
    });

    const videoMetadata: VideoMetadata = {
      title: meetingData.title,
      filename: this.generateFilename(meetingData),
      date: meetingData.date,
      source: 'Gemeente Lansingerland',
      dataset: 'lansingerland_gemeenteraad',
      format: 'Gemeenteraadsvergadering',
      place: meetingData.location,
      record_type: 'Scheduled Council Meeting',
      total_words: 0,
      total_segments: 0
    };

    return {
      format_version: '1.0',
      import_metadata: {
        source: 'lansingerland_scraper',
        created_at: new Date().toISOString(),
        created_by: 'Claude Code Lansingerland Scraper',
        conversion_notes: 'Future meeting - no video content available yet'
      },
      video: videoMetadata,
      segments: []
    };
  }

  /**
   * Build simplified transcript JSON (matching requirements format)
   */
  buildSimplifiedJSON(
    meetingData: MeetingData,
    segments: TranscriptSegment[],
    agendaUrl: string,
    videoAvailable: boolean = true
  ): any {
    const meetingId = meetingData.webcastCode || meetingData.uuid;
    
    // Convert agenda items to required format
    const agenda = meetingData.agendaItems.map(item => ({
      id: item.id,
      title: item.title,
      order: item.order,
      speakers: item.speakers.map(speaker => ({
        start_time: speaker.startSec,
        end_time: speaker.endSec,
        speaker_name: speaker.speakerName
      }))
    }));

    // Convert transcript segments to required format
    const transcript = segments.map(segment => ({
      start: segment.video_seconds,
      end: segment.video_seconds + segment.duration_seconds,
      text: segment.transcript_text,
      speaker: segment.speaker_name,
      agenda_item: segment.agenda_item
    }));

    const result = {
      meeting_id: meetingId,
      date: meetingData.date,
      title: meetingData.title,
      location: meetingData.location,
      chairperson: meetingData.chairperson,
      agenda_url: agendaUrl,
      player_url: `https://channel.royalcast.com/webcast/${meetingId}`,
      language: 'nl',
      video_available: videoAvailable,
      agenda,
      transcript
    };

    logger.info('Built simplified transcript JSON', {
      meetingId,
      agendaItems: agenda.length,
      transcriptSegments: transcript.length,
      videoAvailable
    });

    return result;
  }

  /**
   * Validate transcript JSON structure
   */
  private validateJSON(transcriptJSON: TranscriptJSON): void {
    const errors: string[] = [];

    // Check required fields
    if (!transcriptJSON.format_version) {
      errors.push('Missing format_version');
    }

    if (!transcriptJSON.video) {
      errors.push('Missing video metadata');
    } else {
      if (!transcriptJSON.video.title) {
        errors.push('Missing video title');
      }
      if (!transcriptJSON.video.filename) {
        errors.push('Missing video filename');
      }
    }

    if (!Array.isArray(transcriptJSON.segments)) {
      errors.push('Segments must be an array');
    }

    // Validate segments
    for (let i = 0; i < transcriptJSON.segments.length; i++) {
      const segment = transcriptJSON.segments[i];
      
      if (!segment.segment_id) {
        errors.push(`Segment ${i}: missing segment_id`);
      }
      
      if (!segment.transcript_text) {
        errors.push(`Segment ${i}: missing transcript_text`);
      }
      
      if (typeof segment.word_count !== 'number') {
        errors.push(`Segment ${i}: invalid word_count`);
      }
      
      if (typeof segment.char_count !== 'number') {
        errors.push(`Segment ${i}: invalid char_count`);
      }
    }

    if (errors.length > 0) {
      logger.error('JSON validation failed', { errors });
      throw new Error(`JSON validation failed: ${errors.join(', ')}`);
    }
  }

  /**
   * Calculate JSON file size estimate
   */
  estimateFileSize(transcriptJSON: TranscriptJSON): number {
    try {
      const jsonString = JSON.stringify(transcriptJSON, null, 2);
      return Buffer.byteLength(jsonString, 'utf8');
    } catch (error) {
      logger.warn('Could not estimate file size', error);
      return 0;
    }
  }

  /**
   * Optimize JSON for size (remove optional empty fields)
   */
  optimizeJSON(transcriptJSON: TranscriptJSON): TranscriptJSON {
    const optimized = JSON.parse(JSON.stringify(transcriptJSON));
    
    // Remove empty optional fields from video metadata
    const video = optimized.video;
    Object.keys(video).forEach(key => {
      if (video[key] === null || video[key] === undefined || video[key] === '') {
        delete video[key];
      }
    });

    // Remove null fields from segments
    optimized.segments.forEach((segment: any) => {
      Object.keys(segment).forEach(key => {
        if (segment[key] === null || segment[key] === undefined) {
          delete segment[key];
        }
      });
    });

    return optimized;
  }

  /**
   * Create processing summary
   */
  createProcessingSummary(
    meetingData: MeetingData,
    segments: TranscriptSegment[],
    processingTime: number
  ): any {
    const alignedSpeakers = segments.filter(s => s.speaker_name).length;
    const alignedAgenda = segments.filter(s => s.agenda_item).length;
    const totalWords = segments.reduce((sum, s) => sum + s.word_count, 0);
    const totalDuration = Math.max(...segments.map(s => s.video_seconds + s.duration_seconds));

    return {
      meeting_id: meetingData.webcastCode || meetingData.uuid,
      processing_timestamp: new Date().toISOString(),
      processing_time_ms: processingTime,
      statistics: {
        total_segments: segments.length,
        total_words: totalWords,
        total_duration_seconds: totalDuration,
        speaker_alignment_rate: Math.round((alignedSpeakers / segments.length) * 100),
        agenda_alignment_rate: Math.round((alignedAgenda / segments.length) * 100),
        unique_speakers: new Set(segments.map(s => s.speaker_name).filter(Boolean)).size,
        agenda_items_covered: meetingData.agendaItems.length
      },
      quality_metrics: {
        has_speaker_data: alignedSpeakers > 0,
        has_agenda_data: alignedAgenda > 0,
        alignment_quality: alignedSpeakers > segments.length * 0.5 ? 'good' : 'poor'
      }
    };
  }
}