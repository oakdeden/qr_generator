import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { initializeBlock, useBase, useRecords, useSynced, useSession, useSettingsButton } from '@airtable/blocks/base/ui';
import { getQRCodePathData, generateQRCodeDataUrl } from './qr_lib';
import './style.css';

// Avery 88560 standard dimensions: 30 labels per sheet (3 columns x 10 rows)
const LABELS_PER_SHEET = 30;

// Pure React SVG QR Code Component (No dangerouslySetInnerHTML, completely safe & CSP compliant)
function QRCodeSvgComponent({ payload, errorCorrection = 'M', fgColor = '#000000', bgColor = '#ffffff', margin = 1, className, style }) {
    const { size, paths } = useMemo(() => {
        return getQRCodePathData(payload || ' ', { errorCorrection, margin });
    }, [payload, errorCorrection, margin]);

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`0 0 ${size} ${size}`}
            shapeRendering="crispEdges"
            className={className}
            style={style}
        >
            <rect width={size} height={size} fill={bgColor} />
            <path d={paths} fill={fgColor} />
        </svg>
    );
}

// Persistent state hook synchronizing with Airtable globalConfig and falling back to localStorage
function usePersistentState(key, defaultValue) {
    const [syncedValue, setSyncedValue, canSetSyncedValue] = useSynced(`qr_${key}`);
    const [localValue, setLocalValue] = useState(() => {
        try {
            const stored = localStorage.getItem(`airtable_qr_${key}`);
            if (stored !== null) {
                return JSON.parse(stored);
            }
        } catch {
            // ignore
        }
        return defaultValue;
    });

    const isSyncedDefined = syncedValue !== undefined && syncedValue !== null;
    const value = isSyncedDefined ? syncedValue : localValue;

    const setValue = useCallback((updaterOrVal) => {
        const nextVal = typeof updaterOrVal === 'function' ? updaterOrVal(value) : updaterOrVal;
        setLocalValue(nextVal);
        try {
            localStorage.setItem(`airtable_qr_${key}`, JSON.stringify(nextVal));
        } catch {
            // ignore
        }
        if (canSetSyncedValue) {
            setSyncedValue(nextVal);
        }
    }, [canSetSyncedValue, setSyncedValue, value, key]);

    return [value, setValue];
}

function QRGenerator() {
    const base = useBase();
    const session = useSession();
    const tables = useMemo(() => base.tables || [], [base]);

    // Table Selection (Persisted)
    const [selectedTableId, setSelectedTableId] = usePersistentState('tableId', tables[0]?.id || '');
    const table = useMemo(() => {
        return tables.find((t) => t.id === selectedTableId) || tables[0] || null;
    }, [tables, selectedTableId]);

    // Permissions: check if current user has permission to write/update records in this table
    const canUpdateRecords = useMemo(() => {
        if (!table) return false;
        return Boolean(table.hasPermissionToUpdateRecords());
    }, [table]);

    // Wire up Airtable's native block settings button to toggle the styling/designer tab
    useSettingsButton(() => {
        setActiveTab((prev) => (prev === 'designer' ? 'auto-column' : 'designer'));
    });

    const records = useRecords(table || undefined);
    const fields = useMemo(() => (table ? table.fields : []), [table]);

    // Navigation Tabs (Persisted)
    const [activeTab, setActiveTab] = usePersistentState('activeTab', 'auto-column');

    // Source Field (Persisted)
    const [sourceFieldId, setSourceFieldId] = usePersistentState('sourceFieldId', '__airtable_record_url__');
    const effectiveSourceField = useMemo(() => {
        if (sourceFieldId === '__airtable_record_url__') return null;
        if (!fields.length) return null;
        return fields.find((f) => f.id === sourceFieldId) || fields[0];
    }, [fields, sourceFieldId]);

    // Target Column (Persisted)
    const [targetFieldId, setTargetFieldId] = usePersistentState('targetFieldId', '');
    const targetField = useMemo(() => {
        return fields.find((f) => f.id === targetFieldId) || null;
    }, [fields, targetFieldId]);

    // Detect target column capabilities
    const isAttachmentTarget = targetField?.type === 'multipleAttachments';

    // QR Configuration (Persisted)
    const [prefix, setPrefix] = usePersistentState('prefix', '');
    const [suffix, setSuffix] = usePersistentState('suffix', '');
    const [errorCorrection, setErrorCorrection] = usePersistentState('errorCorrection', 'M'); // L, M, Q, H
    const [fgColor, setFgColor] = usePersistentState('fgColor', '#000000');
    const [bgColor, setBgColor] = usePersistentState('bgColor', '#ffffff');

    // Auto-Generate Settings (Persisted)
    const [insertMode, setInsertMode] = usePersistentState('insertMode', 'image-attachment'); // 'image-attachment' | 'payload-text' | 'image-url'
    const [autoSyncEnabled, setAutoSyncEnabled] = usePersistentState('autoSyncEnabled', false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });
    const [syncMessage, setSyncMessage] = useState(null);
    const [inFlightIds, setInFlightIds] = useState(() => new Set());

    // Avery 88560 Print Settings (Persisted)
    const [labelLayout, setLabelLayout] = usePersistentState('labelLayout', 'qr-left'); // 'qr-left' | 'qr-right' | 'qr-center' | 'qr-only'
    const [averyQrSize, setAveryQrSize] = usePersistentState('averyQrSize', 'medium'); // 'compact' | 'medium' | 'large'
    const [titleFieldId, setTitleFieldId] = usePersistentState('titleFieldId', '');
    const [subtitleFieldId, setSubtitleFieldId] = usePersistentState('subtitleFieldId', '');
    const [detailFieldId, setDetailFieldId] = usePersistentState('detailFieldId', '');
    const [quantityFieldId, setQuantityFieldId] = usePersistentState('quantityFieldId', ''); // '' means 1 per record
    const [startLabelNumber, setStartLabelNumber] = usePersistentState('startLabelNumber', 1); // 1-30 for partial sheet reuse

    const qrSizeInches = useMemo(() => {
        if (labelLayout === 'qr-only') return '0.84in';
        if (labelLayout === 'qr-center') return '0.52in';
        if (averyQrSize === 'compact') return '0.60in';
        if (averyQrSize === 'large') return '0.75in';
        return '0.66in'; // standard balanced medium
    }, [labelLayout, averyQrSize]);

    // Single Record Preview selection
    const [previewRecordId, setPreviewRecordId] = useState('');

    // Safe field value getter
    const getFieldValue = useCallback((record, field) => {
        if (!record || !field) return '';
        try {
            const str = record.getCellValueAsString(field.id);
            return str || '';
        } catch {
            return '';
        }
    }, []);

    // Active inspected record
    const previewRecord = useMemo(() => {
        if (!records || !records.length) return null;
        return records.find((r) => r.id === previewRecordId) || records[0];
    }, [records, previewRecordId]);

    // Compute encoded payload for a given record
    const getPayloadForRecord = useCallback((record) => {
        if (!record) return '';
        if (sourceFieldId === '__airtable_record_url__') {
            const url = record.url || (table ? `https://airtable.com/${base.id}/${table.id}/${record.id}` : '');
            return `${prefix}${url}${suffix}`;
        }
        if (!effectiveSourceField) return '';
        const raw = getFieldValue(record, effectiveSourceField);
        return `${prefix}${raw}${suffix}`;
    }, [sourceFieldId, base, table, effectiveSourceField, prefix, suffix, getFieldValue]);

    // Check if a record already has data in the target column
    const recordHasTargetData = useCallback((record) => {
        if (!record || !targetField) return false;
        try {
            const val = record.getCellValue(targetField.id);
            if (val !== null && val !== undefined) {
                if (Array.isArray(val) && val.length > 0) return true;
                if (typeof val === 'string' && val.trim().length > 0) return true;
                if (typeof val === 'number' || typeof val === 'boolean') return true;
                if (typeof val === 'object' && Object.keys(val).length > 0) return true;
            }
            const strVal = record.getCellValueAsString(targetField.id);
            if (strVal && strVal.trim().length > 0) return true;
            return false;
        } catch {
            return false;
        }
    }, [targetField]);

    // Check if a record already has a QR code or is currently in-flight
    const isRecordSet = useCallback((record) => {
        if (!record) return false;
        if (inFlightIds.has(record.id)) return true;
        return recordHasTargetData(record);
    }, [inFlightIds, recordHasTargetData]);

    // Records that need QR codes generated (strictly excludes records that already have QR codes set)
    const missingRecords = useMemo(() => {
        if (!records || !targetField) return [];
        return records.filter((r) => !isRecordSet(r) && getPayloadForRecord(r).trim().length > 0);
    }, [records, targetField, isRecordSet, getPayloadForRecord]);

    // Construct update payload for a record (strictly guards against updating already set records)
    const buildUpdateFields = useCallback((record) => {
        if (!targetField) return null;
        if (isRecordSet(record)) return null;

        const payload = getPayloadForRecord(record);
        if (!payload || !payload.trim()) return null;

        const cleanName = (record.name || 'qr-code').replace(/[^a-zA-Z0-9_-]/g, '_');
        const fgHex = (fgColor || '#000000').replace('#', '');
        const bgHex = (bgColor || '#ffffff').replace('#', '');
        const ecc = errorCorrection || 'M';
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=2&ecc=${ecc}&color=${fgHex}&bgcolor=${bgHex}&data=${encodeURIComponent(payload)}`;

        if (isAttachmentTarget || insertMode === 'image-attachment') {
            return {
                [targetField.id]: [
                    {
                        url: qrImageUrl,
                        filename: `${cleanName}_qr.png`,
                    },
                ],
            };
        }

        if (insertMode === 'image-url') {
            return {
                [targetField.id]: qrImageUrl,
            };
        }

        // Default to raw payload text
        return {
            [targetField.id]: payload,
        };
    }, [targetField, isRecordSet, getPayloadForRecord, fgColor, bgColor, errorCorrection, isAttachmentTarget, insertMode]);

    // Update a single record (strictly prevents recreating records after they are set)
    const handleUpdateSingleRecord = useCallback(async (record) => {
        if (!table || !targetField) {
            setSyncMessage({
                type: 'error',
                text: 'Please select a Target Column first.',
            });
            return;
        }
        if (!canUpdateRecords) {
            const check = table.checkPermissionsForUpdateRecord(record);
            setSyncMessage({
                type: 'error',
                text: check.reasonDisplayString || 'You do not have permission to update records in this table.',
            });
            return;
        }
        if (isRecordSet(record)) {
            setSyncMessage({
                type: 'info',
                text: `QR code is already set for "${record.name || record.id}". It will not be re-generated.`,
            });
            return;
        }
        const fieldsToUpdate = buildUpdateFields(record);
        if (!fieldsToUpdate) return;

        setInFlightIds((prev) => new Set([...prev, record.id]));

        try {
            await table.updateRecordAsync(record, fieldsToUpdate);
            setSyncMessage({
                type: 'success',
                text: `Created QR code for "${record.name || record.id}"!`,
            });
        } catch (err) {
            setInFlightIds((prev) => {
                const next = new Set(prev);
                next.delete(record.id);
                return next;
            });
            console.error(err);
            setSyncMessage({
                type: 'error',
                text: `Failed to update record: ${err.message}`,
            });
        }
    }, [table, targetField, canUpdateRecords, isRecordSet, buildUpdateFields]);

    // Batch Auto-Generate and Insert QR codes (strictly generates only for records where QR codes are not yet set)
    const handleRunBatchInsert = useCallback(async () => {
        if (!table || !targetField || !records || !records.length) {
            setSyncMessage({
                type: 'error',
                text: 'Please select both a Source Field and a Target Column.',
            });
            return;
        }
        if (!canUpdateRecords) {
            const check = table.checkPermissionsForUpdateRecords();
            setSyncMessage({
                type: 'error',
                text: check.reasonDisplayString || 'You do not have permission to update records in this table.',
            });
            return;
        }

        const targets = missingRecords.filter((r) => !isRecordSet(r));
        if (!targets.length) {
            setSyncMessage({
                type: 'success',
                text: 'All records already have QR codes set in the selected column.',
            });
            return;
        }

        setIsSyncing(true);
        setSyncProgress({ current: 0, total: targets.length });
        setSyncMessage(null);

        try {
            const chunkSize = 50; // Airtable batch update limit
            for (let i = 0; i < targets.length; i += chunkSize) {
                const chunk = targets.slice(i, i + chunkSize);
                const updates = [];
                const updatedIds = [];

                for (const rec of chunk) {
                    if (isRecordSet(rec)) continue;
                    const fieldsToUpdate = buildUpdateFields(rec);
                    if (fieldsToUpdate) {
                        updates.push({
                            id: rec.id,
                            fields: fieldsToUpdate,
                        });
                        updatedIds.push(rec.id);
                    }
                }

                if (updates.length > 0) {
                    setInFlightIds((prev) => new Set([...prev, ...updatedIds]));
                    await table.updateRecordsAsync(updates);
                }

                setSyncProgress({
                    current: Math.min(i + chunkSize, targets.length),
                    total: targets.length,
                });
            }

            setSyncMessage({
                type: 'success',
                text: `Successfully created QR codes for ${targets.length} records in "${targetField.name}"! Existing QR codes were preserved.`,
            });
        } catch (err) {
            console.error('Batch insert error:', err);
            setSyncMessage({
                type: 'error',
                text: `Error during batch insert: ${err.message}`,
            });
        } finally {
            setIsSyncing(false);
        }
    }, [table, targetField, records, canUpdateRecords, missingRecords, isRecordSet, buildUpdateFields]);

    // Optional Live Auto-Sync Watcher: strictly executes on records without QR codes and when permissions allow
    const autoSyncTimer = useRef(null);
    useEffect(() => {
        if (!autoSyncEnabled || isSyncing || !canUpdateRecords || !targetField || !table || !missingRecords.length) {
            return;
        }

        clearTimeout(autoSyncTimer.current);
        autoSyncTimer.current = setTimeout(() => {
            handleRunBatchInsert();
        }, 1500);

        return () => clearTimeout(autoSyncTimer.current);
    }, [autoSyncEnabled, isSyncing, canUpdateRecords, targetField, table, missingRecords.length, handleRunBatchInsert]);

    // Download Single QR Code as PNG
    const handleDownloadPng = useCallback(() => {
        const payload = previewRecord ? getPayloadForRecord(previewRecord) : 'AIRTABLE-QR-CODE';
        const dataUrl = generateQRCodeDataUrl(payload || ' ', {
            errorCorrection,
            fgColor,
            bgColor,
            margin: 2,
            width: 512,
        });
        if (!dataUrl) return;
        const link = document.createElement('a');
        link.download = `qr_${(previewRecord?.name || 'code').replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
        link.href = dataUrl;
        link.click();
    }, [previewRecord, getPayloadForRecord, errorCorrection, fgColor, bgColor]);

    // Build flattened labels for Avery 88560 sheets
    const printLabels = useMemo(() => {
        if (!records || !records.length) return [];
        const result = [];

        // Insert blanks for partial sheet saver (1-indexed start label #)
        const skipCount = Math.max(0, startLabelNumber - 1);
        for (let i = 0; i < skipCount; i++) {
            result.push({ isBlank: true, key: `blank-${i}` });
        }

        const titleField = fields.find((f) => f.id === titleFieldId);
        const subtitleField = fields.find((f) => f.id === subtitleFieldId);
        const detailField = fields.find((f) => f.id === detailFieldId);
        const qtyField = fields.find((f) => f.id === quantityFieldId);

        records.forEach((record) => {
            let count = 1;
            if (qtyField) {
                const val = record.getCellValue(qtyField.id);
                const parsed = parseInt(val, 10);
                if (!isNaN(parsed) && parsed > 0) count = Math.min(parsed, 100);
            }

            const payload = getPayloadForRecord(record);
            const title = titleField ? getFieldValue(record, titleField) : record.name || '';
            const subtitle = subtitleField ? getFieldValue(record, subtitleField) : '';
            const detail = detailField ? getFieldValue(record, detailField) : '';

            const qrSvg = generateQRCodeSvg(payload || ' ', {
                errorCorrection,
                fgColor,
                bgColor,
                margin: 1,
            });

            for (let c = 0; c < count; c++) {
                result.push({
                    isBlank: false,
                    key: `${record.id}-${c}`,
                    title,
                    subtitle,
                    detail,
                    payload,
                    qrSvg,
                });
            }
        });

        return result;
    }, [
        records,
        startLabelNumber,
        fields,
        titleFieldId,
        subtitleFieldId,
        detailFieldId,
        quantityFieldId,
        getPayloadForRecord,
        getFieldValue,
        errorCorrection,
        fgColor,
        bgColor,
    ]);

    // Group labels into 30-per-sheet pages for Avery 88560
    const sheets = useMemo(() => {
        const list = [];
        for (let i = 0; i < printLabels.length; i += LABELS_PER_SHEET) {
            list.push(printLabels.slice(i, i + LABELS_PER_SHEET));
        }
        return list;
    }, [printLabels]);

    return (
        <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col">
            {/* Header / Navigation */}
            <header className="no-print bg-white border-b border-gray-200 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 shadow-sm">
                <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center text-white shadow-md">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                        </svg>
                    </div>
                    <div>
                        <h1 className="text-base font-bold text-gray-900 leading-tight">Airtable QR Generator & Avery 5160 / 88560</h1>
                        <p className="text-xs text-gray-500">Auto-generate QR codes into columns and print Avery 5160 / 88560 label sheets</p>
                    </div>
                </div>

                {/* Workflow Tabs */}
                <div className="flex items-center bg-gray-100 p-1 rounded-xl border border-gray-200 text-xs">
                    <button
                        onClick={() => setActiveTab('auto-column')}
                        className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                            activeTab === 'auto-column'
                                ? 'bg-white text-blue-600 shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                        }`}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                        </svg>
                        1. Insert QR Codes to Column
                        {targetField && (
                            missingRecords.length > 0 ? (
                                <span className="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                                    {missingRecords.length} unset
                                </span>
                            ) : (
                                <span className="bg-green-100 text-green-800 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                                    All Set
                                </span>
                            )
                        )}
                    </button>

                    <button
                        onClick={() => setActiveTab('avery-print')}
                        className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                            activeTab === 'avery-print'
                                ? 'bg-white text-blue-600 shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                        }`}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        2. Export to Avery 5160 / 8160 ({printLabels.length})
                    </button>

                    <button
                        onClick={() => setActiveTab('designer')}
                        className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                            activeTab === 'designer'
                                ? 'bg-white text-blue-600 shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                        }`}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        QR Styling
                    </button>
                </div>
            </header>

            {/* Global Table & Source Configuration Bar */}
            <div className="no-print bg-white border-b border-gray-200 px-6 py-3 flex flex-wrap items-center gap-4 text-xs">
                <div className="flex items-center space-x-2">
                    <span className="font-semibold text-gray-700">Table:</span>
                    <select
                        value={selectedTableId}
                        onChange={(e) => {
                            setSelectedTableId(e.target.value);
                            setInFlightIds(new Set());
                            setSourceFieldId('');
                            setTargetFieldId('');
                            setTitleFieldId('');
                            setSubtitleFieldId('');
                        }}
                        className="bg-gray-50 border border-gray-300 text-gray-900 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 font-medium"
                    >
                        {tables.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center space-x-2">
                    <span className="font-semibold text-gray-700">Source Column (Encode):</span>
                    <select
                        value={sourceFieldId}
                        onChange={(e) => setSourceFieldId(e.target.value)}
                        className="bg-gray-50 border border-gray-300 text-gray-900 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 font-medium"
                    >
                        <option value="__airtable_record_url__">
                            🔗 Direct Airtable Record Link (Opens Table &amp; Row)
                        </option>
                        <optgroup label="Encode Column Value">
                            {fields.map((f) => (
                                <option key={f.id} value={f.id}>{f.name} ({f.type})</option>
                            ))}
                        </optgroup>
                    </select>
                </div>

                <div className="flex items-center space-x-2">
                    <span className="font-semibold text-gray-700">Prefix:</span>
                    <input
                        type="text"
                        placeholder="https://... or SKU-"
                        value={prefix}
                        onChange={(e) => setPrefix(e.target.value)}
                        className="bg-gray-50 border border-gray-300 text-gray-900 rounded-lg px-2.5 py-1.5 w-36 focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <div className="flex items-center space-x-2">
                    <span className="font-semibold text-gray-700">Suffix:</span>
                    <input
                        type="text"
                        placeholder="?ref=qr"
                        value={suffix}
                        onChange={(e) => setSuffix(e.target.value)}
                        className="bg-gray-50 border border-gray-300 text-gray-900 rounded-lg px-2.5 py-1.5 w-24 focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <div className="flex items-center space-x-2 ml-auto">
                    <span className="text-gray-500">Total Records:</span>
                    <span className="bg-blue-50 text-blue-700 font-bold px-2.5 py-0.5 rounded-full border border-blue-200">
                        {records?.length || 0}
                    </span>
                </div>
            </div>

            {/* ========================================================= */}
            {/* TAB 1: AUTO-GENERATE & INSERT TO SPECIFIC COLUMN          */}
            {/* ========================================================= */}
            {activeTab === 'auto-column' && (
                <main className="no-print flex-1 p-6 max-w-6xl mx-auto w-full space-y-6">
                    {/* Setup Card */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 space-y-5">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div>
                                <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                                    Insert QR Codes into Column
                                </h2>
                                <p className="text-xs text-gray-500 mt-0.5">
                                    Choose an Attachment column (to save QR images directly) or a Text/URL column
                                </p>
                            </div>

                            {/* Live Watcher Checkbox */}
                            <label className="flex items-center space-x-2 text-xs font-semibold text-gray-700 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-xl cursor-pointer hover:bg-gray-100 transition">
                                <input
                                    type="checkbox"
                                    checked={autoSyncEnabled}
                                    onChange={(e) => setAutoSyncEnabled(e.target.checked)}
                                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                />
                                <span>Auto-Sync new / empty records automatically</span>
                            </label>
                        </div>

                        {/* Column and Mode Selection */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">
                                    1. Target Column (Destination)
                                </label>
                                <select
                                    value={targetFieldId}
                                    onChange={(e) => {
                                        setTargetFieldId(e.target.value);
                                        setInFlightIds(new Set());
                                        const found = fields.find((f) => f.id === e.target.value);
                                        if (found?.type === 'multipleAttachments') {
                                            setInsertMode('image-attachment');
                                        } else if (found?.type === 'url') {
                                            setInsertMode('image-url');
                                        } else {
                                            setInsertMode('payload-text');
                                        }
                                    }}
                                    className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                >
                                    <option value="">-- Choose Target Column --</option>
                                    {fields.map((f) => (
                                        <option key={f.id} value={f.id}>
                                            {f.name} ({f.type})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">
                                    2. Format to Insert
                                </label>
                                <select
                                    value={insertMode}
                                    onChange={(e) => setInsertMode(e.target.value)}
                                    disabled={isAttachmentTarget}
                                    className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-xs text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-75 disabled:bg-gray-100"
                                >
                                    {isAttachmentTarget ? (
                                        <option value="image-attachment">
                                            PNG Image Attachment (Direct file upload)
                                        </option>
                                    ) : (
                                        <>
                                            <option value="payload-text">Raw QR Payload Text (e.g. SKU or URL)</option>
                                            <option value="image-url">Direct QR Image URL (QuickChart / QRServer)</option>
                                            <option value="image-attachment">PNG Attachment (Requires Attachment column)</option>
                                        </>
                                    )}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">
                                    3. Generation Scope
                                </label>
                                <div className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-xs flex items-center justify-between">
                                    <span className="font-semibold text-gray-800">Only Unset Records</span>
                                    <span className="text-[10px] text-green-700 font-bold bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
                                        Preserves Set QRs
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Status Message */}
                        {syncMessage && (
                            <div className={`p-3.5 rounded-xl text-xs font-medium ${
                                syncMessage.type === 'success'
                                    ? 'bg-green-50 text-green-800 border border-green-200'
                                    : syncMessage.type === 'info'
                                    ? 'bg-blue-50 text-blue-800 border border-blue-200'
                                    : 'bg-red-50 text-red-800 border border-red-200'
                            }`}>
                                {syncMessage.text}
                            </div>
                        )}

                        {/* Progress Bar */}
                        {isSyncing && (
                            <div className="space-y-1.5 pt-1">
                                <div className="flex justify-between text-xs text-gray-600 font-semibold">
                                    <span>Inserting QR codes...</span>
                                    <span>{syncProgress.current} / {syncProgress.total}</span>
                                </div>
                                <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                                    <div
                                        className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                                        style={{ width: `${(syncProgress.current / Math.max(1, syncProgress.total)) * 100}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Batch Action Footer */}
                        <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100">
                            <div className="text-xs text-gray-600">
                                {targetField ? (
                                    <>
                                        Target: <strong>{targetField.name}</strong> ({targetField.type}) &bull;{' '}
                                        <span className="text-amber-600 font-semibold">
                                            {missingRecords.length} unset records
                                        </span>
                                    </>
                                ) : (
                                    <span className="text-gray-400 italic">Select a target column above to begin</span>
                                )}
                            </div>

                            <button
                                onClick={handleRunBatchInsert}
                                disabled={isSyncing || !targetField || !records?.length || missingRecords.length === 0}
                                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow transition flex items-center gap-2"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                {isSyncing
                                    ? 'Generating QR Codes...'
                                    : missingRecords.length === 0
                                    ? `All QR Codes Set (${records?.length || 0})`
                                    : `Generate Missing (${missingRecords.length} Unset)`}
                            </button>
                        </div>
                    </div>

                    {/* Records Table Preview */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                            <div>
                                <h3 className="text-sm font-bold text-gray-900">Records & Live QR Preview</h3>
                                <p className="text-xs text-gray-500">Test or generate individual rows or verify before bulk updating</p>
                            </div>
                            <span className="text-xs text-gray-500">Showing first 50 records</span>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-gray-50 text-gray-600 font-semibold border-b border-gray-200">
                                    <tr>
                                        <th className="py-3 px-4">Record Name</th>
                                        <th className="py-3 px-4">
                                            Source Value ({sourceFieldId === '__airtable_record_url__' ? 'Airtable Row URL' : effectiveSourceField?.name})
                                        </th>
                                        <th className="py-3 px-4">QR Preview</th>
                                        <th className="py-3 px-4">Target Column ({targetField?.name || 'Not Selected'})</th>
                                        <th className="py-3 px-4 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 text-gray-700">
                                    {(records || []).slice(0, 50).map((record) => {
                                        const payload = getPayloadForRecord(record);
                                        const isSet = isRecordSet(record);
                                        const isPending = inFlightIds.has(record.id);
                                        const qrSvg = generateQRCodeSvg(payload || ' ', {
                                            errorCorrection,
                                            fgColor,
                                            bgColor,
                                            margin: 1,
                                        });

                                        return (
                                            <tr key={record.id} className="hover:bg-gray-50 transition">
                                                <td className="py-2.5 px-4 font-semibold text-gray-900">
                                                    {record.name || record.id}
                                                </td>
                                                <td className="py-2.5 px-4 font-mono text-[11px] text-gray-600 max-w-xs truncate">
                                                    {payload || <span className="text-gray-300 italic">Empty</span>}
                                                </td>
                                                <td className="py-2 px-4">
                                                    <div
                                                        className="w-9 h-9 border border-gray-200 rounded p-0.5 bg-white shadow-xs"
                                                        dangerouslySetInnerHTML={{ __html: qrSvg }}
                                                    />
                                                </td>
                                                <td className="py-2.5 px-4">
                                                    {!targetField ? (
                                                        <span className="text-gray-400 italic">Select column</span>
                                                    ) : isPending ? (
                                                        <span className="inline-flex items-center gap-1 text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md font-medium border border-blue-200 animate-pulse">
                                                            Setting...
                                                        </span>
                                                    ) : isSet ? (
                                                        <span className="inline-flex items-center gap-1 text-green-700 bg-green-50 px-2 py-0.5 rounded-md font-medium border border-green-200">
                                                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                            </svg>
                                                            Set / Ready
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md font-medium border border-amber-200">
                                                            Unset
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="py-2.5 px-4 text-right">
                                                    {isSet || isPending ? (
                                                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400 bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-lg select-none">
                                                            <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                            </svg>
                                                            Set
                                                        </span>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleUpdateSingleRecord(record)}
                                                            disabled={!targetField || !payload || isSyncing}
                                                            className="px-2.5 py-1 bg-gray-100 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-40 rounded-lg border border-gray-300 text-[11px] font-semibold transition"
                                                        >
                                                            Insert
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </main>
            )}

            {/* ========================================================= */}
            {/* TAB 2: AVERY TEMPLATE 88560 EXPORTER & PRINT SHEET        */}
            {/* ========================================================= */}
            {activeTab === 'avery-print' && (
                <div className="flex-1 flex flex-col">
                    {/* Print Configuration Control Panel */}
                    <div className="no-print bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
                        <div className="max-w-6xl mx-auto space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-base font-bold text-gray-900">Avery 8160 / 5160 Easy Peel Exporter</h2>
                                        <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                                            30 Labels / Sheet &bull; 2-5/8&quot; &times; 1&quot;
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        Compatible with Avery 5160, 8160, 88560, 8460, 5260, 5960, and 6570 on 8.5&quot; &times; 11&quot; Letter paper
                                    </p>
                                </div>

                                <div className="flex items-center space-x-3">
                                    <button
                                        onClick={() => window.print()}
                                        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md flex items-center gap-2 transition"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                        </svg>
                                        Print / Save to PDF ({sheets.length} {sheets.length === 1 ? 'Sheet' : 'Sheets'})
                                    </button>
                                </div>
                            </div>

                            {/* Label Layout & Field Mappings */}
                            <div className="grid grid-cols-2 md:grid-cols-7 gap-2.5 text-xs">
                                <div>
                                    <label className="block text-gray-700 font-bold mb-1">Layout Preset</label>
                                    <select
                                        value={labelLayout}
                                        onChange={(e) => setLabelLayout(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 font-medium"
                                    >
                                        <option value="qr-left">QR Left + Text Right</option>
                                        <option value="qr-right">Text Left + QR Right</option>
                                        <option value="qr-center">QR Center + Text Bottom</option>
                                        <option value="qr-only">Large QR Only</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-gray-700 font-bold mb-1">QR Code Size</label>
                                    <select
                                        value={averyQrSize}
                                        onChange={(e) => setAveryQrSize(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 font-medium"
                                    >
                                        <option value="compact">Compact (0.60&quot; - Max text)</option>
                                        <option value="medium">Standard (0.66&quot; - Balanced)</option>
                                        <option value="large">Large (0.75&quot;)</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-gray-700 font-bold mb-1">Title Field</label>
                                    <select
                                        value={titleFieldId}
                                        onChange={(e) => setTitleFieldId(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="">Primary Field</option>
                                        {fields.map((f) => (
                                            <option key={f.id} value={f.id}>{f.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-gray-700 font-bold mb-1">Subtitle / SKU</label>
                                    <select
                                        value={subtitleFieldId}
                                        onChange={(e) => setSubtitleFieldId(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="">None</option>
                                        {fields.map((f) => (
                                            <option key={f.id} value={f.id}>{f.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-gray-700 font-bold mb-1">Price / Detail</label>
                                    <select
                                        value={detailFieldId}
                                        onChange={(e) => setDetailFieldId(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="">None</option>
                                        {fields.map((f) => (
                                            <option key={f.id} value={f.id}>{f.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-gray-700 font-bold mb-1">Qty Multiplier</label>
                                    <select
                                        value={quantityFieldId}
                                        onChange={(e) => setQuantityFieldId(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="">1 per record</option>
                                        {fields.filter(f => f.type === 'number').map((f) => (
                                            <option key={f.id} value={f.id}>{f.name} (Qty)</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-gray-700 font-bold mb-1">Start Label # (1-30)</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="30"
                                        value={startLabelNumber}
                                        onChange={(e) => setStartLabelNumber(Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 1)))}
                                        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 font-medium"
                                        title="Partial sheet saver: skip already used labels on the first sheet"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Avery Sheet Canvas Container */}
                    <div className="flex-1 bg-gray-200 p-6 overflow-auto">
                        <div className="space-y-8">
                            {sheets.map((sheetLabels, sheetIndex) => (
                                <div
                                    key={sheetIndex}
                                    className="avery-preview-sheet"
                                >
                                    <div className="avery-grid">
                                        {sheetLabels.map((lbl, idx) => {
                                            if (lbl.isBlank) {
                                                return (
                                                    <div
                                                        key={lbl.key}
                                                        className="avery-label border border-dashed border-gray-200 flex items-center justify-center text-[10px] text-gray-300 select-none"
                                                    >
                                                        (Empty)
                                                    </div>
                                                );
                                            }

                                            return (
                                                <div
                                                    key={lbl.key || idx}
                                                    className="avery-label border border-gray-100 flex items-center"
                                                >
                                                    {labelLayout === 'qr-left' && (
                                                        <div className="flex items-center w-full h-full gap-2 overflow-hidden">
                                                            <div
                                                                className="shrink-0 flex items-center justify-center overflow-hidden"
                                                                style={{ width: qrSizeInches, height: qrSizeInches }}
                                                                dangerouslySetInnerHTML={{ __html: lbl.qrSvg }}
                                                            />
                                                            <div className="flex-1 min-w-0 flex flex-col justify-center overflow-hidden pr-0.5">
                                                                <div className="text-[9.5px] leading-[1.2] font-bold text-gray-900 break-words line-clamp-2">
                                                                    {lbl.title}
                                                                </div>
                                                                {lbl.subtitle && (
                                                                    <div className="text-[8px] font-mono text-gray-600 truncate mt-0.5 leading-none">
                                                                        {lbl.subtitle}
                                                                    </div>
                                                                )}
                                                                {lbl.detail && (
                                                                    <div className="text-[8px] font-semibold text-blue-700 truncate mt-0.5 leading-none">
                                                                        {lbl.detail}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {labelLayout === 'qr-right' && (
                                                        <div className="flex items-center w-full h-full gap-2 overflow-hidden">
                                                            <div className="flex-1 min-w-0 flex flex-col justify-center overflow-hidden pr-0.5">
                                                                <div className="text-[9.5px] leading-[1.2] font-bold text-gray-900 break-words line-clamp-2">
                                                                    {lbl.title}
                                                                </div>
                                                                {lbl.subtitle && (
                                                                    <div className="text-[8px] font-mono text-gray-600 truncate mt-0.5 leading-none">
                                                                        {lbl.subtitle}
                                                                    </div>
                                                                )}
                                                                {lbl.detail && (
                                                                    <div className="text-[8px] font-semibold text-blue-700 truncate mt-0.5 leading-none">
                                                                        {lbl.detail}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div
                                                                className="shrink-0 flex items-center justify-center overflow-hidden"
                                                                style={{ width: qrSizeInches, height: qrSizeInches }}
                                                                dangerouslySetInnerHTML={{ __html: lbl.qrSvg }}
                                                            />
                                                        </div>
                                                    )}

                                                    {labelLayout === 'qr-center' && (
                                                        <div className="flex flex-col items-center justify-center w-full h-full overflow-hidden text-center">
                                                            <div
                                                                className="shrink-0 flex items-center justify-center overflow-hidden"
                                                                style={{ width: '0.50in', height: '0.50in' }}
                                                                dangerouslySetInnerHTML={{ __html: lbl.qrSvg }}
                                                            />
                                                            <div className="text-[8.5px] leading-[1.15] font-bold text-gray-900 break-words line-clamp-2 w-full mt-0.5 px-0.5">
                                                                {lbl.title}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {labelLayout === 'qr-only' && (
                                                        <div className="flex items-center justify-center w-full h-full overflow-hidden">
                                                            <div
                                                                className="shrink-0 flex items-center justify-center overflow-hidden"
                                                                style={{ width: '0.84in', height: '0.84in' }}
                                                                dangerouslySetInnerHTML={{ __html: lbl.qrSvg }}
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ========================================================= */}
            {/* TAB 3: QR DESIGNER & CUSTOMIZATION                        */}
            {/* ========================================================= */}
            {activeTab === 'designer' && (
                <main className="no-print flex-1 p-6 max-w-5xl mx-auto w-full grid grid-cols-1 md:grid-cols-12 gap-6">
                    <div className="md:col-span-6 space-y-5">
                        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 space-y-4">
                            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wider flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-blue-500" />
                                QR Code Properties
                            </h2>

                            <div className="grid grid-cols-2 gap-3 text-xs">
                                <div>
                                    <label className="block text-gray-600 font-medium mb-1">Error Correction</label>
                                    <select
                                        value={errorCorrection}
                                        onChange={(e) => setErrorCorrection(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="L">L (7% recovery)</option>
                                        <option value="M">M (15% - Recommended)</option>
                                        <option value="Q">Q (25% recovery)</option>
                                        <option value="H">H (30% high resilience)</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-gray-600 font-medium mb-1">Preview Record</label>
                                    <select
                                        value={previewRecord?.id || ''}
                                        onChange={(e) => setPreviewRecordId(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 truncate"
                                    >
                                        {(records || []).slice(0, 100).map((r) => (
                                            <option key={r.id} value={r.id}>
                                                {r.name || r.id}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-xs pt-2">
                                <div>
                                    <label className="block text-gray-600 font-medium mb-1">QR Foreground</label>
                                    <div className="flex items-center space-x-2">
                                        <input
                                            type="color"
                                            value={fgColor}
                                            onChange={(e) => setFgColor(e.target.value)}
                                            className="w-8 h-8 rounded border border-gray-300 cursor-pointer"
                                        />
                                        <span className="font-mono text-gray-700 uppercase">{fgColor}</span>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-gray-600 font-medium mb-1">QR Background</label>
                                    <div className="flex items-center space-x-2">
                                        <input
                                            type="color"
                                            value={bgColor}
                                            onChange={(e) => setBgColor(e.target.value)}
                                            className="w-8 h-8 rounded border border-gray-300 cursor-pointer"
                                        />
                                        <span className="font-mono text-gray-700 uppercase">{bgColor}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 space-y-3">
                            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wider flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-green-500" />
                                Encoded String Preview
                            </h2>
                            <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-xs text-gray-800 break-all select-all">
                                {previewRecord ? getPayloadForRecord(previewRecord) : 'No record selected'}
                            </div>
                        </div>
                    </div>

                    <div className="md:col-span-6 flex flex-col items-center justify-center bg-white rounded-2xl p-8 shadow-sm border border-gray-200 text-center">
                        <div
                            className="p-6 rounded-2xl border border-gray-100 shadow-md inline-block"
                            style={{ backgroundColor: bgColor }}
                        >
                            <div
                                className="w-64 h-64 flex items-center justify-center"
                                dangerouslySetInnerHTML={{
                                    __html: generateQRCodeSvg(
                                        previewRecord ? getPayloadForRecord(previewRecord) || ' ' : 'AIRTABLE',
                                        { errorCorrection, fgColor, bgColor, margin: 2 }
                                    ),
                                }}
                            />
                        </div>

                        <div className="mt-6">
                            <button
                                onClick={handleDownloadPng}
                                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm flex items-center gap-2 transition"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                Download PNG (512x512)
                            </button>
                        </div>
                    </div>
                </main>
            )}
        </div>
    );
}

initializeBlock(() => <QRGenerator />);
