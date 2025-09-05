#!/usr/bin/env node

import { Command } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import { AgendaScraper } from './scraper/AgendaScraper';
import { WebcastResolver } from './scraper/WebcastResolver';
import { VTTProcessor } from './scraper/VTTProcessor';
import { TranscriptAligner } from './alignment/TranscriptAligner';
import { JSONTranscriptBuilder } from './builders/JSONTranscriptBuilder';
import { MeetingDiscovery, DiscoveredMeeting } from './scraper/MeetingDiscovery';
import { logger, logProcessingStatus } from './utils/logger';
import { ScrapingResult } from './types/transcript';

class LansingerlandScraper {
  private agendaScraper: AgendaScraper;
  private webcastResolver: WebcastResolver;
  private vttProcessor: VTTProcessor;
  private transcriptAligner: TranscriptAligner;
  private jsonBuilder: JSONTranscriptBuilder;
  private meetingDiscovery: MeetingDiscovery;
  private outputDir: string;

  constructor(rateLimitMs: number = 1000, graceWindow: number = 0.35, outputDir: string = './output') {
    this.agendaScraper = new AgendaScraper(rateLimitMs);
    this.webcastResolver = new WebcastResolver(rateLimitMs);
    this.vttProcessor = new VTTProcessor();
    this.transcriptAligner = new TranscriptAligner(graceWindow);
    this.jsonBuilder = new JSONTranscriptBuilder();
    this.meetingDiscovery = new MeetingDiscovery(rateLimitMs);
    this.outputDir = outputDir;
  }

  /**
   * Process a single agenda URL
   */
  async scrapeAgenda(agendaUrl: string, options: {
    skipExisting?: boolean;
    simplified?: boolean;
  } = {}): Promise<ScrapingResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting scraping process', { agendaUrl, options });
      
      // Extract meeting data from agenda page
      const meetingData = await this.agendaScraper.scrapeAgenda(agendaUrl);
      const meetingId = meetingData.webcastCode || meetingData.uuid;
      
      logProcessingStatus(meetingId, 'started', { agendaUrl, title: meetingData.title });

      // Check if output already exists and skip if requested
      const outputFile = path.join(this.outputDir, `${meetingId}.json`);
      if (options.skipExisting && await this.fileExists(outputFile)) {
        logger.info('Output file already exists, skipping', { outputFile });
        logProcessingStatus(meetingId, 'skipped', { reason: 'file_exists', outputFile });
        return {
          success: true,
          meetingId,
          outputFile,
          videoAvailable: false,
          transcriptSegments: 0
        };
      }

      // Check if this is a future meeting (no webcast yet)
      if (!meetingData.webcastCode) {
        logger.info('No webcast code found - likely future meeting', { meetingId });
        const futureJSON = this.jsonBuilder.buildFutureMeetingJSON(meetingData);
        
        await this.ensureOutputDir();
        await fs.writeFile(outputFile, JSON.stringify(futureJSON, null, 2));
        
        logProcessingStatus(meetingId, 'success', { 
          videoAvailable: false, 
          segments: 0, 
          outputFile,
          processingTime: Date.now() - startTime
        });

        return {
          success: true,
          meetingId,
          outputFile,
          videoAvailable: false,
          transcriptSegments: 0
        };
      }

      // Process webcast and VTT
      logger.info('Resolving webcast and downloading VTT', { webcastCode: meetingData.webcastCode });
      
      const webcastData = await this.webcastResolver.resolveAndDownloadVTT(meetingData.webcastCode);
      const vttCues = this.vttProcessor.parseVTT(webcastData.vttContent);
      
      if (vttCues.length === 0) {
        throw new Error('No VTT cues found in webcast');
      }

      // Align transcript with speakers and agenda
      logger.info('Aligning transcript with speakers and agenda');
      const segments = this.transcriptAligner.alignTranscript(vttCues, meetingData.agendaItems);
      const processedSegments = this.transcriptAligner.postProcessSegments(segments);

      // Validate alignment
      const validation = this.transcriptAligner.validateAlignment(processedSegments);
      if (!validation.valid) {
        logger.error('Alignment validation failed', { errors: validation.errors });
        throw new Error(`Alignment validation failed: ${validation.errors.join(', ')}`);
      }

      if (validation.warnings.length > 0) {
        logger.warn('Alignment warnings', { warnings: validation.warnings });
      }

      // Generate JSON output
      let outputJSON: any;
      
      if (options.simplified) {
        outputJSON = this.jsonBuilder.buildSimplifiedJSON(
          meetingData, 
          processedSegments, 
          agendaUrl, 
          true
        );
      } else {
        const transcriptJSON = this.jsonBuilder.buildTranscriptJSON(
          meetingData,
          webcastData.info,
          processedSegments,
          webcastData.track
        );
        
        // Update metadata with segment statistics
        transcriptJSON.video = this.jsonBuilder.updateVideoMetadataFromSegments(
          transcriptJSON.video, 
          processedSegments
        );
        
        outputJSON = this.jsonBuilder.optimizeJSON(transcriptJSON);
      }

      // Write output file
      await this.ensureOutputDir();
      await fs.writeFile(outputFile, JSON.stringify(outputJSON, null, 2));

      const processingTime = Date.now() - startTime;
      
      logProcessingStatus(meetingId, 'success', {
        videoAvailable: true,
        segments: processedSegments.length,
        outputFile,
        processingTime,
        alignmentRate: Math.round((processedSegments.filter(s => s.speaker_name).length / processedSegments.length) * 100)
      });

      logger.info('Scraping completed successfully', {
        meetingId,
        outputFile,
        segments: processedSegments.length,
        processingTime: `${processingTime}ms`,
        fileSize: this.jsonBuilder.estimateFileSize(outputJSON)
      });

      return {
        success: true,
        meetingId,
        outputFile,
        videoAvailable: true,
        transcriptSegments: processedSegments.length
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const meetingId = agendaUrl.split('/').pop() || 'unknown';
      
      logger.error('Scraping failed', { 
        agendaUrl, 
        meetingId, 
        error: errorMessage,
        processingTime: Date.now() - startTime
      });
      
      logProcessingStatus(meetingId, 'failed', { 
        error: errorMessage,
        processingTime: Date.now() - startTime
      });

      return {
        success: false,
        meetingId,
        error: errorMessage,
        videoAvailable: false,
        transcriptSegments: 0
      };
    }
  }

  /**
   * Process multiple agenda URLs
   */
  async scrapeMultiple(agendaUrls: string[], options: {
    skipExisting?: boolean;
    simplified?: boolean;
    continueOnError?: boolean;
  } = {}): Promise<ScrapingResult[]> {
    logger.info('Starting batch processing', { 
      totalUrls: agendaUrls.length,
      options
    });

    const results: ScrapingResult[] = [];

    for (let i = 0; i < agendaUrls.length; i++) {
      const agendaUrl = agendaUrls[i];
      
      logger.info(`Processing ${i + 1}/${agendaUrls.length}`, { agendaUrl });

      try {
        const result = await this.scrapeAgenda(agendaUrl, options);
        results.push(result);

        if (!result.success && !options.continueOnError) {
          logger.error('Stopping batch processing due to error', { 
            failedUrl: agendaUrl,
            error: result.error
          });
          break;
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Batch processing error', { agendaUrl, error: errorMessage });
        
        results.push({
          success: false,
          meetingId: agendaUrl.split('/').pop() || 'unknown',
          error: errorMessage,
          videoAvailable: false,
          transcriptSegments: 0
        });

        if (!options.continueOnError) {
          break;
        }
      }
    }

    // Log batch summary
    const successful = results.filter(r => r.success).length;
    const failed = results.length - successful;
    const totalSegments = results.reduce((sum, r) => sum + r.transcriptSegments, 0);

    logger.info('Batch processing completed', {
      total: results.length,
      successful,
      failed,
      totalSegments
    });

    return results;
  }

  /**
   * Discover and process meetings automatically
   */
  async discoverAndProcess(options: {
    fromDate?: Date;
    toDate?: Date;
    meetingTypes?: string[];
    skipExisting?: boolean;
    simplified?: boolean;
    continueOnError?: boolean;
    maxMeetings?: number;
  } = {}): Promise<{ discovered: DiscoveredMeeting[], results: ScrapingResult[] }> {
    logger.info('Starting meeting discovery and processing', { options });

    // Discover meetings
    const discovered = await this.meetingDiscovery.discoverMeetings({
      fromDate: options.fromDate,
      toDate: options.toDate,
      meetingTypes: options.meetingTypes,
      includeAll: true,
      includeCancelled: false
    });

    logger.info(`Discovered ${discovered.length} meetings`);

    // Limit number of meetings if specified
    const meetingsToProcess = options.maxMeetings 
      ? discovered.slice(0, options.maxMeetings)
      : discovered;

    if (meetingsToProcess.length !== discovered.length) {
      logger.info(`Limited processing to ${meetingsToProcess.length} meetings`);
    }

    // Process each discovered meeting
    const results = await this.scrapeMultiple(
      meetingsToProcess.map(m => m.agendaUrl),
      {
        skipExisting: options.skipExisting,
        simplified: options.simplified,
        continueOnError: options.continueOnError
      }
    );

    return { discovered, results };
  }

  /**
   * Discover meetings without processing them
   */
  async discoverMeetings(options: {
    fromDate?: Date;
    toDate?: Date;
    meetingTypes?: string[];
    includeCancelled?: boolean;
  } = {}): Promise<DiscoveredMeeting[]> {
    return this.meetingDiscovery.discoverMeetings({
      ...options,
      includeAll: true
    });
  }

  private async ensureOutputDir(): Promise<void> {
    try {
      await fs.access(this.outputDir);
    } catch {
      await fs.mkdir(this.outputDir, { recursive: true });
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

// CLI Setup
const program = new Command();

program
  .name('lansingerland-scraper')
  .description('Robust scraper for Lansingerland council meetings')
  .version('1.0.0');

program
  .command('discover')
  .description('Discover meetings from the Lansingerland portal')
  .option('-f, --from <date>', 'Start date (YYYY-MM-DD)')
  .option('-t, --to <date>', 'End date (YYYY-MM-DD)')
  .option('-d, --days <number>', 'Number of days from today (use negative for past, positive for future)', '30')
  .option('-m, --meeting-types <types>', 'Comma-separated meeting types (e.g., "Gemeenteraad,Commissie Ruimte")')
  .option('-c, --include-cancelled', 'Include cancelled meetings')
  .option('--max <number>', 'Maximum number of meetings to return')
  .option('-o, --output <file>', 'Output discovered meetings to JSON file')
  .action(async (options) => {
    try {
      const rateLimitMs = parseInt(process.env.HTTP_RATE_LIMIT || '1000');
      const discovery = new MeetingDiscovery(rateLimitMs);
      
      // Parse date options
      let fromDate: Date | undefined;
      let toDate: Date | undefined;
      
      if (options.from) {
        fromDate = new Date(options.from);
        if (isNaN(fromDate.getTime())) {
          console.error('Invalid from date format. Use YYYY-MM-DD');
          process.exit(1);
        }
      } else if (options.days) {
        const days = parseInt(options.days);
        if (days < 0) {
          // Past meetings
          fromDate = new Date();
          fromDate.setDate(fromDate.getDate() + days); // days is negative
          toDate = new Date();
        } else {
          // Future meetings
          fromDate = new Date();
          toDate = new Date();
          toDate.setDate(toDate.getDate() + days);
        }
      }
      
      if (options.to) {
        toDate = new Date(options.to);
        if (isNaN(toDate.getTime())) {
          console.error('Invalid to date format. Use YYYY-MM-DD');
          process.exit(1);
        }
      }
      
      const meetingTypes = options.meetingTypes ? 
        options.meetingTypes.split(',').map((t: string) => t.trim()) : 
        undefined;
      
      console.log('🔍 Discovering meetings...');
      console.log(`   Date range: ${fromDate?.toISOString().split('T')[0] || 'open'} to ${toDate?.toISOString().split('T')[0] || 'open'}`);
      if (meetingTypes) {
        console.log(`   Meeting types: ${meetingTypes.join(', ')}`);
      }
      
      const meetings = await discovery.discoverMeetings({
        fromDate,
        toDate,
        meetingTypes,
        includeCancelled: options.includeCancelled,
        includeAll: true
      });
      
      // Limit results if specified
      const limitedMeetings = options.max ? meetings.slice(0, parseInt(options.max)) : meetings;
      
      // Output to file if specified
      if (options.output) {
        await fs.writeFile(options.output, JSON.stringify(limitedMeetings, null, 2));
        console.log(`📁 Saved ${limitedMeetings.length} meetings to ${options.output}`);
      }
      
      // Display results
      console.log(`\n📊 Discovery Results: ${limitedMeetings.length} meetings found`);
      
      const stats = discovery.getMeetingStats(limitedMeetings);
      console.log(`   Cancelled: ${stats.cancelled}`);
      console.log(`   Types: ${Object.entries(stats.byType).map(([type, count]) => `${type} (${count})`).join(', ')}`);
      
      // Show first few meetings
      const preview = limitedMeetings.slice(0, 5);
      if (preview.length > 0) {
        console.log(`\n📅 Preview (first ${preview.length}):`);
        for (const meeting of preview) {
          const cancelledFlag = meeting.cancelled ? ' [CANCELLED]' : '';
          console.log(`   ${meeting.date} - ${meeting.meetingType}${cancelledFlag}`);
          console.log(`     ${meeting.title} (${meeting.location})`);
          console.log(`     URL: ${meeting.agendaUrl}`);
        }
        
        if (limitedMeetings.length > preview.length) {
          console.log(`   ... and ${limitedMeetings.length - preview.length} more`);
        }
      }
      
    } catch (error) {
      console.error('Discovery error:', error);
      process.exit(1);
    }
  });

program
  .command('auto')
  .description('Discover and automatically process meetings')
  .option('-f, --from <date>', 'Start date (YYYY-MM-DD)')
  .option('-t, --to <date>', 'End date (YYYY-MM-DD)')
  .option('-d, --days <number>', 'Number of days from today (negative for past, positive for future)', '30')
  .option('-m, --meeting-types <types>', 'Comma-separated meeting types')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('-r, --rate-limit <ms>', 'Rate limit in milliseconds', '1000')
  .option('-g, --grace-window <sec>', 'Alignment grace window in seconds', '0.35')
  .option('-s, --skip-existing', 'Skip if output file already exists')
  .option('--simplified', 'Use simplified JSON output format')
  .option('-c, --continue-on-error', 'Continue processing even if individual meetings fail')
  .option('--max-meetings <number>', 'Maximum number of meetings to process')
  .action(async (options) => {
    try {
      const scraper = new LansingerlandScraper(
        parseInt(options.rateLimit),
        parseFloat(options.graceWindow),
        options.output
      );
      
      // Parse date options (same logic as discover command)
      let fromDate: Date | undefined;
      let toDate: Date | undefined;
      
      if (options.from) {
        fromDate = new Date(options.from);
      } else if (options.days) {
        const days = parseInt(options.days);
        if (days < 0) {
          fromDate = new Date();
          fromDate.setDate(fromDate.getDate() + days);
          toDate = new Date();
        } else {
          fromDate = new Date();
          toDate = new Date();
          toDate.setDate(toDate.getDate() + days);
        }
      }
      
      if (options.to) {
        toDate = new Date(options.to);
      }
      
      const meetingTypes = options.meetingTypes ? 
        options.meetingTypes.split(',').map((t: string) => t.trim()) : 
        undefined;
      
      console.log('🚀 Auto-discovering and processing meetings...');
      
      const { discovered, results } = await scraper.discoverAndProcess({
        fromDate,
        toDate,
        meetingTypes,
        skipExisting: options.skipExisting,
        simplified: options.simplified,
        continueOnError: options.continueOnError,
        maxMeetings: options.maxMeetings ? parseInt(options.maxMeetings) : undefined
      });
      
      const successful = results.filter(r => r.success).length;
      const failed = results.length - successful;
      const withVideo = results.filter(r => r.videoAvailable).length;
      
      console.log(`\n📊 Auto-Processing Results:`);
      console.log(`   Discovered: ${discovered.length} meetings`);
      console.log(`   Processed: ${results.length} meetings`);
      console.log(`   ✅ Successful: ${successful}`);
      console.log(`   ❌ Failed: ${failed}`);
      console.log(`   🎥 With video: ${withVideo}`);
      console.log(`   📄 Total segments: ${results.reduce((sum, r) => sum + r.transcriptSegments, 0)}`);
      
      if (failed > 0 && !options.continueOnError) {
        process.exit(1);
      }
    } catch (error) {
      console.error('Auto-processing error:', error);
      process.exit(1);
    }
  });

program
  .command('scrape')
  .description('Scrape a single agenda URL')
  .argument('<url>', 'Agenda URL to scrape')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('-r, --rate-limit <ms>', 'Rate limit in milliseconds', '1000')
  .option('-g, --grace-window <sec>', 'Alignment grace window in seconds', '0.35')
  .option('-s, --skip-existing', 'Skip if output file already exists')
  .option('--simplified', 'Use simplified JSON output format')
  .action(async (url, options) => {
    try {
      const scraper = new LansingerlandScraper(
        parseInt(options.rateLimit), 
        parseFloat(options.graceWindow),
        options.output
      );
      
      const result = await scraper.scrapeAgenda(url, {
        skipExisting: options.skipExisting,
        simplified: options.simplified
      });

      if (result.success) {
        console.log(`✅ Success: ${result.outputFile}`);
        console.log(`   Meeting ID: ${result.meetingId}`);
        console.log(`   Video available: ${result.videoAvailable}`);
        console.log(`   Transcript segments: ${result.transcriptSegments}`);
      } else {
        console.error(`❌ Failed: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error('Scraper error:', error);
      process.exit(1);
    }
  });

program
  .command('batch')
  .description('Scrape multiple agenda URLs from a file')
  .argument('<file>', 'File containing agenda URLs (one per line)')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('-r, --rate-limit <ms>', 'Rate limit in milliseconds', '1000')
  .option('-g, --grace-window <sec>', 'Alignment grace window in seconds', '0.35')
  .option('-s, --skip-existing', 'Skip if output file already exists')
  .option('--simplified', 'Use simplified JSON output format')
  .option('-c, --continue-on-error', 'Continue processing even if individual URLs fail')
  .action(async (file, options) => {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const urls = content.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && line.startsWith('http'));

      if (urls.length === 0) {
        console.error('No valid URLs found in file');
        process.exit(1);
      }

      console.log(`Processing ${urls.length} URLs from ${file}`);

      const scraper = new LansingerlandScraper(
        parseInt(options.rateLimit),
        parseFloat(options.graceWindow),
        options.output
      );

      const results = await scraper.scrapeMultiple(urls, {
        skipExisting: options.skipExisting,
        simplified: options.simplified,
        continueOnError: options.continueOnError
      });

      const successful = results.filter(r => r.success).length;
      const failed = results.length - successful;

      console.log(`\n📊 Batch Results:`);
      console.log(`   Total: ${results.length}`);
      console.log(`   ✅ Successful: ${successful}`);
      console.log(`   ❌ Failed: ${failed}`);

      if (failed > 0 && !options.continueOnError) {
        process.exit(1);
      }
    } catch (error) {
      console.error('Batch processing error:', error);
      process.exit(1);
    }
  });

// Initialize logs directory
(async () => {
  try {
    await fs.mkdir('logs', { recursive: true });
  } catch {
    // Directory already exists
  }
})();

if (require.main === module) {
  program.parse();
}