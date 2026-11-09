'use strict';

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');

const redactedQueryParams = [
  'token', 'access_token', 'refresh_token', 'password', 'authorization', 'api_key', 'jwt',
];

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || 'http://alloy:4318/v1/traces',
    timeoutMillis: 10000,
  }),
  instrumentations: [
    new HttpInstrumentation({
      redactedQueryParams,
      redactedQueryParamsServer: redactedQueryParams,
      ignoreOutgoingRequestHook: (request) => {
        const host = String(request.hostname || request.host || '');
        return host === 'alloy' || host.startsWith('alloy:');
      },
    }),
    new ExpressInstrumentation({ ignoreLayersType: ['middleware'] }),
  ],
});

sdk.start();
require('./sqlite.cjs')(require('/app/backend/node_modules/better-sqlite3'));
console.log('OpenTelemetry HTTP/Express/SQLite tracing initialized');

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    sdk.shutdown()
      .catch((error) => console.error('OpenTelemetry shutdown:', error.message))
      .finally(() => process.exit(0));
  });
}
