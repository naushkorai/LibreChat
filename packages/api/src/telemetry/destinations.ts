import { logger } from '@librechat/data-schemas';
import { extractEnvVariable } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { RunConfig } from '@librechat/agents';
import { resolveLangfuseHeaders } from '~/langfuse/utils';

type OtlpTraceDestination = NonNullable<
  NonNullable<RunConfig['langfuse']>['otlpDestinations']
>[number];
/** `TCustomConfig` is a `DeepPartial`, so every field, `type` included, may be absent. */
type ConfiguredDestination = NonNullable<AppConfig['traceDestinations']>[number];

const MIXPANEL_HOSTS = {
  us: 'ingestion-us.mixpanel.com',
  eu: 'ingestion-eu.mixpanel.com',
  in: 'ingestion-in.mixpanel.com',
} as const;
const MIXPANEL_TRACES_PATH = '/v1/ai/otel/traces';

function resolveValue(value: string | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  const resolved = extractEnvVariable(value).trim();
  return resolved === '' || resolved.includes('${') ? undefined : resolved;
}

function resolveMixpanelDestination(
  destination: Extract<ConfiguredDestination, { type?: 'mixpanel' }>,
): OtlpTraceDestination | undefined {
  const projectToken = resolveValue(destination.projectToken);
  if (projectToken == null) {
    logger.warn('[traceDestinations] Skipping Mixpanel: projectToken is empty or unset.');
    return undefined;
  }
  const endpoint =
    resolveValue(destination.endpoint) ??
    `https://${MIXPANEL_HOSTS[destination.region ?? 'us']}${MIXPANEL_TRACES_PATH}`;
  return {
    endpoint,
    headers: { Authorization: `Basic ${Buffer.from(`${projectToken}:`).toString('base64')}` },
    captureContent: destination.captureContent === true,
  };
}

function resolveOtlpDestination(
  destination: Extract<ConfiguredDestination, { type?: 'otlp' }>,
): OtlpTraceDestination | undefined {
  const endpoint = resolveValue(destination.endpoint);
  if (endpoint == null) {
    logger.warn('[traceDestinations] Skipping OTLP destination: endpoint is empty or unset.');
    return undefined;
  }
  const headers = resolveLangfuseHeaders(destination.headers);
  return {
    endpoint,
    ...(headers != null ? { headers } : {}),
    captureContent: destination.captureContent === true,
  };
}

/** Resolves `traceDestinations` into agent run OTLP destinations; temporary chats get none. */
export function resolveTraceDestinations(
  appConfig: AppConfig | undefined,
  isTemporary?: boolean,
): OtlpTraceDestination[] | undefined {
  const configured = appConfig?.traceDestinations;
  if (isTemporary === true || configured == null || configured.length === 0) {
    return undefined;
  }
  const destinations: OtlpTraceDestination[] = [];
  for (const destination of configured) {
    let resolved: OtlpTraceDestination | undefined;
    if (destination.type === 'mixpanel') {
      resolved = resolveMixpanelDestination(destination);
    } else if (destination.type === 'otlp') {
      resolved = resolveOtlpDestination(destination);
    }
    if (resolved != null) {
      destinations.push(resolved);
    }
  }
  return destinations.length > 0 ? destinations : undefined;
}
