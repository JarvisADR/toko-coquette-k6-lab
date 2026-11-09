'use strict';

const { trace, SpanKind, SpanStatusCode } = require('@opentelemetry/api');

module.exports = function instrumentSqlite(Database) {
  const tracer = trace.getTracer('petite-bow-sqlite', '1.0.0');
  const prepared = Database.prototype.prepare;
  const patched = new WeakSet();

  function describe(sql) {
    const text = String(sql || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').trim();
    const operation = (/^([a-z]+)/i.exec(text)?.[1] || 'QUERY').toUpperCase();
    const match = /\b(?:FROM|INTO|UPDATE|JOIN)\s+["`\[]?([a-z_][a-z0-9_]*)/i.exec(text);
    const table = match?.[1];
    const summary = table ? `${operation} ${table}` : operation;
    return { operation, table, summary };
  }

  function execute(sql, invoke) {
    // Startup/maintenance queries have no application parent and create no spans.
    if (!trace.getActiveSpan()?.isRecording()) return invoke();
    const { operation, table, summary } = describe(sql);
    const attributes = { 'db.system.name': 'sqlite', 'db.namespace': 'toko',
      'db.operation.name': operation, 'db.query.summary': summary };
    if (table) attributes['db.collection.name'] = table;
    return tracer.startActiveSpan(summary, { kind: SpanKind.CLIENT, attributes }, (span) => {
      try { return invoke(); }
      catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.setAttribute('error.type', String(error.code || error.name || 'Error'));
        throw error;
      } finally { span.end(); }
    });
  }

  Database.prototype.prepare = function (...args) {
    const statement = Reflect.apply(prepared, this, args);
    if (patched.has(statement)) return statement;
    patched.add(statement);
    // These synchronous methods cover every query path in the inspected app.
    for (const method of ['run', 'get', 'all']) {
      const original = statement[method];
      Object.defineProperty(statement, method, {
        configurable: true, writable: true,
        value: function (...parameters) {
          return execute(this.source, () => Reflect.apply(original, this, parameters));
        },
      });
    }
    return statement;
  };
  for (const method of ['exec', 'pragma']) {
    const original = Database.prototype[method];
    Database.prototype[method] = function (...args) {
      return execute(args[0], () => Reflect.apply(original, this, args));
    };
  }
};
