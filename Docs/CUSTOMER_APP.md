# BORJIE Customer App

## Overview

The Customer App is a mobile-first web application designed for tenants/renters to manage their tenancy, make payments, submit maintenance requests, and communicate with property management.

## Features

### Dashboard
- Welcome greeting with personalized content
- Quick stats: unit number, lease expiry countdown, open maintenance tickets
- Upcoming payment card with breakdown and quick pay action
- Quick action buttons for common tasks
- Recent activity feed

### Lease Management
- Lease overview with key dates and terms
- Property and unit information
- Financial summary (rent, deposit, due dates)
- Registered occupants list
- Document library (lease agreement, inspection reports, house rules)
- Lease expiry warnings with renewal request capability

### Payments
- Current balance due with breakdown
- Payment history with status indicators
- Multiple payment methods (M-Pesa, Card, Bank Transfer)
- Payment method management
- Statement access and download
- Quick pay workflow with M-Pesa STK push integration

### Maintenance Requests
- Submit new maintenance requests with:
  - Category selection
  - Priority indication (with SLA expectations)
  - Description and location
  - Photo upload
  - Entry permission management
- View open and closed requests
- Real-time status tracking
- SLA status visibility
- Scheduled visit information
- Technician contact
- Rating and feedback submission

### Notifications
- Multi-category notifications:
  - Payment reminders and confirmations
  - Maintenance updates
  - Lease expiry alerts
  - Document availability
  - Announcements
- Read/unread status management
- Notification preferences

## Technical Architecture

### Framework
- Next.js 14 with App Router
- TypeScript for type safety
- Tailwind CSS for styling

### State Management
- React hooks for local state
- Zustand for global state (if needed)

### API Integration
- @borjie/api-client package
- RESTful API communication
- JWT authentication

### Mobile-First Design
- Responsive layouts optimized for mobile
- Bottom navigation for thumb-friendly access
- Safe area handling for notched devices
- Touch-optimized interactions

### Offline Support (Future)
- Service worker for caching
- Offline-first maintenance submission
- Background sync for pending actions

## User Flows

### Payment Flow
1. User views balance on dashboard or payments page
2. Clicks "Pay Now"
3. Reviews payment summary
4. Selects payment method (M-Pesa default)
5. Confirms phone number
6. Initiates payment (STK push)
7. Enters M-Pesa PIN on phone
8. Receives confirmation

### Maintenance Request Flow
1. User clicks "Report Issue" from dashboard or maintenance page
2. Selects issue category
3. Indicates urgency level (sees SLA expectations)
4. Provides title and description
5. Specifies location in unit
6. Optionally uploads photos
7. Grants/denies entry permission
8. Submits request
9. Receives confirmation with work order number
10. Tracks progress through status updates
11. Receives notification when scheduled
12. Rates service upon completion

## Security Considerations

- JWT-based authentication
- Tenant isolation enforced at API level
- Sensitive data (ID numbers) masked in UI
- HTTPS-only communication
- Input validation on all forms

## Performance Targets

- First Contentful Paint: < 1.5s
- Time to Interactive: < 3s
- Lighthouse Score: > 90

## Deployment

- Static export with Next.js
- CDN distribution
- Environment-based configuration
- Feature flags for gradual rollout
