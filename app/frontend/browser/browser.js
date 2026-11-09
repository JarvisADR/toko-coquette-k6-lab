import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';

try {
  const endpoint = `${location.origin}/otel/v1/traces`;
  const exporter = new OTLPTraceExporter({ url: endpoint, timeoutMillis: 10000 });
  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      'service.name': 'petite-bow-frontend',
      'service.version': '1.1.0-trace.2',
      'deployment.environment.name': 'k6-lab',
    }),
    spanProcessors: [new BatchSpanProcessor(exporter, {
      scheduledDelayMillis: 1000, maxExportBatchSize: 64, maxQueueSize: 256,
    })],
  });
  provider.register({ contextManager: new ZoneContextManager() });
  const ignoreUrls = [/\/otel\/v1\/traces(?:[/?]|$)/];
  const sameOriginApi = new RegExp(`^${location.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/api(?:/|$)`);
  const cleanUrl = (span) => {
    for (const key of ['url.full', 'http.url']) {
      const value = span.attributes[key];
      if (typeof value === 'string') {
        try { const u = new URL(value, location.origin); span.setAttribute(key, u.origin + u.pathname); }
        catch { /* Leave non-URL attributes unchanged. */ }
      }
    }
  };
  registerInstrumentations({ instrumentations: [
    new DocumentLoadInstrumentation({ applyCustomAttributesOnSpan: {
      documentLoad: cleanUrl, documentFetch: cleanUrl, resourceFetch: cleanUrl,
    } }),
    new FetchInstrumentation({ ignoreUrls, propagateTraceHeaderCorsUrls: [sameOriginApi],
      ignoreNetworkEvents: true, applyCustomAttributesOnSpan: cleanUrl }),
    new XMLHttpRequestInstrumentation({ ignoreUrls, propagateTraceHeaderCorsUrls: [sameOriginApi],
      ignoreNetworkEvents: true, applyCustomAttributesOnSpan: cleanUrl }),
  ] });
  console.info('OpenTelemetry browser tracing initialized');
} catch (error) {
  // A telemetry problem must not prevent the shop app.js from loading.
  console.warn('Browser tracing unavailable:', error?.message);
}
