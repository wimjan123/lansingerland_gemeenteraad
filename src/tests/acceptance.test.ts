#!/usr/bin/env node

import { AgendaScraper } from '../scraper/AgendaScraper';
import { WebcastResolver } from '../scraper/WebcastResolver';
import { VTTProcessor } from '../scraper/VTTProcessor';
import { TranscriptAligner } from '../alignment/TranscriptAligner';
import { JSONTranscriptBuilder } from '../builders/JSONTranscriptBuilder';
import { logger } from '../utils/logger';

interface TestCase {
  name: string;
  agendaUrl: string;
  expectedWebcastCode: string;
  expectedUuid: string;
  expectedVttTrack: string;
  expectVideoAvailable: boolean;
}

class AcceptanceTests {
  private agendaScraper: AgendaScraper;
  private webcastResolver: WebcastResolver;
  private vttProcessor: VTTProcessor;
  private transcriptAligner: TranscriptAligner;
  private jsonBuilder: JSONTranscriptBuilder;

  constructor() {
    this.agendaScraper = new AgendaScraper(2000); // Slower rate for tests
    this.webcastResolver = new WebcastResolver(2000);
    this.vttProcessor = new VTTProcessor();
    this.transcriptAligner = new TranscriptAligner();
    this.jsonBuilder = new JSONTranscriptBuilder();
  }

  async runAllTests(): Promise<void> {
    console.log('🧪 Starting Lansingerland Scraper Acceptance Tests\n');

    const testCases: TestCase[] = [
      {
        name: 'March 27, 2025 Council Meeting',
        agendaUrl: 'https://lansingerland.bestuurlijkeinformatie.nl/Agenda/Index/8f592da7-0c24-41ac-9423-c4cbe40252a0',
        expectedWebcastCode: 'gemeentelansingerland_20250327_1',
        expectedUuid: 'fcdc1d3a-0bbb-4bee-9e33-3b1bc449b8a3',
        expectedVttTrack: 'NLcorrectie',
        expectVideoAvailable: true
      },
      {
        name: 'May 22, 2025 Council Meeting (if available)',
        agendaUrl: 'https://lansingerland.bestuurlijkeinformatie.nl/Agenda/Index/ef1cb62f-dbee-46b8-bb53-79890b0262f3',
        expectedWebcastCode: 'gemeentelansingerland_20250522_1',
        expectedUuid: 'ef1cb62f-dbee-46b8-bb53-79890b0262f3',
        expectedVttTrack: 'NLcorrectie',
        expectVideoAvailable: true
      }
    ];

    let passedTests = 0;
    let totalTests = 0;

    for (const testCase of testCases) {
      console.log(`\n📋 ${testCase.name}`);
      console.log('='.repeat(50));
      
      try {
        const success = await this.runTestCase(testCase);
        if (success) {
          passedTests++;
          console.log('✅ PASS');
        } else {
          console.log('❌ FAIL');
        }
      } catch (error) {
        console.log(`❌ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      
      totalTests++;
    }

    console.log('\n' + '='.repeat(50));
    console.log(`📊 Test Results: ${passedTests}/${totalTests} passed`);
    
    if (passedTests === totalTests) {
      console.log('🎉 All acceptance tests passed!');
      process.exit(0);
    } else {
      console.log('💥 Some tests failed');
      process.exit(1);
    }
  }

  private async runTestCase(testCase: TestCase): Promise<boolean> {
    const checks: Array<{ name: string; passed: boolean; details?: any }> = [];

    try {
      // Test 1: Agenda Scraping
      console.log('🔍 Testing agenda scraping...');
      const meetingData = await this.agendaScraper.scrapeAgenda(testCase.agendaUrl);
      
      checks.push({
        name: 'Agenda data extracted',
        passed: !!meetingData.title && !!meetingData.date,
        details: { 
          title: meetingData.title, 
          date: meetingData.date,
          agendaItems: meetingData.agendaItems.length
        }
      });

      checks.push({
        name: 'Webcast code extracted',
        passed: meetingData.webcastCode === testCase.expectedWebcastCode,
        details: { 
          expected: testCase.expectedWebcastCode, 
          actual: meetingData.webcastCode
        }
      });

      if (!testCase.expectVideoAvailable) {
        // For future meetings, just check agenda extraction
        checks.push({
          name: 'Future meeting handling',
          passed: !meetingData.webcastCode,
          details: 'Meeting is in the future, no webcast expected'
        });
        
        this.printCheckResults(checks);
        return checks.every(c => c.passed);
      }

      // Test 2: Webcast Resolution
      console.log('🎬 Testing webcast resolution...');
      const webcastInfo = await this.webcastResolver.getWebcastInfo(testCase.expectedWebcastCode);
      
      checks.push({
        name: 'Webcast UUID resolved',
        passed: webcastInfo.id === testCase.expectedUuid,
        details: { 
          expected: testCase.expectedUuid, 
          actual: webcastInfo.id
        }
      });

      // Test 3: VTT Track Listing
      console.log('📝 Testing VTT track listing...');
      const vttTracks = await this.webcastResolver.listVTTTracks(webcastInfo.id);
      
      checks.push({
        name: 'VTT tracks found',
        passed: vttTracks.length > 0,
        details: { 
          tracks: vttTracks.map(t => t.id),
          count: vttTracks.length
        }
      });

      const expectedTrack = vttTracks.find(t => t.id.toLowerCase().includes(testCase.expectedVttTrack.toLowerCase()));
      checks.push({
        name: 'Expected VTT track found',
        passed: !!expectedTrack,
        details: { 
          expected: testCase.expectedVttTrack,
          available: vttTracks.map(t => t.id)
        }
      });

      // Test 4: VTT Download and Parsing
      if (expectedTrack) {
        console.log('⬇️  Testing VTT download and parsing...');
        const vttContent = await this.webcastResolver.downloadVTT(webcastInfo.id, expectedTrack);
        
        checks.push({
          name: 'VTT content downloaded',
          passed: vttContent.startsWith('WEBVTT') && vttContent.length > 1000,
          details: { 
            size: vttContent.length,
            startsWithWebVTT: vttContent.startsWith('WEBVTT')
          }
        });

        const vttCues = this.vttProcessor.parseVTT(vttContent);
        checks.push({
          name: 'VTT cues parsed',
          passed: vttCues.length > 50, // Expect reasonable number of cues
          details: { 
            cueCount: vttCues.length,
            firstCue: vttCues[0] ? { start: vttCues[0].start, text: vttCues[0].text.substring(0, 50) } : null
          }
        });

        // Test 5: Speaker Alignment
        console.log('👥 Testing speaker alignment...');
        const segments = this.transcriptAligner.alignTranscript(vttCues, meetingData.agendaItems);
        
        checks.push({
          name: 'Transcript segments created',
          passed: segments.length > 0,
          details: { 
            segmentCount: segments.length,
            alignedSpeakers: segments.filter(s => s.speaker_name).length
          }
        });

        const alignedSpeakers = segments.filter(s => s.speaker_name).length;
        const speakerAlignmentRate = alignedSpeakers / segments.length;
        
        checks.push({
          name: 'Speaker alignment rate acceptable',
          passed: speakerAlignmentRate > 0.3, // At least 30% should have speakers
          details: { 
            alignmentRate: `${Math.round(speakerAlignmentRate * 100)}%`,
            alignedSegments: alignedSpeakers,
            totalSegments: segments.length
          }
        });

        // Test 6: JSON Generation
        console.log('📄 Testing JSON generation...');
        const transcriptJSON = this.jsonBuilder.buildTranscriptJSON(
          meetingData,
          webcastInfo,
          segments,
          expectedTrack
        );

        checks.push({
          name: 'JSON structure valid',
          passed: transcriptJSON.format_version === '1.0' && 
                  transcriptJSON.video && 
                  Array.isArray(transcriptJSON.segments),
          details: { 
            formatVersion: transcriptJSON.format_version,
            hasVideo: !!transcriptJSON.video,
            segmentCount: transcriptJSON.segments.length
          }
        });

        // Test 7: Simplified JSON Format
        console.log('📋 Testing simplified JSON format...');
        const simplifiedJSON = this.jsonBuilder.buildSimplifiedJSON(
          meetingData,
          segments,
          testCase.agendaUrl,
          true
        );

        checks.push({
          name: 'Simplified JSON format valid',
          passed: simplifiedJSON.meeting_id && 
                  simplifiedJSON.agenda &&
                  Array.isArray(simplifiedJSON.transcript),
          details: { 
            meetingId: simplifiedJSON.meeting_id,
            agendaItems: simplifiedJSON.agenda?.length,
            transcriptItems: simplifiedJSON.transcript?.length
          }
        });
      }

    } catch (error) {
      console.log(`💥 Test case failed with error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }

    this.printCheckResults(checks);
    return checks.every(c => c.passed);
  }

  private printCheckResults(checks: Array<{ name: string; passed: boolean; details?: any }>): void {
    for (const check of checks) {
      const status = check.passed ? '✅' : '❌';
      console.log(`  ${status} ${check.name}`);
      
      if (check.details && !check.passed) {
        console.log(`     Details: ${JSON.stringify(check.details, null, 2)}`);
      } else if (check.details && process.env.VERBOSE_TESTS) {
        console.log(`     Details: ${JSON.stringify(check.details, null, 2)}`);
      }
    }
  }

  async testAgendaDiscovery(): Promise<void> {
    console.log('\n🔍 Testing agenda discovery patterns...');
    
    // Test various agenda URL patterns
    const testUrls = [
      'https://lansingerland.bestuurlijkeinformatie.nl/Agenda/Index/8f592da7-0c24-41ac-9423-c4cbe40252a0'
    ];

    for (const url of testUrls) {
      try {
        console.log(`\n📄 Testing: ${url}`);
        const meetingData = await this.agendaScraper.scrapeAgenda(url);
        console.log(`  ✅ Title: ${meetingData.title}`);
        console.log(`  ✅ Date: ${meetingData.date}`);
        console.log(`  ✅ Agenda items: ${meetingData.agendaItems.length}`);
        console.log(`  ✅ Webcast code: ${meetingData.webcastCode || 'none'}`);
        
        const totalSpeakers = meetingData.agendaItems.reduce((sum, item) => sum + item.speakers.length, 0);
        console.log(`  ✅ Total speakers: ${totalSpeakers}`);
        
      } catch (error) {
        console.log(`  ❌ Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  async testWebcastEndpoints(): Promise<void> {
    console.log('\n🎬 Testing Company Webcast API endpoints...');
    
    const testCodes = [
      'gemeentelansingerland_20250327_1',
      'gemeentelansingerland_20250522_1'
    ];

    for (const code of testCodes) {
      try {
        console.log(`\n🧪 Testing webcast code: ${code}`);
        
        // Test info endpoint
        const info = await this.webcastResolver.getWebcastInfo(code);
        console.log(`  ✅ Info resolved: ${info.id}`);
        console.log(`  ✅ Label: ${info.label}`);
        console.log(`  ✅ Phase: ${info.phase}`);
        
        // Test VTT listing
        const tracks = await this.webcastResolver.listVTTTracks(info.id);
        console.log(`  ✅ VTT tracks: ${tracks.length}`);
        
        for (const track of tracks) {
          console.log(`    📝 ${track.id} (${track.path}, modified: ${track.lastModified})`);
        }
        
        // Test VTT download
        if (tracks.length > 0) {
          const bestTrack = this.webcastResolver.getBestVTTTrack(tracks);
          if (bestTrack) {
            const vttContent = await this.webcastResolver.downloadVTT(info.id, bestTrack);
            console.log(`  ✅ VTT downloaded: ${vttContent.length} bytes`);
            
            const validation = this.vttProcessor.validateVTT(vttContent);
            console.log(`  ${validation.valid ? '✅' : '❌'} VTT valid: ${validation.valid}`);
            if (!validation.valid) {
              console.log(`    Errors: ${validation.errors.join(', ')}`);
            }
          }
        }
        
      } catch (error) {
        console.log(`  ❌ Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }
}

// Main test runner
if (require.main === module) {
  const tests = new AcceptanceTests();
  
  const args = process.argv.slice(2);
  
  if (args.includes('--discovery')) {
    tests.testAgendaDiscovery().catch(console.error);
  } else if (args.includes('--webcast')) {
    tests.testWebcastEndpoints().catch(console.error);
  } else {
    tests.runAllTests().catch(console.error);
  }
}