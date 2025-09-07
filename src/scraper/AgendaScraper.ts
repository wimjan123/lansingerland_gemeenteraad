import * as cheerio from 'cheerio';
import { HttpClient } from '../utils/http';
import { parseSpeakerLine } from '../utils/time';
import { logger } from '../utils/logger';
import { MeetingData, AgendaItem, SpeakerWindow } from '../types/transcript';

export class AgendaScraper {
  private httpClient: HttpClient;

  constructor(rateLimitMs: number = 1000) {
    this.httpClient = new HttpClient(rateLimitMs);
  }

  /**
   * Extract meeting data from agenda URL
   */
  async scrapeAgenda(agendaUrl: string): Promise<MeetingData> {
    logger.info(`Scraping agenda: ${agendaUrl}`);
    
    try {
      const response = await this.httpClient.withRetry(() => 
        this.httpClient.get(agendaUrl)
      );
      
      const $ = cheerio.load(response.data);
      const uuid = this.extractUuidFromUrl(agendaUrl);
      
      // Extract basic meeting info
      const title = this.extractTitle($);
      const location = this.extractLocation($);
      const chairperson = this.extractChairperson($);
      const timeInfo = this.extractTimeInfo($);
      
      // Extract webcast code first
      const webcastCode = this.extractWebcastCode(response.data);
      
      // Extract date - prefer webcast date if available
      let dateInfo = this.extractDateInfo($);
      if (webcastCode) {
        const webcastDate = this.extractDateFromWebcastCode(webcastCode);
        if (webcastDate) {
          logger.debug(`Using webcast date ${webcastDate} instead of HTML date ${dateInfo}`, {
            webcastCode,
            htmlDate: dateInfo,
            webcastDate
          });
          dateInfo = webcastDate;
        }
      }
      
      // Extract agenda items with speakers
      const agendaItems = this.extractAgendaItems($);
      
      const meetingData: MeetingData = {
        uuid,
        title,
        date: dateInfo,
        location,
        chairperson,
        startTime: timeInfo.start,
        endTime: timeInfo.end,
        agendaItems,
        webcastCode
      };
      
      logger.info(`Successfully scraped meeting: ${title}`, { 
        agendaItems: agendaItems.length,
        webcastCode: webcastCode || 'not found',
        finalDate: dateInfo
      });
      
      return meetingData;
      
    } catch (error) {
      logger.error(`Failed to scrape agenda ${agendaUrl}:`, error);
      throw error;
    }
  }

  private extractUuidFromUrl(url: string): string {
    const match = url.match(/\/([a-f0-9-]{36})$/i);
    if (!match) {
      throw new Error(`Could not extract UUID from URL: ${url}`);
    }
    return match[1];
  }

  private extractTitle($: cheerio.CheerioAPI): string {
    // Look for title in various possible locations
    const titleSelectors = [
      'h1',
      '.meeting-title',
      '.agenda-title',
      'title'
    ];
    
    for (const selector of titleSelectors) {
      const title = $(selector).first().text().trim();
      if (title && title.length > 0) {
        return title;
      }
    }
    
    return 'Gemeenteraad'; // Default fallback
  }

  private extractDateInfo($: cheerio.CheerioAPI): string {
    // Look for date information
    const dateSelectors = [
      '.meeting-date',
      '.date',
      'time[datetime]'
    ];
    
    for (const selector of dateSelectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        const datetime = element.attr('datetime');
        if (datetime) {
          return datetime.split('T')[0]; // Extract date part
        }
        
        const text = element.text().trim();
        if (text) {
          // Try to parse Dutch date format
          const parsed = this.parseDutchDate(text);
          if (parsed) {
            return parsed;
          }
        }
      }
    }
    
    // Search in all text for date patterns
    const bodyText = $('body').text();
    const dateMatch = bodyText.match(/(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(\d{4})/i);
    if (dateMatch) {
      const [, day, monthName, year] = dateMatch;
      const month = this.dutchMonthToNumber(monthName);
      return `${year}-${month.toString().padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    return new Date().toISOString().split('T')[0]; // Fallback to today
  }

  private extractLocation($: cheerio.CheerioAPI): string {
    const locationSelectors = [
      '.meeting-location',
      '.location',
      '.venue'
    ];
    
    for (const selector of locationSelectors) {
      const location = $(selector).first().text().trim();
      if (location && location.length > 0) {
        return location;
      }
    }
    
    // Look for "Raadzaal" or similar in text
    const bodyText = $('body').text();
    const locationMatch = bodyText.match(/(Raadzaal|Gemeentehuis|Stadskantoor)/i);
    if (locationMatch) {
      return locationMatch[1];
    }
    
    return 'Raadzaal'; // Default
  }

  private extractChairperson($: cheerio.CheerioAPI): string {
    const chairSelectors = [
      '.chairperson',
      '.voorzitter',
      '.chair'
    ];
    
    for (const selector of chairSelectors) {
      const chair = $(selector).first().text().trim();
      if (chair && chair.length > 0) {
        return chair;
      }
    }
    
    // Look in text for "voorzitter" patterns
    const bodyText = $('body').text();
    const chairMatch = bodyText.match(/(?:voorzitter|chairperson):\s*([^\\n,]+)/i);
    if (chairMatch) {
      return chairMatch[1].trim();
    }
    
    return 'Voorzitter'; // Default
  }

  private extractTimeInfo($: cheerio.CheerioAPI): { start: string; end: string } {
    // Look for time information
    const timeSelectors = [
      '.meeting-time',
      '.time',
      'time'
    ];
    
    for (const selector of timeSelectors) {
      const timeText = $(selector).first().text().trim();
      const timeMatch = timeText.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
      if (timeMatch) {
        return {
          start: timeMatch[1],
          end: timeMatch[2]
        };
      }
    }
    
    // Search in all text for time patterns
    const bodyText = $('body').text();
    const timeMatch = bodyText.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
    if (timeMatch) {
      return {
        start: timeMatch[1],
        end: timeMatch[2]
      };
    }
    
    return { start: '20:00', end: '23:00' }; // Default
  }

  private extractWebcastCode(html: string): string | undefined {
    // Look for webcast code patterns
    const patterns = [
      /gemeentelansingerland[^"'\s]*/g,
      /"webcastCode"\s*:\s*"([^"]+)"/g,
      /sdk\.companywebcast\.com\/sdk\/player\/\?id=([^&"'\s]+)/g
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        // Clean up the webcast code
        const code = match[0].replace(/^["']|["']$/g, '').replace('gemeentelansingerland/', '');
        if (code.startsWith('gemeentelansingerland')) {
          return code;
        }
        return `gemeentelansingerland_${code}`;
      }
    }
    
    return undefined;
  }

  /**
   * Extract date from webcast code format: gemeentelansingerland_YYYYMMDD_N
   */
  private extractDateFromWebcastCode(webcastCode: string): string | null {
    const match = webcastCode.match(/gemeentelansingerland_(\d{8})_\d+/);
    if (match) {
      const dateStr = match[1]; // YYYYMMDD
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      return `${year}-${month}-${day}`;
    }
    return null;
  }

  private extractAgendaItems($: cheerio.CheerioAPI): AgendaItem[] {
    const items: AgendaItem[] = [];
    
    // Look for agenda items in various structures
    const itemSelectors = [
      '.agenda-item',
      '.agendaitem',
      'li:contains(".")', // Items with numbered format
      'tr td:first-child' // Table format
    ];
    
    let foundItems = false;
    
    for (const selector of itemSelectors) {
      const elements = $(selector);
      if (elements.length > 0) {
        elements.each((index, element) => {
          const $item = $(element);
          const text = $item.text().trim();
          
          if (text && text.length > 0) {
            const item: AgendaItem = {
              id: `item_${index + 1}`,
              title: this.cleanAgendaTitle(text),
              order: index + 1,
              speakers: this.extractSpeakersForItem($, $item)
            };
            
            items.push(item);
          }
        });
        
        if (items.length > 0) {
          foundItems = true;
          break;
        }
      }
    }
    
    // If no structured items found, create fallback
    if (!foundItems) {
      items.push({
        id: 'item_1',
        title: 'Raadsvergadering',
        order: 1,
        speakers: this.extractAllSpeakers($)
      });
    }
    
    return items;
  }

  private extractSpeakersForItem($: cheerio.CheerioAPI, itemElement: cheerio.Cheerio<any>): SpeakerWindow[] {
    const speakers: SpeakerWindow[] = [];
    
    // Look for "Sprekers" button or section near this item
    const speakersSection = itemElement.find('.sprekers, .speakers').first();
    if (speakersSection.length > 0) {
      const speakerText = speakersSection.text();
      const lines = speakerText.split('\n');
      
      for (const line of lines) {
        const parsed = parseSpeakerLine(line);
        if (parsed) {
          speakers.push(parsed);
        }
      }
    }
    
    return speakers;
  }

  private extractAllSpeakers($: cheerio.CheerioAPI): SpeakerWindow[] {
    const speakers: SpeakerWindow[] = [];
    
    // Look for any speaker time windows in the page
    const bodyText = $('body').text();
    const lines = bodyText.split('\n');
    
    for (const line of lines) {
      const parsed = parseSpeakerLine(line);
      if (parsed) {
        speakers.push(parsed);
      }
    }
    
    return speakers;
  }

  private cleanAgendaTitle(title: string): string {
    // Remove numbering and clean up title
    return title
      .replace(/^\d+\.?\s*/, '') // Remove leading numbers
      .replace(/^[\-\*]\s*/, '') // Remove leading dashes/bullets
      .trim();
  }

  private parseDutchDate(dateStr: string): string | null {
    const match = dateStr.match(/(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(\d{4})/i);
    if (match) {
      const [, day, monthName, year] = match;
      const month = this.dutchMonthToNumber(monthName);
      return `${year}-${month.toString().padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return null;
  }

  private dutchMonthToNumber(monthName: string): number {
    const months: { [key: string]: number } = {
      'januari': 1, 'februari': 2, 'maart': 3, 'april': 4,
      'mei': 5, 'juni': 6, 'juli': 7, 'augustus': 8,
      'september': 9, 'oktober': 10, 'november': 11, 'december': 12
    };
    return months[monthName.toLowerCase()] || 1;
  }
}