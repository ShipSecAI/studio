-- ClickHouse schema initialization
-- This runs automatically on first container startup via /docker-entrypoint-initdb.d/

CREATE TABLE IF NOT EXISTS security_findings (
    -- Primary identifiers
    organization_id LowCardinality(String),
    finding_hash String,

    -- Timestamps (DoubleDelta codec: ~90% compression on sorted timestamps)
    timestamp DateTime64(3) CODEC(DoubleDelta, ZSTD(3)),
    ingested_at DateTime64(3) DEFAULT now64(3) CODEC(DoubleDelta, ZSTD(3)),

    -- Materialized partition key — computed from timestamp, zero storage overhead vs DateTime64
    event_date Date MATERIALIZED toDate(timestamp) CODEC(Delta, ZSTD(3)),

    -- Workflow context
    workflow_id String DEFAULT '',
    workflow_name String DEFAULT '',
    run_id String DEFAULT '',
    node_ref String DEFAULT '',
    component_id LowCardinality(String) DEFAULT '',

    -- Asset context
    asset_key String DEFAULT '',

    -- Trigger context
    trigger_source String DEFAULT '',
    trigger_type String DEFAULT '',

    -- Scan context
    repository String DEFAULT '',
    branch String DEFAULT '',
    commit_sha String DEFAULT '',
    account_id String DEFAULT '',
    connection_name String DEFAULT '',
    provider LowCardinality(String) DEFAULT '',

    -- Finding core fields
    scanner LowCardinality(String) DEFAULT '',
    severity LowCardinality(String) DEFAULT '',
    status LowCardinality(String) DEFAULT '',
    title String DEFAULT '',
    description String DEFAULT '',
    rule_id String DEFAULT '',
    check_name String DEFAULT '',
    check_id String DEFAULT '',
    region LowCardinality(String) DEFAULT '',
    service_name LowCardinality(String) DEFAULT '',
    ip String DEFAULT '',
    file String DEFAULT '',
    source_input String DEFAULT '',
    compliance Array(String) DEFAULT [],
    line UInt32 DEFAULT 0 CODEC(T64, ZSTD(3)),
    snippet String DEFAULT '',
    resource_tags Map(String, String) DEFAULT map(),

    -- All other dynamic fields as JSON
    extra JSON DEFAULT '{}',

    -- Skip indexes for filtered queries
    INDEX idx_scanner scanner TYPE set(20) GRANULARITY 1,
    INDEX idx_severity severity TYPE set(10) GRANULARITY 1,
    INDEX idx_status status TYPE set(10) GRANULARITY 1,
    INDEX idx_rule_id rule_id TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_asset_key asset_key TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_file file TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_check_name check_name TYPE bloom_filter(0.01) GRANULARITY 4,
    -- Full-text indexes
    INDEX idx_title title TYPE tokenbf_v1(10240, 3, 0) GRANULARITY 4,
    INDEX idx_description description TYPE tokenbf_v1(10240, 3, 0) GRANULARITY 4,

    -- Projections for alternative sort orders (auto-selected by optimizer)
    PROJECTION proj_by_severity (
        SELECT organization_id, severity, status, scanner, timestamp, finding_hash
        ORDER BY (organization_id, severity, timestamp)
    ),
    PROJECTION proj_by_scanner (
        SELECT organization_id, scanner, severity, status, timestamp, finding_hash
        ORDER BY (organization_id, scanner, timestamp)
    ),
    PROJECTION proj_severity_counts (
        SELECT organization_id, severity, status, count() AS cnt, max(timestamp) AS latest
        GROUP BY organization_id, severity, status
    )
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (organization_id, timestamp, finding_hash)
TTL timestamp + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192,
         default_compression_codec = 'ZSTD(3)',
         min_age_to_force_merge_seconds = 3600;

CREATE TABLE IF NOT EXISTS security_findings_latest (
    organization_id LowCardinality(String),
    finding_hash String,
    timestamp DateTime64(3) CODEC(DoubleDelta, ZSTD(3)),
    ingested_at DateTime64(3) DEFAULT now64(3) CODEC(DoubleDelta, ZSTD(3)),
    workflow_id String DEFAULT '',
    workflow_name String DEFAULT '',
    run_id String DEFAULT '',
    node_ref String DEFAULT '',
    component_id LowCardinality(String) DEFAULT '',
    asset_key String DEFAULT '',
    trigger_source String DEFAULT '',
    trigger_type String DEFAULT '',
    repository String DEFAULT '',
    branch String DEFAULT '',
    commit_sha String DEFAULT '',
    account_id String DEFAULT '',
    connection_name String DEFAULT '',
    provider LowCardinality(String) DEFAULT '',
    scanner LowCardinality(String) DEFAULT '',
    severity LowCardinality(String) DEFAULT '',
    status LowCardinality(String) DEFAULT '',
    title String DEFAULT '',
    description String DEFAULT '',
    rule_id String DEFAULT '',
    check_name String DEFAULT '',
    check_id String DEFAULT '',
    region LowCardinality(String) DEFAULT '',
    service_name LowCardinality(String) DEFAULT '',
    ip String DEFAULT '',
    file String DEFAULT '',
    source_input String DEFAULT '',
    compliance Array(String) DEFAULT [],
    line UInt32 DEFAULT 0 CODEC(T64, ZSTD(3)),
    snippet String DEFAULT '',
    resource_tags Map(String, String) DEFAULT map(),
    extra JSON DEFAULT '{}',

    -- Skip indexes
    INDEX idx_scanner scanner TYPE set(20) GRANULARITY 1,
    INDEX idx_severity severity TYPE set(10) GRANULARITY 1,
    INDEX idx_status status TYPE set(10) GRANULARITY 1,
    INDEX idx_rule_id rule_id TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_asset_key asset_key TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_file file TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_check_name check_name TYPE bloom_filter(0.01) GRANULARITY 4,
    -- Full-text indexes
    INDEX idx_title title TYPE tokenbf_v1(10240, 3, 0) GRANULARITY 4,
    INDEX idx_description description TYPE tokenbf_v1(10240, 3, 0) GRANULARITY 4,

    -- Aggregate projection for dashboard counts
    PROJECTION proj_latest_counts (
        SELECT organization_id, severity, status, scanner, count() AS cnt
        GROUP BY organization_id, severity, status, scanner
    )
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY organization_id
ORDER BY (organization_id, finding_hash)
SETTINGS index_granularity = 8192,
         default_compression_codec = 'ZSTD(3)',
         min_age_to_force_merge_seconds = 3600,
         deduplicate_merge_projection_mode = 'rebuild';

CREATE MATERIALIZED VIEW IF NOT EXISTS security_findings_latest_mv
TO security_findings_latest
AS SELECT * FROM security_findings;
