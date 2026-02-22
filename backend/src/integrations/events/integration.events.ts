export class IntegrationConnectedEvent {
  static readonly EVENT_NAME = 'integration.connected';

  constructor(
    public readonly connectionId: string,
    public readonly provider: string,
    public readonly credentialType: string,
    public readonly organizationId: string,
    public readonly userId: string,
    public readonly isReconnect: boolean,
    public readonly region?: string,
  ) {}
}
