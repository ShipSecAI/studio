-- Drop the old approval_requests table (v1, no legacy data)
DROP TABLE IF EXISTS approval_requests;

-- Drop old enum
DROP TYPE IF EXISTS approval_status;

-- Create new enum for human input status
CREATE TYPE human_input_status AS ENUM ('pending', 'resolved', 'expired', 'cancelled');

-- Create new enum for input types
CREATE TYPE human_input_type AS ENUM ('approval', 'form', 'selection', 'review', 'acknowledge');

-- Human Input Requests table - generalized HITL system
CREATE TABLE human_input_requests (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Workflow context
  run_id TEXT NOT NULL,
  workflow_id UUID NOT NULL,
  node_ref TEXT NOT NULL,
  
  -- Status
  status human_input_status NOT NULL DEFAULT 'pending',
  
  -- Input type and schema
  input_type human_input_type NOT NULL DEFAULT 'approval',
  input_schema JSONB NOT NULL DEFAULT '{}',
  
  -- Display metadata
  title TEXT NOT NULL,
  description TEXT,
  context JSONB DEFAULT '{}',
  
  -- Secure token for public links
  resolve_token TEXT NOT NULL UNIQUE,
  
  -- Timeout handling
  timeout_at TIMESTAMPTZ,
  
  -- Response tracking
  response_data JSONB,
  responded_at TIMESTAMPTZ,
  responded_by TEXT,
  
  -- Multi-tenancy
  organization_id VARCHAR(191),
  
  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_human_input_requests_status ON human_input_requests(status);
CREATE INDEX idx_human_input_requests_run_id ON human_input_requests(run_id);
CREATE INDEX idx_human_input_requests_workflow_id ON human_input_requests(workflow_id);
CREATE INDEX idx_human_input_requests_organization_id ON human_input_requests(organization_id);
CREATE INDEX idx_human_input_requests_resolve_token ON human_input_requests(resolve_token);
