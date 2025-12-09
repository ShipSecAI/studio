import { Global, Module } from '@nestjs/common';

import { TraceService } from './trace.service';
import { TraceRepository } from './trace.repository';
import { LogStreamRepository } from './log-stream.repository';
import { LogStreamService } from './log-stream.service';
import { DatabaseModule } from '../database/database.module';
import { LogIngestService } from '../logging/log-ingest.service';
import { EventIngestService } from '../events/event-ingest.service';
import { AgentTraceIngestService } from '../agent-trace/agent-trace-ingest.service';
import { AgentTraceRepository } from '../agent-trace/agent-trace.repository';
import { AgentTraceService } from '../agent-trace/agent-trace.service';

const ingestServicesEnabled =
  (process.env.ENABLE_INGEST_SERVICES ?? 'true') === 'true' &&
  process.env.SKIP_INGEST_SERVICES !== 'true';

const ingestServices = ingestServicesEnabled
  ? [LogIngestService, EventIngestService, AgentTraceIngestService]
  : [];

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    TraceRepository,
    TraceService,
    LogStreamRepository,
    LogStreamService,
    AgentTraceRepository,
    AgentTraceService,
    ...ingestServices,
  ],
  exports: [
    TraceService,
    TraceRepository,
    LogStreamRepository,
    LogStreamService,
    AgentTraceRepository,
    AgentTraceService,
  ],
})
export class TraceModule {}
