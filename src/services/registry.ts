import type { ServiceMode, ServiceName } from '../core/config';
import type { SearchService, ServiceRegistry, VisionService } from './contracts';
import { MockKnowledgeService, RemoteKnowledgeService } from './knowledge';
import { MockLLMService, RemoteLLMService } from './llm';
import { BrowserLocationService, MockLocationService } from './location';
import { IndexedDbMemoryService, MockMemoryService } from './memory';
import { MockNewsService, RemoteNewsService } from './news';
import { MockPlacesService, RemotePlacesService } from './places';
import { MockSearchService, RemoteSearchService } from './search';
import { MockSocialService, RemoteSocialService } from './social';
import { MockTranslateService, RemoteTranslateService } from './translate';
import { MockVisionService } from './vision/MockVisionService';
import { OnDeviceVisionService, RemoteVisionService } from './vision/WorkerVisionService';
import { MockVoiceService, WebVoiceService } from './voice';
import { MockWeatherService, OpenMeteoWeatherService } from './weather';

/**
 * VisionProvider factory. Web verification inside the identification
 * pipeline goes through whichever SearchService is configured.
 */
export function createVision(mode: ServiceMode, deps: { search: () => SearchService }): VisionService {
  if (mode === 'ondevice') return new OnDeviceVisionService(deps.search);
  if (mode === 'real') return new RemoteVisionService();
  return new MockVisionService();
}

/** Builds the service graph for the given per-service modes. */
export function createServices(modes: Record<ServiceName, ServiceMode>): ServiceRegistry {
  const real = (n: ServiceName) => modes[n] === 'real';
  const voice = real('voice') ? new WebVoiceService() : new MockVoiceService();
  const search = real('search') ? new RemoteSearchService() : new MockSearchService();
  return {
    vision: createVision(modes.vision, { search: () => search }),
    // Knowledge follows the LLM mode — entity profiles come from the same gateway.
    knowledge: real('llm') ? new RemoteKnowledgeService() : new MockKnowledgeService(),
    places: real('places') ? new RemotePlacesService() : new MockPlacesService(),
    llm: real('llm') ? new RemoteLLMService() : new MockLLMService(),
    search,
    translate: real('translate') ? new RemoteTranslateService() : new MockTranslateService(),
    weather: real('weather') ? new OpenMeteoWeatherService() : new MockWeatherService(),
    news: real('news') ? new RemoteNewsService() : new MockNewsService(),
    location: real('location') ? new BrowserLocationService() : new MockLocationService(),
    voice: voice.sttSupported || voice.mode === 'mock' ? voice : new MockVoiceService(),
    memory: real('memory') ? new IndexedDbMemoryService() : new MockMemoryService(),
    social: real('llm') ? new RemoteSocialService() : new MockSocialService(),
  };
}
