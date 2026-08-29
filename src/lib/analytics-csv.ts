function spreadsheetSafe(value: string): string {
    return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function analyticsCsvCell(value: unknown): string {
    const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return `"${spreadsheetSafe(text).replaceAll('"', '""')}"`;
}

export function analyticsCsv(rows: unknown[]): string {
    const objects = rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
    const columns = [...new Set(objects.flatMap(row => Object.keys(row)))];
    return [columns.map(analyticsCsvCell).join(','), ...objects.map(row => columns.map(key => analyticsCsvCell(row[key])).join(','))].join('\n');
}
