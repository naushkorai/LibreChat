import type { AppConfig } from '@librechat/data-schemas';
import { resolveTraceDestinations } from './destinations';
import { buildLangfuseConfig } from '~/langfuse/config';

const basic = (token: string) => `Basic ${Buffer.from(`${token}:`).toString('base64')}`;
const withDestinations = (traceDestinations: AppConfig['traceDestinations']) =>
  ({ traceDestinations }) as AppConfig;

describe('resolveTraceDestinations', () => {
  afterEach(() => {
    delete process.env.MIXPANEL_PROJECT_TOKEN;
    delete process.env.COLLECTOR_TOKEN;
  });

  it('sends Mixpanel traces to US ingestion with Basic token auth and no content by default', () => {
    expect(
      resolveTraceDestinations(withDestinations([{ type: 'mixpanel', projectToken: 'abc123' }])),
    ).toEqual([
      {
        endpoint: 'https://ingestion-us.mixpanel.com/v1/ai/otel/traces',
        headers: { Authorization: basic('abc123') },
        captureContent: false,
      },
    ]);
  });

  it('reads the project token from the environment and honors the region', () => {
    process.env.MIXPANEL_PROJECT_TOKEN = 'from-env';

    const [destination] =
      resolveTraceDestinations(
        withDestinations([
          { type: 'mixpanel', projectToken: '${MIXPANEL_PROJECT_TOKEN}', region: 'eu' },
        ]),
      ) ?? [];

    expect(destination.endpoint).toBe('https://ingestion-eu.mixpanel.com/v1/ai/otel/traces');
    expect(destination.headers).toEqual({ Authorization: basic('from-env') });
  });

  it('skips a Mixpanel destination whose token variable is unset', () => {
    expect(
      resolveTraceDestinations(
        withDestinations([{ type: 'mixpanel', projectToken: '${MIXPANEL_PROJECT_TOKEN}' }]),
      ),
    ).toBeUndefined();
  });

  it('passes a generic OTLP endpoint through with interpolated headers and opt-in content', () => {
    process.env.COLLECTOR_TOKEN = 'secret';

    expect(
      resolveTraceDestinations(
        withDestinations([
          {
            type: 'otlp',
            endpoint: 'https://collector.internal/v1/traces',
            headers: { Authorization: 'Bearer ${COLLECTOR_TOKEN}' },
            captureContent: true,
          },
        ]),
      ),
    ).toEqual([
      {
        endpoint: 'https://collector.internal/v1/traces',
        headers: { Authorization: 'Bearer secret' },
        captureContent: true,
      },
    ]);
  });

  it('exports nothing for temporary chats', () => {
    expect(
      resolveTraceDestinations(
        withDestinations([{ type: 'mixpanel', projectToken: 'abc123' }]),
        true,
      ),
    ).toBeUndefined();
  });
});

describe('buildLangfuseConfig with trace destinations', () => {
  const appConfig = withDestinations([{ type: 'mixpanel', projectToken: 'abc123' }]);

  afterEach(() => {
    delete process.env.LANGFUSE_TRACING_ENABLED;
  });

  it('adds the destinations to the run even when Langfuse is not configured', () => {
    expect(buildLangfuseConfig({ appConfig, runId: 'run-1' }).otlpDestinations).toEqual([
      expect.objectContaining({ endpoint: 'https://ingestion-us.mixpanel.com/v1/ai/otel/traces' }),
    ]);
  });

  it('keeps the destinations when Langfuse tracing is switched off', () => {
    process.env.LANGFUSE_TRACING_ENABLED = 'false';

    const langfuse = buildLangfuseConfig({ appConfig, runId: 'run-1' });

    expect(langfuse.enabled).toBe(false);
    expect(langfuse.otlpDestinations).toHaveLength(1);
  });

  it('leaves temporary chats without destinations', () => {
    expect(
      buildLangfuseConfig({ appConfig, runId: 'run-1', isTemporary: true }).otlpDestinations,
    ).toBeUndefined();
  });
});
