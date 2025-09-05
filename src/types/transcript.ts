export interface AgendaItem {
  id: string;
  title: string;
  order: number;
  speakers: SpeakerWindow[];
}

export interface SpeakerWindow {
  startSec: number;
  endSec: number;
  speakerName: string;
}

export interface VTTCue {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptSegment {
  segment_id: string;
  speaker_name: string | null;
  transcript_text: string;
  video_seconds: number;
  timestamp_start: string;
  timestamp_end: string;
  duration_seconds: number;
  word_count: number;
  char_count: number;
  segment_type: string;
  agenda_item?: string | null;
}

export interface VideoMetadata {
  title: string;
  filename: string;
  date?: string;
  duration?: number;
  source: string;
  dataset: string;
  format: string;
  place?: string;
  record_type: string;
  total_words?: number;
  total_segments?: number;
  description?: string;
  url?: string;
}

export interface TranscriptJSON {
  format_version: string;
  import_metadata?: {
    source: string;
    created_at: string;
    created_by: string;
    source_file?: string;
    conversion_notes?: string;
  };
  video: VideoMetadata;
  segments: TranscriptSegment[];
}

export interface MeetingData {
  uuid: string;
  title: string;
  date: string;
  location: string;
  chairperson: string;
  startTime: string;
  endTime: string;
  agendaItems: AgendaItem[];
  webcastCode?: string;
}

export interface WebcastInfo {
  id: string;
  label: string;
  description: string;
  start: string;
  duration: string;
  phase: string;
  landingPage: string;
}

export interface VTTTrack {
  path: string;
  id: string;
  lastModified: string;
}

export interface ScrapingResult {
  success: boolean;
  meetingId: string;
  outputFile?: string;
  error?: string;
  videoAvailable: boolean;
  transcriptSegments: number;
}