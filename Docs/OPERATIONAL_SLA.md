# BORJIE Operational SLA Configuration

## Overview

This document defines the Service Level Agreements (SLAs) for maintenance work orders across the BORJIE platform. These SLAs ensure timely response and resolution of tenant issues while providing visibility into operational performance.

## Work Order Priority Levels

### Emergency Priority
- **Response Time Target:** 30 minutes
- **Resolution Time Target:** 4 hours
- **Auto-escalation After:** 1 hour
- **Examples:** Water leaks causing flooding, no electricity, security breaches, gas leaks

### High Priority
- **Response Time Target:** 2 hours
- **Resolution Time Target:** 24 hours
- **Auto-escalation After:** 4 hours
- **Examples:** Major appliance failure, HVAC issues in extreme weather, plumbing backups

### Medium Priority
- **Response Time Target:** 8 hours
- **Resolution Time Target:** 72 hours
- **Auto-escalation After:** 24 hours
- **Examples:** Minor plumbing issues, appliance repairs, electrical issues (non-safety)

### Low Priority
- **Response Time Target:** 24 hours
- **Resolution Time Target:** 7 days
- **Auto-escalation After:** 48 hours
- **Examples:** Cosmetic repairs, minor maintenance, general improvements

## SLA Definitions

### Response Time
Time from work order submission to first acknowledgment/triage by the operations team.

**Measured as:**
- `respondedAt` - `submittedAt`
- Clock pauses when SLA is explicitly paused (e.g., waiting for customer input)

### Resolution Time
Time from work order submission to completion of work.

**Measured as:**
- `resolvedAt` - `submittedAt` - `pausedDurationMinutes`
- Excludes time when SLA is paused

## SLA Pause Conditions

SLA timers may be paused under the following conditions:

1. **Waiting for Customer Access**
   - Customer not available for scheduled appointment
   - Entry permission pending

2. **Waiting for Parts**
   - Required materials not in stock
   - Special order items needed

3. **Waiting for Vendor**
   - External contractor coordination required

4. **Waiting for Approval**
   - Cost exceeds pre-approved threshold
   - Requires owner/management approval

## Escalation Matrix

### Level 1 Escalation
- **Trigger:** Response/Resolution approaching SLA breach
- **Action:** Notify assigned technician and property manager
- **Timeline:** 75% of SLA time elapsed

### Level 2 Escalation
- **Trigger:** SLA breached or Level 1 unresolved
- **Action:** Notify operations manager and reassign if needed
- **Timeline:** SLA breach + 1 hour

### Level 3 Escalation
- **Trigger:** Emergency unresolved or Level 2 unresolved
- **Action:** Notify senior management, mandatory status call
- **Timeline:** SLA breach + 4 hours

## Performance Targets

### Response Compliance
- **Target:** 95% of work orders responded within SLA
- **Acceptable:** 90%
- **Requires Action:** Below 85%

### Resolution Compliance
- **Target:** 90% of work orders resolved within SLA
- **Acceptable:** 85%
- **Requires Action:** Below 80%

### Customer Satisfaction
- **Target:** 4.5/5 average rating
- **Acceptable:** 4.0/5
- **Requires Action:** Below 3.5/5

## Reporting Cadence

### Real-time Dashboard
- SLA health check (at-risk and breached work orders)
- Active work order count by priority
- Current response/resolution rates

### Daily Report
- Work orders opened/closed
- SLA breaches
- Technician utilization

### Weekly Report
- SLA compliance rates by priority
- Trend analysis
- Top breach categories

### Monthly Report
- Overall SLA performance
- Customer satisfaction scores
- Vendor performance review
- Cost analysis

## Integration with Apps

### Customer App
- Real-time status updates on maintenance requests
- SLA targets displayed to set expectations
- Push notifications for status changes

### Estate Manager App
- SLA countdown timers on work orders
- At-risk indicators for proactive management
- One-tap escalation capability
- Performance dashboard access

## Configuration Management

SLA configurations are managed at the tenant level and can be customized per property. Changes to SLA configurations:

1. Require admin approval
2. Take effect for new work orders only
3. Are logged in audit trail
4. Trigger notification to operations team

## Audit and Compliance

All SLA-related events are logged:
- Work order state transitions
- SLA timer starts/pauses/resumes
- Breach events
- Escalation triggers
- Configuration changes

Logs are retained for 7 years for compliance purposes.
