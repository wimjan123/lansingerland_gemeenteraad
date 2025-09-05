import * as cheerio from 'cheerio';
import { HttpClient } from '../utils/http';
import { logger } from '../utils/logger';

export interface DiscoveredMeeting {
  uuid: string;
  agendaUrl: string;
  title: string;
  date: string;
  time?: string;
  location: string;
  meetingType: string;
  agendaTypeId: string;
  description?: string;
  cancelled?: boolean;
}

export interface DiscoveryOptions {
  fromDate?: Date;
  toDate?: Date;
  meetingTypes?: string[];
  includeAll?: boolean;
  includeCancelled?: boolean;
}

export class MeetingDiscovery {
  private httpClient: HttpClient;
  private baseUrl = 'https://lansingerland.bestuurlijkeinformatie.nl';

  constructor(rateLimitMs: number = 1000) {
    this.httpClient = new HttpClient(rateLimitMs);
  }

  /**
   * Discover meetings from the Lansingerland calendar
   */
  async discoverMeetings(options: DiscoveryOptions = {}): Promise<DiscoveredMeeting[]> {
    logger.info('Starting meeting discovery', { options });
    
    const meetings: DiscoveredMeeting[] = [];
    
    // Get date range to search
    const { startDate, endDate } = this.getDateRange(options);
    
    // Iterate through months in the date range
    const monthsToSearch = this.generateMonthRange(startDate, endDate);
    
    for (const { month, year } of monthsToSearch) {
      logger.info(`Searching calendar for ${year}-${month.toString().padStart(2, '0')}`);
      
      try {
        const monthMeetings = await this.discoverMeetingsForMonth(month, year, options);
        meetings.push(...monthMeetings);
        
        logger.info(`Found ${monthMeetings.length} meetings for ${year}-${month.toString().padStart(2, '0')}`);
        
      } catch (error) {
        logger.error(`Failed to discover meetings for ${year}-${month}:`, error);
        if (!options.includeAll) {
          throw error;
        }
      }
    }

    // Filter by date range if specified
    const filteredMeetings = this.filterMeetingsByDate(meetings, options);
    
    // Sort by date
    filteredMeetings.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    logger.info(`Discovery completed: found ${filteredMeetings.length} meetings`, {
      dateRange: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
      meetingTypes: options.meetingTypes || 'all'
    });
    
    return filteredMeetings;
  }

  /**
   * Discover meetings for a specific month
   */
  private async discoverMeetingsForMonth(
    month: number, 
    year: number, 
    options: DiscoveryOptions
  ): Promise<DiscoveredMeeting[]> {
    const calendarUrl = `${this.baseUrl}/Calendar?month=${month}&year=${year}`;
    
    const response = await this.httpClient.withRetry(() => 
      this.httpClient.get(calendarUrl)
    );
    
    const $ = cheerio.load(response.data);
    const meetings: DiscoveredMeeting[] = [];
    
    // Parse each calendar day
    $('.calendar-items-row').each((_, dayRow) => {
      const $dayRow = $(dayRow);
      const dayNumber = parseInt($dayRow.find('.calendar-items-day-nr').text().trim());
      
      if (isNaN(dayNumber)) return;
      
      // Parse meetings for this day
      $dayRow.find('a.calendar-item').each((_, meetingElement) => {
        const $meeting = $(meetingElement);
        
        try {
          const meeting = this.parseMeetingElement($meeting, $, dayNumber, month, year);
          
          if (meeting && this.shouldIncludeMeeting(meeting, options)) {
            meetings.push(meeting);
          }
        } catch (error) {
          logger.warn('Failed to parse meeting element:', error);
        }
      });
    });
    
    return meetings;
  }

  /**
   * Parse a single meeting element from the calendar
   */
  private parseMeetingElement(
    $meeting: cheerio.Cheerio<any>,
    $: cheerio.CheerioAPI,
    day: number,
    month: number,
    year: number
  ): DiscoveredMeeting | null {
    const agendaUrl = $meeting.attr('href');
    if (!agendaUrl) return null;
    
    const fullAgendaUrl = agendaUrl.startsWith('http') ? agendaUrl : `${this.baseUrl}${agendaUrl}`;
    const uuid = this.extractUuidFromUrl(fullAgendaUrl);
    if (!uuid) return null;
    
    const title = $meeting.find('.calendar-item-label').clone().children().remove().end().text().trim();
    const location = $meeting.find('.calendar-item-location').text().replace(/[()]/g, '').trim();
    const agendaTypeId = $meeting.attr('data-agendatype-id') || '';
    
    // Look for meeting description (might indicate cancellation)
    const $description = $meeting.closest('.calendar-items').find('.calendar-item-description');
    const description = $description.length > 0 ? $description.text().trim() : undefined;
    const cancelled = description?.toLowerCase().includes('geannuleerd') || false;
    
    const date = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    
    return {
      uuid,
      agendaUrl: fullAgendaUrl,
      title,
      date,
      location,
      meetingType: this.mapMeetingType(title),
      agendaTypeId,
      description,
      cancelled
    };
  }

  /**
   * Extract UUID from agenda URL
   */
  private extractUuidFromUrl(url: string): string | null {
    const match = url.match(/\/Agenda\/Index\/([a-f0-9-]{36})/i);
    return match ? match[1] : null;
  }

  /**
   * Map meeting title to standardized type
   */
  private mapMeetingType(title: string): string {
    const titleLower = title.toLowerCase();
    
    if (titleLower.includes('gemeenteraad')) return 'Gemeenteraad';
    if (titleLower.includes('commissie ruimte')) return 'Commissie Ruimte';
    if (titleLower.includes('commissie algemeen bestuur')) return 'Commissie Algemeen Bestuur';
    if (titleLower.includes('commissie samenleving')) return 'Commissie Samenleving';
    if (titleLower.includes('beeldvorming')) return 'Beeldvorming';
    if (titleLower.includes('bac')) return 'BAC';
    
    return title; // Return original if no mapping found
  }

  /**
   * Check if meeting should be included based on options
   */
  private shouldIncludeMeeting(meeting: DiscoveredMeeting, options: DiscoveryOptions): boolean {
    // Filter by meeting type
    if (options.meetingTypes && options.meetingTypes.length > 0) {
      const matchesType = options.meetingTypes.some(type => 
        meeting.meetingType.toLowerCase().includes(type.toLowerCase()) ||
        meeting.title.toLowerCase().includes(type.toLowerCase())
      );
      if (!matchesType) return false;
    }
    
    // Filter cancelled meetings
    if (!options.includeCancelled && meeting.cancelled) {
      return false;
    }
    
    return true;
  }

  /**
   * Filter meetings by date range
   */
  private filterMeetingsByDate(meetings: DiscoveredMeeting[], options: DiscoveryOptions): DiscoveredMeeting[] {
    if (!options.fromDate && !options.toDate) {
      return meetings;
    }
    
    return meetings.filter(meeting => {
      const meetingDate = new Date(meeting.date);
      
      if (options.fromDate && meetingDate < options.fromDate) {
        return false;
      }
      
      if (options.toDate && meetingDate > options.toDate) {
        return false;
      }
      
      return true;
    });
  }

  /**
   * Get date range for discovery
   */
  private getDateRange(options: DiscoveryOptions): { startDate: Date; endDate: Date } {
    const now = new Date();
    
    const startDate = options.fromDate || new Date(now.getFullYear() - 1, 0, 1); // Last year
    const endDate = options.toDate || new Date(now.getFullYear() + 1, 11, 31); // Next year
    
    return { startDate, endDate };
  }

  /**
   * Generate array of months to search
   */
  private generateMonthRange(startDate: Date, endDate: Date): Array<{ month: number; year: number }> {
    const months: Array<{ month: number; year: number }> = [];
    
    const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    
    while (current <= end) {
      months.push({
        month: current.getMonth() + 1, // 1-based month
        year: current.getFullYear()
      });
      
      current.setMonth(current.getMonth() + 1);
    }
    
    return months;
  }

  /**
   * Get meetings of specific types
   */
  async getCouncilMeetings(options: Omit<DiscoveryOptions, 'meetingTypes'> = {}): Promise<DiscoveredMeeting[]> {
    return this.discoverMeetings({
      ...options,
      meetingTypes: ['Gemeenteraad']
    });
  }

  async getCommissionMeetings(options: Omit<DiscoveryOptions, 'meetingTypes'> = {}): Promise<DiscoveredMeeting[]> {
    return this.discoverMeetings({
      ...options,
      meetingTypes: ['Commissie']
    });
  }

  async getAllMeetings(options: DiscoveryOptions = {}): Promise<DiscoveredMeeting[]> {
    return this.discoverMeetings({
      ...options,
      includeAll: true
    });
  }

  /**
   * Get meetings for a specific date range with convenient helpers
   */
  async getRecentMeetings(days: number = 30): Promise<DiscoveredMeeting[]> {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    
    return this.discoverMeetings({
      fromDate,
      toDate,
      includeAll: true
    });
  }

  async getUpcomingMeetings(days: number = 30): Promise<DiscoveredMeeting[]> {
    const fromDate = new Date();
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + days);
    
    return this.discoverMeetings({
      fromDate,
      toDate,
      includeAll: true
    });
  }

  /**
   * Get meeting statistics
   */
  getMeetingStats(meetings: DiscoveredMeeting[]): any {
    const stats = {
      total: meetings.length,
      cancelled: meetings.filter(m => m.cancelled).length,
      byType: {} as Record<string, number>,
      byLocation: {} as Record<string, number>,
      dateRange: {
        earliest: meetings.length > 0 ? meetings[0].date : null,
        latest: meetings.length > 0 ? meetings[meetings.length - 1].date : null
      }
    };
    
    meetings.forEach(meeting => {
      stats.byType[meeting.meetingType] = (stats.byType[meeting.meetingType] || 0) + 1;
      stats.byLocation[meeting.location] = (stats.byLocation[meeting.location] || 0) + 1;
    });
    
    return stats;
  }
}