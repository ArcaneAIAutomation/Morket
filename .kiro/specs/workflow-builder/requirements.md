# Requirements — Module 8.2: Visual Workflow Builder (Backend)

## Overview
Backend APIs for persisting, versioning, and executing multi-step enrichment workflows. The frontend (React Flow canvas) is planned separately — this module provides the data model and execution engine.

## Functional Requirements

### 8.2.1 Workflow CRUD
- Create/read/update/delete workflows per workspace
- Workflow has a name, description, and a JSON graph definition (nodes + edges)
- Node types: data_source, enrichment_step, filter, output
- Each node has a type, config (provider slug, field mappings, filter rules, output target), and position (x, y for canvas)

### 8.2.2 Workflow Versioning
- Each save creates a new version (immutable snapshots)
- List versions for a workflow
- Rollback to a previous version (copies that version's graph as a new version)

### 8.2.3 Workflow Execution
- Execute a workflow: validate graph, then run nodes in topological order
- Execution creates a workflow_run record tracking status and per-node results
- Execution is async — returns run ID immediately, client polls for status
- Node execution delegates to existing services (enrichment service for enrichment nodes, data-ops for import/export nodes, integration service for CRM output nodes)

### 8.2.4 Workflow Templates
- Pre-built workflow templates (read-only, system-owned)
- Clone a template into a workspace as a new editable workflow

### 8.2.5 Scheduled Execution
- Attach a cron schedule to a workflow (stored in DB, executed by Temporal)
- Enable/disable schedule without deleting

## Non-Functional Requirements
- All endpoints workspace-scoped under /api/v1/workspaces/:id/workflows
- Zod validation on all inputs
- RBAC: member+ for read/execute, owner for create/update/delete
- Graph definition max 50 nodes, 100 edges
