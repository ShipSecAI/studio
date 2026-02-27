import { CompressionCodecs, CompressionTypes, Kafka, type KafkaConfig } from 'kafkajs';
import SnappyCodec from 'kafkajs-snappy';

let snappyRegistered = false;

function ensureSnappyCodec(): void {
  if (snappyRegistered) {
    return;
  }

  CompressionCodecs[CompressionTypes.Snappy] = SnappyCodec;
  snappyRegistered = true;
}

export function createKafkaClient(config: KafkaConfig): Kafka {
  ensureSnappyCodec();
  return new Kafka(config);
}
