# Reports and Analytics Service

Report generation, scheduling, storage, and delivery for the BORJIE platform.

## Features

- **Report Generation**: Financial (rent roll, income statement, cash flow), occupancy, maintenance, tenant, property performance
- **Output Formats**: PDF (pdfkit), Excel (exceljs), CSV
- **Scheduled Reports**: BullMQ-based cron scheduling
- **Storage**: In-memory (dev) or pluggable S3/filesystem
- **Email Delivery**: Nodemailer integration for report delivery

## Installation

```bash
pnpm install
```

## Build

```bash
pnpm build
```

## Usage

### Quick Start

```typescript
import {
  createReportService,
  InMemoryReportStorage,
  MockReportDataProvider,
} from '@borjie/reports-service';

const service = createReportService({
  dataProvider: new MockReportDataProvider(),
});

// Generate report
const { reportId, content } = await service.generateReport(
  'financial',
  { tenantId: 'tenant-1', dateRange: { start: new Date('2025-01-01'), end: new Date('2025-01-31') } },
  'pdf'
);

// List reports
const reports = await service.listReports({ tenantId: 'tenant-1' });

// Get report by ID
const result = await service.getReport(reportId!);
```

### With Scheduler and Email Delivery

```typescript
import {
  ReportGenerationService,
  ReportScheduler,
  InMemoryReportStorage,
  EmailDeliveryService,
  createReportJobProcessor,
} from '@borjie/reports-service';

const storage = new InMemoryReportStorage();
const scheduler = new ReportScheduler({ redis: { host: 'localhost', port: 6379 } });
const transporter = EmailDeliveryService.createTransporter();

const service = new ReportGenerationService({
  dataProvider: myDataProvider,
  storage,
  scheduler,
  persistReports: true,
});

// Schedule recurring report (e.g. every Monday 9am)
const { scheduleId } = await service.scheduleReport(
  'financial',
  { tenantId: 'tenant-1' },
  { cron: '0 9 * * 1', recipients: ['manager@example.com'], format: 'pdf' }
);

// Cancel schedule
await service.cancelSchedule(scheduleId);

// Start job processor (run in worker process)
const worker = createReportJobProcessor(
  (tenantId, reportType, params, format) =>
    service.generateReport(reportType, { ...params, tenantId }, format).then((r) => r.content),
  storage,
  new EmailDeliveryService(transporter)
);
```

### Report Types

| Type        | Description                                      |
| ----------- | ------------------------------------------------- |
| `financial` | Rent roll, income statement, cash flow           |
| `occupancy` | Occupancy rates, vacancies by property           |
| `maintenance` | Work orders, costs, SLA compliance             |
| `tenant`    | Tenant list, arrears, lease expiry                |
| `property`  | Property performance metrics                      |

### Formats

- `pdf` - PDF via PDFKit
- `excel` - Excel (.xlsx) via ExcelJS
- `csv` - CSV export

## Environment Variables

- `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` - Redis for BullMQ
- `SMTP_HOST` - SMTP server host
- `SMTP_PORT` - SMTP port (default: 587)
- `SMTP_SECURE` - Use TLS
- `SMTP_USER` / `SMTP_PASS` - SMTP credentials

## Structure

```
src/
├── index.ts                    # Main exports, createReportService
├── report-generation-service.ts
├── generators/
│   ├── generator.interface.ts  # IReportGenerator, ReportData
│   ├── pdf-generator.ts
│   ├── excel-generator.ts
│   └── csv-generator.ts
├── reports/
│   ├── financial-report.ts
│   ├── occupancy-report.ts
│   ├── maintenance-report.ts
│   ├── tenant-report.ts
│   └── property-report.ts
├── scheduler/
│   ├── scheduler.ts           # ReportScheduler
│   └── job-processor.ts      # createReportJobProcessor
├── storage/
│   ├── storage.ts             # IReportStorage, InMemoryReportStorage
│   └── delivery.ts            # EmailDeliveryService
└── data-provider.interface.ts # IReportDataProvider
```
