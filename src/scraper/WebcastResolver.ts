import { HttpClient } from '../utils/http';
import { logger } from '../utils/logger';
import { WebcastInfo, VTTTrack } from '../types/transcript';

export class WebcastResolver {
  private httpClient: HttpClient;
  private baseUrl = 'https://sdk.companywebcast.com';

  constructor(rateLimitMs: number = 1000) {
    this.httpClient = new HttpClient(rateLimitMs);
  }

  /**
   * Get webcast info and resolve internal UUID from webcast code
   */
  async getWebcastInfo(webcastCode: string): Promise<WebcastInfo> {
    logger.info(`Resolving webcast info for: ${webcastCode}`);
    
    try {
      const infoUrl = `${this.baseUrl}/players/${webcastCode}/info`;
      
      const response = await this.httpClient.withRetry(() => 
        this.httpClient.getWebcast(infoUrl)
      );
      
      const info = response.data;
      
      if (!info.id) {
        throw new Error(`No UUID found in webcast info for ${webcastCode}`);
      }
      
      logger.info(`Resolved webcast UUID: ${info.id}`, {
        webcastCode,
        uuid: info.id,
        label: info.label,
        phase: info.phase
      });
      
      return {
        id: info.id,
        label: info.label || 'Unknown',
        description: info.description || '',
        start: info.start,
        duration: info.duration,
        phase: info.phase,
        landingPage: info.landingPage || ''
      };
      
    } catch (error) {
      logger.error(`Failed to resolve webcast info for ${webcastCode}:`, error);
      throw error;
    }
  }

  /**
   * List available VTT tracks for a webcast
   */
  async listVTTTracks(uuid: string): Promise<VTTTrack[]> {
    logger.info(`Listing VTT tracks for UUID: ${uuid}`);
    
    try {
      const vttUrl = `${this.baseUrl}/players/${uuid}/vtt/`;
      
      const response = await this.httpClient.withRetry(() =>
        this.httpClient.getWebcast(vttUrl)
      );
      
      const tracks: VTTTrack[] = response.data;
      
      logger.info(`Found ${tracks.length} VTT tracks`, {
        uuid,
        tracks: tracks.map(t => ({ path: t.path, id: t.id }))
      });
      
      return tracks;
      
    } catch (error) {
      logger.error(`Failed to list VTT tracks for ${uuid}:`, error);
      throw error;
    }
  }

  /**
   * Download VTT content
   */
  async downloadVTT(uuid: string, track: VTTTrack): Promise<string> {
    logger.info(`Downloading VTT track: ${track.id}`, { uuid, track: track.id });
    
    try {
      const vttUrl = `${this.baseUrl}/players/${uuid}/vtt/${track.path}/${track.id}`;
      
      const response = await this.httpClient.withRetry(() =>
        this.httpClient.getWebcast(vttUrl, {
          headers: {
            'Accept': 'text/vtt,text/plain,*/*'
          }
        })
      );
      
      const content = response.data;
      
      if (typeof content !== 'string') {
        throw new Error('VTT content is not a string');
      }
      
      if (!content.startsWith('WEBVTT')) {
        throw new Error('Invalid VTT format - does not start with WEBVTT');
      }
      
      logger.info(`Successfully downloaded VTT track`, {
        uuid,
        track: track.id,
        size: content.length,
        lastModified: track.lastModified
      });
      
      return content;
      
    } catch (error) {
      logger.error(`Failed to download VTT track ${track.id} for ${uuid}:`, error);
      throw error;
    }
  }

  /**
   * Get the best available VTT track (prefer NLCorrectie/NLcorrectie)
   */
  getBestVTTTrack(tracks: VTTTrack[]): VTTTrack | null {
    if (tracks.length === 0) {
      return null;
    }
    
    // Prefer Dutch correction tracks
    const dutchTracks = tracks.filter(t => 
      t.id.toLowerCase().includes('nlcorrectie') || 
      t.id.toLowerCase().includes('nlcorrecte')
    );
    
    if (dutchTracks.length > 0) {
      return dutchTracks[0];
    }
    
    // Prefer any track with "nl" in the name
    const nlTracks = tracks.filter(t => t.id.toLowerCase().includes('nl'));
    if (nlTracks.length > 0) {
      return nlTracks[0];
    }
    
    // Return first available track
    return tracks[0];
  }

  /**
   * Check if webcast has subtitles available
   */
  async hasSubtitles(webcastCode: string): Promise<boolean> {
    try {
      const info = await this.getWebcastInfo(webcastCode);
      const tracks = await this.listVTTTracks(info.id);
      return tracks.length > 0;
    } catch (error) {
      logger.warn(`Could not check subtitles for ${webcastCode}:`, error);
      return false;
    }
  }

  /**
   * Check if VTT content has changed based on lastModified timestamp
   */
  isVTTUpdated(track: VTTTrack, lastProcessed?: string): boolean {
    if (!lastProcessed) {
      return true; // First time processing
    }
    
    try {
      const trackDate = new Date(track.lastModified);
      const processedDate = new Date(lastProcessed);
      return trackDate > processedDate;
    } catch (error) {
      logger.warn('Could not compare VTT timestamps:', error);
      return true; // Process if unsure
    }
  }

  /**
   * Complete workflow: resolve webcast and download best VTT
   */
  async resolveAndDownloadVTT(webcastCode: string): Promise<{
    info: WebcastInfo;
    vttContent: string;
    track: VTTTrack;
  }> {
    logger.info(`Starting complete VTT resolution for: ${webcastCode}`);
    
    const info = await this.getWebcastInfo(webcastCode);
    const tracks = await this.listVTTTracks(info.id);
    
    if (tracks.length === 0) {
      throw new Error(`No VTT tracks available for ${webcastCode}`);
    }
    
    const bestTrack = this.getBestVTTTrack(tracks);
    if (!bestTrack) {
      throw new Error(`Could not select best VTT track for ${webcastCode}`);
    }
    
    const vttContent = await this.downloadVTT(info.id, bestTrack);
    
    logger.info(`Complete VTT resolution successful`, {
      webcastCode,
      uuid: info.id,
      track: bestTrack.id,
      contentLength: vttContent.length
    });
    
    return {
      info,
      vttContent,
      track: bestTrack
    };
  }
}