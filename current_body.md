This PR implements the foundational **Human-in-the-Loop (HITL)** system for ShipSec AI. It enables workflows to pause execution and wait for human intervention—whether for simple approvals, data collection via forms, or making specific selections.

This is a comprehensive implementation spanning the backend (Temporal, Drizzle, NestJS) and the frontend (Action Center, Workflow Designer).

### Key Features

#### 1. Centralized Action Center
*   A new **Action Center** (`/actions`) that serves as a command center for all manual tasks.
*   Filter tasks by status (Pending, Resolved, Expired).
*   Search and sort by Workflow Run ID, Node Name, or Title.
*   Direct response actions from the table view for quick approvals.

#### 2. Manual Action Components (HITL Nodes)
Implemented a set of specialized nodes for the workflow designer:
*   **Manual Approval**: A binary gate (Approve/Reject) to control workflow flow.
*   **Manual Form**: Generates dynamic UI forms based on configurable JSON Schema. Supports strings, numbers, enums, and booleans.
*   **Manual Selection**: Allows humans to choose from a list of predefined options (single or multiple choice).
*   **Manual Acknowledgment**: A "Mark as Read" style node to ensure human awareness before proceeding.

#### 3. Dynamic Context & Templating
*   **Variable Injection**: Task titles and descriptions can now use dynamic variables (e.g., `{{steps.scan.output.vulnerabilities}}`) to provide humans with the necessary context to make decisions.
*   **Markdown Support**: Full Markdown rendering in task descriptions for rich context display.

#### 4. Robust Backend Architecture
*   **Temporal Integration**: Built using Temporal activities that handle suspension and resumption of workflow execution.
*   **Persistence**: Detailed tracking of requests in Drizzle ORM, including `respondedBy`, `respondedAt`, and full `responseData` payloads.
*   **Timeout Handling**: Support for configurable timeouts, allowing workflows to handle cases where humans don't respond in time.

#### 5. Unified Resolution Framework
*   Created `HumanInputResolutionView`, a "smart" component that handles the entire resolution lifecycle.
*   Seamlessly manages different input types (form, selection, approval) within a consistent, premium UI.
*   Shared across the Action Center and the Workflow Execution Inspector for a unified user experience.

### Technical Implementation Details
*   **Database**: Added `human_input_requests` table with relational support.
*   **API**: RESTful endpoints for internal system and frontend consumption.
*   **Schema**: Leveraging Zod for rigorous DTO validation and OpenAPI generation.
*   **State Management**: Optimized hooks for real-time status updates and interaction handling.

This PR establishes the core capability of "Human-in-the-Loop" which is essential for secure and reliable AI-driven security workflows.
