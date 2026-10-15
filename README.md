# Airtable QR Code Generator & Avery 88560 Label Exporter

A custom Airtable Extension (Block) built with `@airtable/blocks` and Tailwind CSS that:
1. **Generates QR Codes** from any field (SKU, Product ID, URL, formula, or record link) with optional prefix/suffix.
2. **Applies QR Codes to Column**:
   - Saves high-resolution QR code PNG images directly into an Airtable **Attachment** field.
   - Optionally saves the raw QR payload or image URL to a **Text / URL** column.
   - Supports individual row generation or 1-click **batch generation** (with progress tracking and rate-limit handling).
3. **Exports to Avery Template 88560**:
   - Pixel-perfect layout for standard **Avery 88560** (and 5160 / 8160 / 8460 / 5260 / 5960 / 6570):
     - **30 labels per sheet** (3 columns × 10 rows) on US Letter (8.5" × 11").
     - **Label size**: 2-5/8" wide × 1.0" tall (2.625" × 1.0").
     - **Margins**: Top/Bottom 0.5", Left/Right 0.1875", Column gap 0.125", Row gap 0".
   - **Label Design Presets**:
     - *QR Left + Text Right* (Industry standard product label)
     - *Text Left + QR Right*
     - *QR Center + Text Bottom*
     - *Large QR Code Only*
   - **Partial Sheet Saver**: Choose starting label # (1 to 30) to print on partially-used Avery sheets without wasting labels.
   - **Quantity Multiplier**: Print 1 per record or multiply by a numeric inventory/stock field.
   - **1-Click Print & PDF Export**: Native browser print trigger (`window.print()`) with print CSS tuned for Avery label sheets.

---

## Getting Started

### 1. Install Dependencies (Already configured)
```bash
npm install
```

### 2. Link Extension to your Airtable Base
In your Airtable base:
1. Click **Extensions** > **Add an extension** > **Build a custom extension**.
2. Copy the extension identifier (format: `appXXXXXXXX/blkXXXXXXXX`).
3. In this directory, run:
```bash
block set-api-key <YOUR_AIRTABLE_PERSONAL_ACCESS_TOKEN>
# or configure .block/remote.json
```

### 3. Run Locally
```bash
npm start
# or: block run
```
Then paste the local URL (`https://localhost:9000`) into Airtable's extension developer settings.

---

## Avery 88560 Printing Instructions
When printing from Chrome, Safari, or Edge:
- **Destination**: Printer or "Save as PDF"
- **Paper Size**: `Letter (8.5 x 11 inches)`
- **Scale**: `100%` or `Actual Size` (do NOT use "Fit to Page")
- **Margins**: `None` or `0`
- **Headers and Footers**: Unchecked
