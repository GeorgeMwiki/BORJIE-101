# BORJIE Estate Manager App

## Overview

The Estate Manager App is a mobile-first web application designed for property managers and field technicians to manage work orders, conduct inspections, track SLA compliance, and coordinate maintenance operations.

## Features

### Dashboard
- Daily task summary with urgency indicators
- SLA performance metrics (response rate, resolution rate)
- Today's schedule preview
- Recent alerts (SLA breaches, escalations, new assignments)
- Quick access to urgent tasks

### Work Order Management

#### Task Board (List View)
- Filterable work order list
- Search functionality
- Status-based filtering
- Priority indicators
- SLA countdown timers
- Assignment information

#### Task Board (Kanban View)
- Visual workflow management
- Drag-and-drop status updates
- Column-based organization:
  - New (Submitted/Triaged)
  - Assigned/Scheduled
  - In Progress
  - Completed

#### Work Order Details
- Complete issue description
- Customer contact information
- Location details
- Photo evidence
- Entry instructions
- SLA status with timers
- Activity timeline
- Action buttons:
  - Start Work
  - Complete
  - Pause (with reason)
  - Escalate
  - Reschedule

### Inspection Management

#### Inspection List
- Upcoming and completed inspections
- Type indicators (Move-in, Move-out, Routine, Annual)
- Date and time scheduling
- Condition ratings for completed

#### Inspection Workflow (Future Enhancement)
- Standardized checklists
- Room-by-room assessment
- Photo capture
- Condition ratings
- Issue flagging
- Signature capture
- Report generation

### Schedule View

#### Daily Timeline
- Visual calendar view
- Time-slot based task display
- Color-coded by priority
- Duration indicators
- Quick navigation between days
- Week overview option

### SLA Dashboard

#### Key Metrics
- Response compliance rate with trend
- Resolution compliance rate with trend
- Average response time
- Average resolution time

#### Performance by Priority
- Compliance rate per priority level
- Actual vs target times
- Ticket counts

#### Weekly Trend Chart
- Visual compliance trend
- Color-coded performance indicators

#### Active Breaches
- List of currently breached work orders
- Breach type and duration
- Quick action access

#### SLA Configuration Reference
- Current SLA targets by priority
- Response, resolution, escalation times

## Technical Architecture

### Framework
- Next.js 14 with App Router
- TypeScript for type safety
- Tailwind CSS for styling

### State Management
- React hooks for local state
- Zustand for global state (if needed)
- SWR for data fetching and caching

### API Integration
- @borjie/api-client package
- RESTful API communication
- JWT authentication

### Mobile-First Design
- Responsive layouts for field use
- Bottom navigation
- Large touch targets
- Quick action buttons

### Offline Capabilities (Future)
- Service worker caching
- Offline work order viewing
- Queued status updates
- Background sync

## User Flows

### Start Work Flow
1. Manager views assigned task
2. Reviews customer info and location
3. Contacts customer if needed
4. Taps "Start Work"
5. Performs maintenance
6. Takes completion photos
7. Enters completion notes
8. Taps "Complete"
9. Work order closes

### Inspection Flow
1. Manager sees scheduled inspection
2. Arrives at unit
3. Starts inspection
4. Works through checklist areas
5. Rates each item
6. Takes photos as needed
7. Notes issues requiring follow-up
8. Records overall condition
9. Captures signatures
10. Completes inspection
11. System generates report

### SLA Management Flow
1. Manager views SLA dashboard
2. Identifies at-risk work orders
3. Reviews breach details
4. Takes corrective action:
   - Reassigns if needed
   - Escalates if blocked
   - Pauses SLA if waiting
5. Documents actions
6. Monitors resolution

## Security Considerations

- Role-based access control
- Tenant isolation
- Audit logging of all actions
- Secure customer data handling
- Location tracking (with consent)

## Performance Targets

- First Contentful Paint: < 2s
- Time to Interactive: < 4s
- Offline-capable core features
- Works on 3G networks

## Deployment

- Static export with Next.js
- CDN distribution
- Environment-based configuration
- Feature flags for gradual rollout
