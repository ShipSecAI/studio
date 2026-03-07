import {
  createShipSecClient,
  type ClientConfig,
  type ShipSecApiClient,
} from '../../../packages/backend-client/src/api-client';
import { getBackendOrigin } from './backend-url';

function resolveBaseUrl() {
  return getBackendOrigin();
}

export function createInternalBackendClient(
  config: Omit<ClientConfig, 'middleware'> = {},
): ShipSecApiClient {
  return createShipSecClient({
    baseUrl: config.baseUrl ?? resolveBaseUrl(),
    headers: config.headers,
    middleware: {
      async onRequest({ request }) {
        const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
        if (internalToken && !request.headers.has('X-Internal-Token')) {
          request.headers.set('X-Internal-Token', internalToken);
        }
        return request;
      },
    },
  });
}
