import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { logger } from './logger';

export class HttpClient {
  private client: AxiosInstance;
  private rateLimitDelay: number;
  private lastRequestTime: number = 0;

  constructor(rateLimitMs: number = 1000) {
    this.rateLimitDelay = rateLimitMs;
    this.client = axios.create({
      timeout: 30000,
      headers: {
        'User-Agent': process.env.WEBCAST_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    // Add request interceptor for rate limiting
    this.client.interceptors.request.use(async (config) => {
      await this.enforceRateLimit();
      return config;
    });

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`HTTP ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`);
        return response;
      },
      (error) => {
        const status = error.response?.status || 'NETWORK_ERROR';
        logger.error(`HTTP ${status} ${error.config?.method?.toUpperCase()} ${error.config?.url}: ${error.message}`);
        return Promise.reject(error);
      }
    );
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.rateLimitDelay) {
      const delay = this.rateLimitDelay - timeSinceLastRequest;
      logger.debug(`Rate limiting: waiting ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastRequestTime = Date.now();
  }

  async get(url: string, config?: AxiosRequestConfig) {
    return this.client.get(url, config);
  }

  async post(url: string, data?: any, config?: AxiosRequestConfig) {
    return this.client.post(url, data, config);
  }

  /**
   * Make request with Company Webcast specific headers
   */
  async getWebcast(url: string, config?: AxiosRequestConfig) {
    const webcastConfig = {
      ...config,
      headers: {
        ...config?.headers,
        'Referer': process.env.WEBCAST_REFERER || 'https://lansingerland.bestuurlijkeinformatie.nl/',
        'Accept': 'application/json,text/plain,*/*'
      }
    };
    
    return this.client.get(url, webcastConfig);
  }

  /**
   * Retry mechanism for requests
   */
  async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries) {
          logger.error(`Request failed after ${maxRetries} attempts: ${lastError.message}`);
          throw lastError;
        }
        
        const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
        logger.warn(`Request failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms: ${lastError.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError!;
  }
}