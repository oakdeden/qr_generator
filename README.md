# Airtable QR Code Generator & Avery 5160 / 88560 Label Exporter

A professional, marketplace-ready Airtable Extension built with `@airtable/blocks` and Tailwind CSS that generates custom QR codes directly in your Airtable bases and prints them onto standard Avery label sheets.

---

## Key Features

1. **Auto-Generate & Insert QR Codes into Columns**:
   - Saves high-resolution QR code PNG images directly into an Airtable **Attachment** field.
   - Saves raw payloads or image links to **Single line text / URL** columns.
   - **Non-destructive update guard**: Never overwrites or regenerates QR codes for records that already have them set.
   - **Rate-limit compliant batch processing**: Intelligently processes in controlled batches (15 records at a time) with progress tracking.
   - **Auto-Sync mode**: Automatically detects and populates newly added or unset records.

2. **Avery Template 88560 & 5160 Label Sheet Printing**:
   - Precision layout for standard **Avery 88560**, **5160**, **8160**, **8460**, **5260**, **5960**, **6570**:
     - **30 labels per sheet** (3 columns × 10 rows) on standard US Letter (8.5" × 11").
     - **Label size**: 2-5/8" × 1.0" (2.625" × 1.0").
     - **Margins**: Top/Bottom 0.5", Left/Right 0.1875", Column gap 0.125", Row gap 0".
   - **4 Layout Presets**:
     - *QR Left + Text Right* (Standard retail & inventory barcode format)
     - *Text Left + QR Right*
     - *QR Center + Text Bottom*
     - *Large QR Code Only*
   - **Partial Sheet Saver**: Skip previously used labels (starting at any label from 1 to 30) to avoid wasting sticker paper.
   - **Quantity Multiplier**: Print 1 label per record or multiply by a numeric stock/inventory column.
   - **Native 1-Click Print & PDF**: Uses dedicated print stylesheets (`@media print`) matching Avery physical dimensions.

3. **Custom QR Styling & PNG Downloads**:
   - Customizable Foreground and Background colors with instant live preview.
   - Configurable Error Correction Levels (L: 7%, M: 15%, Q: 25%, H: 30%).
   - Direct high-resolution (512×512) PNG download.

4. **Robust Enterprise & Marketplace Polish**:
   - **Persistent Configuration**: User preferences, selected columns, and styling sync to Airtable `globalConfig` and persist across reloads.
   - **Strict Permissions Handling**: Respects base collaborator roles (`table.hasPermissionToUpdateRecords()`), rendering read-only notices and cleanly disabling write actions for viewers/commenters.
   - **Pure React SVG Rendering**: Zero use of `dangerouslySetInnerHTML`, ensuring full CSP compliance and maximum security.
   - **Empty State Handling**: Gracefully handles bases with no tables, tables with no records, and empty Avery print queues.
   - **Native Settings Button Integration**: Connected to Airtable's extension gear icon (`useSettingsButton`) for quick styling access.

---

## Airtable Marketplace Reviewer & QA Guide

### 1. Extension Information
- **Name**: QR Code Generator & Avery Labels
- **Short Description**: Generate QR codes directly into attachment columns and print Avery 5160 / 88560 label sheets.
- **Categories**: Productivity, Inventory & Assets, Utilities
- **Keywords**: QR code, barcode, avery, labels, 5160, 88560, print, inventory, stickers, generator

### 2. Required Scopes & Permissions
| Scope | Purpose |
| :--- | :--- |
| `data.records:read` | Read record values and IDs to encode into QR code payloads. |
| `data.records:write` | Write generated QR code images (attachments) or text/URLs into designated table columns. |
| `schema.bases:read` | Inspect tables, column types, and field options for UI selectors and permission validation. |

### 3. External Services Disclosure
- **Service Name**: QR Server API (`https://api.qrserver.com/v1/create-qr-code/`)
- **Protocol**: HTTPS (Strict TLS)
- **Usage**: When a user selects an **Attachment** field as the target column, the extension supplies Airtable with a publicly accessible HTTPS image URL (`api.qrserver.com`) so Airtable's background worker can fetch and store the image file into Airtable's attachment CDN.
- **Privacy & Local Execution**: All live in-app QR previews, SVG rendering, Avery label printing, and 512×512 PNG downloads run **100% locally and privately in the browser** using client-side QR algorithms. No record data is tracked, stored, or logged externally.

### 4. Reviewer Testing Instructions

#### Test 1: Empty Base & Edge Cases
1. Open the extension in a brand-new base with **0 tables**.
   - *Expected*: Friendly "No Tables Found" empty state screen.
2. Create an empty table with **0 records**.
   - *Expected*: Live preview table indicates "No records found in this table" and Avery print tab shows "No records to print".

#### Test 2: Read-Only Collaborator Permissions
1. Open the extension as a base collaborator with **Read-Only / Commenter** access.
   - *Expected*: Warning banner appears informing the collaborator of read-only access. Batch generation and single row insert buttons are cleanly disabled. Live preview, Avery sheet printing, and PNG downloads remain fully functional.

#### Test 3: Insert QR Codes to Column
1. Create a table with a Primary text column (e.g. `SKU`) and an **Attachment** column (e.g. `QR Code`).
2. Add 3-5 rows with sample values (e.g. `PROD-001`, `PROD-002`).
3. In the extension:
   - Select `SKU` as the Source Column.
   - Select `QR Code` as the Target Column.
4. Click **Generate Missing (X Unset)**.
   - *Expected*: Progress bar appears. QR codes are written into Airtable's Attachment column. The status switches to "All QR Codes Set". Clicking generate again will not re-write or duplicate existing attachments.

#### Test 4: Avery 5160 / 88560 Sheet Printing
1. Switch to the **Export to Avery 5160 / 8160** tab.
2. Select layout (e.g. `QR Left + Text Right`), title field, and subtitle field.
3. Test the **Start Label #** input (e.g. set to `5` to skip the first 4 labels on a partially used sheet).
4. Click **Print Label Sheet**.
   - *Expected*: Browser print dialog opens with 30-up Avery label alignment.

---

## Avery 88560 / 5160 Print Settings

When printing from Google Chrome, Safari, or Microsoft Edge:
- **Destination**: Select physical label printer or "Save as PDF"
- **Paper Size**: `Letter` (8.5 × 11 in)
- **Scale**: `100%` or `Actual Size` *(Do NOT select "Fit to Printable Area" or "Fit to Page")*
- **Margins**: `None` or `Minimum`
- **Headers and Footers**: Unchecked

---

## Local Development & Release

### Install & Run
```bash
npm install
npm start   # Runs local block development server on https://localhost:9000
```

### Run Linter
```bash
npm run lint
```

### Release Build
```bash
npm run build # Runs block release for marketplace deployment
```
